// ============================================
// INVEST PROM - PWA + Supabase Cloud Backend
// ============================================

// --- STATE ---
let DATA = { apartments: [], garages: [], ostave: [], receipts: [],
             users: [], customer_data: {}, activity_log: [], archive: [], roles: {} };
let currentView = 'dashboard';
let searchQuery = '';
let currentFilter = 'all';
let editingYear = 2025;
let currentUser = null;
let _supabaseClient = null;

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://hrtelkjsmrnhibnosmgc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PcEhVYpdID3j7-yEUv2v8w_QY5kZmwr';

// Local cache + session keys
const CACHE_KEY = 'investprom_cache_v1';
const USER_KEY  = 'investprom_users_v1';
const SESSION_KEY  = 'investprom_session_v1';
const BIOMETRIC_KEY = 'investprom_biometric_v1';
const STORAGE_KEY = CACHE_KEY; // alias for legacy calls

// --- SUPABASE CLIENT ---
function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  if (typeof window !== 'undefined' && window.supabase) {
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabaseClient;
}

// --- ONLINE STATUS ---
let _isOnline = navigator.onLine;
window.addEventListener('online',  () => {
  _isOnline = true;
  syncFromSupabase().then(() => showToast('Sinhronizovano ✓', 'success'));
});
window.addEventListener('offline', () => {
  _isOnline = false;
  showToast('Offline — promjene se čuvaju lokalno', 'warning');
});

// --- LOAD DATA ---
async function loadData() {
  // 1. Load cache for instant startup
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const p = JSON.parse(cached);
      DATA.apartments    = p.apartments    || [];
      DATA.garages       = p.garages       || [];
      DATA.ostave        = p.ostave        || [];
      DATA.receipts      = p.receipts      || [];
      DATA.customer_data = p.customer_data || {};
      DATA.activity_log  = p.activity_log  || [];
      DATA.archive       = p.archive       || [];
      DATA.roles         = p.roles         || {};
    } catch(e) {}
  }
  // 2. Sync from Supabase (if online)
  if (_isOnline) await syncFromSupabase();
  else if (!cached) {
    // First run + offline: use bundled data.json
    try {
      const res = await fetch('data.json');
      const init = await res.json();
      DATA.apartments = init.apartments || [];
      DATA.garages    = init.garages    || [];
      DATA.ostave     = init.ostave     || [];
      DATA.receipts = []; DATA.customer_data = {};
      DATA.activity_log = []; DATA.archive = []; DATA.roles = {};
      saveToCache();
    } catch(e) { console.error('loadData fallback error', e); }
  }
}

// --- SYNC FROM SUPABASE ---
async function syncFromSupabase() {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const showSync = document.getElementById('syncIndicator');
    if (showSync) showSync.style.display = 'flex';

    const [apts, aptPays, gars, garPays, osts, rcpts, custData, logs, profiles] = await Promise.all([
      sb.from('apartments').select('*').order('lamela').order('stan'),
      sb.from('apartment_payments').select('*'),
      sb.from('garages').select('*').order('broj'),
      sb.from('garage_payments').select('*'),
      sb.from('ostave').select('*'),
      sb.from('receipts').select('*').order('created_at', { ascending: false }),
      sb.from('customer_data').select('*'),
      sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('user_profiles').select('username, role')
    ]);

    if (apts.error) throw new Error(apts.error.message);

    // Build payment maps
    const aptPayMap = {}, garPayMap = {};
    (aptPays.data||[]).forEach(p => {
      const mk = (p.payment_date||'').substring(0,7) || p.month_key;
      if (!aptPayMap[p.apartment_id]) aptPayMap[p.apartment_id] = {};
      aptPayMap[p.apartment_id][mk] = (aptPayMap[p.apartment_id][mk]||0) + parseFloat(p.amount||0);
    });
    (garPays.data||[]).forEach(p => {
      const mk = (p.payment_date||'').substring(0,7) || p.month_key;
      if (!garPayMap[p.garage_id]) garPayMap[p.garage_id] = {};
      garPayMap[p.garage_id][mk] = (garPayMap[p.garage_id][mk]||0) + parseFloat(p.amount||0);
    });

    DATA.apartments = (apts.data||[]).map(a => ({
      _id: a.id, lamela: a.lamela, stan: a.stan, sprat: a.sprat||'',
      ime: a.ime||'', prodat: a.prodat, vlasnik_parcele: a.vlasnik_parcele,
      ugovor: a.ugovor, predugovor: a.predugovor||false,
      povrsina: +a.povrsina||0, cena_m2: +a.cena_m2||0, cena_m2_pdv: +a.cena_m2_pdv||0,
      vrednost_bez_pdv: +a.vrednost_bez_pdv||0, vrednost_sa_pdv: +a.vrednost_sa_pdv||0,
      isplaceno: +a.isplaceno||0, preostalo: +a.preostalo||0,
      napomena: a.napomena||'', ugovorena_cena: a.ugovorena_cena ? +a.ugovorena_cena : null,
      datum_prodaje: a.datum_prodaje||null, plan_otplate: a.plan_otplate||null,
      slike: a.slike||[], uplate: aptPayMap[a.id]||{},
      uplate_dates: {}, planirane_rate: {}
    }));

    DATA.garages = (gars.data||[]).map(g => ({
      _id: g.id, broj: g.broj, ime: g.ime||'', vlasnik_parcele: g.vlasnik_parcele,
      povrsina: +g.povrsina||0, prodat: g.prodat,
      vrednost: +g.vrednost||0, naplaceno: +g.naplaceno||0, preostalo: +g.preostalo||0,
      datum_prodaje: g.datum_prodaje||null, plan_otplate: g.plan_otplate||null,
      uplate: garPayMap[g.id]||{}, uplate_dates: {}
    }));

    DATA.ostave = (osts.data||[]).map(o => ({
      _id: o.id, tip: o.tip, nivo: o.nivo, lamela: o.lamela||'', broj: o.broj,
      ime: o.ime||'', vlasnik_parcele: o.vlasnik_parcele,
      povrsina: +o.povrsina||0, prodat: o.prodat,
      vrednost: +o.vrednost||0, naplaceno: +o.naplaceno||0, preostalo: +o.preostalo||0,
      datum_prodaje: o.datum_prodaje||null, uplate: {}, uplate_dates: {}
    }));

    DATA.receipts = (rcpts.data||[]).map(r => ({
      id: r.id, number: r.number, payer: r.payer, itemType: r.item_type,
      itemId: r.item_id, lamela: r.lamela, itemDesc: r.item_desc,
      amount: +r.amount||0, method: r.method, date: r.payment_date,
      paymentMonth: r.payment_month, note: r.note, issuedBy: r.issued_by,
      timestamp: new Date(r.created_at).getTime()
    }));

    DATA.customer_data = {};
    (custData.data||[]).forEach(c => {
      DATA.customer_data[c.customer_key] = { telefon: c.telefon, dokumenti: c.dokumenti||[] };
    });

    DATA.activity_log = (logs.data||[]).map(l => ({
      ts: new Date(l.created_at).getTime(), user: l.username,
      action: l.action, details: l.details
    }));

    DATA.roles = {};
    (profiles.data||[]).forEach(p => { DATA.roles[p.username] = p.role; });

    saveToCache();
    if (showSync) showSync.style.display = 'none';
    if (document.getElementById('app')?.classList.contains('active')) renderView();

  } catch(err) {
    console.warn('Supabase sync failed:', err.message);
    const showSync = document.getElementById('syncIndicator');
    if (showSync) showSync.style.display = 'none';
  }
}

// --- SAVE TO CACHE ---
function saveToCache() {
  try {
    const cutoff = Date.now() - 30*24*60*60*1000;
    if (DATA.archive) DATA.archive = DATA.archive.filter(a => a.deletedAt > cutoff);
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      apartments: DATA.apartments, garages: DATA.garages, ostave: DATA.ostave,
      receipts: DATA.receipts, customer_data: DATA.customer_data,
      activity_log: (DATA.activity_log||[]).slice(0,100),
      archive: DATA.archive||[], roles: DATA.roles||{}
    }));
  } catch(e) {}
}

// saveData = alias that also triggers cache save
function saveData() { saveToCache(); }

// --- SUPABASE WRITE HELPERS ---
async function sbSave(table, data, conflict) {
  const sb = getSupabase();
  if (!sb || !_isOnline) return null;
  const { data: result, error } = await sb.from(table).upsert(data, conflict ? { onConflict: conflict } : undefined).select('id').single();
  if (error) { console.error('sbSave', table, error.message); return null; }
  return result?.id;
}

async function sbUpsertApartment(a) {
  const id = await sbSave('apartments', {
    id: a._id||undefined, lamela: a.lamela, stan: a.stan, sprat: a.sprat, ime: a.ime,
    prodat: a.prodat, vlasnik_parcele: a.vlasnik_parcele, ugovor: a.ugovor, predugovor: a.predugovor||false,
    povrsina: a.povrsina, cena_m2: a.cena_m2, cena_m2_pdv: a.cena_m2_pdv,
    vrednost_bez_pdv: a.vrednost_bez_pdv, vrednost_sa_pdv: a.vrednost_sa_pdv,
    isplaceno: a.isplaceno, preostalo: a.preostalo, napomena: a.napomena,
    ugovorena_cena: a.ugovorena_cena||null, datum_prodaje: a.datum_prodaje||null,
    plan_otplate: a.plan_otplate||null, slike: a.slike||[]
  }, 'lamela,stan');
  if (id && !a._id) a._id = id;
}

async function sbUpsertGarage(g) {
  const id = await sbSave('garages', {
    id: g._id||undefined, broj: g.broj, ime: g.ime, vlasnik_parcele: g.vlasnik_parcele,
    povrsina: g.povrsina, prodat: g.prodat, vrednost: g.vrednost,
    naplaceno: g.naplaceno, preostalo: g.preostalo,
    datum_prodaje: g.datum_prodaje||null, plan_otplate: g.plan_otplate||null
  }, 'broj');
  if (id && !g._id) g._id = id;
}

async function sbUpsertOstava(o) {
  const id = await sbSave('ostave', {
    id: o._id||undefined, tip: o.tip, nivo: o.nivo, lamela: o.lamela||'',
    broj: o.broj, ime: o.ime, vlasnik_parcele: o.vlasnik_parcele,
    povrsina: o.povrsina, prodat: o.prodat, vrednost: o.vrednost,
    naplaceno: o.naplaceno, preostalo: o.preostalo, datum_prodaje: o.datum_prodaje||null
  });
  if (id && !o._id) o._id = id;
}

async function sbInsertPayment(table, fkField, fkId, monthKey, amount, date) {
  const sb = getSupabase();
  if (!sb || !_isOnline || !fkId) return;
  const row = { month_key: monthKey, amount, payment_date: date||null, tip: 'uplata' };
  row[fkField] = fkId;
  const { error } = await sb.from(table).insert(row);
  if (error) console.error('sbInsertPayment', table, error.message);
}

async function sbInsertReceipt(r) {
  const sb = getSupabase();
  if (!sb || !_isOnline) return;
  const { error } = await sb.from('receipts').insert({
    id: r.id, number: r.number, payer: r.payer, item_type: r.itemType,
    item_id: r.itemId, lamela: r.lamela, item_desc: r.itemDesc,
    amount: r.amount, method: r.method, payment_date: r.date,
    payment_month: r.paymentMonth, note: r.note, issued_by: r.issuedBy
  });
  if (error) console.error('sbInsertReceipt', error.message);
}

async function sbUpsertCustomerData(key, data) {
  const sb = getSupabase();
  if (!sb || !_isOnline) return;
  await sb.from('customer_data').upsert({
    customer_key: key, customer_name: key,
    telefon: data.telefon||null, dokumenti: data.dokumenti||[]
  }, { onConflict: 'customer_key' });
}

// --- LOG ACTIVITY ---
function logActivity(action, details) {
  if (!DATA.activity_log) DATA.activity_log = [];
  DATA.activity_log.unshift({ ts: Date.now(), user: currentUser||'sistem', action, details: details||'' });
  if (DATA.activity_log.length > 500) DATA.activity_log = DATA.activity_log.slice(0, 500);
  if (_isOnline) {
    const sb = getSupabase();
    if (sb) sb.from('activity_log').insert({ action, details: details||'', username: currentUser||'sistem' }).then(() => {});
  }
}

// --- ARCHIVE ---
function archiveItem(type, data) {
  if (!DATA.archive) DATA.archive = [];
  DATA.archive.unshift({ type, data: JSON.parse(JSON.stringify(data)), deletedAt: Date.now(), deletedBy: currentUser });
}

function restoreFromArchive(idx) {
  const item = DATA.archive[idx]; if (!item) return;
  if (item.type === 'apartment') DATA.apartments.push(item.data);
  else if (item.type === 'garage') DATA.garages.push(item.data);
  else if (item.type === 'ostava') DATA.ostave.push(item.data);
  DATA.archive.splice(idx, 1);
  logActivity('SISTEM', 'Obnovljeno iz arhive');
  saveToCache(); renderView();
  showToast('Stavka obnovljena', 'success');
}

// --- ROLES ---
function currentRole() {
  if (!DATA.roles || !currentUser) return 'admin';
  return DATA.roles[currentUser] || 'admin';
}
function canAccess(feature) {
  return currentRole() === 'admin' || !['statistika'].includes(feature);
}


// --- HASH (simple SHA-256) ---
function closeModal() {
  const m = document.getElementById('modal');
  if (m) m.classList.remove('active');
}

function closeModalOnBackdrop(e) {
  if (e.target.id === 'modal') closeModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

function saveUsers() {
  localStorage.setItem(USER_KEY, JSON.stringify(DATA.users || []));
}

async function hashPassword(pw) {
  const buf = new TextEncoder().encode(pw + 'investprom_salt_2025');
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// --- AUTH ---
async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Unesite korisničko ime i lozinku'; return; }
  const btn = document.querySelector('#loginScreen .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Prijava...'; }
  try {
    const sb = getSupabase();
    if (sb && _isOnline) {
      // If username (not email), look up real email from auth.users via user_profiles
      let email = username;
      if (!username.includes('@')) {
        // Try to find email by username through user_profiles
        const { data: profile } = await sb.from('user_profiles').select('id, username').eq('username', username).single();
        if (profile?.id) {
          // We have the user ID, construct email or use stored mapping
          // Try common email patterns
          email = username + '@dacicprom.investprom';
          // First try with Gmail pattern stored in session
          const cached = localStorage.getItem('investprom_email_map');
          if (cached) {
            const map = JSON.parse(cached);
            if (map[username]) email = map[username];
          }
        }
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        // Fallback to legacy local users
        const legacyUsers = JSON.parse(localStorage.getItem(USER_KEY) || '[]');
        const hash = await hashPassword(password);
        const legacyUser = Array.isArray(legacyUsers) && legacyUsers.find(u => u.username === username && u.passwordHash === hash);
        if (legacyUser) {
          currentUser = username;
          localStorage.setItem(SESSION_KEY, JSON.stringify({ user: username, ts: Date.now() }));
          enterApp(); return;
        }
        errEl.textContent = 'Pogrešno korisničko ime ili lozinka';
        return;
      }
      // Get username from user_profiles table
      let resolvedUsername = username;
      try {
        const { data: profile } = await sb.from('user_profiles').select('username').eq('id', data.user.id).single();
        if (profile?.username) resolvedUsername = profile.username;
        // Save email mapping for future logins
        const map = JSON.parse(localStorage.getItem('investprom_email_map') || '{}');
        map[resolvedUsername] = data.user.email;
        localStorage.setItem('investprom_email_map', JSON.stringify(map));
      } catch(e) {}
      currentUser = resolvedUsername;
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        user: currentUser, ts: Date.now(),
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token
      }));
      enterApp();
    } else {
      // Offline login via cached credentials
      const legacyUsers = JSON.parse(localStorage.getItem(USER_KEY) || '[]');
      const hash = await hashPassword(password);
      const found = Array.isArray(legacyUsers) && legacyUsers.find(u => u.username === username && u.passwordHash === hash);
      if (!found) {
        // First time offline - auto-register
        if (!Array.isArray(legacyUsers) || legacyUsers.length === 0) {
          const newUsers = [{ username, passwordHash: hash, createdAt: Date.now() }];
          localStorage.setItem(USER_KEY, JSON.stringify(newUsers));
          if (!DATA.roles) DATA.roles = {};
          DATA.roles[username] = 'admin';
          currentUser = username;
          localStorage.setItem(SESSION_KEY, JSON.stringify({ user: username, ts: Date.now() }));
          showToast('Nalog kreiran. Dobrodošli!', 'success');
          enterApp(); return;
        }
        errEl.textContent = 'Pogrešno korisničko ime ili lozinka';
        return;
      }
      currentUser = username;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user: username, ts: Date.now() }));
      showToast('Prijavili ste se offline', 'warning');
      enterApp();
    }
  } catch(e) {
    errEl.textContent = 'Greška: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Prijava'; }
  }
}


async function doBiometric() {
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  
  if (!window.PublicKeyCredential) {
    errEl.textContent = 'Vaš uređaj ne podržava otisak prsta';
    return;
  }
  
  const stored = localStorage.getItem(BIOMETRIC_KEY);
  if (!stored) {
    errEl.textContent = 'Prvo se prijavite sa lozinkom, pa idite u podešavanja da aktivirate otisak';
    return;
  }
  
  try {
    const biom = JSON.parse(stored);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: Uint8Array.from(atob(biom.credentialId), c => c.charCodeAt(0)),
          type: 'public-key'
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    
    if (credential) {
      currentUser = biom.username;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user: biom.username, ts: Date.now() }));
      enterApp();
    }
  } catch (e) {
    errEl.textContent = 'Prijava otiskom nije uspela';
    console.error(e);
  }
}

function openSettings() {
  const hasBiom = !!localStorage.getItem(BIOMETRIC_KEY);
  const biomData = hasBiom ? JSON.parse(localStorage.getItem(BIOMETRIC_KEY)) : null;
  const supported = !!window.PublicKeyCredential;
  const isAdmin = currentRole() === 'admin';
  const allUsers = DATA.users ? Object.keys(DATA.users) : [currentUser];
  const archiveCount = (DATA.archive || []).length;
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '600px';
  m.innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">⚙️ Podešavanja</div>
        <div class="modal-title-sub">${currentUser} · ${isAdmin ? 'Administrator' : 'Prodavac'}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      
      <!-- Otisak prsta -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">👆 Prijava otiskom prsta</h3>
      <div style="background:var(--surface-2); padding:14px; border-radius:8px; margin-bottom:16px;">
        ${!supported ? `<div style="color:var(--warning);">⚠️ Uređaj ne podržava biometriju</div>` 
        : hasBiom ? `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div><div style="font-weight:600; color:var(--success);">✓ Otisak aktivan za: ${biomData.username}</div></div>
            <button class="btn btn-secondary" onclick="disableBiometric()" style="font-size:12px;">Isključi</button>
          </div>` 
        : `<button class="btn btn-primary" onclick="enableBiometric()" style="width:100%;">👆 Aktiviraj otisak prsta</button>
           <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">Aktivira se samo za ovaj uređaj.</div>`}
      </div>
      
      ${isAdmin ? `
      <!-- Role korisnika - samo admin -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">👥 Role korisnika</h3>
      <div style="background:var(--surface-2); padding:14px; border-radius:8px; margin-bottom:16px;">
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Administrator ima pristup svim podacima uključujući Statistiku. Prodavac nema pristup Statistici.</div>
        ${allUsers.map(u => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--border);">
            <div>
              <strong>${u}</strong>
              ${u === currentUser ? ' <span style="font-size:10px; color:var(--accent);">(vi)</span>' : ''}
            </div>
            <select onchange="setUserRole('${u}', this.value)" style="background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:5px 10px; color:var(--text); font-size:13px;">
              <option value="admin" ${(DATA.roles?.[u]||'admin')==='admin' ? 'selected' : ''}>Administrator</option>
              <option value="prodavac" ${(DATA.roles?.[u])==='prodavac' ? 'selected' : ''}>Prodavac</option>
            </select>
          </div>
        `).join('')}
      </div>
      
      <!-- Arhiva - samo admin -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">🗄️ Arhiva izbrisanih stavki</h3>
      <div style="background:var(--surface-2); padding:14px; border-radius:8px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600;">${archiveCount} ${archiveCount===1?'stavka':'stavki'} u arhivi</div>
            <div style="font-size:12px; color:var(--text-dim);">Čuvaju se 30 dana, zatim se automatski brišu</div>
          </div>
          ${archiveCount > 0 ? `<button class="btn btn-secondary" onclick="openArchiveView()" style="font-size:12px;">Pregled →</button>` : ''}
        </div>
      </div>
      ` : ''}
      
      <!-- Tema -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">🎨 Tema</h3>
      <div style="background:var(--surface-2); padding:12px 14px; border-radius:8px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between;">
        <div>
          <div style="font-weight:600;" id="themeLabel">${document.documentElement.dataset.theme === 'light' ? '☀️ Svetla tema' : '🌙 Tamna tema'}</div>
          <div style="font-size:12px; color:var(--text-dim);">Tamna je bolja za rad, svetla za štampu</div>
        </div>
        <button class="btn btn-secondary" onclick="toggleTheme()" style="font-size:13px;">Promeni</button>
      </div>
      
      <!-- Backup/Restore -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">💾 Backup i obnova</h3>
      <div style="background:var(--surface-2); padding:14px; border-radius:8px; margin-bottom:16px;">
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Izvezite sve podatke u JSON fajl i sačuvajte na sigurno mjesto. Uvoz vraća sve podatke.</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="backupData()" style="flex:1; min-width:120px;">⬇️ Izvezi backup</button>
          <label class="btn btn-secondary" style="flex:1; min-width:120px; cursor:pointer; justify-content:center;">
            ⬆️ Uvezi backup
            <input type="file" accept=".json" onchange="restoreData(this)" style="display:none;">
          </label>
        </div>
      </div>
      
      <!-- Info -->
      <h3 style="font-size:13px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px;">📦 Podaci</h3>
      <div style="background:var(--surface-2); padding:14px; border-radius:8px;">
        ${[['Verzija','v13'],['Stanova',DATA.apartments.length],['Garaža',DATA.garages.length],['Ostava',DATA.ostave.length],['Priznanica',DATA.receipts?.length||0]].map(([l,v])=>`
          <div style="display:flex; justify-content:space-between; font-size:13px; padding:3px 0;">
            <span style="color:var(--text-dim);">${l}:</span><strong>${v}</strong>
          </div>`).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function addAptPhotos(input, lamela, stan) {
  const files = Array.from(input.files);
  const a = findApartment(lamela, stan);
  if (!a) return;
  if (!a.slike) a.slike = [];
  
  let processed = 0;
  files.forEach(file => {
    if (a.slike.length >= 4) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // Compress via canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.72);
        a.slike.push(compressed);
        processed++;
        if (processed === files.length || a.slike.length >= 4) {
          saveToCache();
          // Refresh photo area
          openApartment(lamela, stan);
          showToast(`Fotografija dodana`, 'success');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function removeAptPhoto(idx) {
  // Find current apartment from _editingApt context
  const m = document.getElementById('f_lamela');
  if (!m) return;
  const lamela = m.value;
  const stan = parseInt(document.getElementById('f_stan').value);
  const a = findApartment(lamela, stan);
  if (!a || !a.slike) return;
  a.slike.splice(idx, 1);
  saveToCache();
  openApartment(lamela, stan);
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  document.documentElement.dataset.theme = isLight ? '' : 'light';
  localStorage.setItem('investprom_theme', isLight ? 'dark' : 'light');
  // Update label if settings still open
  const lbl = document.getElementById('themeLabel');
  if (lbl) lbl.textContent = isLight ? '🌙 Tamna tema' : '☀️ Svetla tema';
}

function applyTheme() {
  const saved = localStorage.getItem('investprom_theme');
  if (saved === 'light') document.documentElement.dataset.theme = 'light';
}

function backupData() {
  const backup = {
    version: 'v13',
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser,
    data: JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
    users: JSON.parse(localStorage.getItem(USER_KEY) || '{}')
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `EvidencijaStanova_backup_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  logActivity('SISTEM', 'Backup podataka izvezen');
  showToast('Backup izvezen', 'success');
}

function restoreData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.data || !backup.data.apartments) {
        showToast('Nevažeći backup fajl', 'error');
        return;
      }
      if (!confirm(`Uvesti backup od ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString('sr') : 'nepoznat datum'}?\n\nOVO ĆE ZAMIJENITI SVE TRENUTNE PODATKE!`)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backup.data));
      if (backup.users) localStorage.setItem(USER_KEY, JSON.stringify(backup.users));
      showToast('Backup uvezen! Stranica se osvježava...', 'success');
      setTimeout(() => location.reload(), 1500);
    } catch(err) {
      showToast('Greška: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function setUserRole(username, role) {
  if (!DATA.roles) DATA.roles = {};
  DATA.roles[username] = role;
  saveToCache();
  const sb = getSupabase();
  if (sb && _isOnline) {
    sb.from('user_profiles').upsert({ username, role }, { onConflict: 'username' }).then(()=>{});
  }
  showToast(`Rola "${username}" → ${role === 'admin' ? 'Administrator' : 'Prodavac'}`, 'success');
}

function openArchiveView() {
  const archive = DATA.archive || [];
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '700px';
  m.innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">🗄️ Arhiva izbrisanih stavki</div>
        <div class="modal-title-sub">Čuvaju se 30 dana</div>
      </div>
      <button class="modal-close" onclick="openSettings()">←</button>
    </div>
    <div class="modal-body">
      ${archive.length === 0 ? '<div class="empty-state" style="padding:40px;">Arhiva je prazna</div>' : `
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${archive.map((item, idx) => {
            const d = item.data;
            const label = item.type === 'apartment' ? `Stan ${d.lamela}-${d.stan} · ${d.ime||'bez kupca'}`
              : item.type === 'garage' ? `Garaža G-${d.broj} · ${d.ime||''}` 
              : `Ostava ${d.broj||''} · ${d.ime||''}`;
            const daysLeft = Math.ceil((item.deletedAt + 30*24*60*60*1000 - Date.now()) / (24*60*60*1000));
            return `
              <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div>
                  <div style="font-weight:600;">${label}</div>
                  <div style="font-size:12px; color:var(--text-dim);">Obrisano: ${fmtDate(item.deletedAt)} · Briše se za ${daysLeft} dana</div>
                </div>
                <button class="btn btn-secondary" onclick="restoreFromArchive(${idx}); openArchiveView();" style="font-size:12px; flex-shrink:0;">↩️ Obnovi</button>
              </div>`;
          }).join('')}
        </div>
      `}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="openSettings()">Nazad</button>
    </div>
  `;
}

function disableBiometric() {
  if (!confirm('Isključiti prijavu otiskom prsta?')) return;
  localStorage.removeItem(BIOMETRIC_KEY);
  showToast('Otisak prsta isključen', 'success');
  openSettings();
}

async function enableBiometric() {
  if (!window.PublicKeyCredential) {
    showToast('Uređaj ne podržava biometriju', 'error');
    return;
  }
  
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(currentUser);
    
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Evidencija Stanova' },
        user: {
          id: userId,
          name: currentUser,
          displayName: currentUser
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });
    
    const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    localStorage.setItem(BIOMETRIC_KEY, JSON.stringify({
      username: currentUser,
      credentialId: credId
    }));
    showToast('✓ Otisak prsta je aktiviran', 'success');
    // Refresh settings view if open
    if (document.getElementById('modal').classList.contains('active')) {
      openSettings();
    }
  } catch (e) {
    showToast('Aktivacija otiska nije uspela: ' + (e.message || ''), 'error');
    console.error(e);
  }
}

function doLogout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
}

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  document.getElementById('currentUser').textContent = currentUser;
  const role = currentRole();
  const statNav = document.getElementById('nav-statistika');
  if (statNav) statNav.style.display = role === 'admin' ? '' : 'none';
  logActivity('LOGIN', `Prijava: ${currentUser} (${role})`);
  saveToCache();
  updateNotificationBadge();
  switchView('dashboard');
}

// Upcoming rates in next 7 days
const RECENT_KEY = 'investprom_recent_v1';

function trackRecent(type, data) {
  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    // Remove duplicate
    const filtered = recent.filter(r => !(r.type === type && JSON.stringify(r.data) === JSON.stringify(data)));
    filtered.unshift({ type, data, ts: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 8)));
  } catch(e) {}
}

function getRecentItems() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch(e) { return []; }
}

function recentAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'upravo';
  if (diff < 3600000) return Math.floor(diff/60000) + ' min';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' h';
  return Math.floor(diff/86400000) + ' dana';
}

function recentOnclick(r) {
  const d = r.data;
  if (r.type === 'apartment') return "openApartment('" + d.lamela + "'," + d.stan + ")";
  if (r.type === 'garage') return "openGarage(" + d.broj + ")";
  if (r.type === 'customer') return "openCustomerProfile('" + d.key + "')";
  return '';
}

function renderRecentPanel() {
  const recent = getRecentItems().slice(0, 5);
  if (recent.length === 0) return '';
  let rows = '';
  recent.forEach(r => {
    const d = r.data;
    const ago = recentAgo(r.ts);
    const oc = recentOnclick(r);
    rows += `<div onclick="${oc}" style="padding:10px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; align-items:center; gap:12px; transition:background 0.1s;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
      <span style="font-size:22px; flex-shrink:0;">${d.icon}</span>
      <div style="flex:1; min-width:0; overflow:hidden;">
        <div style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.label}</div>
        <div style="font-size:12px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.sub||''}</div>
      </div>
      <div style="font-size:11px; color:var(--text-dim); flex-shrink:0; margin-left:8px;">${ago}</div>
    </div>`;
  });
  return `<div class="panel" style="margin-bottom:20px;"><div class="panel-header"><div class="panel-title" style="display:flex;align-items:center;gap:8px;"><span>🕐</span> Nedavno otvoreno</div></div><div>${rows}</div></div>`;
}
function getUpcomingRatesCount() {
  const now = new Date(); now.setHours(0,0,0,0);
  const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
  const nowKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const in7Key = `${in7.getFullYear()}-${String(in7.getMonth()+1).padStart(2,'0')}`;
  let count = 0;
  const items = [...DATA.apartments, ...(DATA.garages||[]), ...(DATA.ostave||[])];
  items.forEach(item => {
    if (!item.prodat || item.vlasnik_parcele) return;
    if (item.planirane_rate) {
      Object.keys(item.planirane_rate).forEach(mk => { if (mk >= nowKey && mk <= in7Key) count++; });
    }
    if (item.plan_otplate?.rate) {
      item.plan_otplate.rate.forEach(r => {
        if (r.isplacena || !r.datum) return;
        const d = new Date(r.datum); d.setHours(0,0,0,0);
        if (d >= now && d <= in7) count++;
      });
    }
  });
  return count;
}

function updateNotificationBadge() {
  const count = getUpcomingRatesCount();
  const badge = document.getElementById('kalendarBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// Check existing session on load
async function checkSession() {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    const s = JSON.parse(session);
    // Session valid for 30 days
    if (Date.now() - s.ts < 30 * 24 * 60 * 60 * 1000) {
      currentUser = s.user;
      enterApp();
      return true;
    }
  }
  return false;
}

// --- TOAST ---
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// --- NUMBER FORMATTING ---
// Tolerance for floating point comparison - anything under 0.5 EUR is considered paid off
const PAID_TOLERANCE = 0.5;
function isPaidOff(preostalo) {
  return !preostalo || preostalo <= PAID_TOLERANCE;
}
function hasDebt(preostalo) {
  return preostalo && preostalo > PAID_TOLERANCE;
}
// Format: 1,000,000.00 (thousand separator = comma, decimal = dot)
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtEur(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return '€ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtDate(d) {
  // dd/mm/yyyy
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function fmtDateTime(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return fmtDate(date) + ' ' + hh + ':' + mi;
}

// --- NAVIGATION ---
function switchView(view) {
  currentView = view;
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  
  const titles = {
    dashboard: 'Početna',
    apartments: 'Stanovi',
    garages: 'Garaže',
    ostave: 'Ostave',
    kalendar: 'Kalendar priliva',
    customers: 'Kupci',
    vlasnici: 'Vlasnici parcela',
    statistika: 'Statistika',
    activity: 'Dnevnik izmena',
    receipts: 'Priznanice'
  };
  document.getElementById('pageTitle').textContent = titles[view];
  document.getElementById('searchBox').style.display = (view === 'dashboard' || view === 'statistika' || view === 'kalendar' || view === 'activity') ? 'none' : 'block';
  document.getElementById('exportBtn').style.display = (view === 'dashboard' || view === 'statistika' || view === 'kalendar' || view === 'activity') ? 'none' : 'inline-flex';
  
  renderView();
}

function applySearch() {
  searchQuery = document.getElementById('searchInput').value.toLowerCase();
  renderView();
}

function renderView() {
  const c = document.getElementById('content');
  if (currentView === 'dashboard') renderDashboard(c);
  else if (currentView === 'apartments') renderApartments(c);
  else if (currentView === 'garages') renderGarages(c);
  else if (currentView === 'ostave') renderOstave(c);
  else if (currentView === 'kalendar') renderKalendar(c);
  else if (currentView === 'customers') renderCustomers(c);
  else if (currentView === 'vlasnici') renderVlasnici(c);
  else if (currentView === 'statistika') renderStatistika(c);
  else if (currentView === 'activity') renderActivity(c);
  else if (currentView === 'receipts') renderReceipts(c);
}
// --- DASHBOARD ---
function renderDashboard(c) {
  const apts = DATA.apartments;
  const gar = DATA.garages;
  const ost = DATA.ostave;
  
  // Isključi vlasnike parcela iz statistike prodaje
  const aptZaProdaju = apts.filter(a => !a.vlasnik_parcele);
  const garZaProdaju = gar.filter(g => !g.vlasnik_parcele);
  const ostZaProdaju = ost.filter(o => !o.vlasnik_parcele);
  
  const aptSold = aptZaProdaju.filter(a => a.prodat).length;
  const aptTotalVal = aptZaProdaju.reduce((s,a) => s + a.vrednost_sa_pdv, 0);
  const aptPaid = aptZaProdaju.reduce((s,a) => s + a.isplaceno, 0);
  const aptRemaining = aptZaProdaju.filter(a => a.prodat).reduce((s,a) => s + a.preostalo, 0);
  
  const garSold = garZaProdaju.filter(g => g.prodat).length;
  const garPaid = garZaProdaju.reduce((s,g) => s + g.naplaceno, 0);
  
  const ostSold = ostZaProdaju.filter(o => o.prodat).length;
  const ostPaid = ostZaProdaju.reduce((s,o) => s + o.naplaceno, 0);
  
  const totalPaid = aptPaid + garPaid + ostPaid;
  const totalRec = DATA.receipts.length;
  
  const recentReceipts = [...DATA.receipts].sort((a,b) => b.timestamp - a.timestamp).slice(0, 5);
  
  const outstanding = aptZaProdaju
    .filter(a => a.prodat && hasDebt(a.preostalo))
    .sort((a,b) => b.preostalo - a.preostalo)
    .slice(0, 5);
  
  // Recently sold items (across all types)
  const recentlySold = [];
  apts.forEach(a => {
    if (a.prodat && a.datum_prodaje) {
      recentlySold.push({
        type: 'apartment', label: `Stan ${a.lamela}-${a.stan}`,
        sprat: a.sprat, ime: a.ime, datum: a.datum_prodaje,
        vrednost: a.vrednost_sa_pdv, lamela: a.lamela, stan: a.stan
      });
    }
  });
  gar.forEach(g => {
    if (g.prodat && g.datum_prodaje) {
      recentlySold.push({
        type: 'garage', label: `Garaža G-${g.broj}`,
        sprat: `Nivo ${getGarageLevel(g.broj)}`, ime: g.ime, datum: g.datum_prodaje,
        vrednost: g.vrednost, broj: g.broj
      });
    }
  });
  ost.forEach((o, idx) => {
    if (o.prodat && o.datum_prodaje) {
      recentlySold.push({
        type: 'ostava', label: `Ostava ${o.broj || ''}`,
        sprat: o.nivo || '', ime: o.ime, datum: o.datum_prodaje,
        vrednost: o.vrednost, idx
      });
    }
  });
  recentlySold.sort((a,b) => (b.datum || '').localeCompare(a.datum || ''));
  const recentSoldTop = recentlySold.slice(0, 5);
  
  c.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Prodati stanovi</div>
        <div class="stat-value accent">${aptSold} / ${aptZaProdaju.length}</div>
        <div class="stat-sub">${aptZaProdaju.length > 0 ? ((aptSold/aptZaProdaju.length)*100).toFixed(1) : 0}% od ${aptZaProdaju.length} za prodaju</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Naplaćeno (stanovi)</div>
        <div class="stat-value success">${fmtEur(aptPaid)}</div>
        <div class="stat-sub">Preostalo: ${fmtEur(aptRemaining)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Garaže prodato</div>
        <div class="stat-value">${garSold} / ${garZaProdaju.length}</div>
        <div class="stat-sub">Naplaćeno: ${fmtEur(garPaid)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ukupno naplaćeno</div>
        <div class="stat-value accent">${fmtEur(totalPaid)}</div>
        <div class="stat-sub">${totalRec} priznanica izdato</div>
      </div>
    </div>
    
    <!-- Prodaja po mesecima -->
    ${renderMonthlySalesChart()}
    ${renderUpcomingRatesPanel()}
    ${renderRecentPanel()}
    
    <div class="dashboard-row">
      ${recentSoldTop.length > 0 ? `
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="display:flex; align-items:center; gap:8px;">
            <span style="color:var(--success);">🔑</span> Nedavno prodato
          </div>
          <div style="font-size:12px; color:var(--text-dim);">${recentlySold.length} ${recentlySold.length === 1 ? 'prodaja' : 'prodaja'}</div>
        </div>
        <div class="panel-body" style="padding:0;">
          ${recentSoldTop.map(s => {
            const monthsFull = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
            const d = new Date(s.datum);
            const monthYear = `${monthsFull[d.getMonth()]} ${d.getFullYear()}`;
            const onclickAction = s.type === 'apartment' 
              ? `openApartment('${s.lamela}', ${s.stan})`
              : s.type === 'garage' 
                ? `openGarage(${s.broj})`
                : `openOstava(${s.idx})`;
            return `
              <div class="outstanding-row" onclick="${onclickAction}" style="cursor:pointer;">
                <div>
                  <div style="font-weight:600; color:var(--accent); font-size:13px;">${s.label}</div>
                  <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">${s.ime || '(bez kupca)'} · ${s.sprat || ''}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:12px; color:var(--success); font-weight:600;">${monthYear}</div>
                  <div style="font-size:11px; color:var(--text-dim);">${fmtDate(s.datum)}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      ` : ''}
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title" style="display:flex; align-items:center; gap:8px;">
            <span style="color:var(--danger);">⚠</span> Kupci koji kasne sa ratama
          </div>
          <button class="btn btn-ghost" onclick="switchView('apartments'); setTimeout(() => setFilter('arrears'), 100);">Svi →</button>
        </div>
        <div class="panel-body" style="padding:0;">
          ${(() => {
            const arrearsList = DATA.apartments
              .map(a => ({ a, info: getArrearsInfo(a) }))
              .filter(x => x.info)
              .sort((x,y) => (y.info.months || 999) - (x.info.months || 999))
              .slice(0, 5);
            if (arrearsList.length === 0) return '<div class="empty-state" style="padding:30px;">✓ Svi su uredni sa ratama</div>';
            return '<table class="data-table"><tbody>' + arrearsList.map(x => `
              <tr onclick="openApartment('${x.a.lamela}', ${x.a.stan})">
                <td style="width:60px;"><strong>${x.a.lamela}-${x.a.stan}</strong></td>
                <td>${x.a.ime || '—'}<br><span class="arrears-tag ${x.info.level}">⚠ ${x.info.text}</span></td>
                <td class="num" style="color:var(--danger); font-weight:600;">${fmtEur(x.a.preostalo)}</td>
              </tr>
            `).join('') + '</tbody></table>';
          })()}
        </div>
      </div>
      
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Najveći preostali iznosi</div>
          <button class="btn btn-ghost" onclick="switchView('apartments')">Svi stanovi →</button>
        </div>
        <div class="panel-body" style="padding:0;">
          ${outstanding.length === 0 ? '<div class="empty-state">Nema preostalih uplata</div>' :
            '<table class="data-table"><tbody>' + outstanding.map(a => `
              <tr onclick="openApartment('${a.lamela}', ${a.stan})">
                <td style="width:60px;"><strong>${a.lamela}-${a.stan}</strong></td>
                <td>${a.ime || '—'}</td>
                <td class="num" style="color:var(--danger); font-weight:600;">${fmtEur(a.preostalo)}</td>
              </tr>
            `).join('') + '</tbody></table>'}
        </div>
      </div>
    </div>
    
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header">
        <div class="panel-title">Nedavne priznanice</div>
        <button class="btn btn-ghost" onclick="switchView('receipts')">Sve →</button>
      </div>
      <div class="panel-body" style="padding:0;">
        ${recentReceipts.length === 0 ? '<div class="empty-state">Još nema priznanica</div>' :
          recentReceipts.map(r => `
            <div class="receipt-list-item" onclick="viewReceipt('${r.id}')">
              <div class="receipt-list-num">${r.number}</div>
              <div class="receipt-list-info">
                <div class="name">${r.payer}</div>
                <div class="sub">${r.itemType} ${r.itemId} · ${fmtDate(r.timestamp)}</div>
              </div>
              <div class="receipt-list-amount">${fmtEur(r.amount)}</div>
            </div>
          `).join('')}
      </div>
    </div>
    
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Mesečna naplata - ${new Date().getFullYear()}</div>
      </div>
      <div class="panel-body">
        ${renderMonthlyChart()}
      </div>
    </div>
  `;
}

function renderMonthlyChart() {
  const year = new Date().getFullYear();
  const months = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Avg','Sep','Okt','Nov','Dec'];
  const collected = new Array(12).fill(0);
  const expected = new Array(12).fill(0);
  
  // Collect actual payments
  const collectFromItem = (item) => {
    if (!item.uplate) return;
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2,'0')}`;
      if (item.uplate[key]) collected[m-1] += item.uplate[key];
    }
  };
  DATA.apartments.forEach(collectFromItem);
  (DATA.garages || []).forEach(collectFromItem);
  (DATA.ostave || []).forEach(collectFromItem);
  
  // Expected: from planirane_rate (iz Excela) + plan_otplate ako postoji
  const addExpected = (item) => {
    // From planirane_rate
    if (item.planirane_rate) {
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2,'0')}`;
        if (item.planirane_rate[key]) expected[m-1] += item.planirane_rate[key];
      }
    }
    // From plan_otplate (if manually added)
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum || rata.isplacena) return;
        const d = new Date(rata.datum);
        if (d.getFullYear() === year) {
          expected[d.getMonth()] += rata.iznos || 0;
        }
      });
    }
  };
  DATA.apartments.forEach(addExpected);
  (DATA.garages || []).forEach(addExpected);
  (DATA.ostave || []).forEach(addExpected);
  
  const max = Math.max(...collected, ...expected, 1);
  const totalCollected = collected.reduce((s,v) => s+v, 0);
  const totalExpected = expected.reduce((s,v) => s+v, 0);
  
  return `
    <div style="display:flex; gap:24px; margin-bottom:16px; font-size:12px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:14px; height:14px; background:linear-gradient(to top, #22c55e, #4ade80); border-radius:3px;"></div>
        <span>Naplaćeno: <strong style="color:var(--success);">${fmtEur(totalCollected)}</strong></span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:14px; height:14px; background:linear-gradient(to top, var(--accent), #e3b584); border-radius:3px;"></div>
        <span>Predviđeno: <strong style="color:var(--accent);">${fmtEur(totalExpected)}</strong></span>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(12,1fr); gap:8px; align-items:end; height:180px;">
      ${months.map((monthName, i) => {
        const cVal = collected[i];
        const eVal = expected[i];
        return `
        <div style="display:flex; flex-direction:column; align-items:center; gap:6px; height:100%;">
          <div style="flex:1; display:flex; flex-direction:row; justify-content:center; align-items:flex-end; width:100%; gap:2px;">
            <div style="flex:1; height:${(cVal/max)*100}%; background:linear-gradient(to top, #22c55e, #4ade80); border-radius:3px 3px 0 0; min-height:${cVal > 0 ? '2px' : '0'}; position:relative;" title="Naplaćeno: ${fmtEur(cVal)}">
              ${cVal > 0 ? `<div style="position:absolute; top:-16px; left:-20px; right:-20px; text-align:center; font-size:9px; font-weight:600; color:var(--success); white-space:nowrap;">${(cVal/1000).toFixed(1)}k</div>` : ''}
            </div>
            <div style="flex:1; height:${(eVal/max)*100}%; background:linear-gradient(to top, var(--accent), #e3b584); border-radius:3px 3px 0 0; min-height:${eVal > 0 ? '2px' : '0'}; position:relative; opacity:0.8;" title="Predviđeno: ${fmtEur(eVal)}">
            </div>
          </div>
          <div style="font-size:11px; color:var(--text-dim);">${monthName}</div>
        </div>
        `;
      }).join('')}
    </div>
  `;
}

// Helpers for arrears detection
function monthsInRange(fromKey, toKey) {
  // fromKey: "2025-01", toKey: "2026-04" -> list of monthKeys
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  const list = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    list.push(`${y}-${String(m).padStart(2,'0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return list;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Check which months since contract start are missing payments
// For now, we detect "arrears" simply: has contract, has unpaid balance, 
// and has ZERO payments in the last 2 months (prior months to current)
function getArrearsInfo(a) {
  if (a.vlasnik_parcele) return null;
  if (!a.prodat) return null;
  if (isPaidOff(a.preostalo)) return null;
  
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1; // 1-12
  // Current month key - rates due up to end of THIS month are NOT overdue yet
  const currentMonthKey = `${nowYear}-${String(nowMonth).padStart(2,'0')}`;
  
  let overdueMonths = 0;
  let overdueAmount = 0;
  
  // Check planirane_rate (from Excel) - overdue if month is strictly BEFORE current month
  if (a.planirane_rate) {
    Object.entries(a.planirane_rate).forEach(([mk, amt]) => {
      if (mk >= currentMonthKey) return; // current or future month - not overdue
      // Past month rate - check if it was actually paid
      const paid = a.uplate ? Object.entries(a.uplate)
        .filter(([uk]) => uk.startsWith(mk.substring(0,7)))
        .reduce((s,[,v]) => s+v, 0) : 0;
      if (paid < amt - 0.5) {
        overdueMonths++;
        overdueAmount += (amt - paid);
      }
    });
  }
  
  // Check plan_otplate rates - overdue if due date month is strictly before current month
  if (a.plan_otplate && a.plan_otplate.rate) {
    a.plan_otplate.rate.forEach(r => {
      if (r.isplacena) return;
      if (!r.datum) return;
      const d = new Date(r.datum);
      const rateMonthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (rateMonthKey >= currentMonthKey) return; // not yet due
      overdueMonths++;
      overdueAmount += (r.iznos || 0);
    });
  }
  
  if (overdueMonths === 0) return null;
  
  const level = overdueMonths >= 3 ? 'overdue' : 'warning';
  const text = overdueMonths === 1 
    ? `Kasni 1 mesec (${fmtEur(overdueAmount)})`
    : `Kasni ${overdueMonths} ${overdueMonths < 5 ? 'meseca' : 'meseci'} (${fmtEur(overdueAmount)})`;
  
  return { level, months: overdueMonths, amount: overdueAmount, text };
}

// --- APARTMENTS VIEW ---
function renderApartments(c) {
  let filtered = DATA.apartments.filter(a => !a.vlasnik_parcele);
  
  if (currentFilter === 'sold') filtered = filtered.filter(a => a.prodat);
  else if (currentFilter === 'available') filtered = filtered.filter(a => !a.prodat);
  else if (currentFilter === 'vlasnici') filtered = DATA.apartments.filter(a => a.vlasnik_parcele);
  else if (currentFilter === 'outstanding') filtered = filtered.filter(a => a.prodat && hasDebt(a.preostalo));
  else if (currentFilter === 'lamela_a') filtered = filtered.filter(a => a.lamela === 'A');
  else if (currentFilter === 'lamela_b') filtered = filtered.filter(a => a.lamela === 'B');
  else if (currentFilter === 'arrears') filtered = filtered.filter(a => getArrearsInfo(a));
  
  if (searchQuery) {
    filtered = filtered.filter(a => 
      String(a.stan).includes(searchQuery) ||
      (a.ime || '').toLowerCase().includes(searchQuery) ||
      (a.sprat || '').toLowerCase().includes(searchQuery) ||
      ('lamela ' + (a.lamela || '').toLowerCase()).includes(searchQuery)
    );
  }
  
  // Group by lamela, then floor
  const byLamela = { A: {}, B: {} };
  filtered.forEach(a => {
    const lam = a.lamela || 'A';
    const f = a.sprat || 'Bez sprata';
    if (!byLamela[lam][f]) byLamela[lam][f] = [];
    byLamela[lam][f].push(a);
  });
  
  const lamelaCountA = DATA.apartments.filter(a => a.lamela === 'A').length;
  const lamelaCountB = DATA.apartments.filter(a => a.lamela === 'B').length;
  const arrearsCount = DATA.apartments.filter(a => getArrearsInfo(a)).length;
  
  c.innerHTML = `
    <div class="filter-row">
      <div class="chip ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Za prodaju (${DATA.apartments.filter(a => !a.vlasnik_parcele).length})</div>
      <div class="chip ${currentFilter === 'lamela_a' ? 'active' : ''}" onclick="setFilter('lamela_a')">Lamela A (${lamelaCountA})</div>
      <div class="chip ${currentFilter === 'lamela_b' ? 'active' : ''}" onclick="setFilter('lamela_b')">Lamela B (${lamelaCountB})</div>
      <div class="chip ${currentFilter === 'sold' ? 'active' : ''}" onclick="setFilter('sold')">Prodati (${DATA.apartments.filter(a=>a.prodat).length})</div>
      <div class="chip ${currentFilter === 'available' ? 'active' : ''}" onclick="setFilter('available')">Slobodni (${DATA.apartments.filter(a=>!a.prodat && !a.vlasnik_parcele).length})</div>
      <div class="chip ${currentFilter === 'vlasnici' ? 'active' : ''}" style="border-color:#a78bfa; color:#c4b5fd;" onclick="setFilter('vlasnici')">Vlasnici (${DATA.apartments.filter(a=>a.vlasnik_parcele).length})</div>
      <div class="chip ${currentFilter === 'outstanding' ? 'active' : ''}" onclick="setFilter('outstanding')">Sa dugom (${DATA.apartments.filter(a=>a.prodat && hasDebt(a.preostalo)).length})</div>
      ${arrearsCount > 0 ? `<div class="chip ${currentFilter === 'arrears' ? 'active' : ''}" style="border-color:var(--danger); color:var(--danger);" onclick="setFilter('arrears')">⚠ Kasne (${arrearsCount})</div>` : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-secondary" onclick="openNewPaymentDialog()">💰 Nova uplata</button>
      <button class="btn btn-primary" onclick="openSellDialog('apartment')">🔑 Prodaj stan</button>
    </div>
    
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Stan</th>
              <th>Kupac</th>
              <th class="center">Status</th>
              <th class="num">Površina</th>
              <th class="num">€/m²</th>
              <th class="num">Vrednost</th>
              <th class="num">Isplaćeno</th>
              <th class="num">Preostalo</th>
              <th>Napomena</th>
            </tr>
          </thead>
          <tbody>
            ${['A', 'B'].map(lam => {
              const floors = byLamela[lam];
              const floorKeys = Object.keys(floors);
              if (floorKeys.length === 0) return '';
              return `
                <tr class="lamela-header"><td colspan="9">LAMELA ${lam}</td></tr>
                ${floorKeys.map(floor => `
                  <tr class="floor-header"><td colspan="9">${floor}</td></tr>
                  ${floors[floor].map(a => {
                    const arrears = getArrearsInfo(a);
                    return `
                    <tr onclick="openApartment('${a.lamela}', ${a.stan})" ${arrears ? 'class="row-arrears"' : ''}>
                      <td><strong>${a.lamela}-${a.stan}</strong></td>
                      <td>${a.ime ? `<span class="customer-link" onclick="event.stopPropagation(); openCustomerProfile('${getCustomerKey(a.ime)}')">${a.ime}</span>` : '<span style="color:var(--text-dim);">—</span>'}${arrears ? ` <span class="arrears-tag ${arrears.level}">⚠ ${arrears.text}</span>` : ''}</td>
                      <td class="center">${statusBadge(a)}</td>
                      <td class="num">${fmtNum(a.povrsina)} m²</td>
                      <td class="num">${fmtNum(a.cena_m2_pdv, 0)}</td>
                      <td class="num">${fmtEur(a.vrednost_sa_pdv)}</td>
                      <td class="num" style="color:var(--success);">${a.isplaceno ? fmtEur(a.isplaceno) : '—'}</td>
                      <td class="num" style="color:${hasDebt(a.preostalo) && a.prodat ? 'var(--danger)' : 'var(--text-dim)'};">${a.prodat ? fmtEur(a.preostalo) : '—'}</td>
                      <td style="color:var(--text-dim); font-size:12px;">${(a.napomena || '').substring(0, 40)}</td>
                    </tr>
                    `;
                  }).join('')}
                `).join('')}
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="9"><div class="empty-state">Nema rezultata</div></td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function setFilter(f) {
  currentFilter = f;
  renderView();
}

function statusBadge(a) {
  if (a.vlasnik_parcele) return '<span class="badge vlasnik">Vlasnik</span>';
  if (!a.prodat) return '<span class="badge available">Slobodan</span>';
  if (isPaidOff(a.preostalo)) return '<span class="badge sold">Isplaćen</span>';
  if (!a.isplaceno || a.isplaceno <= PAID_TOLERANCE) return '<span class="badge no-payment">Nema uplata</span>';
  return '<span class="badge partial">Deo. isplaćen</span>';
}

// Similar for garages/ostave (use different property names)
function itemStatusBadge(item) {
  if (item.vlasnik_parcele) return '<span class="badge vlasnik">Vlasnik</span>';
  if (!item.prodat) return '<span class="badge available">Slobodna</span>';
  if (isPaidOff(item.preostalo)) return '<span class="badge sold">Isplaćena</span>';
  const paid = item.naplaceno || 0;
  if (paid <= PAID_TOLERANCE) return '<span class="badge no-payment">Nema uplata</span>';
  return '<span class="badge partial">Deo. isplaćena</span>';
}

// --- GARAGES VIEW ---
function renderGarages(c) {
  let filtered = DATA.garages.filter(g => !g.vlasnik_parcele);
  
  if (currentFilter === 'sold') filtered = filtered.filter(g => g.prodat);
  else if (currentFilter === 'available') filtered = filtered.filter(g => !g.prodat);
  else if (currentFilter === 'vlasnici') filtered = DATA.garages.filter(g => g.vlasnik_parcele);
  else if (currentFilter === 'level-1') filtered = filtered.filter(g => getGarageLevel(g.broj) === '-1');
  else if (currentFilter === 'level-2') filtered = filtered.filter(g => getGarageLevel(g.broj) === '-2');
  else if (currentFilter === 'level-3') filtered = filtered.filter(g => getGarageLevel(g.broj) === '-3');
  
  if (searchQuery) {
    filtered = filtered.filter(g => 
      String(g.broj).includes(searchQuery) ||
      (g.ime || '').toLowerCase().includes(searchQuery)
    );
  }
  
  // Group by level
  const byLevel = { '-1': [], '-2': [], '-3': [] };
  filtered.forEach(g => {
    const lvl = getGarageLevel(g.broj);
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(g);
  });
  
  // Count by level for filter chips
  const l1Count = DATA.garages.filter(g => !g.vlasnik_parcele && getGarageLevel(g.broj) === '-1').length;
  const l2Count = DATA.garages.filter(g => !g.vlasnik_parcele && getGarageLevel(g.broj) === '-2').length;
  const l3Count = DATA.garages.filter(g => !g.vlasnik_parcele && getGarageLevel(g.broj) === '-3').length;
  
  c.innerHTML = `
    <div class="filter-row">
      <div class="chip ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Za prodaju (${DATA.garages.filter(g => !g.vlasnik_parcele).length})</div>
      <div class="chip ${currentFilter === 'level-3' ? 'active' : ''}" onclick="setFilter('level-3')">Nivo -3 (${l3Count})</div>
      <div class="chip ${currentFilter === 'level-2' ? 'active' : ''}" onclick="setFilter('level-2')">Nivo -2 (${l2Count})</div>
      <div class="chip ${currentFilter === 'level-1' ? 'active' : ''}" onclick="setFilter('level-1')">Nivo -1 (${l1Count})</div>
      <div class="chip ${currentFilter === 'sold' ? 'active' : ''}" onclick="setFilter('sold')">Prodate (${DATA.garages.filter(g=>g.prodat).length})</div>
      <div class="chip ${currentFilter === 'available' ? 'active' : ''}" onclick="setFilter('available')">Slobodne (${DATA.garages.filter(g=>!g.prodat && !g.vlasnik_parcele).length})</div>
      ${DATA.garages.some(g => g.vlasnik_parcele) ? `<div class="chip ${currentFilter === 'vlasnici' ? 'active' : ''}" style="border-color:#a78bfa; color:#c4b5fd;" onclick="setFilter('vlasnici')">Vlasnici (${DATA.garages.filter(g=>g.vlasnik_parcele).length})</div>` : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-secondary" onclick="openNewPaymentDialog()">💰 Nova uplata</button>
      <button class="btn btn-primary" onclick="openSellDialog('garage')">🔑 Prodaj garažu</button>
    </div>
    
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Garaža</th>
              <th>Kupac</th>
              <th class="center">Status</th>
              <th class="num">Površina</th>
              <th class="num">Vrednost</th>
              <th class="num">Naplaćeno</th>
              <th class="num">Preostalo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${['-3', '-2', '-1'].map(lvl => {
              const items = byLevel[lvl];
              if (!items || items.length === 0) return '';
              return `
                <tr class="level-header level-${lvl.replace('-','m')}"><td colspan="8">
                  <span style="display:inline-flex; align-items:center; gap:10px;">
                    <span style="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; background:rgba(255,255,255,0.2); border-radius:50%; font-size:14px; font-weight:900;">${lvl}</span>
                    NIVO ${lvl} · ${items.length} ${items.length === 1 ? 'garaža' : 'garaža'}
                  </span>
                </td></tr>
                ${items.map(g => `
                  <tr onclick="openGarage(${g.broj})">
                    <td><strong>G-${g.broj}</strong></td>
                    <td>${g.ime ? `<span class="customer-link" onclick="event.stopPropagation(); openCustomerProfile('${getCustomerKey(g.ime)}')">${g.ime}</span>` : '<span style="color:var(--text-dim);">—</span>'}</td>
                    <td class="center">${itemStatusBadge(g)}</td>
                    <td class="num">${fmtNum(g.povrsina)} m²</td>
                    <td class="num">${fmtEur(g.vrednost)}</td>
                    <td class="num" style="color:var(--success);">${g.naplaceno ? fmtEur(g.naplaceno) : '—'}</td>
                    <td class="num" style="color:${hasDebt(g.preostalo) && g.prodat ? 'var(--danger)' : 'var(--text-dim)'};">${g.prodat ? fmtEur(g.preostalo) : '—'}</td>
                    <td></td>
                  </tr>
                `).join('')}
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="8"><div class="empty-state">Nema rezultata</div></td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --- OSTAVE VIEW ---
function renderOstave(c) {
  let filtered = DATA.ostave.filter(o => !o.vlasnik_parcele);
  
  if (currentFilter === 'sold') filtered = filtered.filter(o => o.prodat);
  else if (currentFilter === 'available') filtered = filtered.filter(o => !o.prodat);
  else if (currentFilter === 'vlasnici') filtered = DATA.ostave.filter(o => o.vlasnik_parcele);
  
  if (searchQuery) {
    filtered = filtered.filter(o => 
      String(o.broj).toLowerCase().includes(searchQuery) ||
      (o.ime || '').toLowerCase().includes(searchQuery) ||
      (o.nivo || '').toLowerCase().includes(searchQuery)
    );
  }
  
  c.innerHTML = `
    <div class="filter-row">
      <div class="chip ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Za prodaju (${DATA.ostave.filter(o => !o.vlasnik_parcele).length})</div>
      <div class="chip ${currentFilter === 'sold' ? 'active' : ''}" onclick="setFilter('sold')">Prodate (${DATA.ostave.filter(o=>o.prodat).length})</div>
      <div class="chip ${currentFilter === 'available' ? 'active' : ''}" onclick="setFilter('available')">Slobodne (${DATA.ostave.filter(o=>!o.prodat && !o.vlasnik_parcele).length})</div>
      ${DATA.ostave.some(o => o.vlasnik_parcele) ? `<div class="chip ${currentFilter === 'vlasnici' ? 'active' : ''}" style="border-color:#a78bfa; color:#c4b5fd;" onclick="setFilter('vlasnici')">Vlasnici (${DATA.ostave.filter(o=>o.vlasnik_parcele).length})</div>` : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-secondary" onclick="openNewPaymentDialog()">💰 Nova uplata</button>
      <button class="btn btn-primary" onclick="openSellDialog('ostava')">🔑 Prodaj ostavu</button>
    </div>
    
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Broj</th>
              <th>Kupac</th>
              <th class="center">Status</th>
              <th class="num">Površina</th>
              <th class="num">Vrednost</th>
              <th class="num">Naplaćeno</th>
              <th class="num">Preostalo</th>
            </tr>
          </thead>
          <tbody>
            ${(() => {
              // Group: PODRUM -> by nivo; SPRAT -> by nivo (sprat) -> by lamela
              const podrumske = [];
              const spratne = [];
              filtered.forEach(o => {
                const actualIdx = DATA.ostave.indexOf(o);
                const item = { ...o, _origIdx: actualIdx };
                if (o.tip === 'PODRUM' || (o.nivo && o.nivo.startsWith('-'))) {
                  podrumske.push(item);
                } else {
                  spratne.push(item);
                }
              });
              
              // Order podrumske by nivo: -3, -2, -1 (deepest first)
              const podrumByNivo = {};
              podrumske.forEach(o => {
                const n = o.nivo || '?';
                if (!podrumByNivo[n]) podrumByNivo[n] = [];
                podrumByNivo[n].push(o);
              });
              const podrumOrder = ['-3', '-2', '-1'];
              
              // Order spratne by roman numeral level
              const romanOrder = ['I SPRAT','II SPRAT','III SPRAT','IV SPRAT','V SPRAT','VI SPRAT','VII SPRAT','VIII SPRAT','IX SPRAT','X SPRAT','XI SPRAT','XII SPRAT'];
              const spratByLevel = {};
              spratne.forEach(o => {
                const lvl = o.nivo || '?';
                if (!spratByLevel[lvl]) spratByLevel[lvl] = { A: [], B: [] };
                const lam = o.lamela || 'A';
                if (!spratByLevel[lvl][lam]) spratByLevel[lvl][lam] = [];
                spratByLevel[lvl][lam].push(o);
              });
              
              let out = '';
              
              // Render podrumske
              if (podrumske.length > 0) {
                out += `<tr class="ostava-section-header"><td colspan="7" style="background:linear-gradient(90deg, #4c1d95, #5b21b6); color:white; padding:12px 16px; font-weight:700; font-size:13px; text-transform:uppercase; letter-spacing:1px;">🏚️ PODRUMSKE OSTAVE (${podrumske.length})</td></tr>`;
                podrumOrder.forEach(nivo => {
                  const items = podrumByNivo[nivo];
                  if (!items || items.length === 0) return;
                  out += `<tr class="ostava-level-header"><td colspan="7">
                    <span style="display:inline-flex; align-items:center; gap:10px;">
                      <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; background:rgba(255,255,255,0.18); border-radius:6px; font-size:13px; font-weight:900;">📦</span>
                      Nivo ${nivo} · ${items.length} ${items.length === 1 ? 'ostava' : 'ostave'}
                    </span>
                  </td></tr>`;
                  items.forEach(o => {
                    out += `<tr onclick="openOstava(${o._origIdx})">
                      <td><strong>${o.broj || '—'}</strong></td>
                      <td>${o.ime ? `<span class="customer-link" onclick="event.stopPropagation(); openCustomerProfile('${getCustomerKey(o.ime)}')">${o.ime}</span>` : '<span style="color:var(--text-dim);">—</span>'}</td>
                      <td class="center">${itemStatusBadge(o)}</td>
                      <td class="num">${fmtNum(o.povrsina)} m²</td>
                      <td class="num">${fmtEur(o.vrednost)}</td>
                      <td class="num" style="color:var(--success);">${o.naplaceno ? fmtEur(o.naplaceno) : '—'}</td>
                      <td class="num" style="color:${hasDebt(o.preostalo) && o.prodat ? 'var(--danger)' : 'var(--text-dim)'};">${o.prodat ? fmtEur(o.preostalo) : '—'}</td>
                    </tr>`;
                  });
                });
              }
              
              // Render spratne grouped by sprat + lamela
              if (spratne.length > 0) {
                out += `<tr class="ostava-section-header"><td colspan="7" style="background:linear-gradient(90deg, #0d9488, #0f766e); color:white; padding:12px 16px; font-weight:700; font-size:13px; text-transform:uppercase; letter-spacing:1px;">🏢 SPRATNE OSTAVE (${spratne.length})</td></tr>`;
                romanOrder.forEach(lvl => {
                  const group = spratByLevel[lvl];
                  if (!group) return;
                  const totalInLvl = (group.A?.length || 0) + (group.B?.length || 0);
                  if (totalInLvl === 0) return;
                  out += `<tr class="ostava-level-header"><td colspan="7">
                    <span style="display:inline-flex; align-items:center; gap:10px;">
                      <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; background:rgba(255,255,255,0.18); border-radius:6px; font-size:13px; font-weight:900;">📦</span>
                      ${lvl} · ${totalInLvl} ${totalInLvl === 1 ? 'ostava' : 'ostave'}
                    </span>
                  </td></tr>`;
                  ['A','B'].forEach(lam => {
                    const items = group[lam] || [];
                    if (items.length === 0) return;
                    out += `<tr style="background:var(--surface-2);"><td colspan="7" style="padding:6px 20px; font-size:11px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Lamela ${lam}</td></tr>`;
                    items.forEach(o => {
                      out += `<tr onclick="openOstava(${o._origIdx})">
                        <td><strong>${o.broj || '—'}</strong></td>
                        <td>${o.ime ? `<span class="customer-link" onclick="event.stopPropagation(); openCustomerProfile('${getCustomerKey(o.ime)}')">${o.ime}</span>` : '<span style="color:var(--text-dim);">—</span>'}</td>
                        <td class="center">${itemStatusBadge(o)}</td>
                        <td class="num">${fmtNum(o.povrsina)} m²</td>
                        <td class="num">${fmtEur(o.vrednost)}</td>
                        <td class="num" style="color:var(--success);">${o.naplaceno ? fmtEur(o.naplaceno) : '—'}</td>
                        <td class="num" style="color:${hasDebt(o.preostalo) && o.prodat ? 'var(--danger)' : 'var(--text-dim)'};">${o.prodat ? fmtEur(o.preostalo) : '—'}</td>
                      </tr>`;
                    });
                  });
                });
              }
              
              return out;
            })()}
            ${filtered.length === 0 ? '<tr><td colspan="7"><div class="empty-state">Nema rezultata</div></td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
// --- APARTMENT DETAIL MODAL ---
function findApartment(lamela, stan) {
  return DATA.apartments.find(a => a.lamela === lamela && a.stan === stan);
}

function openApartment(lamela, stan) {
  const a = findApartment(lamela, stan);
  if (!a) return;
  trackRecent('apartment', { lamela, stan, label: `Stan ${lamela}-${stan}`, sub: a.ime || 'Slobodan', icon: '🏠' });
  if (!a.prodat && !a.vlasnik_parcele) { showSellConfirm('apartment', lamela, stan); return; }
  renderApartmentModal(a);
}

function openApartmentNew() {
  // Default to A lamela, next free number
  const maxStanA = Math.max(0, ...DATA.apartments.filter(a => a.lamela === 'A').map(a => a.stan));
  const a = {
    lamela: 'A',
    stan: maxStanA + 1,
    sprat: '',
    ime: '',
    prodat: false,
    ugovor: false,
    povrsina: 0,
    cena_m2: 0,
    cena_m2_pdv: 0,
    vrednost_bez_pdv: 0,
    vrednost_sa_pdv: 0,
    isplaceno: 0,
    preostalo: 0,
    napomena: '',
    uplate: {},
    _new: true
  };
  renderApartmentModal(a);
}

function renderApartmentModal(a) {
  const m = document.getElementById('modalContent');
  const isNew = a._new;
  
  // Calculate yearly totals for quick view
  const yearlyTotals = {};
  if (a.uplate) {
    for (const k in a.uplate) {
      const yr = k.substring(0, 4);
      yearlyTotals[yr] = (yearlyTotals[yr] || 0) + a.uplate[k];
    }
  }
  
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Stan ${a.lamela}-${a.stan}</div>
        <div class="modal-title-sub">Lamela ${a.lamela} · ${a.sprat || 'Sprat nije određen'}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field">
          <label>Lamela</label>
          <select id="f_lamela">
            <option value="A" ${a.lamela === 'A' ? 'selected' : ''}>A</option>
            <option value="B" ${a.lamela === 'B' ? 'selected' : ''}>B</option>
          </select>
        </div>
        <div class="form-field">
          <label>Broj stana</label>
          <input type="number" id="f_stan" value="${a.stan}">
        </div>
        <div class="form-field full">
          <label>Sprat</label>
          <input type="text" id="f_sprat" value="${a.sprat || ''}" placeholder="npr. III SPRAT">
        </div>
        <div class="form-field full">
          <label>Ime i prezime kupca</label>
          <input type="text" id="f_ime" value="${a.ime || ''}" placeholder="Ime i prezime">
        </div>
        <div class="form-field">
          <label>Prodat</label>
          <select id="f_prodat">
            <option value="false" ${!a.prodat ? 'selected' : ''}>Ne</option>
            <option value="true" ${a.prodat ? 'selected' : ''}>Da</option>
          </select>
        </div>
        <div class="form-field">
          <label>Ugovor potpisan</label>
          <select id="f_ugovor">
            <option value="false" ${!a.ugovor ? 'selected' : ''}>Ne</option>
            <option value="true" ${a.ugovor ? 'selected' : ''}>Da</option>
          </select>
        </div>
        <div class="form-field">
          <label>Površina (m²)</label>
          <input type="number" step="0.001" id="f_povrsina" value="${a.povrsina}" oninput="recalcApartment()">
        </div>
        <div class="form-field">
          <label>Cena €/m² <span style="color:var(--accent); font-size:11px;">← unesite ovdje</span></label>
          <input type="number" step="0.01" id="f_cena_m2_pdv" value="${a.cena_m2_pdv || ''}" placeholder="npr. 1558" oninput="recalcApartment()" style="font-size:16px; font-weight:600; color:var(--accent);">
        </div>
        <div class="form-field">
          <label>PDV %</label>
          <input type="number" step="0.1" id="f_pdv_pct" value="${a.pdv_pct ?? 17}" min="0" max="100" oninput="recalcApartment()">
        </div>
        <div class="form-field">
          <label>Ukupna vrednost sa PDV <span style="color:var(--text-dim); font-size:11px;">(auto)</span></label>
          <input type="number" step="0.01" id="f_vred_sa" value="${a.vrednost_sa_pdv || ''}" readonly style="color:var(--success); font-weight:700; font-size:15px; background:var(--surface-3);">
        </div>
        <div class="form-field">
          <label>Vrednost bez PDV-a <span style="color:var(--text-dim); font-size:11px;">(auto)</span></label>
          <input type="number" step="0.01" id="f_vred_bez" value="${a.vrednost_bez_pdv || ''}" readonly style="color:var(--text-dim);">
        </div>
        <div class="form-field">
          <label>Cena u ugovoru/predugovoru <span style="color:var(--text-dim);font-size:11px;">(skrivena kolona)</span></label>
          <input type="number" step="0.01" id="f_ugovorena_cena" value="${a.ugovorena_cena || ''}" placeholder="Unesi ako se razlikuje od tržišne">
        </div>
        <div class="form-field">
          <label>Ukupno isplaćeno</label>
          <input type="text" value="${fmtEur(a.isplaceno)}" readonly style="color:var(--success); font-weight:600;">
        </div>
        <div class="form-field">
          <label>Preostalo za uplatu</label>
          <input type="text" value="${fmtEur(a.preostalo)}" readonly style="color:var(--danger); font-weight:600;">
        </div>
        <div class="form-field full">
          <label>Napomena</label>
          <textarea id="f_napomena" rows="2">${a.napomena || ''}</textarea>
        </div>
        <div class="form-field full">
          <label>Fotografije stana</label>
          <div id="aptPhotos" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            ${(a.slike || []).map((src, i) => `
              <div style="position:relative; width:80px; height:80px; border-radius:8px; overflow:hidden; border:1px solid var(--border);">
                <img src="${src}" style="width:100%; height:100%; object-fit:cover;">
                <button onclick="removeAptPhoto(${i})" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:1;">×</button>
              </div>
            `).join('')}
            ${(a.slike || []).length < 4 ? `
              <label style="width:80px;height:80px;border-radius:8px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:4px;font-size:11px;color:var(--text-dim);">
                📷<span>Dodaj</span>
                <input type="file" accept="image/*" multiple style="display:none" onchange="addAptPhotos(this,'${a.lamela}',${a.stan})">
              </label>
            ` : ''}
          </div>
        </div>
      </div>
      
      <!-- PLAN OTPLATE -->
      <div style="margin-top:20px; padding:16px; background:var(--surface-2); border-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <strong>Plan otplate</strong>
            <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">Dogovorena dinamika isplate (kapara + rate)</div>
          </div>
          <button type="button" class="btn btn-secondary" onclick="autoSaveApartmentThenPlan('${a.lamela}', ${a.stan})">
            ${a.plan_otplate && a.plan_otplate.rate && a.plan_otplate.rate.length ? 'Izmeni plan' : '+ Kreiraj plan'}
          </button>
        </div>
        ${renderPlanSummary(a)}
      </div>
      
      ${!isNew && a.prodat ? `
      <div style="margin-top:20px; padding:16px; background:var(--surface-2); border-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong>Evidencija uplata</strong>
          <button class="btn btn-primary" onclick="openPaymentReport('${a.lamela}', ${a.stan})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Pregled / Štampa uplata
          </button>
        </div>
        <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:8px; font-size:12px;">
          ${[2025,2026,2027,2028,2029].map(y => `
            <div style="padding:8px; background:var(--surface); border-radius:6px; text-align:center;">
              <div style="color:var(--text-dim); font-size:11px;">${y}</div>
              <div style="font-weight:600; color:var(--accent);">${fmtEur(yearlyTotals[y] || 0)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
      
      ${!isNew ? `
      <div class="payments-section">
        <h3>Mesečne uplate (klikni na mesec za unos)</h3>
        <div class="year-tabs" id="yearTabs">
          ${[2025, 2026, 2027, 2028, 2029].map(y => `
            <div class="year-tab ${y === editingYear ? 'active' : ''}" onclick="setEditYear(${y}, '${a.lamela}', ${a.stan})">${y}</div>
          `).join('')}
        </div>
        <div class="months-grid">
          ${renderMonthsGrid(a, editingYear)}
        </div>
        <div style="margin-top:16px; padding:12px; background:var(--surface-2); border-radius:8px; display:flex; justify-content:space-between; font-size:13px;">
          <span>Ukupno za ${editingYear}:</span>
          <strong style="color:var(--accent);">${fmtEur(yearTotal(a, editingYear))}</strong>
        </div>
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      ${!isNew && a.prodat ? `<button class="btn btn-ghost" style="color:var(--danger); margin-right:auto;" onclick="unsellApartment('${a.lamela}', ${a.stan})">Poništi prodaju</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
      <button class="btn btn-primary" onclick="saveApartment('${a.lamela}', ${a.stan}, ${isNew})">Sačuvaj</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function recalcApartment() {
  const p = parseFloat(document.getElementById('f_povrsina')?.value) || 0;
  const c = parseFloat(document.getElementById('f_cena_m2_pdv')?.value) || 0;
  const pdvPct = parseFloat(document.getElementById('f_pdv_pct')?.value) ?? 17;
  
  if (p > 0 && c > 0) {
    const vSa = p * c;
    const vBez = vSa / (1 + pdvPct / 100);
    const vSaEl = document.getElementById('f_vred_sa');
    const vBezEl = document.getElementById('f_vred_bez');
    if (vSaEl) vSaEl.value = vSa.toFixed(2);
    if (vBezEl) vBezEl.value = vBez.toFixed(2);
  }
}

function renderMonthsGrid(a, year) {
  const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  return months.map((name, i) => {
    const key = `${year}-${String(i+1).padStart(2,'0')}`;
    const val = (a.uplate && a.uplate[key]) || 0;
    return `
      <div class="month-cell ${val > 0 ? 'paid' : ''}" onclick="openPaymentDialog('${a.lamela}', ${a.stan}, '${key}', '${name}')">
        <div class="month-cell-label">${name.substring(0,3)} ${year}</div>
        <div class="month-cell-value">${val > 0 ? fmtEur(val) : '— klikni za unos —'}</div>
      </div>
    `;
  }).join('');
}

function setEditYear(year, lamela, stan) {
  editingYear = year;
  const a = findApartment(lamela, stan);
  if (a) renderApartmentModal(a);
}

function yearTotal(a, year) {
  let total = 0;
  if (!a.uplate) return 0;
  for (const k in a.uplate) {
    if (k.startsWith(String(year))) total += a.uplate[k];
  }
  return total;
}

function saveApartment(lamela, stan, isNew) {
  const newLamela = document.getElementById('f_lamela').value;
  const newStan = parseInt(document.getElementById('f_stan').value);
  const data = {
    lamela: newLamela,
    stan: newStan,
    sprat: document.getElementById('f_sprat').value.trim(),
    ime: document.getElementById('f_ime').value.trim(),
    prodat: document.getElementById('f_prodat').value === 'true',
    ugovor: document.getElementById('f_ugovor').value === 'true',
    povrsina: parseFloat(document.getElementById('f_povrsina').value) || 0,
    cena_m2_pdv: parseFloat(document.getElementById('f_cena_m2_pdv').value) || 0,
    vrednost_bez_pdv: parseFloat(document.getElementById('f_vred_bez').value) || 0,
    vrednost_sa_pdv: parseFloat(document.getElementById('f_vred_sa').value) || 0,
    pdv_pct: parseFloat(document.getElementById('f_pdv_pct')?.value) ?? 17,
    napomena: document.getElementById('f_napomena').value.trim(),
    ugovorena_cena: parseFloat(document.getElementById('f_ugovorena_cena')?.value) || null
  };
  data.cena_m2 = data.povrsina ? data.vrednost_bez_pdv / data.povrsina : 0;
  
  if (isNew) {
    if (findApartment(newLamela, newStan)) {
      showToast(`Stan ${newLamela}-${newStan} već postoji`, 'error');
      return;
    }
    DATA.apartments.push({ ...data, isplaceno: 0, preostalo: data.vrednost_sa_pdv, uplate: {} });
  } else {
    const idx = DATA.apartments.findIndex(a => a.lamela === lamela && a.stan === stan);
    const old = DATA.apartments[idx];
    DATA.apartments[idx] = {
      ...old,
      ...data,
      isplaceno: old.isplaceno,
      uplate: old.uplate,
      preostalo: data.vrednost_sa_pdv - (old.isplaceno || 0)
    };
  }
  
  // Sort by lamela+stan
  DATA.apartments.sort((a,b) => a.lamela.localeCompare(b.lamela) || a.stan - b.stan);
  const saved = findApartment(newLamela, newStan);
  saveToCache();
  sbUpsertApartment(saved).catch(()=>{});
  closeModal();
  renderView();
  logActivity('IZMENA', `Stan ${newLamela}-${newStan} ${isNew ? 'dodat' : 'izmenjen'}${data.ime ? ' · ' + data.ime : ''}`);
  showToast('Stan sačuvan', 'success');
}

function unsellApartment(lamela, stan) {
  if (!confirm(`Poništiti prodaju stana ${lamela}-${stan}? Podaci o kupcu i sve uplate će biti obrisani, ali stan ostaje u evidenciji kao slobodan.`)) return;
  const a = findApartment(lamela, stan);
  if (!a) return;
  a.ime = '';
  a.prodat = false;
  a.ugovor = false;
  a.isplaceno = 0;
  a.preostalo = a.vrednost_sa_pdv;
  a.uplate = {};
  a.napomena = '';
  a.plan_otplate = null;
  saveToCache();
  closeModal();
  renderView();
  showToast('Prodaja poništena, stan je sada slobodan', 'success');
}

// Keep for compatibility, but prevent accidental delete
function deleteApartment(lamela, stan) {
  showToast('Brisanje stana nije dozvoljeno. Možete samo poništiti prodaju.', 'error');
}

// --- PAYMENT DIALOG ---
function openPaymentDialog(lamela, stan, monthKey, monthName) {
  const a = findApartment(lamela, stan);
  if (!a) return;
  const existing = (a.uplate && a.uplate[monthKey]) || 0;
  
  const m = document.getElementById('modalContent');
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Uplata - ${monthName}</div>
        <div class="modal-title-sub">Stan ${a.lamela}-${a.stan} · ${a.ime || 'Bez kupca'}</div>
      </div>
      <button class="modal-close" onclick="openApartment('${lamela}', ${stan})">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field full">
          <label>Iznos uplate (€)</label>
          <input type="number" step="0.01" id="p_amount" value="${existing || ''}" placeholder="0.00" autofocus>
        </div>
        <div class="form-field">
          <label>Datum uplate</label>
          <input type="date" id="p_date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-field">
          <label>Način plaćanja (samo u evidenciji)</label>
          <select id="p_method">
            <option value="Keš">Keš</option>
            <option value="Uplatnica">Uplatnica / Virman</option>
            <option value="Kartica">Kartica</option>
            <option value="Ostalo">Ostalo</option>
          </select>
        </div>
        <div class="form-field full">
          <label>Napomena (opciono)</label>
          <input type="text" id="p_note" placeholder="npr. rata za oktobar">
        </div>
      </div>
      <div style="margin-top:16px; padding:12px; background:var(--surface-2); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
          <span style="color:var(--text-dim);">Ukupno isplaćeno:</span>
          <strong>${fmtEur(a.isplaceno)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <span style="color:var(--text-dim);">Preostalo:</span>
          <strong style="color:var(--danger);">${fmtEur(a.preostalo)}</strong>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      ${existing ? `<button class="btn btn-ghost" style="color:var(--danger); margin-right:auto;" onclick="deletePayment('${lamela}', ${stan}, '${monthKey}')">Obriši uplatu</button>` : ''}
      <button class="btn btn-secondary" onclick="openApartment('${lamela}', ${stan})">Nazad</button>
      <button class="btn btn-primary" onclick="savePayment('${lamela}', ${stan}, '${monthKey}', '${monthName}', ${existing})">
        ${existing ? 'Ažuriraj i priznanica' : 'Sačuvaj i izdaj priznanicu'}
      </button>
    </div>
  `;
}

function savePayment(lamela, stan, monthKey, monthName, oldAmount) {
  const amount = parseFloat(document.getElementById('p_amount').value) || 0;
  const date = document.getElementById('p_date').value;
  const method = document.getElementById('p_method').value;
  const note = document.getElementById('p_note').value.trim();
  
  if (amount <= 0) {
    showToast('Iznos mora biti veći od 0', 'error');
    return;
  }
  
  const a = findApartment(lamela, stan);
  if (!a.uplate) a.uplate = {};
  a.uplate[monthKey] = amount;
  
  // Recalculate totals
  a.isplaceno = Object.values(a.uplate).reduce((s,v) => s + v, 0);
  a.preostalo = a.vrednost_sa_pdv - a.isplaceno;
  
  // Generate receipt (only if it's a new payment or increased)
  if (amount > (oldAmount || 0)) {
    const receiptAmount = amount - (oldAmount || 0);
    createReceipt({
      payer: a.ime || `Stan ${a.lamela}-${a.stan}`,
      itemType: 'Stan',
      itemId: `${a.lamela}-${a.stan}`,
      itemDesc: `${a.sprat || ''} · ${fmtNum(a.povrsina)} m²`,
      lamela: a.lamela,
      amount: receiptAmount,
      method,
      date,
      note: note || `Uplata za ${monthName}`,
      paymentMonth: monthKey
    });
  }
  
  saveToCache();
  closeModal();
  renderView();
  logActivity('UPLATA', `Stan ${a.lamela}-${a.stan} · ${a.ime || ''} · ${fmtEur(receiptAmount)}`);
  showToast('Uplata sačuvana, priznanica izdata', 'success');
}

function deletePayment(lamela, stan, monthKey) {
  if (!confirm('Obrisati ovu uplatu?')) return;
  const a = findApartment(lamela, stan);
  if (a.uplate) delete a.uplate[monthKey];
  a.isplaceno = Object.values(a.uplate || {}).reduce((s,v) => s + v, 0);
  a.preostalo = a.vrednost_sa_pdv - a.isplaceno;
  saveToCache();
  openApartment(lamela, stan);
  showToast('Uplata obrisana', 'success');
}

// --- PAYMENT REPORT (per customer/apartment) ---
function openPaymentReport(lamela, stan) {
  const a = findApartment(lamela, stan);
  if (!a) return;
  
  // Collect all payments chronologically
  const payments = [];
  if (a.uplate) {
    Object.keys(a.uplate).sort().forEach(k => {
      payments.push({ month: k, amount: a.uplate[k] });
    });
  }
  
  const total = payments.reduce((s,p) => s + p.amount, 0);
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '800px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Evidencija uplata - ${a.ime || `Stan ${a.lamela}-${a.stan}`}</div>
        <div class="modal-title-sub">Stan ${a.lamela}-${a.stan} · Lamela ${a.lamela} · ${a.sprat || ''}</div>
      </div>
      <button class="modal-close" onclick="openApartment('${lamela}', ${stan})">×</button>
    </div>
    <div class="modal-body" id="reportBody">
      ${renderPaymentReportHTML(a, payments, total)}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="openApartment('${lamela}', ${stan})">Nazad</button>
      <button class="btn btn-primary" onclick="printPaymentReport('${lamela}', ${stan})">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
        Štampaj / Sačuvaj PDF
      </button>
    </div>
  `;
}

function renderPaymentReportHTML(a, payments, total) {
  const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  
  // Group by year
  const byYear = {};
  payments.forEach(p => {
    const [y, m] = p.month.split('-');
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push({ monthNum: parseInt(m), monthName: months[parseInt(m)-1], amount: p.amount });
  });
  
  return `
    <div style="background:var(--surface-2); padding:16px; border-radius:10px; margin-bottom:16px;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:14px;">
        <div>
          <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Kupac</div>
          <div style="font-weight:600; font-size:16px;">${a.ime || '—'}</div>
        </div>
        <div>
          <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Stan</div>
          <div style="font-weight:600; font-size:16px;">${a.lamela}-${a.stan} · Lamela ${a.lamela}</div>
        </div>
        <div>
          <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Vrednost sa PDV-om</div>
          <div style="font-weight:600;">${fmtEur(a.vrednost_sa_pdv)}</div>
        </div>
        <div>
          <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Preostalo</div>
          <div style="font-weight:600; color:var(--danger);">${fmtEur(a.preostalo)}</div>
        </div>
      </div>
    </div>
    
    ${Object.keys(byYear).sort().map(y => {
      const yearTotal = byYear[y].reduce((s,p) => s + p.amount, 0);
      return `
        <div style="margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--surface-3); border-radius:8px; margin-bottom:8px;">
            <strong>${y}</strong>
            <strong style="color:var(--accent);">${fmtEur(yearTotal)}</strong>
          </div>
          <table class="data-table" style="background:var(--surface);">
            <thead>
              <tr><th>Mesec</th><th class="num">Iznos</th></tr>
            </thead>
            <tbody>
              ${byYear[y].sort((a,b) => a.monthNum - b.monthNum).map(p => `
                <tr>
                  <td>${p.monthName} ${y}</td>
                  <td class="num" style="color:var(--success); font-weight:600;">${fmtEur(p.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('')}
    
    ${payments.length === 0 ? '<div class="empty-state">Nema uplata za ovog kupca</div>' : `
      <div style="padding:16px; background:var(--accent); color:#1a2332; border-radius:10px; display:flex; justify-content:space-between; align-items:center; font-size:16px;">
        <strong>UKUPNO UPLAĆENO:</strong>
        <strong style="font-size:20px;">${fmtEur(total)}</strong>
      </div>
    `}
  `;
}

function printPaymentReport(lamela, stan) {
  const a = findApartment(lamela, stan);
  if (!a) return;
  
  const payments = [];
  if (a.uplate) {
    Object.keys(a.uplate).sort().forEach(k => {
      const dateStr = (a.uplate_dates && a.uplate_dates[k]) || `${k.substring(0,7)}-15`;
      payments.push({ month: k.substring(0,7), date: dateStr, amount: a.uplate[k] });
    });
  }
  const total = payments.reduce((s,p) => s + p.amount, 0);
  const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  const byYear = {};
  payments.forEach(p => {
    const [y, mo] = p.month.split('-');
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push({ monthNum: parseInt(mo), monthName: months[parseInt(mo)-1], amount: p.amount, date: p.date });
  });
  
  const html = `<!DOCTYPE html>
<html lang="sr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidencija uplata - ${a.ime || 'Stan ' + a.lamela + '-' + a.stan}</title>
<style>
@page { size: A4; margin: 20mm; }
body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; }
.logo { text-align: center; margin-bottom: 20px; }
.logo img { max-height: 80px; }
h1 { text-align: center; margin: 10px 0; font-size: 20px; }
.info-box { background: #f5f5f5; padding: 14px; border-radius: 6px; margin-bottom: 20px; }
.info-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
.info-row:last-child { border-bottom: none; }
.info-label { color: #666; }
.info-val { font-weight: 600; }
h2 { font-size: 15px; margin: 20px 0 10px; padding: 8px 12px; background: #eee; border-radius: 4px; display: flex; justify-content: space-between; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #fafafa; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; color: #666; }
td { padding: 8px 10px; border-bottom: 1px solid #eee; }
td.num { text-align: right; font-weight: 600; }
.total { background: #d4a574; color: #1a2332; padding: 16px; border-radius: 6px; display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; margin-top: 20px; }
.footer { text-align: center; color: #999; font-size: 11px; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; }
.print-btn { position: fixed; top: 10px; right: 10px; padding: 10px 20px; background: #1a2332; color: #d4a574; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
@media print { .print-btn { display: none; } }
</style>
</head><body>
<button class="print-btn" onclick="window.print()">🖨️ Štampaj / Sačuvaj PDF</button>
<div class="logo"><img src="${_LOGO_PNG_DATA_URL || 'logo.png'}" alt="Dacić Prom"></div>
<h1>Evidencija uplata</h1>
<div style="text-align:center; font-size:12px; color:#666; margin-bottom:20px;">Datum izdavanja: ${fmtDate(new Date())}</div>

<div class="info-box">
  <div class="info-row"><span class="info-label">Kupac:</span><span class="info-val">${a.ime || '—'}</span></div>
  <div class="info-row"><span class="info-label">Stan:</span><span class="info-val">${a.lamela}-${a.stan}, Lamela ${a.lamela}, ${a.sprat || ''}</span></div>
  <div class="info-row"><span class="info-label">Površina:</span><span class="info-val">${fmtNum(a.povrsina)} m²</span></div>
  <div class="info-row"><span class="info-label">Vrednost sa PDV-om:</span><span class="info-val">${fmtEur(a.vrednost_sa_pdv)}</span></div>
  <div class="info-row"><span class="info-label">Preostalo za uplatu:</span><span class="info-val" style="color:#c00;">${fmtEur(a.preostalo)}</span></div>
</div>

${Object.keys(byYear).sort().map(y => {
  const yt = byYear[y].reduce((s,p) => s + p.amount, 0);
  return `
    <h2><span>Godina ${y}</span><span>${fmtEur(yt)}</span></h2>
    <table>
      <thead><tr><th>Datum</th><th>Mesec</th><th style="text-align:right;">Iznos</th></tr></thead>
      <tbody>
        ${byYear[y].sort((a,b) => a.monthNum - b.monthNum).map(p => `
          <tr><td>${fmtDate(p.date)}</td><td>${p.monthName} ${y}</td><td class="num">${fmtEur(p.amount)}</td></tr>
        `).join('')}
      </tbody>
    </table>
  `;
}).join('')}

${payments.length === 0 ? '<div style="text-align:center; padding:40px; color:#999;">Nema evidentiranih uplata</div>' : `
  <div class="total">
    <span>UKUPNO UPLAĆENO:</span>
    <span>${fmtEur(total)}</span>
  </div>
`}

<div class="footer">
  Dacić Prom · Dokument generisan ${fmtDateTime(new Date())} · Izdao: ${currentUser || ''}
</div>
</body></html>`;
  
  openPrintWindow(html, `Evidencija uplata - ${a.ime || a.lamela + '-' + a.stan}`);
}

// Universal print helper - koristi inline iframe u modalu (radi i na mobilnom)
function openPrintWindow(html, title) {
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '900px';
  const iframeH = Math.round(window.innerHeight * 0.72) + 'px';
  m.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" style="font-size:15px;">${title || 'Dokument za štampu'}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div style="display:flex; gap:8px; padding:10px 16px; background:var(--surface-2); border-bottom:1px solid var(--border);">
      <button class="btn btn-primary" onclick="document.getElementById('__pf').contentWindow.print()" style="flex:1;">
        🖨️ Štampaj / Sačuvaj PDF
      </button>
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
    </div>
    <iframe id="__pf" style="width:100%; height:${iframeH}; border:none; background:white; display:block;"></iframe>
  `;
  document.getElementById('modal').classList.add('active');

  requestAnimationFrame(() => {
    const iframe = document.getElementById('__pf');
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
    } catch(e) {
      try {
        iframe.src = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      } catch(e2) { showToast('Greška: ' + e2.message, 'error'); }
    }
  });
}

// Logo as base64 data URL (set from inline HTML if needed)
let _LOGO_PNG_DATA_URL = null;

// --- GARAGE MODAL ---
function openGarage(broj) {
  const g = DATA.garages.find(x => x.broj === broj);
  if (!g) return;
  trackRecent('garage', { broj, label: `Garaža G-${broj}`, sub: g.ime || 'Slobodna', icon: '🚗' });
  renderSimpleModal('garage', g);
}

function openGarageNew() {
  const maxBr = Math.max(0, ...DATA.garages.map(g => g.broj));
  renderSimpleModal('garage', {
    broj: maxBr + 1, ime: '', povrsina: 0, prodat: false,
    vrednost: 0, naplaceno: 0, preostalo: 0, _new: true
  });
}

function openOstava(idx) {
  const o = DATA.ostave[idx];
  if (!o) return;
  renderSimpleModal('ostava', { ...o, _idx: idx });
}

function openOstavaNew() {
  renderSimpleModal('ostava', {
    nivo: '', broj: '', ime: '', povrsina: 0, prodat: false,
    vrednost: 0, naplaceno: 0, preostalo: 0, _new: true
  });
}

function renderSimpleModal(type, item) {
  const m = document.getElementById('modalContent');
  const isNew = item._new;
  const isGarage = type === 'garage';
  const label = isGarage ? 'Garaža' : 'Ostava';
  const idLabel = isGarage ? `G-${item.broj}` : (item.broj || 'nova');
  
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">${label} ${idLabel}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        ${!isGarage ? `
        <div class="form-field">
          <label>Nivo</label>
          <input type="text" id="g_nivo" value="${item.nivo || ''}" placeholder="npr. -1">
        </div>
        <div class="form-field">
          <label>Broj / Oznaka</label>
          <input type="text" id="g_broj" value="${item.broj || ''}">
        </div>
        ` : `
        <div class="form-field">
          <label>Broj garaže</label>
          <input type="number" id="g_broj" value="${item.broj}">
        </div>
        <div class="form-field">
          <label>Status</label>
          <select id="g_prodat">
            <option value="false" ${!item.prodat ? 'selected' : ''}>Slobodna</option>
            <option value="true" ${item.prodat ? 'selected' : ''}>Prodata</option>
          </select>
        </div>
        `}
        <div class="form-field full">
          <label>Ime i prezime kupca</label>
          <input type="text" id="g_ime" value="${item.ime || ''}">
        </div>
        ${!isGarage ? `
        <div class="form-field full">
          <label>Status</label>
          <select id="g_prodat">
            <option value="false" ${!item.prodat ? 'selected' : ''}>Slobodna</option>
            <option value="true" ${item.prodat ? 'selected' : ''}>Prodata</option>
          </select>
        </div>
        ` : ''}
        <div class="form-field">
          <label>Površina (m²)</label>
          <input type="number" step="0.01" id="g_povrsina" value="${item.povrsina}">
        </div>
        <div class="form-field">
          <label>Vrednost (€)</label>
          <input type="number" step="0.01" id="g_vrednost" value="${item.vrednost}">
        </div>
        <div class="form-field">
          <label>Naplaćeno (€)</label>
          <input type="number" step="0.01" id="g_naplaceno" value="${item.naplaceno}" ${!isNew ? 'readonly style="color:var(--success);font-weight:600;"' : ''}>
        </div>
        <div class="form-field">
          <label>Preostalo (€)</label>
          <input type="number" step="0.01" id="g_preostalo" value="${item.preostalo}" readonly style="color:var(--danger);font-weight:600;">
        </div>
      </div>
      
      ${!isNew && item.prodat ? `
      <div class="payments-section">
        <h3>Nova uplata</h3>
        <div class="form-grid">
          <div class="form-field">
            <label>Iznos (€)</label>
            <input type="number" step="0.01" id="g_pay_amount" placeholder="0.00">
          </div>
          <div class="form-field">
            <label>Datum</label>
            <input type="date" id="g_pay_date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-field">
            <label>Način plaćanja</label>
            <select id="g_pay_method">
              <option value="Keš">Keš</option>
              <option value="Uplatnica">Uplatnica / Virman</option>
              <option value="Kartica">Kartica</option>
            </select>
          </div>
          <div class="form-field">
            <label>Napomena</label>
            <input type="text" id="g_pay_note" placeholder="opciono">
          </div>
          <div class="form-field full">
            <button class="btn btn-primary" onclick="addPaymentToItem('${type}', ${isGarage ? item.broj : item._idx})">
              + Dodaj uplatu i izdaj priznanicu
            </button>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      ${!isNew && item.prodat ? `<button class="btn btn-ghost" style="color:var(--danger); margin-right:auto;" onclick="unsellItem('${type}', ${isGarage ? item.broj : item._idx})">Poništi prodaju</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
      <button class="btn btn-primary" onclick="saveItem('${type}', ${isGarage ? item.broj : (item._idx !== undefined ? item._idx : -1)}, ${isNew})">Sačuvaj</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function saveItem(type, idOrIdx, isNew) {
  const isGarage = type === 'garage';
  const data = {
    ime: document.getElementById('g_ime').value.trim(),
    prodat: document.getElementById('g_prodat').value === 'true',
    povrsina: parseFloat(document.getElementById('g_povrsina').value) || 0,
    vrednost: parseFloat(document.getElementById('g_vrednost').value) || 0
  };
  
  if (isGarage) {
    data.broj = parseInt(document.getElementById('g_broj').value);
  } else {
    data.nivo = document.getElementById('g_nivo').value.trim();
    data.broj = document.getElementById('g_broj').value.trim();
  }
  
  const arr = isGarage ? DATA.garages : DATA.ostave;
  
  if (isNew) {
    data.naplaceno = parseFloat(document.getElementById('g_naplaceno').value) || 0;
    data.preostalo = data.vrednost - data.naplaceno;
    arr.push(data);
  } else {
    const idx = isGarage ? arr.findIndex(x => x.broj === idOrIdx) : idOrIdx;
    const old = arr[idx];
    arr[idx] = { ...old, ...data, naplaceno: old.naplaceno, preostalo: data.vrednost - (old.naplaceno || 0) };
  }
  
  if (isGarage) DATA.garages.sort((a,b) => a.broj - b.broj);
  saveToCache();
  closeModal();
  renderView();
  showToast('Sačuvano', 'success');
}

function unsellItem(type, idOrIdx) {
  const label = type === 'garage' ? 'garaže' : 'ostave';
  if (!confirm(`Poništiti prodaju ${label}? Podaci o kupcu će biti obrisani, ali stavka ostaje u evidenciji kao slobodna.`)) return;
  
  let item;
  if (type === 'garage') {
    item = DATA.garages.find(g => g.broj === idOrIdx);
  } else {
    item = DATA.ostave[idOrIdx];
  }
  if (!item) return;
  
  item.ime = '';
  item.prodat = false;
  item.naplaceno = 0;
  item.preostalo = item.vrednost;
  item.uplate = {};
  item.plan_otplate = null;
  
  saveToCache();
  closeModal();
  renderView();
  showToast('Prodaja poništena', 'success');
}

// Keep for compatibility
function deleteItem(type, idOrIdx) {
  showToast('Brisanje nije dozvoljeno. Možete samo poništiti prodaju.', 'error');
}

function addPaymentToItem(type, idOrIdx) {
  const amount = parseFloat(document.getElementById('g_pay_amount').value) || 0;
  const date = document.getElementById('g_pay_date').value;
  const method = document.getElementById('g_pay_method').value;
  const note = document.getElementById('g_pay_note').value.trim();
  
  if (amount <= 0) {
    showToast('Unesite iznos', 'error');
    return;
  }
  
  const isGarage = type === 'garage';
  const arr = isGarage ? DATA.garages : DATA.ostave;
  const idx = isGarage ? arr.findIndex(x => x.broj === idOrIdx) : idOrIdx;
  const item = arr[idx];
  
  item.naplaceno = (item.naplaceno || 0) + amount;
  item.preostalo = item.vrednost - item.naplaceno;
  
  createReceipt({
    payer: item.ime || `${isGarage ? 'Garaža' : 'Ostava'} ${isGarage ? item.broj : (item.broj || '?')}`,
    itemType: isGarage ? 'Garaža' : 'Ostava',
    itemId: String(isGarage ? item.broj : item.broj),
    itemDesc: isGarage ? `Garaža G-${item.broj}, ${fmtNum(item.povrsina)}m²` : `Ostava ${item.nivo || ''} ${item.broj || ''}, ${fmtNum(item.povrsina)}m²`,
    amount,
    method,
    date,
    note
  });
  
  saveToCache();
  closeModal();
  renderView();
  logActivity('UPLATA', `${type === 'garage' ? 'Garaža G-' + idOrIdx : 'Ostava ' + idOrIdx} · ${fmtEur(amount)}`);
  showToast('Uplata sačuvana, priznanica izdata', 'success');
}
// --- RECEIPTS ---
function generateReceiptNumber(receiptData) {
  // Format: [Zgrada][Lamela]-[BrojStana]-[DDMMYY]
  // npr. 031-10-170426 = zgrada 03, lamela 1 (A), stan 10, datum 17.04.2026
  const ZGRADA = '03'; // Trenutna zgrada (fiksno za Dacić Prom)
  
  let lamelaCode = '1'; // default (1 = A, 2 = B)
  let stanBroj = '';
  
  if (receiptData && receiptData.itemType) {
    const t = receiptData.itemType.toLowerCase();
    if (t === 'stan' || t.includes('stan')) {
      lamelaCode = receiptData.lamela === 'B' ? '2' : '1';
      stanBroj = String(receiptData.itemId || '').padStart(2, '0');
    } else if (t.includes('garaž') || t === 'garage') {
      lamelaCode = 'G';
      stanBroj = String(receiptData.itemId || '').padStart(3, '0');
    } else if (t.includes('ostav') || t === 'ostava') {
      lamelaCode = 'O';
      stanBroj = String(receiptData.itemId || '').padStart(3, '0');
    }
  }
  
  const d = receiptData && receiptData.date ? new Date(receiptData.date) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const dateStr = `${dd}${mm}${yy}`;
  
  return `${ZGRADA}${lamelaCode}-${stanBroj}-${dateStr}`;
}

function createReceipt(data) {
  const receipt = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    number: generateReceiptNumber(data),
    timestamp: Date.now(),
    issuedBy: currentUser,
    ...data
  };
  DATA.receipts.push(receipt);
  saveToCache();
  sbInsertReceipt(receipt).catch(()=>{});
  return receipt;
}

// --- RECEIPTS VIEW ---
function renderReceipts(c) {
  let filtered = [...DATA.receipts].sort((a,b) => b.timestamp - a.timestamp);
  
  if (currentFilter === 'stan') filtered = filtered.filter(r => r.itemType === 'Stan');
  else if (currentFilter === 'garaza') filtered = filtered.filter(r => r.itemType === 'Garaža');
  else if (currentFilter === 'ostava') filtered = filtered.filter(r => r.itemType === 'Ostava');
  
  if (searchQuery) {
    filtered = filtered.filter(r => 
      r.number.toLowerCase().includes(searchQuery) ||
      r.payer.toLowerCase().includes(searchQuery) ||
      (r.itemId || '').includes(searchQuery)
    );
  }
  
  const totalAmount = filtered.reduce((s,r) => s + r.amount, 0);
  
  c.innerHTML = `
    <div class="filter-row">
      <div class="chip ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Sve (${DATA.receipts.length})</div>
      <div class="chip ${currentFilter === 'stan' ? 'active' : ''}" onclick="setFilter('stan')">Stanovi</div>
      <div class="chip ${currentFilter === 'garaza' ? 'active' : ''}" onclick="setFilter('garaza')">Garaže</div>
      <div class="chip ${currentFilter === 'ostava' ? 'active' : ''}" onclick="setFilter('ostava')">Ostave</div>
      <div style="flex:1;"></div>
      <div style="font-size:14px; color:var(--text-dim);">Ukupno: <strong style="color:var(--accent);">${fmtEur(totalAmount)}</strong></div>
    </div>
    
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Broj</th>
              <th>Datum</th>
              <th>Uplatilac</th>
              <th>Predmet</th>
              <th>Način</th>
              <th class="num">Iznos</th>
              <th style="width:120px;"></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? '<tr><td colspan="7"><div class="empty-state">Još nema priznanica. Priznanica se kreira automatski kada evidentirate uplatu.</div></td></tr>' :
              filtered.map(r => `
                <tr>
                  <td><strong style="font-family:monospace; color:var(--accent);">${r.number}</strong></td>
                  <td>${fmtDate(r.timestamp)}</td>
                  <td>${r.payer}</td>
                  <td>${r.itemType} ${r.itemId} <span style="color:var(--text-dim); font-size:11px;">${(r.itemDesc || '').substring(0, 30)}</span></td>
                  <td><span class="badge available">${r.method}</span></td>
                  <td class="num" style="color:var(--success); font-weight:600;">${fmtEur(r.amount)}</td>
                  <td>
                    <button class="btn btn-ghost" onclick="viewReceipt('${r.id}')" style="padding:4px 10px;">Pregled</button>
                  </td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function viewReceipt(id) {
  const r = DATA.receipts.find(x => x.id === id);
  if (!r) return;
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '700px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Priznanica ${r.number}</div>
        <div class="modal-title-sub">Izdata ${fmtDateTime(r.timestamp)}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="receiptBody">
      ${renderReceiptHTML(r)}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" style="color:var(--danger); margin-right:auto;" onclick="deleteReceipt('${r.id}')">Obriši priznanicu</button>
      <button class="btn btn-secondary" onclick="printReceipt('${r.id}')">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
        Štampaj
      </button>
      <button class="btn btn-primary" onclick="downloadReceiptPDF('${r.id}')">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Preuzmi PDF
      </button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function renderReceiptHTML(r) {
  const date = new Date(r.timestamp);
  const words = numberToWords(r.amount);
  const lamelaText = r.lamela ? ` · Lamela ${r.lamela}` : '';
  
  return `
    <div class="receipt-preview" id="receiptContent">
      <div style="text-align:center; margin-bottom:12px;">
        <img src="${_LOGO_PNG_DATA_URL || 'logo.png'}" alt="Dacić Prom" style="max-height:60px; max-width:200px;">
      </div>
      <h2>PRIZNANICA</h2>
      <div class="receipt-num">Broj: <strong>${r.number}</strong> · ${fmtDate(date)}</div>
      
      <div class="receipt-row">
        <span class="label">Uplatilac:</span>
        <span class="val">${r.payer}</span>
      </div>
      <div class="receipt-row">
        <span class="label">Predmet uplate:</span>
        <span class="val">${r.itemType} ${r.itemId}${lamelaText}</span>
      </div>
      ${r.itemDesc ? `
      <div class="receipt-row">
        <span class="label">Opis:</span>
        <span class="val" style="font-size:12px;">${r.itemDesc}</span>
      </div>
      ` : ''}
      ${r.paymentMonth ? `
      <div class="receipt-row">
        <span class="label">Period:</span>
        <span class="val">${formatMonthKey(r.paymentMonth)}</span>
      </div>
      ` : ''}
      <div class="receipt-row">
        <span class="label">Datum uplate:</span>
        <span class="val">${fmtDate(r.date || r.timestamp)}</span>
      </div>
      ${r.note ? `
      <div class="receipt-row">
        <span class="label">Napomena:</span>
        <span class="val">${r.note}</span>
      </div>
      ` : ''}
      
      <div class="receipt-amount">
        ${fmtEur(r.amount)}
      </div>
      <div style="text-align:center; font-style:italic; color:#666; font-size:13px; margin-top:-10px; margin-bottom:20px;">
        Slovima: ${words} evra
      </div>
      
      <div class="receipt-signatures">
        <div>
          <div class="sig-line">Uplatioc</div>
        </div>
        <div>
          <div class="sig-line">Za Dacić Prom</div>
          <div style="text-align:center; color:#555; font-size:11px;">${r.issuedBy || ''}</div>
        </div>
      </div>
    </div>
  `;
}

function formatMonthKey(key) {
  const [y, m] = key.split('-');
  const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  return `${months[parseInt(m)-1]} ${y}.`;
}

function deleteReceipt(id) {
  if (!confirm('Obrisati ovu priznanicu? Ova radnja ne briše uplatu, samo priznanicu.')) return;
  DATA.receipts = DATA.receipts.filter(r => r.id !== id);
  saveToCache();
  closeModal();
  renderView();
  showToast('Priznanica obrisana', 'success');
}

function printReceipt(id) {
  const r = DATA.receipts.find(x => x.id === id);
  if (!r) return;
  
  // Look up preostalo for this item
  let preostalo = null;
  if (r.itemType === 'Stan' || r.itemType === 'stan') {
    const apt = DATA.apartments.find(a => `${a.lamela}-${a.stan}` === r.itemId || a.stan === parseInt(r.itemId));
    if (apt) preostalo = apt.preostalo;
  } else if (r.itemType === 'Garaža' || r.itemType?.toLowerCase().includes('garaž')) {
    const g = DATA.garages.find(x => `G-${x.broj}` === r.itemId || String(x.broj) === String(r.itemId));
    if (g) preostalo = g.preostalo;
  }
  
  const dateFmt = fmtDate(r.date || r.timestamp);
  const periodLabel = r.paymentMonth ? formatMonthKey(r.paymentMonth) : '';
  const itemLabel = `${r.itemType} ${r.itemId}${r.lamela ? ' · Lamela ' + r.lamela : ''}`;
  
  const singleReceipt = (copyLabel) => `
    <div class="receipt-copy">
      <div class="copy-label">${copyLabel}</div>
      <div class="date-corner">${dateFmt}</div>
      <div class="logo-row">
        <img src="${_LOGO_PNG_DATA_URL || 'logo.png'}" alt="Dacić Prom">
      </div>
      <h2>PRIZNANICA</h2>
      <div class="num">Broj: <strong>${r.number}</strong></div>
      <div class="rows">
        <div class="row"><span class="label">Uplatilac:</span><span class="val">${r.payer}</span></div>
        <div class="row"><span class="label">Predmet uplate:</span><span class="val">${itemLabel}</span></div>
        ${r.itemDesc ? `<div class="row"><span class="label">Opis:</span><span class="val">${r.itemDesc}</span></div>` : ''}
        ${periodLabel ? `<div class="row"><span class="label">Period:</span><span class="val">${periodLabel}</span></div>` : ''}
        <div class="row"><span class="label">Datum uplate:</span><span class="val">${dateFmt}</span></div>
        ${r.note ? `<div class="row"><span class="label">Napomena:</span><span class="val">${r.note}</span></div>` : ''}
        ${preostalo !== null ? `<div class="row" style="margin-top:4px; padding-top:6px; border-top:1px dashed #ccc;"><span class="label" style="color:#555;">Preostalo za plaćanje:</span><span class="val" style="color:#c00; font-size:13px;">${fmtEur(Math.max(0, preostalo))}</span></div>` : ''}
      </div>
      <div class="amount">${fmtEur(r.amount)}</div>
      <div class="words">Slovima: ${numberToWords(r.amount)} evra</div>
      <div class="sigs">
        <div><div class="sig-line">Uplatilac</div></div>
        <div><div class="sig-line">Za Dacić Prom</div><div class="sig-sub">${r.issuedBy || ''}</div></div>
      </div>
    </div>
  `;
  
  const __printHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Priznanica ${r.number}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; color: #1a1a1a; font-size: 11px; background: white; }
        .page {
          width: 210mm; height: 297mm;
          display: flex; flex-direction: column;
          padding: 0;
        }
        .receipt-copy {
          width: 210mm; height: 148mm;
          padding: 12mm 15mm;
          position: relative;
          box-sizing: border-box;
          overflow: hidden;
        }
        .receipt-copy:first-child {
          border-bottom: 1px dashed #999;
        }
        .copy-label {
          position: absolute;
          top: 5mm;
          left: 15mm;
          font-size: 9px;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 600;
        }
        .date-corner {
          position: absolute;
          top: 5mm;
          right: 15mm;
          font-size: 11px;
          font-weight: 700;
          color: #333;
          background: #f5f0e8;
          padding: 3px 10px;
          border-radius: 4px;
        }
        .logo-row { text-align: center; margin: 6mm 0 3mm; }
        .logo-row img { max-height: 18mm; max-width: 70mm; }
        h2 {
          text-align: center;
          font-size: 20px;
          margin: 2mm 0 1mm;
          letter-spacing: 3px;
          color: #1a2332;
        }
        .num { text-align: center; color: #555; margin-bottom: 5mm; font-size: 11px; }
        .rows { margin-bottom: 3mm; }
        .row {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          border-bottom: 1px solid #eee;
          font-size: 11px;
        }
        .label { color: #555; }
        .val { font-weight: 600; text-align: right; max-width: 65%; }
        .amount {
          background: #d4a574;
          color: #1a2332;
          padding: 6mm;
          text-align: center;
          font-size: 20px;
          font-weight: bold;
          margin: 3mm 0 1mm;
          border-radius: 4px;
        }
        .words {
          text-align: center;
          font-style: italic;
          color: #666;
          font-size: 10px;
          margin-bottom: 5mm;
        }
        .sigs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15mm;
          margin-top: 6mm;
          font-size: 10px;
        }
        .sig-line {
          border-top: 1px solid #333;
          padding-top: 3px;
          text-align: center;
          color: #555;
        }
        .sig-sub {
          text-align: center;
          color: #777;
          font-size: 9px;
          margin-top: 2px;
        }
        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="page">
        ${singleReceipt('Primerak za kupca')}
        ${singleReceipt('Primerak za arhivu')}
      </div>
    </body>
    </html>
  `;
  openPrintWindow(__printHtml, `Priznanica ${r.number}`);
}

function downloadReceiptPDF(id) {
  // Use browser's print-to-PDF via window.print
  printReceipt(id);
  showToast('U dijalogu za štampu izaberite "Sačuvaj kao PDF"', '');
}

// --- Number to words in Serbian ---
function numberToWords(num) {
  if (num === 0) return 'nula';
  const integer = Math.floor(num);
  const decimals = Math.round((num - integer) * 100);
  
  let result = intToWords(integer);
  if (decimals > 0) {
    result += ' i ' + String(decimals).padStart(2, '0') + '/100';
  }
  return result;
}

function intToWords(n) {
  if (n === 0) return '';
  const ones = ['','jedan','dva','tri','četiri','pet','šest','sedam','osam','devet'];
  const teens = ['deset','jedanaest','dvanaest','trinaest','četrnaest','petnaest','šesnaest','sedamnaest','osamnaest','devetnaest'];
  const tens = ['','','dvadeset','trideset','četrdeset','pedeset','šezdeset','sedamdeset','osamdeset','devedeset'];
  const hundreds = ['','sto','dvesta','trista','četristo','petsto','šesto','sedamsto','osamsto','devetsto'];
  
  function below1000(n) {
    if (n === 0) return '';
    let r = '';
    if (n >= 100) { r += hundreds[Math.floor(n/100)]; n %= 100; }
    if (n >= 20) { r += tens[Math.floor(n/10)]; n %= 10; if (n > 0) r += ' '; }
    else if (n >= 10) { r += teens[n-10]; return r; }
    if (n > 0) r += ones[n];
    return r;
  }
  
  let result = '';
  if (n >= 1000000) {
    const mil = Math.floor(n / 1000000);
    result += (mil === 1 ? 'milion' : below1000(mil) + ' miliona') + ' ';
    n %= 1000000;
  }
  if (n >= 1000) {
    const hilj = Math.floor(n / 1000);
    if (hilj === 1) result += 'hiljadu ';
    else if (hilj === 2) result += 'dve hiljade ';
    else if (hilj === 3) result += 'tri hiljade ';
    else if (hilj === 4) result += 'četiri hiljade ';
    else result += below1000(hilj) + ' hiljada ';
    n %= 1000;
  }
  result += below1000(n);
  return result.trim();
}

// --- EXPORT ---
function exportData() {
  let csv = '';
  const BOM = '\uFEFF';
  
  if (currentView === 'apartments') {
    csv = 'Sprat;Stan;Kupac;Prodat;Površina;Cena €/m² sa PDV;Vrednost sa PDV;Isplaćeno;Preostalo;Napomena\n';
    DATA.apartments.forEach(a => {
      csv += `${a.sprat || ''};${a.stan};"${a.ime || ''}";${a.prodat ? 'Da' : 'Ne'};${a.povrsina};${a.cena_m2_pdv};${a.vrednost_sa_pdv};${a.isplaceno};${a.preostalo};"${(a.napomena||'').replace(/"/g,'""')}"\n`;
    });
  } else if (currentView === 'garages') {
    csv = 'Broj;Kupac;Prodata;Površina;Vrednost;Naplaćeno;Preostalo\n';
    DATA.garages.forEach(g => {
      csv += `${g.broj};"${g.ime || ''}";${g.prodat ? 'Da' : 'Ne'};${g.povrsina};${g.vrednost};${g.naplaceno};${g.preostalo}\n`;
    });
  } else if (currentView === 'ostave') {
    csv = 'Nivo;Broj;Kupac;Prodata;Površina;Vrednost;Naplaćeno;Preostalo\n';
    DATA.ostave.forEach(o => {
      csv += `"${o.nivo||''}";"${o.broj||''}";"${o.ime || ''}";${o.prodat ? 'Da' : 'Ne'};${o.povrsina};${o.vrednost};${o.naplaceno};${o.preostalo}\n`;
    });
  } else if (currentView === 'receipts') {
    csv = 'Broj;Datum;Uplatilac;Tip;ID;Način;Iznos;Napomena\n';
    DATA.receipts.forEach(r => {
      csv += `${r.number};${fmtDate(r.timestamp)};"${r.payer}";${r.itemType};${r.itemId};${r.method};${r.amount};"${(r.note||'').replace(/"/g,'""')}"\n`;
    });
  }
  
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentView}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Izvezeno u CSV', 'success');
}

// --- INIT ---
async function init() {
  applyTheme();
  await loadData();
  // autoRestoreCheck removed - Supabase is source of truth
  
  // Preload logo as data URL for print functions
  try {
    const resp = await fetch('logo.png');
    if (resp.ok) {
      const blob = await resp.blob();
      _LOGO_PNG_DATA_URL = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    }
  } catch (e) { console.warn('Logo preload failed:', e); }
  
  const hasSession = await checkSession();
  if (!hasSession) {
    document.getElementById('loginScreen').style.display = 'flex';
  }
  
  // Enter key on login
  document.getElementById('password').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('username').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
  
  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.log('SW registration skipped', e);
    }
  }
}

// ============================================
// PLAN OTPLATE (Installment Plan)
// ============================================

function renderPlanSummary(item) {
  const plan = item.plan_otplate;
  if (!plan || !plan.rate || plan.rate.length === 0) {
    return `<div style="color:var(--text-dim); font-size:13px; font-style:italic;">Plan otplate još nije kreiran. Kliknite "Kreiraj plan" da unesete dogovorenu dinamiku isplate.</div>`;
  }
  
  const totalPlan = plan.rate.reduce((s,r) => s + (r.iznos || 0), 0);
  const today = new Date();
  today.setHours(0,0,0,0);
  
  // Count paid/unpaid
  let paidRate = 0, overdueRate = 0, upcomingRate = 0;
  plan.rate.forEach(r => {
    const dueDate = new Date(r.datum);
    if (r.isplacena) paidRate++;
    else if (dueDate < today) overdueRate++;
    else upcomingRate++;
  });
  
  return `
    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px;">
      <div style="padding:10px; background:var(--surface); border-radius:6px; text-align:center;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Ukupno po planu</div>
        <div style="font-weight:600; color:var(--accent);">${fmtEur(totalPlan)}</div>
      </div>
      <div style="padding:10px; background:var(--surface); border-radius:6px; text-align:center;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Isplaćeno rata</div>
        <div style="font-weight:600; color:var(--success);">${paidRate} / ${plan.rate.length}</div>
      </div>
      <div style="padding:10px; background:var(--surface); border-radius:6px; text-align:center;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Kasne rate</div>
        <div style="font-weight:600; color:${overdueRate > 0 ? 'var(--danger)' : 'var(--text-dim)'};">${overdueRate}</div>
      </div>
      <div style="padding:10px; background:var(--surface); border-radius:6px; text-align:center;">
        <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase;">Predstojeće</div>
        <div style="font-weight:600;">${upcomingRate}</div>
      </div>
    </div>
    <div style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:6px;">
      <table class="data-table" style="background:var(--surface);">
        <thead><tr>
          <th>#</th><th>Opis</th><th>Rok</th><th class="num">Iznos</th><th class="center">Status</th>
        </tr></thead>
        <tbody>
          ${plan.rate.map((r, idx) => {
            const dueDate = new Date(r.datum);
            const isOverdue = !r.isplacena && dueDate < today;
            return `
              <tr>
                <td>${idx + 1}</td>
                <td>${r.opis || (idx === 0 && plan.kapara ? 'Kapara' : 'Rata ' + (idx+1))}</td>
                <td>${fmtDate(r.datum)}</td>
                <td class="num">${fmtEur(r.iznos)}</td>
                <td class="center">
                  ${r.isplacena ? '<span class="badge sold">Isplaćena</span>' : 
                    (isOverdue ? '<span class="badge partial" style="background:rgba(248,113,113,0.15);color:var(--danger);">Kasni</span>' : 
                    '<span class="badge available">Čeka se</span>')}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function autoSaveApartmentThenPlan(lamela, stan) {
  // Save current form values to apartment before opening plan editor
  // so that data is not lost when returning from plan editor
  const idx = DATA.apartments.findIndex(a => a.lamela === lamela && a.stan === stan);
  if (idx === -1) return openPlanEditor('apartment', lamela, stan);
  const old = DATA.apartments[idx];
  
  // Read all form fields that exist
  const fields = ['f_ime','f_prodat','f_ugovor','f_sprat','f_napomena','f_cena_m2_pdv','f_vred_sa','f_vred_bez'];
  const updates = {};
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'f_prodat') updates.prodat = el.value === 'true';
    else if (id === 'f_ugovor') updates.ugovor = el.value === 'true';
    else if (['f_cena_m2_pdv','f_vred_sa','f_vred_bez'].includes(id)) {
      const key = id === 'f_cena_m2_pdv' ? 'cena_m2_pdv' : id === 'f_vred_sa' ? 'vrednost_sa_pdv' : 'vrednost_bez_pdv';
      updates[key] = parseFloat(el.value) || old[key] || 0;
    } else {
      const key = id.replace('f_','');
      updates[key] = el.value.trim();
    }
  });
  
  DATA.apartments[idx] = { ...old, ...updates };
  if (updates.vrednost_sa_pdv) {
    DATA.apartments[idx].preostalo = updates.vrednost_sa_pdv - (old.isplaceno || 0);
  }
  saveToCache();
  openPlanEditor('apartment', lamela, stan);
}

function openPlanEditor(type, idOrLamela, stanOrIdx) {
  let item, closeCallback;
  if (type === 'apartment') {
    item = findApartment(idOrLamela, stanOrIdx);
    closeCallback = () => openApartment(idOrLamela, stanOrIdx);
  } else if (type === 'garage') {
    item = DATA.garages.find(g => g.broj === idOrLamela);
    closeCallback = () => openGarage(idOrLamela);
  } else if (type === 'ostava') {
    item = DATA.ostave[idOrLamela];
    closeCallback = () => openOstava(idOrLamela);
  }
  if (!item) return;
  
  // Initialize plan if empty
  if (!item.plan_otplate) {
    item.plan_otplate = { kapara_pct: 30, rate: [] };
  }
  
  // Helper: create a working copy for editing
  const plan = JSON.parse(JSON.stringify(item.plan_otplate));
  window._editingPlan = { plan, type, idOrLamela, stanOrIdx, itemRef: item, closeCallback };
  
  renderPlanEditor();
}

function renderPlanEditor() {
  const { plan, itemRef } = window._editingPlan;
  const totalValue = itemRef.vrednost_sa_pdv || itemRef.vrednost || 0;
  const currentSum = plan.rate.reduce((s,r) => s + (r.iznos || 0), 0);
  const diff = totalValue - currentSum;
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '820px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Plan otplate</div>
        <div class="modal-title-sub">${itemRef.ime || 'Bez kupca'} · Vrednost: ${fmtEur(totalValue)}</div>
      </div>
      <button class="modal-close" onclick="cancelPlanEdit()">×</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--surface-2); padding:12px; border-radius:8px; margin-bottom:16px; font-size:13px;">
        <strong>Brzi šabloni:</strong> automatski popuni plan na osnovu procenta kapare i broja mesečnih rata.
      </div>
      <div class="form-grid" style="margin-bottom:16px;">
        <div class="form-field">
          <label>Kapara (%)</label>
          <input type="number" id="plan_kapara_pct" value="${plan.kapara_pct || 30}" min="0" max="100" step="1">
        </div>
        <div class="form-field">
          <label>Datum kapare</label>
          <input type="date" id="plan_kapara_datum" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-field">
          <label>Broj mesečnih rata (ostatak)</label>
          <input type="number" id="plan_br_rata" value="12" min="1" max="120">
        </div>
        <div class="form-field">
          <label>Prva rata (datum)</label>
          <input type="date" id="plan_prva_rata" value="${nextMonthDate()}">
        </div>
        <div class="form-field full">
          <button type="button" class="btn btn-secondary" onclick="generatePlanTemplate()">⚡ Generiši plan po šablonu</button>
          <span style="color:var(--text-dim); font-size:12px; margin-left:12px;">Ovo briše postojeće rate u planu.</span>
        </div>
      </div>
      
      <div style="border-top:1px solid var(--border); padding-top:16px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong>Rate (${plan.rate.length})</strong>
          <button type="button" class="btn btn-secondary" onclick="addPlanRata()">+ Dodaj ratu</button>
        </div>
        <div id="planRateList">
          ${renderPlanRateList()}
        </div>
      </div>
      
      <div style="margin-top:16px; padding:12px; background:var(--surface-2); border-radius:8px; display:grid; grid-template-columns:repeat(3,1fr); gap:10px; font-size:13px;">
        <div><span style="color:var(--text-dim);">Vrednost:</span> <strong>${fmtEur(totalValue)}</strong></div>
        <div><span style="color:var(--text-dim);">Po planu:</span> <strong>${fmtEur(currentSum)}</strong></div>
        <div style="color:${Math.abs(diff) > 0.01 ? 'var(--danger)' : 'var(--success)'};">
          <span style="color:var(--text-dim);">Razlika:</span> <strong>${fmtEur(diff)}</strong>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" style="color:var(--danger); margin-right:auto;" onclick="clearPlan()">Obriši ceo plan</button>
      <button class="btn btn-secondary" onclick="cancelPlanEdit()">Otkaži</button>
      <button class="btn btn-primary" onclick="savePlan()">Sačuvaj plan</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function renderPlanRateList() {
  const { plan } = window._editingPlan;
  if (plan.rate.length === 0) {
    return '<div class="empty-state" style="padding:30px;">Još nema rata. Koristite šablon ili "Dodaj ratu".</div>';
  }
  return `
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${plan.rate.map((r, idx) => `
        <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px 12px;">
          <div style="display:grid; grid-template-columns:1fr auto; gap:8px; align-items:start; margin-bottom:8px;">
            <input type="text" value="${r.opis || ''}" placeholder="${idx === 0 ? 'Kapara' : 'Rata ' + (idx+1)}" 
                   onchange="updateRata(${idx}, 'opis', this.value)" 
                   style="background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:7px 10px; color:var(--text); font-size:14px; font-weight:600; width:100%;">
            <button type="button" class="btn btn-ghost" style="color:var(--danger); padding:6px 10px; flex-shrink:0;" onclick="removeRata(${idx})">×</button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
            <div>
              <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase; margin-bottom:3px;">Rok uplate</div>
              <input type="date" value="${r.datum || ''}" onchange="updateRata(${idx}, 'datum', this.value)" 
                     style="background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--text); font-size:13px; width:100%;">
            </div>
            <div>
              <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase; margin-bottom:3px;">Iznos (€)</div>
              <input type="number" step="0.01" value="${r.iznos || 0}" onchange="updateRata(${idx}, 'iznos', parseFloat(this.value)||0)" 
                     style="background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--accent); font-size:14px; font-weight:700; text-align:right; width:100%;">
            </div>
          </div>
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:6px 8px; background:${r.isplacena ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)'}; border-radius:6px; border:1px solid ${r.isplacena ? 'rgba(34,197,94,0.3)' : 'var(--border)'};">
            <input type="checkbox" ${r.isplacena ? 'checked' : ''} onchange="updateRata(${idx}, 'isplacena', this.checked)" style="width:18px; height:18px; flex-shrink:0;">
            <span style="font-size:13px; color:${r.isplacena ? 'var(--success)' : 'var(--text-dim)'}; font-weight:${r.isplacena ? '600' : '400'};">
              ${r.isplacena ? '✓ Isplaćena' : 'Označi kao isplaćenu'}
            </span>
            ${r.isplacena ? `<span style="margin-left:auto; font-size:12px; color:var(--success); font-weight:700;">${fmtEur(r.iznos||0)}</span>` : ''}
          </label>
        </div>
      `).join('')}
    </div>
  `;
}

function updateRata(idx, field, value) {
  window._editingPlan.plan.rate[idx][field] = value;
  
  // Auto-generate receipt when rata is marked as paid
  if (field === 'isplacena' && value === true) {
    const { plan, itemRef, type, idOrLamela, stanOrIdx } = window._editingPlan;
    const rata = plan.rate[idx];
    if (rata && rata.iznos > 0) {
      // Determine item details for receipt
      let itemType = 'Stan', itemId = '', lamela = '';
      if (type === 'apartment') {
        itemType = 'Stan'; itemId = `${itemRef.lamela}-${itemRef.stan}`; lamela = itemRef.lamela;
      } else if (type === 'garage') {
        itemType = 'Garaža'; itemId = `G-${itemRef.broj}`;
      } else {
        itemType = 'Ostava'; itemId = itemRef.broj || '';
      }
      const receipt = createReceipt({
        payer: itemRef.ime || itemType + ' ' + itemId,
        itemType, itemId, lamela,
        itemDesc: rata.opis || '',
        amount: rata.iznos,
        method: 'Rata',
        date: rata.datum || new Date().toISOString().split('T')[0],
        note: `Rata iz plana otplate: ${rata.opis || idx+1}`
      });
      showToast(`Rata označena. Priznanica ${receipt.number} kreirana.`, 'success');
    }
  }
  
  // Re-render totals footer
  const { plan, itemRef } = window._editingPlan;
  const totalValue = itemRef.vrednost_sa_pdv || itemRef.vrednost || 0;
  const currentSum = plan.rate.reduce((s,r) => s + (r.iznos || 0), 0);
  const diff = totalValue - currentSum;
  const footer = document.querySelector('#modalContent .modal-body > div:last-child');
  if (footer && footer.textContent.includes('Razlika')) {
    footer.innerHTML = `
      <div><span style="color:var(--text-dim);">Vrednost:</span> <strong>${fmtEur(totalValue)}</strong></div>
      <div><span style="color:var(--text-dim);">Po planu:</span> <strong>${fmtEur(currentSum)}</strong></div>
      <div style="color:${Math.abs(diff) > 0.01 ? 'var(--danger)' : 'var(--success)'};">
        <span style="color:var(--text-dim);">Razlika:</span> <strong>${fmtEur(diff)}</strong>
      </div>
    `;
  }
}

function addPlanRata() {
  const { plan } = window._editingPlan;
  plan.rate.push({
    opis: '',
    datum: nextMonthDate(),
    iznos: 0,
    isplacena: false
  });
  document.getElementById('planRateList').innerHTML = renderPlanRateList();
}

function removeRata(idx) {
  window._editingPlan.plan.rate.splice(idx, 1);
  document.getElementById('planRateList').innerHTML = renderPlanRateList();
}

function generatePlanTemplate() {
  const { plan, itemRef } = window._editingPlan;
  const totalValue = itemRef.vrednost_sa_pdv || itemRef.vrednost || 0;
  
  const kaparaPct = parseFloat(document.getElementById('plan_kapara_pct').value) || 0;
  const kaparaDatum = document.getElementById('plan_kapara_datum').value;
  const brRata = parseInt(document.getElementById('plan_br_rata').value) || 12;
  const prvaRata = document.getElementById('plan_prva_rata').value;
  
  if (!totalValue) {
    showToast('Vrednost mora biti unesena pre generisanja plana', 'error');
    return;
  }
  if (!confirm('Ovo će obrisati trenutni plan i kreirati novi po šablonu. Nastaviti?')) return;
  
  plan.kapara_pct = kaparaPct;
  plan.rate = [];
  
  const kaparaIznos = (totalValue * kaparaPct) / 100;
  const ostatak = totalValue - kaparaIznos;
  
  if (kaparaIznos > 0) {
    plan.rate.push({
      opis: `Kapara (${kaparaPct}%)`,
      datum: kaparaDatum,
      iznos: Math.round(kaparaIznos * 100) / 100,
      isplacena: false
    });
  }
  
  if (brRata > 0 && ostatak > 0) {
    const ratniIznos = Math.round((ostatak / brRata) * 100) / 100;
    const startDate = new Date(prvaRata);
    
    let accumulated = 0;
    for (let i = 0; i < brRata; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const isLast = (i === brRata - 1);
      const iznos = isLast ? Math.round((ostatak - accumulated) * 100) / 100 : ratniIznos;
      accumulated += ratniIznos;
      plan.rate.push({
        opis: `Rata ${i + 1}/${brRata}`,
        datum: d.toISOString().split('T')[0],
        iznos,
        isplacena: false
      });
    }
  }
  
  document.getElementById('planRateList').innerHTML = renderPlanRateList();
  showToast('Plan generisan', 'success');
}

function clearPlan() {
  if (!confirm('Obrisati ceo plan otplate?')) return;
  window._editingPlan.plan.rate = [];
  document.getElementById('planRateList').innerHTML = renderPlanRateList();
}

function savePlan() {
  const { plan, itemRef, type, closeCallback } = window._editingPlan;
  plan.kapara_pct = parseFloat(document.getElementById('plan_kapara_pct').value) || 0;
  itemRef.plan_otplate = plan;
  syncPlanToPayments(itemRef);
  saveToCache();
  if (type === 'apartment') sbUpsertApartment(itemRef).catch(()=>{});
  else if (type === 'garage') sbUpsertGarage(itemRef).catch(()=>{});
  else sbUpsertOstava(itemRef).catch(()=>{});
  delete window._editingPlan;
  logActivity('PLAN', 'Plan otplate sačuvan');
  showToast('Plan otplate sačuvan', 'success');
  closeCallback();
  renderView();
}

// Sync paid installments from plan to isplaceno/naplaceno + uplate
function syncPlanToPayments(item) {
  if (!item.plan_otplate || !item.plan_otplate.rate) return;
  
  // Save original uplate from Excel (green cells), to preserve them
  if (!item._originalUplate) {
    item._originalUplate = JSON.parse(JSON.stringify(item.uplate || {}));
    item._originalUplateDates = JSON.parse(JSON.stringify(item.uplate_dates || {}));
  }
  
  // Start from original, then add plan's paid rates
  const uplate = JSON.parse(JSON.stringify(item._originalUplate || {}));
  const uplateDates = JSON.parse(JSON.stringify(item._originalUplateDates || {}));
  
  let planPaidSum = 0;
  item.plan_otplate.rate.forEach((r, idx) => {
    if (r.isplacena && r.iznos > 0) {
      planPaidSum += r.iznos;
      // Add as synthetic uplate for this month (use date if available)
      const d = r.datum ? new Date(r.datum) : new Date();
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      // If there's already an uplate in this month, add on top
      const syntheticKey = `${mk}-plan${idx}`;
      uplate[syntheticKey] = r.iznos;
      uplateDates[syntheticKey] = r.datum || `${mk}-15`;
    }
  });
  
  item.uplate = uplate;
  item.uplate_dates = uplateDates;
  
  // Recompute isplaceno as sum of uplate
  const totalUplate = Object.values(uplate).reduce((s, v) => s + v, 0);
  
  // Update appropriate field (stanovi koriste isplaceno/preostalo/vrednost_sa_pdv, garaže/ostave koriste naplaceno/preostalo/vrednost)
  if (typeof item.vrednost_sa_pdv !== 'undefined') {
    // Apartment
    item.isplaceno = totalUplate;
    item.preostalo = item.vrednost_sa_pdv - totalUplate;
  } else {
    // Garage / ostava
    item.naplaceno = totalUplate;
    item.preostalo = item.vrednost - totalUplate;
  }
}

function cancelPlanEdit() {
  const { closeCallback } = window._editingPlan;
  delete window._editingPlan;
  closeCallback();
}

function nextMonthDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

// ============================================
// KUPCI (CUSTOMERS) - consolidated view
// ============================================

function getCustomerKey(ime) {
  return (ime || '').trim().toLowerCase();
}

function getAllCustomers() {
  // Aggregate all items (apartments, garages, ostave) by customer name
  // EXCLUDES parcel owners - they are in separate view
  const map = {};
  
  DATA.apartments.forEach(a => {
    if (!a.ime || !a.prodat || a.vlasnik_parcele) return;
    const key = getCustomerKey(a.ime);
    if (!map[key]) map[key] = { ime: a.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].stanovi.push(a);
  });
  
  (DATA.garages || []).forEach(g => {
    if (!g.ime || !g.prodat || g.vlasnik_parcele) return;
    const key = getCustomerKey(g.ime);
    if (!map[key]) map[key] = { ime: g.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].garaze.push(g);
  });
  
  (DATA.ostave || []).forEach((o, idx) => {
    if (!o.ime || !o.prodat || o.vlasnik_parcele) return;
    const key = getCustomerKey(o.ime);
    if (!map[key]) map[key] = { ime: o.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].ostave.push({ ...o, _idx: idx });
  });
  
  // Calculate totals
  Object.values(map).forEach(c => {
    const allItems = [...c.stanovi, ...c.garaze, ...c.ostave];
    c.ukupna_vrednost = allItems.reduce((s,i) => s + (i.vrednost_sa_pdv || i.vrednost || 0), 0);
    c.ukupno_isplaceno = allItems.reduce((s,i) => s + (i.isplaceno || i.naplaceno || 0), 0);
    c.ukupno_preostalo = c.ukupna_vrednost - c.ukupno_isplaceno;
    c.broj_stavki = allItems.length;
  });
  
  return Object.values(map).sort((a,b) => a.ime.localeCompare(b.ime, 'sr'));
}

function renderCustomers(c) {
  const customers = getAllCustomers();
  let filtered = customers;
  
  if (searchQuery) {
    filtered = filtered.filter(cu => cu.ime.toLowerCase().includes(searchQuery));
  }
  
  const totalCustomers = customers.length;
  const totalOutstanding = customers.reduce((s,cu) => s + cu.ukupno_preostalo, 0);
  const totalPaid = customers.reduce((s,cu) => s + cu.ukupno_isplaceno, 0);
  
  c.innerHTML = `
    <div class="stats-grid" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="stat-label">Ukupno kupaca</div>
        <div class="stat-value">${totalCustomers}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ukupno isplaćeno</div>
        <div class="stat-value success">${fmtEur(totalPaid)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Preostali dug</div>
        <div class="stat-value danger">${fmtEur(totalOutstanding)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Višestruki kupci</div>
        <div class="stat-value accent">${customers.filter(cu => cu.broj_stavki > 1).length}</div>
      </div>
    </div>
    
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Kupac</th>
              <th class="num">Isplaćeno</th>
              <th class="center">%</th>
              <th class="num">Preostalo</th>
              <th class="center hide-mobile">Ugovor</th>
              <th class="num hide-mobile">Cena u ugov.</th>
              <th class="num hide-mobile">Ukupna vred.</th>
              <th style="width:40px;"></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? '<tr><td colspan="6"><div class="empty-state">Nema kupaca</div></td></tr>' :
              filtered.map(cu => {
                const items = [];
                cu.stanovi.forEach(s => items.push(`Stan ${s.lamela}-${s.stan}`));
                cu.garaze.forEach(g => items.push(`Garaža G-${g.broj}`));
                cu.ostave.forEach(o => items.push(`Ostava ${o.broj || ''}`));
                
                const pct = cu.ukupna_vrednost > 0 
                  ? Math.round(cu.ukupno_isplaceno / cu.ukupna_vrednost * 100) 
                  : 0;
                const pctColor = pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
                
                const hasUgovor = cu.stanovi.some(s => s.ugovor);
                const ugovorBadge = cu.stanovi.length === 0 ? '—' 
                  : hasUgovor ? '<span class="badge sold" style="font-size:10px;">Potpisan</span>'
                  : '<span class="badge available" style="font-size:10px;">Nema</span>';
                
                return `
                  <tr onclick="openCustomerProfile('${getCustomerKey(cu.ime)}')">
                    <td>
                      <strong>${cu.ime}</strong>
                      <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${items.slice(0,2).join(' · ')}${items.length > 2 ? ` +${items.length-2}` : ''}</div>
                    </td>
                    <td class="num" style="color:var(--success);">${fmtEur(cu.ukupno_isplaceno)}</td>
                    <td class="center">
                      <span style="font-weight:700; color:${pctColor}; font-size:13px;">${pct}%</span>
                      <div style="width:36px; height:4px; background:var(--surface-3); border-radius:2px; margin:3px auto 0;">
                        <div style="width:${Math.min(pct,100)}%; height:100%; background:${pctColor}; border-radius:2px;"></div>
                      </div>
                    </td>
                    <td class="num" style="color:${hasDebt(cu.ukupno_preostalo) ? 'var(--danger)' : 'var(--text-dim)'};">${fmtEur(cu.ukupno_preostalo)}</td>
                    <td class="center hide-mobile">${ugovorBadge}</td>
                    <td class="num hide-mobile" style="color:var(--warning);">${cu.stanovi.some(s=>s.ugovorena_cena) ? fmtEur(cu.stanovi.reduce((s,a)=>s+(a.ugovorena_cena||0),0)) : '—'}</td>
                    <td class="num hide-mobile">${fmtEur(cu.ukupna_vrednost)}</td>
                    <td class="center" onclick="event.stopPropagation(); printCustomerProfile('${getCustomerKey(cu.ime)}');" title="Štampaj PDF" style="cursor:pointer;">
                      <span style="font-size:17px; opacity:0.5;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">🖨️</span>
                    </td>
                  </tr>
                `;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openCustomerProfile(customerKey) {
  const customers = getAllCustomers();
  const cu = customers.find(c => getCustomerKey(c.ime) === customerKey);
  if (!cu) return;
  trackRecent('customer', { key: customerKey, label: cu.ime, sub: `${cu.broj_stavki} stavki · ${fmtEur(cu.ukupno_preostalo)} preostalo`, icon: '👤' });
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '900px';
  
  // Check arrears for all customer apartments
  const arrearsItems = [];
  cu.stanovi.forEach(s => {
    const info = getArrearsInfo(s);
    if (info) arrearsItems.push({ type: 'Stan', id: `${s.lamela}-${s.stan}`, info });
  });
  
  // Also check installment plans for overdue rate
  const today = new Date();
  today.setHours(0,0,0,0);
  const overdueRate = [];
  [...cu.stanovi, ...cu.garaze, ...cu.ostave].forEach(item => {
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach((r, idx) => {
        if (!r.isplacena && r.datum) {
          const d = new Date(r.datum);
          if (d < today) {
            const daysOverdue = Math.floor((today - d) / (1000*60*60*24));
            overdueRate.push({
              item: item.stan ? `Stan ${item.lamela}-${item.stan}` : (item.broj ? `Garaža G-${item.broj}` : `Ostava ${item.broj||''}`),
              opis: r.opis || `Rata ${idx+1}`,
              datum: r.datum,
              iznos: r.iznos,
              days: daysOverdue
            });
          }
        }
      });
    }
  });
  
  const hasAnyArrears = arrearsItems.length > 0 || overdueRate.length > 0;
  
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">${cu.ime}</div>
        <div class="modal-title-sub">${cu.broj_stavki} stavki · Ukupno: ${fmtEur(cu.ukupna_vrednost)}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      ${hasAnyArrears ? `
        <div style="background:rgba(248, 113, 113, 0.12); border:1px solid rgba(248, 113, 113, 0.4); padding:14px 16px; border-radius:10px; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <span style="font-size:22px;">⚠</span>
            <strong style="color:var(--danger); font-size:14px; text-transform:uppercase; letter-spacing:0.5px;">Upozorenje - kašnjenje sa ratama</strong>
          </div>
          ${arrearsItems.length > 0 ? `
            <div style="padding-left:32px; font-size:13px; color:var(--text); margin-bottom:6px;">
              ${arrearsItems.map(a => `<div>• ${a.type} ${a.id}: ${a.info.text}</div>`).join('')}
            </div>
          ` : ''}
          ${overdueRate.length > 0 ? `
            <div style="padding-left:32px; font-size:13px; color:var(--text);">
              <div style="margin-bottom:4px; font-weight:600;">Nepostavljene rate iz plana otplate:</div>
              ${overdueRate.slice(0, 5).map(r => `<div>• ${r.item} - ${r.opis}: ${fmtEur(r.iznos)} (rok: ${fmtDate(r.datum)}, kasni ${r.days} ${r.days === 1 ? 'dan' : 'dana'})</div>`).join('')}
              ${overdueRate.length > 5 ? `<div style="color:var(--text-dim); margin-top:4px;">... još ${overdueRate.length - 5} rata kasni</div>` : ''}
            </div>
          ` : ''}
        </div>
      ` : ''}
      <div style="background:var(--surface-2); padding:16px; border-radius:10px; margin-bottom:20px;">
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Ukupna vrednost</div>
            <div style="font-size:18px; font-weight:600;">${fmtEur(cu.ukupna_vrednost)}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Isplaćeno</div>
            <div style="font-size:18px; font-weight:600; color:var(--success);">${fmtEur(cu.ukupno_isplaceno)}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Preostalo</div>
            <div style="font-size:18px; font-weight:600; color:${hasDebt(cu.ukupno_preostalo) ? 'var(--danger)' : 'var(--success)'};">${fmtEur(cu.ukupno_preostalo)}</div>
          </div>
        </div>
      </div>
      
      ${cu.stanovi.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">🏠 Stanovi (${cu.stanovi.length})</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:16px;">
          ${cu.stanovi.map(s => `
            <div onclick="closeModal(); setTimeout(() => openApartment('${s.lamela}', ${s.stan}), 100);" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:auto 1fr auto auto; gap:16px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:var(--accent);">${s.lamela}-${s.stan}</strong>
              <div>
                <div>${s.sprat || ''} · ${fmtNum(s.povrsina)} m²</div>
                <div style="font-size:12px; color:var(--text-dim);">Vrednost: ${fmtEur(s.vrednost_sa_pdv)}</div>
              </div>
              <div class="num" style="color:var(--success); font-weight:600;">${fmtEur(s.isplaceno || 0)}</div>
              <div class="num" style="color:${hasDebt(s.preostalo||0) ? 'var(--danger)' : 'var(--text-dim)'}; font-weight:600;">${fmtEur(s.preostalo)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${cu.garaze.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">🚗 Garaže (${cu.garaze.length})</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:16px;">
          ${cu.garaze.map(g => `
            <div onclick="closeModal(); setTimeout(() => openGarage(${g.broj}), 100);" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:auto 1fr auto auto; gap:16px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:var(--accent);">G-${g.broj}</strong>
              <div>
                <div>${fmtNum(g.povrsina)} m²</div>
                <div style="font-size:12px; color:var(--text-dim);">Vrednost: ${fmtEur(g.vrednost)}</div>
              </div>
              <div class="num" style="color:var(--success); font-weight:600;">${fmtEur(g.naplaceno || 0)}</div>
              <div class="num" style="color:${hasDebt(g.preostalo||0) ? 'var(--danger)' : 'var(--text-dim)'}; font-weight:600;">${fmtEur(g.preostalo)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${cu.ostave.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">📦 Ostave (${cu.ostave.length})</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:16px;">
          ${cu.ostave.map(o => `
            <div onclick="closeModal(); setTimeout(() => openOstava(${o._idx}), 100);" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:auto 1fr auto auto; gap:16px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:var(--accent);">${o.nivo || ''} ${o.broj || ''}</strong>
              <div>
                <div>${fmtNum(o.povrsina)} m²</div>
                <div style="font-size:12px; color:var(--text-dim);">Vrednost: ${fmtEur(o.vrednost)}</div>
              </div>
              <div class="num" style="color:var(--success); font-weight:600;">${fmtEur(o.naplaceno || 0)}</div>
              <div class="num" style="color:${hasDebt(o.preostalo||0) ? 'var(--danger)' : 'var(--text-dim)'}; font-weight:600;">${fmtEur(o.preostalo)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${renderCustomerPaymentsAndRates(cu)}
      ${renderCustomerExtras(cu)}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
      <button class="btn btn-primary" onclick="printCustomerProfile('${getCustomerKey(cu.ime)}')">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
        Štampaj / PDF
      </button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

// Renders telefon + dokumenti section in customer profile
function renderCustomerExtras(cu) {
  const key = getCustomerKey(cu.ime);
  const cd = (DATA.customer_data && DATA.customer_data[key]) || {};
  const telefon = cd.telefon || '';
  const dokumenti = cd.dokumenti || [];
  
  return `
    <h3 style="font-size:14px; margin:24px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">📞 Kontakt i dokumenta</h3>
    <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:14px;">
      <!-- Telefon -->
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <span style="color:var(--text-dim); font-size:13px; width:80px;">Telefon:</span>
        <span id="cTelDisplay_${key}" style="flex:1; font-weight:600; color:${telefon ? 'var(--text)' : 'var(--text-dim)'};">
          ${telefon ? `<a href="tel:${telefon}" style="color:var(--accent); text-decoration:none;">${telefon}</a>` : '<em style="font-weight:400;">nije unesen</em>'}
        </span>
        <button class="btn btn-ghost" style="padding:6px 12px; font-size:12px;" onclick="editCustomerPhone('${key}')">
          ${telefon ? '✏️ Izmeni' : '+ Dodaj'}
        </button>
      </div>
      <!-- Dokumenta / Lična karta PDF -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="color:var(--text-dim); font-size:13px;">Dokumenta (PDF):</span>
          <label class="btn btn-ghost" style="padding:6px 12px; font-size:12px; cursor:pointer;">
            📎 Dodaj PDF
            <input type="file" accept=".pdf,application/pdf" style="display:none;" onchange="uploadCustomerDoc('${key}', this)">
          </label>
        </div>
        <div id="cDocsDisplay_${key}">
          ${dokumenti.length === 0 
            ? '<div style="font-size:12px; color:var(--text-dim); font-style:italic;">Nema uploadovanih dokumenata</div>' 
            : dokumenti.map((d, i) => `
              <div style="display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; margin-bottom:6px;">
                <span style="font-size:18px;">📄</span>
                <span style="flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.name}</span>
                <span style="font-size:11px; color:var(--text-dim);">${fmtDate(d.ts)}</span>
                <button class="btn btn-ghost" style="padding:4px 8px; font-size:11px;" onclick="viewCustomerDoc('${key}', ${i})">Otvori</button>
                <button class="btn btn-ghost" style="padding:4px 8px; font-size:11px; color:var(--danger);" onclick="deleteCustomerDoc('${key}', ${i})">×</button>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;
}

function editCustomerPhone(key) {
  const cd = (DATA.customer_data && DATA.customer_data[key]) || {};
  const current = cd.telefon || '';
  const val = prompt('Unesite broj telefona:', current);
  if (val === null) return;
  if (!DATA.customer_data) DATA.customer_data = {};
  if (!DATA.customer_data[key]) DATA.customer_data[key] = {};
  DATA.customer_data[key].telefon = val.trim();
  logActivity('TELEFON', `Dodat/izmenjen telefon za kupca`);
  saveToCache();
  sbUpsertCustomerData(key, DATA.customer_data[key]).catch(()=>{});
  const el = document.getElementById(`cTelDisplay_${key}`);
  if (el) el.innerHTML = val.trim()
    ? `<a href="tel:${val.trim()}" style="color:var(--accent); text-decoration:none;">${val.trim()}</a>`
    : '<em style="font-weight:400;">nije unesen</em>';
}

function uploadCustomerDoc(key, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    showToast('Samo PDF fajlovi su dozvoljeni', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('PDF je prevelik (max 5MB)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    if (!DATA.customer_data) DATA.customer_data = {};
    if (!DATA.customer_data[key]) DATA.customer_data[key] = {};
    if (!DATA.customer_data[key].dokumenti) DATA.customer_data[key].dokumenti = [];
    DATA.customer_data[key].dokumenti.push({
      name: file.name,
      data: e.target.result, // base64
      ts: Date.now()
    });
    logActivity('DOKUMENT', `Dodat PDF "${file.name}"`);
    saveToCache();
    sbUpsertCustomerData(key, DATA.customer_data[key]).catch(()=>{});
    showToast(`Dokument "${file.name}" sačuvan`, 'success');
    // Refresh docs display
    const cd = DATA.customer_data[key];
    const el = document.getElementById(`cDocsDisplay_${key}`);
    if (el) el.innerHTML = (cd.dokumenti || []).map((d, i) => `
      <div style="display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; margin-bottom:6px;">
        <span style="font-size:18px;">📄</span>
        <span style="flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.name}</span>
        <span style="font-size:11px; color:var(--text-dim);">${fmtDate(d.ts)}</span>
        <button class="btn btn-ghost" style="padding:4px 8px; font-size:11px;" onclick="viewCustomerDoc('${key}', ${i})">Otvori</button>
        <button class="btn btn-ghost" style="padding:4px 8px; font-size:11px; color:var(--danger);" onclick="deleteCustomerDoc('${key}', ${i})">×</button>
      </div>
    `).join('') || '<div style="font-size:12px; color:var(--text-dim); font-style:italic;">Nema uploadovanih dokumenata</div>';
  };
  reader.readAsDataURL(file);
}

function viewCustomerDoc(key, idx) {
  const doc = DATA.customer_data?.[key]?.dokumenti?.[idx];
  if (!doc) return;
  const win = window.open();
  if (win) {
    win.document.write(`<iframe src="${doc.data}" style="width:100%;height:100vh;border:none;"></iframe>`);
  } else {
    // Fallback: download
    const a = document.createElement('a');
    a.href = doc.data;
    a.download = doc.name;
    a.click();
  }
}

function deleteCustomerDoc(key, idx) {
  if (!confirm('Obrisati dokument?')) return;
  DATA.customer_data[key].dokumenti.splice(idx, 1);
  logActivity('DOKUMENT', `Obrisan PDF`);
  saveToCache();
  showToast('Dokument obrisan', 'success');
  openCustomerProfile(key);
}

function renderCustomerPaymentsAndRates(cu) {
  // Collect all payments and all planned rates from all customer's items
  const payments = []; // {month, item, amount}
  const upcoming = []; // {month, item, amount}
  
  const now = new Date();
  now.setHours(0,0,0,0);
  const nowKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  
  const addItem = (item, label, navInfo) => {
    if (item.uplate) {
      Object.keys(item.uplate).sort().forEach(mk => {
        const dateStr = (item.uplate_dates && item.uplate_dates[mk]) || `${mk}-15`;
        payments.push({ month: mk, date: dateStr, item: label, amount: item.uplate[mk] });
      });
    }
    if (item.planirane_rate) {
      Object.keys(item.planirane_rate).forEach(mk => {
        upcoming.push({ month: mk, item: label, amount: item.planirane_rate[mk], past: mk < nowKey, ...navInfo });
      });
    }
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(r => {
        if (!r.datum || r.isplacena) return;
        const d = new Date(r.datum);
        const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        upcoming.push({ month: mk, item: label, amount: r.iznos||0, past: d < now, desc: r.opis, dueDate: r.datum, ...navInfo });
      });
    }
  };
  
  cu.stanovi.forEach(s => addItem(s, `Stan ${s.lamela}-${s.stan}`, { type:'apartment', lamela:s.lamela, stan:s.stan }));
  cu.garaze.forEach(g => addItem(g, `Garaža G-${g.broj}`, { type:'garage', broj:g.broj }));
  cu.ostave.forEach(o => addItem(o, `Ostava ${o.broj||''}`, { type:'ostava', idx: o._idx }));
  
  if (payments.length === 0 && upcoming.length === 0) return '';
  
  payments.sort((a,b) => a.month.localeCompare(b.month));
  upcoming.sort((a,b) => a.month.localeCompare(b.month));
  
  const monthLabel = (mk) => {
    const [y, m] = mk.split('-');
    const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
    return `${months[parseInt(m)-1]} ${y}`;
  };
  
  const totalPaid = payments.reduce((s,p) => s + p.amount, 0);
  const totalUpcoming = upcoming.reduce((s,u) => s + u.amount, 0);
  
  return `
    <h3 style="font-size:14px; margin:24px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">💰 Dosadašnje uplate (${payments.length})</h3>
    ${payments.length === 0 ? '<div style="padding:20px; color:var(--text-dim); text-align:center; background:var(--surface-2); border-radius:8px;">Nema evidentiranih uplata</div>' : `
      <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:8px;">
        <table class="data-table" style="background:transparent; margin:0;">
          <thead><tr>
            <th>Datum</th><th>Mesec</th><th>Stavka</th><th class="num">Iznos</th>
          </tr></thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${fmtDate(p.date)}</td>
                <td style="font-size:13px; color:var(--text-dim);">${monthLabel(p.month)}</td>
                <td style="font-size:13px; color:var(--text-dim);">${p.item}</td>
                <td class="num" style="color:var(--success); font-weight:600;">${fmtEur(p.amount)}</td>
              </tr>
            `).join('')}
            <tr style="background:var(--surface-3);">
              <td colspan="3" style="font-weight:700;">UKUPNO UPLAĆENO</td>
              <td class="num" style="color:var(--success); font-weight:700; font-size:15px;">${fmtEur(totalPaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `}
    
    <h3 style="font-size:14px; margin:24px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">📅 Nadolazeće rate (${upcoming.length})</h3>
    ${upcoming.length === 0 ? '<div style="padding:20px; color:var(--text-dim); text-align:center; background:var(--surface-2); border-radius:8px;">Nema planiranih rata</div>' : `
      <div style="border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:8px;">
        <!-- Summary header -->
        <div style="display:flex; justify-content:space-between; padding:10px 14px; background:var(--surface-2); border-bottom:1px solid var(--border);">
          <span style="font-size:12px; color:var(--text-dim);">Ukupno očekivano</span>
          <strong style="color:var(--accent);">${fmtEur(totalUpcoming)}</strong>
        </div>
        <!-- Cards - mobile friendly -->
        ${upcoming.map(u => {
          const isPast = u.past;
          const borderColor = isPast ? 'var(--danger)' : 'var(--border)';
          const bgColor = isPast ? 'rgba(248,113,113,0.05)' : 'transparent';
          // Build onclick to open payment dialog with prefilled amount
          const onclickFn = u.type === 'apartment' ? `openQuickPayment('apartment','${u.lamela||''}',${u.stan||0},${u.amount},'${(u.desc||u.item||'').replace(/'/g,"\\'")}')` 
            : u.type === 'garage' ? `openQuickPayment('garage',null,${u.broj||0},${u.amount},'${(u.desc||u.item||'').replace(/'/g,"\\'")}')` 
            : u.type === 'ostava' ? `openQuickPayment('ostava',null,${u.idx||0},${u.amount},'${(u.desc||u.item||'').replace(/'/g,"\\'")}')` 
            : '';
          return `
            <div onclick="${onclickFn}" style="padding:12px 14px; border-bottom:1px solid var(--border); background:${bgColor}; cursor:${onclickFn ? 'pointer' : 'default'};" 
                 ${onclickFn ? 'onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\''+bgColor+'\'"' : ''}>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="flex:1; min-width:0;">
                  <div style="font-weight:600; font-size:14px; color:var(--accent);">${fmtEur(u.amount)}</div>
                  <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">
                    ${u.dueDate ? fmtDate(u.dueDate) : monthLabel(u.month)}
                    ${u.desc ? ` · ${u.desc}` : ''}
                    · ${u.item}
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                  ${isPast ? '<span class="badge no-payment">Prošlo</span>' : '<span class="badge available">Čeka se</span>'}
                  ${onclickFn ? '<span style="color:var(--text-dim); font-size:16px;">→</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

// Quick payment dialog pre-filled from rate click
function openQuickPayment(type, lamela, idOrBroj, prefillAmount, prefillNote) {
  // Open the standard new payment dialog but with amount pre-filled
  let item;
  if (type === 'apartment') item = findApartment(lamela, idOrBroj);
  else if (type === 'garage') item = DATA.garages.find(g => g.broj === idOrBroj);
  else item = DATA.ostave[idOrBroj];
  if (!item) return;
  
  const label = type === 'apartment' ? `Stan ${item.lamela}-${item.stan}` 
    : type === 'garage' ? `Garaža G-${item.broj}` : `Ostava ${item.broj||''}`;
  const vrednost = item.vrednost_sa_pdv || item.vrednost || 0;
  const preostalo = item.preostalo || 0;
  const today = new Date().toISOString().split('T')[0];
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '500px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Nova uplata · ${label}</div>
        <div class="modal-title-sub">${item.ime || ''} · Preostalo: ${fmtEur(preostalo)}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field full">
          <label>Iznos (€) *</label>
          <input id="qp_amount" type="number" step="0.01" value="${prefillAmount || ''}" style="font-size:20px; font-weight:700; color:var(--accent);">
        </div>
        <div class="form-field">
          <label>Datum</label>
          <input id="qp_date" type="date" value="${today}">
        </div>
        <div class="form-field">
          <label>Način plaćanja</label>
          <select id="qp_method">
            <option>Gotovina</option><option>Prenos</option><option>Ček</option>
          </select>
        </div>
        <div class="form-field full">
          <label>Opis / Napomena</label>
          <input id="qp_note" type="text" value="${prefillNote || ''}" placeholder="npr. Rata 3/12">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
      <button class="btn btn-primary" onclick="confirmQuickPayment('${type}','${lamela||''}',${idOrBroj})">
        💰 Evidentuj uplatu
      </button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
  setTimeout(() => { const el = document.getElementById('qp_amount'); if(el){el.select();} }, 150);
}

function confirmQuickPayment(type, lamela, idOrBroj) {
  const amount = parseFloat(document.getElementById('qp_amount').value) || 0;
  const date = document.getElementById('qp_date').value;
  const method = document.getElementById('qp_method').value;
  const note = document.getElementById('qp_note').value.trim();
  if (amount <= 0) { showToast('Unesite iznos', 'error'); return; }
  
  let item;
  if (type === 'apartment') item = findApartment(lamela, parseInt(idOrBroj));
  else if (type === 'garage') item = DATA.garages.find(g => g.broj === parseInt(idOrBroj));
  else item = DATA.ostave[parseInt(idOrBroj)];
  if (!item) return;
  
  const mk = date.substring(0,7);
  if (!item.uplate) item.uplate = {};
  if (!item.uplate_dates) item.uplate_dates = {};
  const existing = Object.keys(item.uplate).filter(k => k.startsWith(mk)).length;
  const key = existing > 0 ? `${mk}-r${existing}` : mk;
  item.uplate[key] = amount;
  item.uplate_dates[key] = date;
  
  if (type === 'apartment') {
    item.isplaceno = (item.isplaceno || 0) + amount;
    item.preostalo = (item.vrednost_sa_pdv || 0) - item.isplaceno;
  } else {
    item.naplaceno = (item.naplaceno || 0) + amount;
    item.preostalo = (item.vrednost || 0) - item.naplaceno;
  }
  
  const label = type === 'apartment' ? `Stan ${item.lamela}-${item.stan}` : type === 'garage' ? `Garaža G-${item.broj}` : `Ostava`;
  const rcpt = createReceipt({
    payer: item.ime || label,
    itemType: type === 'apartment' ? 'Stan' : type === 'garage' ? 'Garaža' : 'Ostava',
    itemId: type === 'apartment' ? `${item.lamela}-${item.stan}` : type === 'garage' ? `G-${item.broj}` : item.broj || '',
    lamela: item.lamela || '',
    amount, method, date, note,
    itemDesc: `${item.sprat||item.nivo||''} · ${fmtNum(item.povrsina||0)} m²`
  });
  logActivity('UPLATA', `${label} · ${item.ime||''} · ${fmtEur(amount)}`);
  saveToCache();
  // Push to Supabase
  if (type === 'apartment') {
    sbUpsertApartment(item).then(() => {
      if (item._id) sbInsertPayment('apartment_payments','apartment_id',item._id,mk,amount,date);
    }).catch(()=>{});
  } else if (type === 'garage') {
    sbUpsertGarage(item).then(() => {
      if (item._id) sbInsertPayment('garage_payments','garage_id',item._id,mk,amount,date);
    }).catch(()=>{});
  } else {
    sbUpsertOstava(item).catch(()=>{});
  }
  closeModal();
  renderView();
  showToast(`Uplata evidentirana. Priznanica ${rcpt.number} kreirana.`, 'success');
}

function printCustomerProfile(customerKey) {
  const customers = getAllCustomers();
  const cu = customers.find(c => getCustomerKey(c.ime) === customerKey);
  if (!cu) return;
  
  // Calculate arrears locally (was missing before - caused silent crash)
  const hasAnyArrears = cu.stanovi.some(s => !!getArrearsInfo(s));
  
  const rowHTML = (label, value, extra = '') => `<tr><td>${label}</td><td style="text-align:right;">${value}</td>${extra}</tr>`;
  
  // Collect payments for this customer
  const allPayments = [];
  cu.stanovi.forEach(s => {
    if (s.uplate) Object.keys(s.uplate).sort().forEach(mk => {
      const dateStr = (s.uplate_dates?.[mk]) || `${mk.substring(0,7)}-15`;
      allPayments.push({ date: dateStr, item: `Stan ${s.lamela}-${s.stan}`, amount: s.uplate[mk] });
    });
  });
  cu.garaze.forEach(g => {
    if (g.uplate) Object.keys(g.uplate).sort().forEach(mk => {
      const dateStr = (g.uplate_dates?.[mk]) || `${mk.substring(0,7)}-15`;
      allPayments.push({ date: dateStr, item: `Garaža G-${g.broj}`, amount: g.uplate[mk] });
    });
  });
  allPayments.sort((a,b) => a.date.localeCompare(b.date));
  
  const __printHtml = `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>Kupac - ${cu.ime}</title>
    <style>
      @page { size: A4; margin: 15mm; }
      body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; font-size: 13px; }
      .logo { text-align: center; margin-bottom: 15px; }
      .logo img { max-height: 70px; }
      h1 { text-align: center; margin: 10px 0; font-size: 20px; }
      .info-box { background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 20px; }
      .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .info-grid .label { color: #666; font-size: 11px; text-transform: uppercase; }
      .info-grid .val { font-weight: 600; font-size: 15px; }
      h2 { font-size: 14px; margin: 18px 0 8px; padding: 6px 10px; background: #e5e5e5; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
      th { background: #fafafa; padding: 6px 8px; text-align: left; border-bottom: 2px solid #ccc; font-size: 10px; text-transform: uppercase; color: #666; }
      td { padding: 6px 8px; border-bottom: 1px solid #eee; }
      td.num { text-align: right; font-weight: 600; }
      .total-box { background: #d4a574; color: #1a2332; padding: 14px; border-radius: 6px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 15px; }
      .total-box .label { font-size: 10px; text-transform: uppercase; opacity: 0.8; }
      .total-box .val { font-size: 16px; font-weight: bold; }
      .footer { text-align: center; color: #999; font-size: 10px; margin-top: 25px; padding-top: 12px; border-top: 1px solid #ddd; }
    </style></head><body>
      <div class="logo"><img src="${_LOGO_PNG_DATA_URL || 'logo.png'}" alt="Dacić Prom"></div>
      <h1>Kartica kupca</h1>
      <div style="text-align:center; color:#666; font-size:11px; margin-bottom:15px;">Datum: ${fmtDate(new Date())}</div>
      
      <div class="info-box">
        <div style="font-size:18px; font-weight:bold; margin-bottom:10px;">${cu.ime}</div>
        <div class="info-grid">
          <div><div class="label">Broj stavki</div><div class="val">${cu.broj_stavki}</div></div>
          <div><div class="label">Ukupna vrednost</div><div class="val">${fmtEur(cu.ukupna_vrednost)}</div></div>
          <div><div class="label">Status</div><div class="val" style="color:${hasAnyArrears ? '#c00' : '#0a0'};">${hasAnyArrears ? 'Kasni sa ratom' : 'Redovan'}</div></div>
        </div>
      </div>
      
      ${cu.stanovi.length > 0 ? `
        <h2>Stanovi (${cu.stanovi.length})</h2>
        <table>
          <thead><tr><th>Oznaka</th><th>Sprat</th><th style="text-align:right;">m²</th><th style="text-align:right;">Vrednost</th><th style="text-align:right;">Isplaćeno</th><th style="text-align:right;">Preostalo</th></tr></thead>
          <tbody>
            ${cu.stanovi.map(s => `
              <tr><td><strong>${s.lamela}-${s.stan}</strong></td><td>${s.sprat||''}</td><td class="num">${fmtNum(s.povrsina)}</td><td class="num">${fmtEur(s.vrednost_sa_pdv)}</td><td class="num">${fmtEur(s.isplaceno)}</td><td class="num" style="color:${hasDebt(s.preostalo)?'#c00':'#0a0'};">${fmtEur(s.preostalo)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      
      ${cu.garaze.length > 0 ? `
        <h2>Garaže (${cu.garaze.length})</h2>
        <table>
          <thead><tr><th>Oznaka</th><th style="text-align:right;">m²</th><th style="text-align:right;">Vrednost</th><th style="text-align:right;">Naplaćeno</th><th style="text-align:right;">Preostalo</th></tr></thead>
          <tbody>
            ${cu.garaze.map(g => `
              <tr><td><strong>G-${g.broj}</strong></td><td class="num">${fmtNum(g.povrsina)}</td><td class="num">${fmtEur(g.vrednost)}</td><td class="num">${fmtEur(g.naplaceno||0)}</td><td class="num" style="color:${hasDebt(g.preostalo)?'#c00':'#0a0'};">${fmtEur(g.preostalo)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      
      ${cu.ostave.length > 0 ? `
        <h2>Ostave (${cu.ostave.length})</h2>
        <table>
          <thead><tr><th>Oznaka</th><th>Nivo</th><th style="text-align:right;">m²</th><th style="text-align:right;">Vrednost</th><th style="text-align:right;">Naplaćeno</th><th style="text-align:right;">Preostalo</th></tr></thead>
          <tbody>
            ${cu.ostave.map(o => `
              <tr><td><strong>${o.broj||''}</strong></td><td>${o.nivo||''}</td><td class="num">${fmtNum(o.povrsina)}</td><td class="num">${fmtEur(o.vrednost)}</td><td class="num">${fmtEur(o.naplaceno||0)}</td><td class="num" style="color:${hasDebt(o.preostalo)?'#c00':'#0a0'};">${fmtEur(o.preostalo)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      
      <div class="total-box">
        <div><div class="label">Ukupna vrednost</div><div class="val">${fmtEur(cu.ukupna_vrednost)}</div></div>
        <div><div class="label">Isplaćeno</div><div class="val">${fmtEur(cu.ukupno_isplaceno)}</div></div>
        <div><div class="label">Preostalo</div><div class="val">${fmtEur(cu.ukupno_preostalo)}</div></div>
      </div>
      
      ${allPayments.length > 0 ? `
        <h2>Istorija uplata (${allPayments.length})</h2>
        <table>
          <thead><tr><th>Datum</th><th>Stavka</th><th style="text-align:right;">Iznos</th></tr></thead>
          <tbody>
            ${allPayments.map(p => `
              <tr><td>${fmtDate(p.date)}</td><td>${p.item}</td><td class="num">${fmtEur(p.amount)}</td></tr>
            `).join('')}
            <tr style="background:#f5f0e8;"><td colspan="2" style="font-weight:700;">UKUPNO</td><td class="num" style="font-weight:700;">${fmtEur(allPayments.reduce((s,p)=>s+p.amount,0))}</td></tr>
          </tbody>
        </table>
      ` : ''}
      
      <div class="footer">Dacić Prom · Generisano ${fmtDateTime(new Date())} · Izdao: ${currentUser || ''}</div>
    </body></html>
  `;
  openPrintWindow(__printHtml, 'Profil kupca - ' + (cu.ime || ''));
}

// ============================================
// STATISTIKA
// ============================================

function renderStatistika(c) {
  // Build statistics DINAMIČKI iz trenutnih podataka (ne iz sačuvane Excel statistike)
  const apts = DATA.apartments;
  const gar = DATA.garages;
  const ost = DATA.ostave;
  
  const aptVlasnici = apts.filter(a => a.vlasnik_parcele);
  const aptZaProdaju = apts.filter(a => !a.vlasnik_parcele);
  const aptProdati = aptZaProdaju.filter(a => a.prodat);
  const aptSlobodni = aptZaProdaju.filter(a => !a.prodat);
  
  const garVlasnici = gar.filter(g => g.vlasnik_parcele);
  const garZaProdaju = gar.filter(g => !g.vlasnik_parcele);
  const garProdate = garZaProdaju.filter(g => g.prodat);
  const garSlobodne = garZaProdaju.filter(g => !g.prodat);
  
  const ostPodrumske = ost.filter(o => o.tip === 'PODRUM' || (o.nivo && o.nivo.startsWith('-')));
  const ostSpratne = ost.filter(o => o.tip === 'SPRAT' || (o.nivo && !o.nivo.startsWith('-')));
  const ostVlasnici = ost.filter(o => o.vlasnik_parcele);
  const ostZaProdaju = ost.filter(o => !o.vlasnik_parcele);
  
  // Sum helpers
  const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
  
  const stats = [
    { group: 'Stanovi', label: 'Broj stanova ukupno', value: apts.length, kind: 'count' },
    { group: 'Stanovi', label: 'Broj stanova vlasnika parcela', value: aptVlasnici.length, kind: 'count' },
    { group: 'Stanovi', label: 'Broj stanova za prodaju', value: aptZaProdaju.length, kind: 'count' },
    { group: 'Stanovi', label: 'Broj prodatih stanova', value: aptProdati.length, kind: 'count' },
    { group: 'Stanovi', label: 'Broj neprodatih stanova', value: aptSlobodni.length, kind: 'count' },
    { group: 'Stanovi', label: 'Površina stanova za prodaju', value: sum(aptZaProdaju, a => a.povrsina), kind: 'm2' },
    { group: 'Stanovi', label: 'Prosečna cena prodatih stanova (sa PDV)', value: aptProdati.length > 0 ? sum(aptProdati, a => a.vrednost_sa_pdv) / aptProdati.length : 0 },
    { group: 'Stanovi', label: 'Prosečna cena/m² prodatih stanova (sa PDV)', value: (() => { const valid = aptProdati.filter(a => a.povrsina > 0 && a.cena_m2_pdv > 0); return valid.length > 0 ? sum(valid, a => a.cena_m2_pdv) / valid.length : 0; })(), kind: 'eur_m2' },
    { group: 'Stanovi', label: 'Vrednost prodatih stanova', value: sum(aptProdati, a => a.vrednost_sa_pdv) },
    { group: 'Stanovi', label: 'Vrednost neprodatih stanova', value: sum(aptSlobodni, a => a.vrednost_sa_pdv) },
    { group: 'Stanovi', label: 'Ukupno naplaćeno od prodatih stanova', value: sum(aptProdati, a => a.isplaceno) },
    { group: 'Stanovi', label: 'Preostalo za naplatu od prodatih stanova', value: sum(aptProdati, a => a.preostalo) },
    { group: 'Stanovi', label: 'Vrednost svih stanova za prodaju', value: sum(aptZaProdaju, a => a.vrednost_sa_pdv) },
    
    { group: 'Garaže', label: 'Broj garaža ukupno', value: gar.length, kind: 'count' },
    { group: 'Garaže', label: 'Broj garaža vlasnika parcela', value: garVlasnici.length, kind: 'count' },
    { group: 'Garaže', label: 'Broj garaža za prodaju', value: garZaProdaju.length, kind: 'count' },
    { group: 'Garaže', label: 'Broj prodatih garažnih mesta', value: garProdate.length, kind: 'count' },
    { group: 'Garaže', label: 'Broj neprodatih garažnih mesta', value: garSlobodne.length, kind: 'count' },
    { group: 'Garaže', label: 'Vrednost prodatih garažnih mesta', value: sum(garProdate, g => g.vrednost) },
    { group: 'Garaže', label: 'Ukupno naplaćeno od prodatih garaža', value: sum(garProdate, g => g.naplaceno) },
    { group: 'Garaže', label: 'Preostalo za naplatu od prodatih garažnih mesta', value: sum(garProdate, g => g.preostalo) },
    { group: 'Garaže', label: 'Ukupna vrednost garaža za prodaju', value: sum(garZaProdaju, g => g.vrednost) },
    { group: 'Garaže', label: 'Prosečna cena garaže - Nivo -3 (G1-64)', value: (() => { const g=garZaProdaju.filter(x=>getGarageLevel(x.broj)==='-3'&&x.prodat); return g.length>0?sum(g,x=>x.vrednost)/g.length:0; })() },
    { group: 'Garaže', label: 'Prosečna cena garaže - Nivo -2 (G65-126)', value: (() => { const g=garZaProdaju.filter(x=>getGarageLevel(x.broj)==='-2'&&x.prodat); return g.length>0?sum(g,x=>x.vrednost)/g.length:0; })() },
    { group: 'Garaže', label: 'Prosečna cena garaže - Nivo -1 (G127-175)', value: (() => { const g=garZaProdaju.filter(x=>getGarageLevel(x.broj)==='-1'&&x.prodat); return g.length>0?sum(g,x=>x.vrednost)/g.length:0; })() },
    
    { group: 'Ostave', label: 'Broj ostava ukupno', value: ost.length, kind: 'count' },
    { group: 'Ostave', label: 'Broj spratnih ostava', value: ostSpratne.length, kind: 'count' },
    { group: 'Ostave', label: 'Broj podrumskih ostava', value: ostPodrumske.length, kind: 'count' },
    { group: 'Ostave', label: 'Broj ostava vlasnika parcela', value: ostVlasnici.length, kind: 'count' },
    { group: 'Ostave', label: 'Broj ostava za prodaju', value: ostZaProdaju.length, kind: 'count' },
    { group: 'Ostave', label: 'Broj prodatih ostava', value: ost.filter(o => o.prodat).length, kind: 'count' },
    { group: 'Ostave', label: 'Ukupna površina ostava za prodaju', value: sum(ostZaProdaju, o => o.povrsina), kind: 'm2' },
    { group: 'Ostave', label: 'Naplaćeno od prodatih ostava', value: sum(ost.filter(o => o.prodat), o => o.naplaceno) },
    { group: 'Ostave', label: 'Preostalo za naplatu od ostava', value: sum(ost.filter(o => o.prodat), o => o.preostalo) },
    { group: 'Ostave', label: 'Ukupna vrednost ostava za prodaju', value: sum(ostZaProdaju, o => o.vrednost) },
    
    { group: 'Naplata - zbirno', label: 'Naplaćeno od stanova', value: sum(aptProdati, a => a.isplaceno) },
    { group: 'Naplata - zbirno', label: 'Naplaćeno od garažnih mesta', value: sum(garProdate, g => g.naplaceno) },
    { group: 'Naplata - zbirno', label: 'Naplaćeno od ostava', value: sum(ost.filter(o => o.prodat), o => o.naplaceno) },
    { group: 'Naplata - zbirno', label: 'Ukupno naplaćeno', value: sum(aptProdati, a => a.isplaceno) + sum(garProdate, g => g.naplaceno) + sum(ost.filter(o => o.prodat), o => o.naplaceno) }
  ];
  
  // Also add original Excel statistics for "Predmer i predračun"
  (DATA.statistics || []).forEach(s => {
    if (!s.label) return;
    const label = s.label.toLowerCase();
    if (label.includes('predmer') || label.includes('procena') || (label.includes('ukupno:') && !stats.find(x => x.label === s.label))) {
      stats.push({ group: 'Predmer i predračun', label: s.label, value: s.value, extra: s.extra });
    }
  });
  
  // Group stats
  const groups = {};
  stats.forEach(s => {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  });
  
  const fmtStatValue = (s) => {
    if (s.value === null || s.value === undefined) return '—';
    if (typeof s.value === 'string') return s.value;
    if (s.kind === 'count') return Number(s.value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (s.kind === 'm2') return fmtNum(s.value) + ' m²';
    if (s.kind === 'eur_m2') return fmtEur(s.value) + '/m²';
    return fmtEur(s.value);
  };
  
  c.innerHTML = `
    <div style="max-width:1100px; margin:0 auto;">
      <div style="background:var(--surface); padding:20px; border-radius:12px; border:1px solid var(--border); margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:16px; font-weight:600;">Statistika projekta</div>
          <div style="font-size:13px; color:var(--text-dim); margin-top:2px;">Zbirni podaci o stanju prodaje i naplate</div>
        </div>
        <button class="btn btn-primary" onclick="printStatistika()">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
          Štampaj / PDF
        </button>
      </div>
      
      <!-- CHARTS - responsive grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Prodaja stanova</div></div>
          ${renderStatChart('apartments-status')}
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Prodaja garaža</div></div>
          ${renderStatChart('garages-status')}
        </div>
      </div>
      
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-header"><div class="panel-title">Stanje naplate</div></div>
        ${renderStatChart('collected-bars')}
      </div>
      
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-header"><div class="panel-title">Poređenje lamela A i B</div></div>
        ${renderStatChart('lamela-compare')}
      </div>
      
      ${Object.keys(groups).map(groupTitle => {
        const rows = groups[groupTitle];
        // Find key metrics (big numbers worth highlighting)
        const highlightRows = rows.filter(r => typeof r.value === 'number' && !r.kind && r.value > 1000);
        const normalRows = rows;
        return `
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-header"><div class="panel-title">${groupTitle}</div></div>
          <div style="padding:12px 16px;">
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px; margin-bottom:${normalRows.length > 0 ? '12px' : '0'};">
              ${rows.filter(r => typeof r.value === 'number' && r.value > 0 && (r.kind === 'count' || (!r.kind && r.value > 1000))).map(r => `
                <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px;">
                  <div style="font-size:10px; color:var(--text-dim); text-transform:uppercase; margin-bottom:4px; line-height:1.3;">${r.label}</div>
                  <div style="font-size:${r.kind === 'count' ? '22px' : '15px'}; font-weight:700; color:${r.kind === 'count' ? 'var(--text)' : 'var(--accent)'};">${fmtStatValue(r)}</div>
                </div>
              `).join('')}
            </div>
            <div>
              ${rows.filter(r => !(typeof r.value === 'number' && r.value > 0 && (r.kind === 'count' || (!r.kind && r.value > 1000)))).map(r => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid var(--border); gap:8px;">
                  <span style="font-size:12px; color:var(--text-dim); flex:1;">${r.label}</span>
                  <span style="font-size:13px; font-weight:600; color:var(--text); white-space:nowrap;">${fmtStatValue(r)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        `;
      }).join('')}
    </div>
  `;
}

function printStatistika() {
  // Build fresh statistics from live data (same as renderStatistika)
  const apts = DATA.apartments;
  const gar = DATA.garages;
  const ost = DATA.ostave;
  const aptZaProdaju = apts.filter(a => !a.vlasnik_parcele);
  const aptProdati = aptZaProdaju.filter(a => a.prodat);
  const garZaProdaju = gar.filter(g => !g.vlasnik_parcele);
  const garProdate = garZaProdaju.filter(g => g.prodat);
  const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);

  const __printHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Statistika - Dacić Prom</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Arial, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; }
.logo { text-align: center; margin-bottom: 10px; }
.logo img { max-height: 60px; }
h1 { text-align: center; margin: 6px 0 2px; font-size: 18px; }
.date { text-align: center; color: #666; font-size: 10px; margin-bottom: 16px; }
/* Key metric cards */
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
.kpi { background: #f8f5f0; border: 1px solid #e0d8cc; border-radius: 6px; padding: 10px 12px; text-align: center; }
.kpi.accent { background: #d4a574; border-color: #b8864e; }
.kpi.accent .kpi-val, .kpi.accent .kpi-lbl { color: #1a2332; }
.kpi-val { font-size: 20px; font-weight: 800; color: #1a2332; }
.kpi-lbl { font-size: 9px; color: #666; text-transform: uppercase; margin-top: 2px; }
/* Sections */
.section { margin-bottom: 14px; break-inside: avoid; }
.section-title {
  background: #1a2332; color: #d4a574;
  padding: 5px 10px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.5px;
  margin: 0 0 0; border-radius: 4px 4px 0 0;
}
table { width: 100%; border-collapse: collapse; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 4px 4px; }
tr:nth-child(even) { background: #fafafa; }
td { padding: 5px 10px; border-bottom: 1px solid #eee; font-size: 11px; }
td.lbl { color: #444; width: 65%; }
td.val { font-weight: 700; text-align: right; color: #1a2332; width: 35%; }
td.val.money { color: #7c5e35; }
.progress-bar { height: 6px; background: #eee; border-radius: 3px; margin-top: 4px; }
.progress-fill { height: 100%; background: #d4a574; border-radius: 3px; }
.footer { text-align: center; color: #aaa; font-size: 9px; margin-top: 18px; padding-top: 8px; border-top: 1px solid #ddd; }
</style></head><body>
<div class="logo"><img src="${_LOGO_PNG_DATA_URL || 'logo.png'}" alt="Dacić Prom"></div>
<h1>Statistika projekta</h1>
<div class="date">Datum: ${fmtDate(new Date())} · Dacić Prom</div>

<!-- KPI Cards -->
<div class="kpi-grid">
  <div class="kpi">
    <div class="kpi-val">${aptProdati.length}/${aptZaProdaju.length}</div>
    <div class="kpi-lbl">Stanovi prodati</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${aptZaProdaju.length > 0 ? Math.round(aptProdati.length/aptZaProdaju.length*100) : 0}%"></div></div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${garProdate.length}/${garZaProdaju.length}</div>
    <div class="kpi-lbl">Garaže prodate</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${garZaProdaju.length > 0 ? Math.round(garProdate.length/garZaProdaju.length*100) : 0}%"></div></div>
  </div>
  <div class="kpi accent">
    <div class="kpi-val">${fmtEur(sum(aptProdati, a => a.isplaceno))}</div>
    <div class="kpi-lbl">Naplaćeno stanovi</div>
  </div>
  <div class="kpi accent">
    <div class="kpi-val">${fmtEur(sum(aptProdati, a => a.isplaceno) + sum(garProdate, g => g.naplaceno))}</div>
    <div class="kpi-lbl">Ukupno naplaćeno</div>
  </div>
</div>

<!-- Stanovi -->
<div class="section">
  <div class="section-title">Stanovi</div>
  <table>
    <tr><td class="lbl">Ukupno stanova za prodaju</td><td class="val">${aptZaProdaju.length}</td></tr>
    <tr><td class="lbl">Prodato stanova</td><td class="val">${aptProdati.length} (${aptZaProdaju.length > 0 ? Math.round(aptProdati.length/aptZaProdaju.length*100) : 0}%)</td></tr>
    <tr><td class="lbl">Slobodnih stanova</td><td class="val">${aptZaProdaju.filter(a => !a.prodat).length}</td></tr>
    <tr><td class="lbl">Vlasnici parcela</td><td class="val">${apts.filter(a => a.vlasnik_parcele).length}</td></tr>
    <tr><td class="lbl">Ukupna površina za prodaju</td><td class="val">${fmtNum(sum(aptZaProdaju, a => a.povrsina))} m²</td></tr>
    <tr><td class="lbl">Vrednost prodatih stanova</td><td class="val money">${fmtEur(sum(aptProdati, a => a.vrednost_sa_pdv))}</td></tr>
    <tr><td class="lbl">Naplaćeno od prodatih stanova</td><td class="val money">${fmtEur(sum(aptProdati, a => a.isplaceno))}</td></tr>
    <tr><td class="lbl">Preostalo za naplatu (stanovi)</td><td class="val money">${fmtEur(sum(aptProdati, a => a.preostalo))}</td></tr>
  </table>
</div>

<!-- Garaže -->
<div class="section">
  <div class="section-title">Garaže</div>
  <table>
    <tr><td class="lbl">Ukupno garaža za prodaju</td><td class="val">${garZaProdaju.length}</td></tr>
    <tr><td class="lbl">Prodato garaža</td><td class="val">${garProdate.length} (${garZaProdaju.length > 0 ? Math.round(garProdate.length/garZaProdaju.length*100) : 0}%)</td></tr>
    <tr><td class="lbl">Slobodnih garaža</td><td class="val">${garZaProdaju.filter(g => !g.prodat).length}</td></tr>
    <tr><td class="lbl">Vlasnici parcela</td><td class="val">${gar.filter(g => g.vlasnik_parcele).length}</td></tr>
    <tr><td class="lbl">Naplaćeno od prodatih garaža</td><td class="val money">${fmtEur(sum(garProdate, g => g.naplaceno))}</td></tr>
    <tr><td class="lbl">Preostalo za naplatu (garaže)</td><td class="val money">${fmtEur(sum(garProdate, g => g.preostalo))}</td></tr>
  </table>
</div>

<!-- Ostave -->
<div class="section">
  <div class="section-title">Ostave</div>
  <table>
    <tr><td class="lbl">Ukupno ostava</td><td class="val">${ost.length}</td></tr>
    <tr><td class="lbl">Prodato ostava</td><td class="val">${ost.filter(o => o.prodat).length}</td></tr>
    <tr><td class="lbl">Slobodnih ostava</td><td class="val">${ost.filter(o => !o.prodat && !o.vlasnik_parcele).length}</td></tr>
    <tr><td class="lbl">Naplaćeno od ostava</td><td class="val money">${fmtEur(sum(ost.filter(o => o.prodat), o => o.naplaceno))}</td></tr>
  </table>
</div>

<!-- Naplata zbirno -->
<div class="section">
  <div class="section-title">Naplata - zbirno</div>
  <table>
    <tr><td class="lbl">Naplaćeno stanovi</td><td class="val money">${fmtEur(sum(aptProdati, a => a.isplaceno))}</td></tr>
    <tr><td class="lbl">Naplaćeno garaže</td><td class="val money">${fmtEur(sum(garProdate, g => g.naplaceno))}</td></tr>
    <tr><td class="lbl">Naplaćeno ostave</td><td class="val money">${fmtEur(sum(ost.filter(o => o.prodat), o => o.naplaceno))}</td></tr>
    <tr style="background:#f5f0e8;"><td class="lbl" style="font-weight:700;">UKUPNO NAPLAĆENO</td><td class="val money" style="font-size:14px;">${fmtEur(sum(aptProdati, a => a.isplaceno) + sum(garProdate, g => g.naplaceno) + sum(ost.filter(o => o.prodat), o => o.naplaceno))}</td></tr>
  </table>
</div>

<div class="footer">Dacić Prom · Generisano ${fmtDateTime(new Date())} · Evidencija Stanova v8</div>
</body></html>`;
  openPrintWindow(__printHtml, 'Statistika - Dacić Prom');
}

// ============================================
// Helper: loadData extension for statistics
// ============================================
// Patch loadData to include statistics (already handled in data.json but safety)
const _origLoadData = loadData;
loadData = async function() {
  await _origLoadData();
  // If statistics not loaded, try fetching separately
  if (!DATA.statistics) {
    try {
      const res = await fetch('data.json');
      const j = await res.json();
      if (j.statistics) DATA.statistics = j.statistics;
    } catch (e) {}
  }
};

// ============================================
// "PRODAJ STAN/GARAŽU/OSTAVU" DIALOG
// ============================================

function openSellDialog(type) {
  let items, typeLabel;
  
  if (type === 'apartment') {
    items = DATA.apartments.filter(a => !a.prodat && !a.vlasnik_parcele).sort((a,b) => 
      a.lamela.localeCompare(b.lamela) || a.stan - b.stan
    );
    typeLabel = 'stan';
  } else if (type === 'garage') {
    items = DATA.garages.filter(g => !g.prodat && !g.vlasnik_parcele).sort((a,b) => a.broj - b.broj);
    typeLabel = 'garažu';
  } else {
    items = DATA.ostave.map((o,i) => ({...o, _idx: i})).filter(o => !o.prodat && !o.vlasnik_parcele);
    items.sort((a,b) => (a.nivo || '').localeCompare(b.nivo || '') || (a.broj || '').localeCompare(b.broj || ''));
    typeLabel = 'ostavu';
  }
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '720px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Prodaj ${typeLabel}</div>
        <div class="modal-title-sub">Izaberite slobodnu stavku iz liste (ukupno ${items.length})</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="search-box" style="width:100%; margin-bottom:16px;">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); width:18px; height:18px; color:var(--text-dim);"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="text" id="sellSearch" placeholder="Pretraga..." oninput="filterSellList('${type}')" style="width:100%; padding:10px 14px 10px 40px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; outline:none;">
      </div>
      <div id="sellList" style="max-height:420px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
        ${renderSellListItems(items, type)}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
  window._sellItems = items;
  window._sellType = type;
}

function renderSellListItems(items, type) {
  if (items.length === 0) return '<div class="empty-state" style="padding:40px;">Nema slobodnih stavki</div>';
  
  return items.map(item => {
    let id, label, details, onclick;
    if (type === 'apartment') {
      id = `${item.lamela}-${item.stan}`;
      label = `Stan ${id}`;
      details = `Lamela ${item.lamela} · ${item.sprat || ''} · ${fmtNum(item.povrsina)} m² · ${fmtEur(item.vrednost_sa_pdv)}`;
      onclick = `showSellConfirm('apartment', '${item.lamela}', ${item.stan})`;
    } else if (type === 'garage') {
      id = `G-${item.broj}`;
      label = `Garaža ${id}`;
      details = `${fmtNum(item.povrsina)} m² · ${fmtEur(item.vrednost)}`;
      onclick = `showSellConfirm('garage', null, ${item.broj})`;
    } else {
      id = `${item.nivo || ''}-${item.broj || ''}`;
      label = `Ostava ${item.broj || ''}`;
      details = `Nivo ${item.nivo || '?'} · ${fmtNum(item.povrsina)} m² · ${fmtEur(item.vrednost)}`;
      onclick = `showSellConfirm('ostava', null, ${item._idx})`;
    }
    
    return `
      <div class="sell-item" onclick="${onclick}" style="padding:14px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
        <div>
          <div style="font-weight:600; color:var(--accent);">${label}</div>
          <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">${details}</div>
        </div>
        <div style="color:var(--text-dim); font-size:20px;">→</div>
      </div>
    `;
  }).join('');
}

// Prodaja: dijalog za unos kupca + kapare
function showSellConfirm(type, lamela, idOrBroj) {
  let item, label, value, cenaM2 = 0, povrsina = 0;
  if (type === 'apartment') {
    item = findApartment(lamela, idOrBroj);
    label = `Stan ${item.lamela}-${item.stan}`;
    value = item.vrednost_sa_pdv;
    cenaM2 = item.cena_m2_pdv || 0;
    povrsina = item.povrsina || 0;
  } else if (type === 'garage') {
    item = DATA.garages.find(g => g.broj === idOrBroj);
    label = `Garaža G-${item.broj}`;
    value = item.vrednost;
    povrsina = item.povrsina || 0;
  } else {
    item = DATA.ostave[idOrBroj];
    label = `Ostava ${item.broj || ''} (Nivo ${item.nivo || ''})`;
    value = item.vrednost;
    povrsina = item.povrsina || 0;
  }
  if (!item) return;
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '600px';
  const today = new Date().toISOString().split('T')[0];
  
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Prodaja · ${label}</div>
        <div class="modal-title-sub">${fmtNum(povrsina)} m²${cenaM2 ? ' · ' + fmtEur(cenaM2) + '/m²' : ''}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      
      <!-- Info box -->
      <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin-bottom:16px; display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:13px;">
        <div><span style="color:var(--text-dim);">Površina:</span> <strong>${fmtNum(povrsina)} m²</strong></div>
        ${type === 'apartment' && cenaM2 ? `<div><span style="color:var(--text-dim);">Cena/m²:</span> <strong>${fmtEur(cenaM2)}</strong></div>` : ''}
        <div><span style="color:var(--text-dim);">Ukupna vrednost:</span> <strong style="color:var(--accent);">${fmtEur(value)}</strong></div>
      </div>
      
      <div class="form-grid">
        <div class="form-field full">
          <label>Ime i prezime kupca *</label>
          <input id="sellIme" type="text" placeholder="npr. Marko Marković" autofocus>
        </div>
        
        ${type === 'apartment' ? `
        <div class="form-field">
          <label>Cena/m² sa PDV (€) <span style="color:var(--accent); font-size:11px;">← unesite ovdje</span></label>
          <input id="sellCenaM2" type="number" step="0.01" value="${cenaM2 || ''}" placeholder="npr. 1558" oninput="updateSellTotal()" style="font-size:16px; font-weight:600; color:var(--accent);">
        </div>
        <div class="form-field">
          <label>Ukupna vrednost sa PDV (€) <span style="color:var(--text-dim); font-size:11px;">(auto)</span></label>
          <input id="sellVrednost" type="number" step="0.01" value="${value || ''}" readonly style="background:var(--surface-3); color:var(--success); font-weight:700; font-size:15px;">
        </div>
        ` : ''}
        
        <div class="form-field">
          <label>Datum prodaje</label>
          <input id="sellDatum" type="date" value="${today}">
        </div>
        
        <div class="form-field">
          <label>Kapara (€, opciono)</label>
          <input id="sellKapara" type="number" step="1" placeholder="0">
        </div>
        
        <div class="form-field full">
          <label>Dokumenti</label>
          <select id="sellUgovor" style="width:100%;">
            <option value="none">Ne - ništa nije potpisano</option>
            <option value="predugovor">Predugovor potpisan</option>
            <option value="ugovor" selected>Ugovor potpisan</option>
          </select>
        </div>
        
        ${type === 'apartment' ? `
        <div class="form-field full">
          <label>Plan otplate</label>
          <select id="sellPlan" style="width:100%;">
            <option value="none">Ne - bez plana</option>
            <option value="standard">Standardni (kapara + rate)</option>
          </select>
        </div>
        <div id="sellPlanDetails" style="display:none; grid-column:1/-1;">
          <div class="form-grid">
            <div class="form-field">
              <label>Kapara %</label>
              <input id="sellPlanKaparaPct" type="number" value="20" min="0" max="100">
            </div>
            <div class="form-field">
              <label>Broj rata</label>
              <input id="sellPlanBrojRata" type="number" value="12" min="1" max="120">
            </div>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
      <button class="btn btn-primary" onclick="confirmSell('${type}', ${type === 'apartment' ? `'${lamela}', ${idOrBroj}` : `null, ${idOrBroj}`})">
        🔑 Potvrdi prodaju
      </button>
    </div>
  `;
  
  // Store povrsina for auto-calc
  window._sellPovrsina = povrsina;
  
  // Wire up plan toggle
  const planSel = document.getElementById('sellPlan');
  if (planSel) {
    planSel.addEventListener('change', () => {
      const d = document.getElementById('sellPlanDetails');
      if (d) d.style.display = planSel.value !== 'none' ? 'contents' : 'none';
    });
  }
  
  setTimeout(() => {
    const el = document.getElementById('sellIme');
    if (el) el.focus();
  }, 100);
}

function updateSellTotal() {
  const cenaEl = document.getElementById('sellCenaM2');
  const vredEl = document.getElementById('sellVrednost');
  if (!cenaEl || !vredEl) return;
  const cena = parseFloat(cenaEl.value) || 0;
  // Find povrsina from current item
  const povrsinaEl = document.getElementById('sellPovrsina');
  const povrsina = povrsinaEl ? parseFloat(povrsinaEl.value) || 0 : window._sellPovrsina || 0;
  if (cena > 0 && povrsina > 0) {
    vredEl.value = (cena * povrsina).toFixed(2);
  }
}

function confirmSell(type, lamela, idOrBroj) {
  const ime = document.getElementById('sellIme').value.trim();
  if (!ime) {
    showToast('Morate uneti ime kupca', 'error');
    return;
  }
  const datum = document.getElementById('sellDatum').value;
  const kapara = parseFloat(document.getElementById('sellKapara').value) || 0;
  
  // Ugovor: select (none/predugovor/ugovor) or old checkbox fallback
  const ugovorSel = document.getElementById('sellUgovor');
  let ugovorVal = false;
  let predugovorVal = false;
  if (ugovorSel && ugovorSel.tagName === 'SELECT') {
    ugovorVal = ugovorSel.value === 'ugovor';
    predugovorVal = ugovorSel.value === 'predugovor';
  } else if (ugovorSel) {
    ugovorVal = ugovorSel.checked;
  }
  
  let item;
  if (type === 'apartment') {
    item = findApartment(lamela, idOrBroj);
  } else if (type === 'garage') {
    item = DATA.garages.find(g => g.broj === idOrBroj);
  } else {
    item = DATA.ostave[idOrBroj];
  }
  if (!item) return;
  
  // Update cena/m2 and vrednost if changed for apartment
  if (type === 'apartment') {
    const newCenaM2 = parseFloat(document.getElementById('sellCenaM2')?.value) || item.cena_m2_pdv;
    const newVrednost = parseFloat(document.getElementById('sellVrednost')?.value) || item.vrednost_sa_pdv;
    if (newCenaM2) item.cena_m2_pdv = newCenaM2;
    if (newVrednost && newVrednost !== item.vrednost_sa_pdv) {
      item.vrednost_sa_pdv = newVrednost;
      item.preostalo = newVrednost - (item.isplaceno || 0);
    }
  }
  
  // Perform sale
  item.prodat = true;
  item.ime = ime;
  
  if (type === 'apartment') {
    item.ugovor = ugovorVal;
    item.predugovor = predugovorVal;
    
    if (kapara > 0) {
      const mk = datum.substring(0,7);
      if (!item.uplate) item.uplate = {};
      if (!item.uplate_dates) item.uplate_dates = {};
      const existingInMonth = Object.keys(item.uplate).filter(k => k.startsWith(mk)).length;
      const key = existingInMonth > 0 ? `${mk}-kapara${existingInMonth}` : mk;
      item.uplate[key] = kapara;
      item.uplate_dates[key] = datum;
      item.isplaceno = (item.isplaceno || 0) + kapara;
      item.preostalo = item.vrednost_sa_pdv - item.isplaceno;
    }
    
    // Auto-generate plan otplate if selected
    const planSel = document.getElementById('sellPlan');
    if (planSel && planSel.value === 'standard') {
      const kaparaPct = parseFloat(document.getElementById('sellPlanKaparaPct')?.value) || 20;
      const brojRata = parseInt(document.getElementById('sellPlanBrojRata')?.value) || 12;
      const vrednost = item.vrednost_sa_pdv || 0;
      const kaparaIznos = Math.round(vrednost * kaparaPct / 100);
      const rataIznos = Math.round((vrednost - kaparaIznos) / brojRata);
      
      const rate = [];
      // Add kapara as first rate
      if (kaparaIznos > 0 && kapara === 0) {
        rate.push({ opis: 'Kapara', iznos: kaparaIznos, datum: datum, isplacena: false });
      }
      // Add monthly rates starting next month
      const startDate = new Date(datum);
      startDate.setMonth(startDate.getMonth() + 1);
      for (let i = 0; i < brojRata; i++) {
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + i);
        const dateStr = d.toISOString().split('T')[0];
        rate.push({ opis: `Rata ${i+1}/${brojRata}`, iznos: rataIznos, datum: dateStr, isplacena: false });
      }
      item.plan_otplate = { kapara_pct: kaparaPct, rate };
    }
  } else {
    // garage / ostava
    if (kapara > 0) {
      const mk = datum.substring(0,7);
      if (!item.uplate) item.uplate = {};
      if (!item.uplate_dates) item.uplate_dates = {};
      const existingInMonth = Object.keys(item.uplate).filter(k => k.startsWith(mk)).length;
      const key = existingInMonth > 0 ? `${mk}-kapara${existingInMonth}` : mk;
      item.uplate[key] = kapara;
      item.uplate_dates[key] = datum;
      item.naplaceno = (item.naplaceno || 0) + kapara;
      item.preostalo = item.vrednost - item.naplaceno;
    }
  }
  
  // Track sale date (for "recently sold" card)
  item.datum_prodaje = datum;
  
  // Save to Supabase
  saveToCache();
  if (type === 'apartment') {
    sbUpsertApartment(item).then(() => {
      if (kapara > 0 && item._id) {
        sbInsertPayment('apartment_payments','apartment_id',item._id,datum.substring(0,7),kapara,datum);
      }
    }).catch(()=>{});
  } else if (type === 'garage') {
    sbUpsertGarage(item).then(() => {
      if (kapara > 0 && item._id) {
        sbInsertPayment('garage_payments','garage_id',item._id,datum.substring(0,7),kapara,datum);
      }
    }).catch(()=>{});
  } else {
    sbUpsertOstava(item).catch(()=>{});
  }
  
  closeModal();
  renderView();
  logActivity('PRODAJA', `${type === 'apartment' ? `Stan ${lamela}-${idOrBroj}` : type === 'garage' ? `Garaža G-${idOrBroj}` : `Ostava`} → ${ime}${kapara > 0 ? ' · Kapara: ' + fmtEur(kapara) : ''}`);
  showToast(`${type === 'apartment' ? 'Stan' : (type === 'garage' ? 'Garaža' : 'Ostava')} prodat${type === 'apartment' ? '' : 'a'}: ${ime}`, 'success');
}

function filterSellList(type) {
  const q = document.getElementById('sellSearch').value.toLowerCase();
  const items = window._sellItems || [];
  const filtered = items.filter(item => {
    const searchable = type === 'apartment' 
      ? `${item.lamela}-${item.stan} ${item.sprat || ''}`
      : type === 'garage' 
        ? `g-${item.broj}`
        : `${item.nivo || ''} ${item.broj || ''}`;
    return searchable.toLowerCase().includes(q);
  });
  document.getElementById('sellList').innerHTML = renderSellListItems(filtered, type);
}

// ============================================
// DATA RESTORE (za stan koji je slučajno obrisan pre ove verzije)
// ============================================

async function restoreMissingItems() {
  try {
    const res = await fetch('data.json');
    const original = await res.json();
    
    let restoredCount = 0;
    
    // Restore missing apartments
    original.apartments.forEach(origApt => {
      const existing = DATA.apartments.find(a => 
        a.lamela === origApt.lamela && a.stan === origApt.stan
      );
      if (!existing) {
        DATA.apartments.push(origApt);
        restoredCount++;
      }
    });
    
    // Restore missing garages
    if (original.garages) {
      original.garages.forEach(origG => {
        const existing = DATA.garages.find(g => g.broj === origG.broj);
        if (!existing) {
          DATA.garages.push(origG);
          restoredCount++;
        }
      });
    }
    
    // Restore missing ostave (harder to match - by nivo+broj)
    if (original.ostave) {
      original.ostave.forEach(origO => {
        const existing = DATA.ostave.find(o => 
          (o.nivo || '') === (origO.nivo || '') && 
          (o.broj || '') === (origO.broj || '')
        );
        if (!existing) {
          DATA.ostave.push(origO);
          restoredCount++;
        }
      });
    }
    
    // Sort apartments
    DATA.apartments.sort((a,b) => 
      a.lamela.localeCompare(b.lamela) || a.stan - b.stan
    );
    DATA.garages.sort((a,b) => a.broj - b.broj);
    
    if (restoredCount > 0) {
      saveToCache();
      showToast(`Vraćeno ${restoredCount} stavki u evidenciju`, 'success');
      renderView();
    } else {
      showToast('Sve stavke su već u evidenciji', 'success');
    }
  } catch (e) {
    showToast('Greška pri vraćanju podataka', 'error');
    console.error(e);
  }
}

// Auto-restore disabled - Supabase is source of truth

// ============================================
// GARAGES & OSTAVE - LEVEL GROUPING
// ============================================

// Group garages by their "nivo" - but garages don't have nivo field in data yet
// We'll infer from broj ranges: 1-60 = -1, 61-120 = -2, 121+ = -3
// Actually better: add nivo detection based on natural groupings in original data
function getGarageLevel(broj) {
  // Ispravno: -3 je najniži nivo (1-64), -2 srednji (65-126), -1 najgornji (127-175)
  if (broj <= 64) return '-3';
  if (broj <= 126) return '-2';
  return '-1';
}

// ============================================
// STATISTIKA - CHARTS
// ============================================

function renderStatChart(type) {
  if (type === 'apartments-status') {
    const sold = DATA.apartments.filter(a => a.prodat).length;
    const total = DATA.apartments.length;
    const free = total - sold;
    const pct = Math.round((sold / total) * 100);
    
    const r = 70;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - sold/total);
    
    return `
      <div style="display:flex; align-items:center; gap:24px; padding:20px;">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="18"/>
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--accent)" stroke-width="18"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}" 
            transform="rotate(-90 90 90)" stroke-linecap="round"/>
          <text x="90" y="86" text-anchor="middle" fill="var(--text)" font-size="32" font-weight="700">${pct}%</text>
          <text x="90" y="108" text-anchor="middle" fill="var(--text-dim)" font-size="12">prodato</text>
        </svg>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
            <div style="width:14px; height:14px; background:var(--accent); border-radius:3px;"></div>
            <div>
              <div style="font-size:13px; color:var(--text-dim);">Prodatih stanova</div>
              <div style="font-size:22px; font-weight:700;">${sold}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:14px; height:14px; background:var(--surface-3); border-radius:3px;"></div>
            <div>
              <div style="font-size:13px; color:var(--text-dim);">Slobodnih</div>
              <div style="font-size:22px; font-weight:700;">${free}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  if (type === 'garages-status') {
    const sold = DATA.garages.filter(g => g.prodat).length;
    const total = DATA.garages.length;
    const free = total - sold;
    const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
    
    const r = 70;
    const c = 2 * Math.PI * r;
    const offset = total > 0 ? c * (1 - sold/total) : c;
    
    return `
      <div style="display:flex; align-items:center; gap:24px; padding:20px;">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="18"/>
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="#22c55e" stroke-width="18"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}" 
            transform="rotate(-90 90 90)" stroke-linecap="round"/>
          <text x="90" y="86" text-anchor="middle" fill="var(--text)" font-size="32" font-weight="700">${pct}%</text>
          <text x="90" y="108" text-anchor="middle" fill="var(--text-dim)" font-size="12">prodato</text>
        </svg>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
            <div style="width:14px; height:14px; background:#22c55e; border-radius:3px;"></div>
            <div>
              <div style="font-size:13px; color:var(--text-dim);">Prodato garaža</div>
              <div style="font-size:22px; font-weight:700;">${sold}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:14px; height:14px; background:var(--surface-3); border-radius:3px;"></div>
            <div>
              <div style="font-size:13px; color:var(--text-dim);">Slobodnih</div>
              <div style="font-size:22px; font-weight:700;">${free}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  if (type === 'collected-bars') {
    // Bar chart: collected vs outstanding for apartments/garages/ostave
    const aptPaid = DATA.apartments.reduce((s,a) => s + (a.isplaceno || 0), 0);
    const aptRemain = DATA.apartments.filter(a => a.prodat).reduce((s,a) => s + (a.preostalo || 0), 0);
    
    const garPaid = DATA.garages.reduce((s,g) => s + (g.naplaceno || 0), 0);
    const garRemain = DATA.garages.filter(g => g.prodat).reduce((s,g) => s + (g.preostalo || 0), 0);
    
    const ostPaid = DATA.ostave.reduce((s,o) => s + (o.naplaceno || 0), 0);
    const ostRemain = DATA.ostave.filter(o => o.prodat).reduce((s,o) => s + (o.preostalo || 0), 0);
    
    const max = Math.max(aptPaid + aptRemain, garPaid + garRemain, ostPaid + ostRemain, 1);
    
    const bar = (label, paid, remain) => {
      const total = paid + remain;
      const paidW = (paid / max) * 100;
      const remainW = (remain / max) * 100;
      return `
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
            <span style="font-weight:600;">${label}</span>
            <span style="color:var(--text-dim);">${fmtEur(total)}</span>
          </div>
          <div style="display:flex; height:28px; background:var(--surface-3); border-radius:6px; overflow:hidden;">
            <div style="width:${paidW}%; background:linear-gradient(to right, #22c55e, #4ade80); display:flex; align-items:center; padding:0 8px; font-size:11px; color:#1a2332; font-weight:600;" title="Naplaćeno">
              ${paidW > 12 ? fmtEur(paid) : ''}
            </div>
            <div style="width:${remainW}%; background:linear-gradient(to right, #f87171, #fca5a5); display:flex; align-items:center; padding:0 8px; font-size:11px; color:#1a2332; font-weight:600;" title="Preostalo">
              ${remainW > 12 ? fmtEur(remain) : ''}
            </div>
          </div>
        </div>
      `;
    };
    
    return `
      <div style="padding:20px;">
        ${bar('Stanovi', aptPaid, aptRemain)}
        ${bar('Garaže', garPaid, garRemain)}
        ${bar('Ostave', ostPaid, ostRemain)}
        <div style="display:flex; gap:20px; margin-top:16px; padding-top:14px; border-top:1px solid var(--border); font-size:12px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="width:12px; height:12px; background:#22c55e; border-radius:2px;"></div>
            <span>Naplaćeno</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="width:12px; height:12px; background:#f87171; border-radius:2px;"></div>
            <span>Preostalo za naplatu</span>
          </div>
        </div>
      </div>
    `;
  }
  
  if (type === 'lamela-compare') {
    const lamA = DATA.apartments.filter(a => a.lamela === 'A');
    const lamB = DATA.apartments.filter(a => a.lamela === 'B');
    const aSold = lamA.filter(a => a.prodat).length;
    const bSold = lamB.filter(a => a.prodat).length;
    const aPaid = lamA.reduce((s,a) => s + (a.isplaceno || 0), 0);
    const bPaid = lamB.reduce((s,a) => s + (a.isplaceno || 0), 0);
    
    const max = Math.max(lamA.length, lamB.length, 1);
    const maxP = Math.max(aPaid, bPaid, 1);
    
    return `
      <div style="padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:30px;">
        <div>
          <div style="font-size:12px; color:var(--text-dim); text-transform:uppercase; margin-bottom:10px;">Prodaja po lamelama</div>
          <div style="display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; margin-bottom:8px;">
            <div style="font-weight:600; color:var(--accent);">LAMELA A</div>
            <div style="height:24px; background:var(--surface-3); border-radius:4px; overflow:hidden; position:relative;">
              <div style="height:100%; width:${(aSold/max)*100}%; background:linear-gradient(to right, var(--accent), #e3b584);"></div>
              <div style="position:absolute; inset:0; display:flex; align-items:center; padding:0 10px; font-size:12px; font-weight:600;">${aSold}/${lamA.length}</div>
            </div>
            <div style="color:var(--text-dim); font-size:12px;">${Math.round(aSold/lamA.length*100)}%</div>
          </div>
          <div style="display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center;">
            <div style="font-weight:600; color:var(--accent);">LAMELA B</div>
            <div style="height:24px; background:var(--surface-3); border-radius:4px; overflow:hidden; position:relative;">
              <div style="height:100%; width:${(bSold/max)*100}%; background:linear-gradient(to right, var(--accent), #e3b584);"></div>
              <div style="position:absolute; inset:0; display:flex; align-items:center; padding:0 10px; font-size:12px; font-weight:600;">${bSold}/${lamB.length}</div>
            </div>
            <div style="color:var(--text-dim); font-size:12px;">${Math.round(bSold/lamB.length*100)}%</div>
          </div>
        </div>
        <div>
          <div style="font-size:12px; color:var(--text-dim); text-transform:uppercase; margin-bottom:10px;">Naplaćeno po lamelama</div>
          <div style="display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; margin-bottom:8px;">
            <div style="font-weight:600; color:var(--accent);">LAMELA A</div>
            <div style="height:24px; background:var(--surface-3); border-radius:4px; overflow:hidden; position:relative;">
              <div style="height:100%; width:${(aPaid/maxP)*100}%; background:linear-gradient(to right, #22c55e, #4ade80);"></div>
            </div>
            <div style="color:var(--success); font-size:12px; font-weight:600;">${fmtEur(aPaid)}</div>
          </div>
          <div style="display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center;">
            <div style="font-weight:600; color:var(--accent);">LAMELA B</div>
            <div style="height:24px; background:var(--surface-3); border-radius:4px; overflow:hidden; position:relative;">
              <div style="height:100%; width:${(bPaid/maxP)*100}%; background:linear-gradient(to right, #22c55e, #4ade80);"></div>
            </div>
            <div style="color:var(--success); font-size:12px; font-weight:600;">${fmtEur(bPaid)}</div>
          </div>
        </div>
      </div>
    `;
  }
  
  return '';
}

// ============================================
// KALENDAR - Očekivani priliv po mesecima
// ============================================

function renderKalendar(c) {
  // For each month, collect: 
  //   - actual payments (from uplate, any item)
  //   - expected rates (from planirane_rate + plan_otplate)
  // byMonth[monthKey] = { actualPaid, expected, entries: [...] }
  const byMonth = {};
  
  const addToMonth = (monthKey, entry) => {
    if (!byMonth[monthKey]) byMonth[monthKey] = { actualPaid: 0, expected: 0, entries: [] };
    byMonth[monthKey].entries.push(entry);
  };
  
  const processItem = (item, label, customer) => {
    if (item.vlasnik_parcele) return;
    
    // Actual payments (green cells from Excel = uplate)
    if (item.uplate) {
      Object.entries(item.uplate).forEach(([mk, amt]) => {
        if (!byMonth[mk]) byMonth[mk] = { actualPaid: 0, expected: 0, entries: [] };
        byMonth[mk].actualPaid += amt;
        byMonth[mk].entries.push({
          type: 'paid',
          item: label, customer,
          amount: amt,
          source: 'Naplaćeno'
        });
      });
    }
    
    // Planned rates (non-green cells from Excel)
    if (item.planirane_rate) {
      Object.entries(item.planirane_rate).forEach(([mk, amt]) => {
        if (!byMonth[mk]) byMonth[mk] = { actualPaid: 0, expected: 0, entries: [] };
        byMonth[mk].expected += amt;
        byMonth[mk].entries.push({
          type: 'planned',
          item: label, customer,
          amount: amt,
          source: 'Plan iz Excela'
        });
      });
    }
    
    // Plan otplate (manually added installments)
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum) return;
        const d = new Date(rata.datum);
        const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (!byMonth[mk]) byMonth[mk] = { actualPaid: 0, expected: 0, entries: [] };
        if (rata.isplacena) {
          byMonth[mk].actualPaid += rata.iznos || 0;
        } else {
          byMonth[mk].expected += rata.iznos || 0;
        }
        byMonth[mk].entries.push({
          type: rata.isplacena ? 'paid' : 'planned',
          item: label, customer,
          amount: rata.iznos || 0,
          source: rata.opis || 'Plan otplate'
        });
      });
    }
  };
  
  DATA.apartments.forEach(a => processItem(a, `Stan ${a.lamela}-${a.stan}`, a.ime || '—'));
  (DATA.garages || []).forEach(g => processItem(g, `Garaža G-${g.broj}`, g.ime || '—'));
  (DATA.ostave || []).forEach(o => processItem(o, `Ostava ${o.broj || ''}`, o.ime || '—'));
  
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  
  // 3 months ahead
  const highlightKeys = [currentKey];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    highlightKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  
  // Ensure all highlight keys exist in byMonth
  highlightKeys.forEach(k => {
    if (!byMonth[k]) byMonth[k] = { actualPaid: 0, expected: 0, entries: [] };
  });
  
  const sortedKeys = Object.keys(byMonth).sort();
  
  // Summary totals for highlight window
  let sum4MonthsExpected = 0, sum4MonthsPaid = 0;
  highlightKeys.forEach(k => {
    const m = byMonth[k];
    if (m) {
      sum4MonthsExpected += m.expected + m.actualPaid;
      sum4MonthsPaid += m.actualPaid;
    }
  });
  
  // Preostalo za tekucu godinu (ostatak od ovog meseca pa do kraja godine)
  let sumYearRemaining = 0;
  const year = now.getFullYear();
  sortedKeys.forEach(k => {
    if (k >= currentKey && k.startsWith(String(year))) {
      sumYearRemaining += byMonth[k].expected;
    }
  });
  
  const totalEntries = Object.values(byMonth).reduce((s,m) => s + m.entries.length, 0);
  
  c.innerHTML = `
    <div style="max-width:1200px; margin:0 auto;">
      <!-- Summary cards -->
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card" style="border-color:var(--accent); background:linear-gradient(135deg, rgba(212,165,116,0.1), transparent);">
          <div class="stat-label">Naredna 4 meseca</div>
          <div class="stat-value accent">${fmtEur(sum4MonthsExpected)}</div>
          <div class="stat-sub">ukupan iznos</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Od toga naplaćeno</div>
          <div class="stat-value success">${fmtEur(sum4MonthsPaid)}</div>
          <div class="stat-sub">${sum4MonthsExpected > 0 ? Math.round(sum4MonthsPaid/sum4MonthsExpected*100) : 0}% od planiranog</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Planirano do kraja ${year}</div>
          <div class="stat-value">${fmtEur(sumYearRemaining)}</div>
          <div class="stat-sub">očekivane rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ukupno stavki</div>
          <div class="stat-value">${totalEntries}</div>
          <div class="stat-sub">kroz sve mesece</div>
        </div>
      </div>
      
      <!-- Highlighted 4 months -->
      <div class="panel" style="margin-bottom:20px; border-color:var(--accent);">
        <div class="panel-header" style="background:linear-gradient(90deg, rgba(212,165,116,0.12), transparent);">
          <div class="panel-title" style="display:flex; align-items:center; gap:8px;">
            <span style="color:var(--accent); font-size:18px;">⭐</span>
            Trenutni mesec i naredna 3 meseca
          </div>
        </div>
        <div style="padding:16px;">
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px;" class="kalendar-highlight-grid">
            ${highlightKeys.map(key => renderMonthCard(key, byMonth[key], true)).join('')}
          </div>
        </div>
      </div>
      
      <!-- All months chronologically -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Svi meseci</div>
          <div style="font-size:12px; color:var(--text-dim);">Klikni na mesec da vidiš detalje</div>
        </div>
        <div style="padding:16px;">
          ${renderKalendarByYear(byMonth, sortedKeys, currentKey, new Set(highlightKeys))}
        </div>
      </div>
    </div>
  `;
}

function renderMonthCard(key, monthData, isHighlight) {
  const [y, m] = key.split('-').map(Number);
  const monthsFull = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const isCurrent = key === currentKey;
  
  const data = monthData || { actualPaid: 0, expected: 0, entries: [] };
  const paid = data.actualPaid || 0;
  const expected = data.expected || 0;
  const total = paid + expected;
  const paidPct = total > 0 ? Math.round(paid/total*100) : 0;
  const entriesCount = data.entries ? data.entries.length : 0;
  
  return `
    <div class="kalendar-month-card ${isCurrent ? 'current' : ''} ${isHighlight ? 'highlight' : ''}" onclick="showMonthDetails('${key}')">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div>
          <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase;">${y}</div>
          <div style="font-size:15px; font-weight:700;">${monthsFull[m-1]}</div>
        </div>
        ${isCurrent ? '<span class="badge" style="background:var(--accent); color:#1a2332; font-size:9px;">TRENUTNO</span>' : ''}
      </div>
      <div style="font-size:20px; font-weight:700; color:var(--accent); margin-bottom:4px;">${fmtEur(total)}</div>
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">${entriesCount} ${entriesCount === 1 ? 'stavka' : 'stavki'}</div>
      ${total > 0 ? `
        <div style="height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-bottom:4px;">
          <div style="height:100%; width:${paidPct}%; background:linear-gradient(to right, #22c55e, #4ade80);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px;">
          <span style="color:var(--success);">${fmtEur(paid)}</span>
          <span style="color:${expected > 0 ? 'var(--accent)' : 'var(--text-dim)'};">${fmtEur(expected)}</span>
        </div>
      ` : '<div style="font-size:11px; color:var(--text-dim); font-style:italic;">Nema stavki</div>'}
    </div>
  `;
}

function renderKalendarByYear(byMonth, sortedKeys, currentKey, highlightKeys) {
  const byYear = {};
  sortedKeys.forEach(k => {
    const y = k.substring(0, 4);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(k);
  });
  
  const currentYearStr = new Date().getFullYear().toString();
  
  return Object.keys(byYear).sort().map(year => {
    const keys = byYear[year];
    const yearTotal = keys.reduce((s,k) => {
      const m = byMonth[k];
      return s + (m ? m.actualPaid + m.expected : 0);
    }, 0);
    const yearPaid = keys.reduce((s,k) => {
      const m = byMonth[k];
      return s + (m ? m.actualPaid : 0);
    }, 0);
    
    // Collapse past years (2025 and earlier) by default
    const isPastYear = year < currentYearStr;
    const isCollapsed = year !== currentYearStr; // Only current year open by default
    
    return `
      <div style="margin-bottom:20px;" data-year="${year}">
        <div onclick="toggleKalendarYear('${year}')" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:var(--surface-3); border-radius:8px; margin-bottom:10px; cursor:pointer; user-select:none;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="year-toggle-icon" id="year-toggle-${year}" style="transition:transform 0.2s; display:inline-block; ${isCollapsed ? '' : 'transform:rotate(90deg);'}">▶</span>
            <strong style="font-size:16px;">${year}</strong>
            ${isPastYear ? '<span style="font-size:11px; color:var(--text-dim); background:var(--surface); padding:2px 8px; border-radius:10px;">prošla godina</span>' : ''}
          </div>
          <div style="display:flex; gap:14px; align-items:center;">
            ${isPastYear ? `<span style="font-size:12px; color:var(--success);">${fmtEur(yearPaid)} naplaćeno</span>` : ''}
            <strong style="color:var(--accent);">${fmtEur(yearTotal)}</strong>
          </div>
        </div>
        <div class="year-content" id="year-content-${year}" style="${isCollapsed ? 'display:none;' : ''}">
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px;" class="kalendar-grid">
            ${keys.map(k => renderMonthCard(k, byMonth[k], highlightKeys.has(k))).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleKalendarYear(year) {
  const content = document.getElementById(`year-content-${year}`);
  const icon = document.getElementById(`year-toggle-${year}`);
  if (!content || !icon) return;
  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.style.transform = 'rotate(90deg)';
  } else {
    content.style.display = 'none';
    icon.style.transform = '';
  }
}

function showMonthDetails(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const monthsFull = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  
  // Build entries for this month
  const paidEntries = [];
  const plannedEntries = [];
  
  const processItem = (item, label, customer, onclickJs) => {
    if (item.vlasnik_parcele) return;
    if (item.uplate && item.uplate[monthKey]) {
      paidEntries.push({
        label, customer, amount: item.uplate[monthKey],
        source: 'Naplaćeno', onclickJs
      });
    }
    if (item.planirane_rate && item.planirane_rate[monthKey]) {
      plannedEntries.push({
        label, customer, amount: item.planirane_rate[monthKey],
        source: 'Plan iz Excela', onclickJs
      });
    }
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum) return;
        const d = new Date(rata.datum);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (k === monthKey) {
          const entry = {
            label, customer, amount: rata.iznos || 0,
            source: rata.opis || 'Plan otplate', onclickJs
          };
          if (rata.isplacena) paidEntries.push(entry);
          else plannedEntries.push(entry);
        }
      });
    }
  };
  
  DATA.apartments.forEach(a => {
    processItem(a, `Stan ${a.lamela}-${a.stan}`, a.ime || '—', 
      `openApartment('${a.lamela}', ${a.stan})`);
  });
  (DATA.garages || []).forEach(g => {
    processItem(g, `Garaža G-${g.broj}`, g.ime || '—',
      `openGarage(${g.broj})`);
  });
  (DATA.ostave || []).forEach((o, idx) => {
    processItem(o, `Ostava ${o.broj || ''}`, o.ime || '—',
      `openOstava(${idx})`);
  });
  
  const totalPaid = paidEntries.reduce((s,e) => s + e.amount, 0);
  const totalPlanned = plannedEntries.reduce((s,e) => s + e.amount, 0);
  
  const mm = document.getElementById('modalContent');
  mm.style.maxWidth = '820px';
  mm.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">${monthsFull[m-1]} ${y}</div>
        <div class="modal-title-sub">${paidEntries.length + plannedEntries.length} stavki · Ukupno: ${fmtEur(totalPaid + totalPlanned)}</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
        <div style="background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); padding:14px; border-radius:8px;">
          <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase;">✓ Naplaćeno</div>
          <div style="font-size:20px; font-weight:700; color:var(--success);">${fmtEur(totalPaid)}</div>
          <div style="font-size:12px; color:var(--text-dim);">${paidEntries.length} uplata</div>
        </div>
        <div style="background:rgba(212,165,116,0.1); border:1px solid rgba(212,165,116,0.3); padding:14px; border-radius:8px;">
          <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase;">📅 Planirano</div>
          <div style="font-size:20px; font-weight:700; color:var(--accent);">${fmtEur(totalPlanned)}</div>
          <div style="font-size:12px; color:var(--text-dim);">${plannedEntries.length} rata</div>
        </div>
      </div>
      
      ${paidEntries.length > 0 ? `
        <h3 style="font-size:13px; margin:16px 0 8px; color:var(--success); text-transform:uppercase; letter-spacing:0.5px;">✓ Naplaćene uplate</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:14px;">
          <table class="data-table" style="background:transparent; margin:0;">
            <thead><tr><th>Stavka</th><th>Kupac</th><th class="num">Iznos</th></tr></thead>
            <tbody>
              ${paidEntries.map(e => `
                <tr onclick="closeModal(); setTimeout(() => ${e.onclickJs}, 100);">
                  <td><strong>${e.label}</strong><br><small style="color:var(--text-dim);">${e.source}</small></td>
                  <td>${e.customer}</td>
                  <td class="num" style="color:var(--success); font-weight:600;">${fmtEur(e.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      
      ${plannedEntries.length > 0 ? `
        <h3 style="font-size:13px; margin:16px 0 8px; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px;">📅 Očekivane rate</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          <table class="data-table" style="background:transparent; margin:0;">
            <thead><tr><th>Stavka</th><th>Kupac</th><th class="num">Iznos</th></tr></thead>
            <tbody>
              ${plannedEntries.map(e => `
                <tr onclick="closeModal(); setTimeout(() => ${e.onclickJs}, 100);">
                  <td><strong>${e.label}</strong><br><small style="color:var(--text-dim);">${e.source}</small></td>
                  <td>${e.customer}</td>
                  <td class="num" style="color:var(--accent); font-weight:600;">${fmtEur(e.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      
      ${paidEntries.length === 0 && plannedEntries.length === 0 ? 
        '<div class="empty-state">Nema stavki u ovom mesecu</div>' : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

// ============================================
// VLASNICI PARCELA
// ============================================

function getAllVlasnici() {
  const map = {};
  
  DATA.apartments.forEach(a => {
    if (!a.vlasnik_parcele || !a.ime) return;
    const key = getCustomerKey(a.ime);
    if (!map[key]) map[key] = { ime: a.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].stanovi.push(a);
  });
  (DATA.garages || []).forEach(g => {
    if (!g.vlasnik_parcele || !g.ime) return;
    const key = getCustomerKey(g.ime);
    if (!map[key]) map[key] = { ime: g.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].garaze.push(g);
  });
  (DATA.ostave || []).forEach((o, idx) => {
    if (!o.vlasnik_parcele || !o.ime) return;
    const key = getCustomerKey(o.ime);
    if (!map[key]) map[key] = { ime: o.ime, stanovi: [], garaze: [], ostave: [] };
    map[key].ostave.push({ ...o, _idx: idx });
  });
  
  Object.values(map).forEach(v => {
    v.broj_stanova = v.stanovi.length;
    v.broj_garaza = v.garaze.length;
    v.broj_ostava = v.ostave.length;
    v.ukupno_kvadrata_stanovi = v.stanovi.reduce((s,a) => s + (a.povrsina || 0), 0);
    v.ukupno_kvadrata_garaze = v.garaze.reduce((s,g) => s + (g.povrsina || 0), 0);
    v.ukupno_kvadrata_ostave = v.ostave.reduce((s,o) => s + (o.povrsina || 0), 0);
    v.vrednost_stanova = v.stanovi.reduce((s,a) => s + (a.vrednost_sa_pdv || 0), 0);
  });
  
  return Object.values(map).sort((a,b) => b.ukupno_kvadrata_stanovi - a.ukupno_kvadrata_stanovi);
}

function renderVlasnici(c) {
  const vlasnici = getAllVlasnici();
  
  const totalStanovi = vlasnici.reduce((s,v) => s + v.broj_stanova, 0);
  const totalGaraze = vlasnici.reduce((s,v) => s + v.broj_garaza, 0);
  const totalOstave = vlasnici.reduce((s,v) => s + v.broj_ostava, 0);
  const totalKvadrata = vlasnici.reduce((s,v) => s + v.ukupno_kvadrata_stanovi, 0);
  const totalVrednost = vlasnici.reduce((s,v) => s + v.vrednost_stanova, 0);
  
  c.innerHTML = `
    <div style="max-width:1200px; margin:0 auto;">
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card">
          <div class="stat-label">Vlasnika parcela</div>
          <div class="stat-value" style="color:#c4b5fd;">${vlasnici.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Stanova ukupno</div>
          <div class="stat-value">${totalStanovi}</div>
          <div class="stat-sub">${fmtNum(totalKvadrata)} m²</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Garaža / Ostava</div>
          <div class="stat-value">${totalGaraze} / ${totalOstave}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Vrednost stanova</div>
          <div class="stat-value accent">${fmtEur(totalVrednost)}</div>
        </div>
      </div>
      
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Lista vlasnika parcela</div>
          <div style="font-size:12px; color:var(--text-dim);">Klikni na vlasnika za detalje</div>
        </div>
        <div class="table-wrap" style="border:none; border-radius:0;">
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Vlasnik</th>
                  <th class="center">Stanova</th>
                  <th class="num">m² stanova</th>
                  <th class="center">Garaža</th>
                  <th class="center">Ostava</th>
                  <th class="num">Vrednost stanova</th>
                </tr>
              </thead>
              <tbody>
                ${vlasnici.length === 0 ? '<tr><td colspan="6"><div class="empty-state">Nema vlasnika parcela</div></td></tr>' :
                  vlasnici.map(v => `
                    <tr onclick="openVlasnikProfile('${getCustomerKey(v.ime)}')">
                      <td><strong>${v.ime}</strong></td>
                      <td class="center">${v.broj_stanova}</td>
                      <td class="num">${fmtNum(v.ukupno_kvadrata_stanovi)} m²</td>
                      <td class="center">${v.broj_garaza || '—'}</td>
                      <td class="center">${v.broj_ostava || '—'}</td>
                      <td class="num">${fmtEur(v.vrednost_stanova)}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function openVlasnikProfile(key) {
  const vlasnici = getAllVlasnici();
  const v = vlasnici.find(x => getCustomerKey(x.ime) === key);
  if (!v) return;
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '900px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">${v.ime}</div>
        <div class="modal-title-sub" style="color:#c4b5fd;">Vlasnik parcele</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div style="background:linear-gradient(135deg, rgba(167,139,250,0.15), rgba(196,181,253,0.05)); padding:16px; border-radius:10px; margin-bottom:20px; border:1px solid rgba(167,139,250,0.3);">
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;">
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Stanova</div>
            <div style="font-size:22px; font-weight:700;">${v.broj_stanova}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">m² stanova</div>
            <div style="font-size:22px; font-weight:700; color:#c4b5fd;">${fmtNum(v.ukupno_kvadrata_stanovi)}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Garaža</div>
            <div style="font-size:22px; font-weight:700;">${v.broj_garaza}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:11px; text-transform:uppercase;">Ostava</div>
            <div style="font-size:22px; font-weight:700;">${v.broj_ostava}</div>
          </div>
        </div>
      </div>
      
      ${v.stanovi.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">🏠 Stanovi (${v.broj_stanova}) · ${fmtNum(v.ukupno_kvadrata_stanovi)} m²</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          ${v.stanovi.map(s => `
            <div onclick="closeModal(); setTimeout(() => openApartment('${s.lamela}', ${s.stan}), 100);" style="padding:12px 14px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:80px 1fr auto; gap:12px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:#c4b5fd;">${s.lamela}-${s.stan}</strong>
              <div>
                <div>${s.sprat || ''}</div>
                <div style="font-size:12px; color:var(--text-dim);">${fmtNum(s.povrsina)} m² · ${fmtEur(s.vrednost_sa_pdv)}</div>
              </div>
              <div style="color:var(--text-dim); font-size:18px;">→</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${v.garaze.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">🚗 Garaže (${v.broj_garaza}) · ${fmtNum(v.ukupno_kvadrata_garaze)} m²</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          ${v.garaze.map(g => `
            <div onclick="closeModal(); setTimeout(() => openGarage(${g.broj}), 100);" style="padding:12px 14px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:80px 1fr auto; gap:12px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:#c4b5fd;">G-${g.broj}</strong>
              <div>
                <div>Nivo ${getGarageLevel(g.broj)}</div>
                <div style="font-size:12px; color:var(--text-dim);">${fmtNum(g.povrsina)} m²</div>
              </div>
              <div style="color:var(--text-dim); font-size:18px;">→</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${v.ostave.length > 0 ? `
        <h3 style="font-size:14px; margin:20px 0 10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">📦 Ostave (${v.broj_ostava})</h3>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          ${v.ostave.map(o => `
            <div onclick="closeModal(); setTimeout(() => openOstava(${o._idx}), 100);" style="padding:12px 14px; border-bottom:1px solid var(--border); cursor:pointer; display:grid; grid-template-columns:80px 1fr auto; gap:12px; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <strong style="color:#c4b5fd;">${o.broj || '?'}</strong>
              <div>
                <div>Nivo ${o.nivo || ''}</div>
                <div style="font-size:12px; color:var(--text-dim);">${fmtNum(o.povrsina)} m²</div>
              </div>
              <div style="color:var(--text-dim); font-size:18px;">→</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

// ============================================
// "NOVA UPLATA" - univerzalni dijalog
// ============================================

function openNewPaymentDialog() {
  // Dialog: odaberi tip, pa stan/garažu/ostavu, pa iznos i datum
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '640px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Nova uplata</div>
        <div class="modal-title-sub">Evidencija nove uplate za kupca</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="form-field full">
          <label>Tip stavke</label>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
            <button type="button" id="pType_a" class="btn btn-secondary" onclick="setNewPaymentType('apartment')" style="padding:14px; flex-direction:column; gap:4px;">
              <span style="font-size:22px;">🏠</span>
              <span>Stan</span>
            </button>
            <button type="button" id="pType_g" class="btn btn-secondary" onclick="setNewPaymentType('garage')" style="padding:14px; flex-direction:column; gap:4px;">
              <span style="font-size:22px;">🚗</span>
              <span>Garaža</span>
            </button>
            <button type="button" id="pType_o" class="btn btn-secondary" onclick="setNewPaymentType('ostava')" style="padding:14px; flex-direction:column; gap:4px;">
              <span style="font-size:22px;">📦</span>
              <span>Ostava</span>
            </button>
          </div>
        </div>
        <div class="form-field full" id="newPaySelection" style="display:none;">
          <!-- Populated after type selection -->
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Otkaži</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

function setNewPaymentType(type) {
  // Highlight selected type
  ['a','g','o'].forEach(x => {
    const btn = document.getElementById(`pType_${x}`);
    if (btn) btn.className = 'btn btn-secondary';
  });
  const selKey = type === 'apartment' ? 'a' : (type === 'garage' ? 'g' : 'o');
  document.getElementById(`pType_${selKey}`).className = 'btn btn-primary';
  
  // Show sold items only
  let items = [];
  if (type === 'apartment') {
    items = DATA.apartments.filter(a => a.prodat).map(a => ({
      id: `${a.lamela}-${a.stan}`,
      label: `Stan ${a.lamela}-${a.stan}`,
      customer: a.ime || '(bez kupca)',
      sub: `${a.sprat || ''} · ${fmtNum(a.povrsina)}m² · Preostalo: ${fmtEur(a.preostalo)}`,
      lamela: a.lamela, stan: a.stan
    })).sort((a,b) => (a.customer || '').localeCompare(b.customer || '', 'sr'));
  } else if (type === 'garage') {
    items = DATA.garages.filter(g => g.prodat).map(g => ({
      id: `G-${g.broj}`,
      label: `Garaža G-${g.broj}`,
      customer: g.ime || '(bez kupca)',
      sub: `Nivo ${getGarageLevel(g.broj)} · ${fmtNum(g.povrsina)}m² · Preostalo: ${fmtEur(g.preostalo)}`,
      broj: g.broj
    })).sort((a,b) => (a.customer || '').localeCompare(b.customer || '', 'sr'));
  } else {
    items = DATA.ostave.map((o, idx) => ({ ...o, _idx: idx })).filter(o => o.prodat).map(o => ({
      id: `${o.broj}`,
      label: `Ostava ${o.broj || ''}`,
      customer: o.ime || '(bez kupca)',
      sub: `Nivo ${o.nivo || ''} · ${fmtNum(o.povrsina)}m² · Preostalo: ${fmtEur(o.preostalo)}`,
      idx: o._idx
    })).sort((a,b) => (a.customer || '').localeCompare(b.customer || '', 'sr'));
  }
  
  const sel = document.getElementById('newPaySelection');
  sel.style.display = 'block';
  
  // Build upcoming rates for quick access
  const upcoming = [];
  if (type === 'apartment') {
    items.forEach(it => {
      const apt = findApartment(it.lamela, it.stan);
      if (!apt) return;
      if (apt.plan_otplate?.rate) {
        apt.plan_otplate.rate.filter(r => !r.isplacena).forEach(r => {
          upcoming.push({ label: `${it.label} · ${it.customer}`, amount: r.iznos, desc: r.opis, date: r.datum, type, lamela: it.lamela, stan: it.stan });
        });
      }
      if (apt.planirane_rate) {
        Object.entries(apt.planirane_rate).forEach(([mk, amt]) => {
          upcoming.push({ label: `${it.label} · ${it.customer}`, amount: amt, desc: mk, type, lamela: it.lamela, stan: it.stan });
        });
      }
    });
  }
  upcoming.sort((a,b) => (a.date||a.desc||'').localeCompare(b.date||b.desc||''));
  const nextRates = upcoming.slice(0, 8);

  sel.innerHTML = `
    ${nextRates.length > 0 ? `
    <div style="margin-bottom:12px;">
      <div style="font-size:12px; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">⚡ Nadolazeće rate (klikni za brzu uplatu)</div>
      <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
        ${nextRates.map(r => `
          <div onclick="closeModal(); setTimeout(() => openQuickPayment('${r.type}','${r.lamela||''}',${r.stan||0},${r.amount},'${(r.desc||'').replace(/'/g,"\\'")}'), 100);" 
               style="padding:10px 12px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center;"
               onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
            <div>
              <div style="font-size:13px; font-weight:600;">${r.label}</div>
              <div style="font-size:11px; color:var(--text-dim);">${r.desc||''} ${r.date ? '· ' + fmtDate(r.date) : ''}</div>
            </div>
            <strong style="color:var(--accent); flex-shrink:0;">${fmtEur(r.amount)}</strong>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
    <label style="font-size:12px; font-weight:600; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">Sve stavke</label>
    <input type="text" placeholder="Pretraga..." oninput="filterPaymentTargets(this.value)" style="width:100%; padding:10px 12px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px; outline:none; margin:6px 0 8px;">
    <div id="payTargetList" style="max-height:260px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
      ${items.length === 0 ? '<div class="empty-state" style="padding:24px;">Nema prodatih stavki ovog tipa</div>' :
        items.map(it => {
          const clickFn = type === 'apartment' 
            ? `openQuickPayment('apartment','${it.lamela}',${it.stan},${0},'')`
            : type === 'garage'
              ? `openQuickPayment('garage',null,${it.broj},${0},'')`
              : `openQuickPayment('ostava',null,${it.idx},${0},'')`;
          return `
            <div class="pay-target" data-search="${(it.customer + ' ' + it.label).toLowerCase()}" onclick="closeModal(); setTimeout(()=>${clickFn},100);" style="padding:11px 14px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
              <div>
                <div style="font-weight:600; color:var(--accent);">${it.label} · ${it.customer}</div>
                <div style="font-size:12px; color:var(--text-dim);">${it.sub}</div>
              </div>
              <div style="color:var(--text-dim); font-size:18px;">→</div>
            </div>
          `;
        }).join('')
      }
    </div>
  `;
}

function filterPaymentTargets(q) {
  q = (q || '').toLowerCase();
  document.querySelectorAll('.pay-target').forEach(el => {
    const s = el.dataset.search || '';
    el.style.display = s.includes(q) ? '' : 'none';
  });
}

// ============================================
// DASHBOARD: Prodaja po mesecima
// ============================================
function renderUpcomingRatesPanel() {
  const now = new Date(); now.setHours(0,0,0,0);
  const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
  const nowKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const in7Key = `${in7.getFullYear()}-${String(in7.getMonth()+1).padStart(2,'0')}`;
  
  const upcoming = [];
  const months = ['Januar','Februar','Mart','April','Maj','Jun','Jul','Avgust','Septembar','Oktobar','Novembar','Decembar'];
  
  DATA.apartments.forEach(a => {
    if (!a.prodat || a.vlasnik_parcele) return;
    if (a.planirane_rate) {
      Object.entries(a.planirane_rate).forEach(([mk, amt]) => {
        if (mk >= nowKey && mk <= in7Key) {
          const [y,m] = mk.split('-');
          upcoming.push({ label: `Stan ${a.lamela}-${a.stan}`, customer: a.ime||'', amount: amt, dateLabel: `${months[parseInt(m)-1]} ${y}`, mk, type:'apartment', lamela:a.lamela, stan:a.stan });
        }
      });
    }
    if (a.plan_otplate?.rate) {
      a.plan_otplate.rate.forEach(r => {
        if (r.isplacena || !r.datum) return;
        const d = new Date(r.datum); d.setHours(0,0,0,0);
        if (d >= now && d <= in7) upcoming.push({ label: `Stan ${a.lamela}-${a.stan}`, customer: a.ime||'', amount: r.iznos, dateLabel: fmtDate(r.datum), desc: r.opis, type:'apartment', lamela:a.lamela, stan:a.stan });
      });
    }
  });
  
  if (upcoming.length === 0) return '';
  upcoming.sort((a,b) => (a.mk||a.dateLabel).localeCompare(b.mk||b.dateLabel));
  
  return `
    <div class="panel" style="margin-bottom:20px; border-color:var(--warning);">
      <div class="panel-header" style="background:linear-gradient(90deg,rgba(251,191,36,0.1),transparent);">
        <div class="panel-title" style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">🔔</span>
          Rate koje dospevaju u narednih 7 dana
          <span style="background:var(--warning); color:#1a2332; border-radius:10px; font-size:11px; font-weight:700; padding:1px 8px;">${upcoming.length}</span>
        </div>
        <button class="btn btn-ghost" style="font-size:12px;" onclick="switchView('kalendar')">Kalendar →</button>
      </div>
      <div>
        ${upcoming.map(u => `
          <div onclick="openQuickPayment('${u.type}','${u.lamela||''}',${u.stan||0},${u.amount},'${(u.desc||u.label||'').replace(/'/g,"\\'")}');" 
               style="padding:12px 16px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:12px;"
               onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
            <div>
              <div style="font-weight:600; font-size:14px;">${u.customer || u.label}</div>
              <div style="font-size:12px; color:var(--text-dim);">${u.label}${u.desc ? ' · ' + u.desc : ''}</div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
              <div style="font-weight:700; color:var(--warning);">${fmtEur(u.amount)}</div>
              <div style="font-size:11px; color:var(--text-dim);">${u.dateLabel}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMonthlySalesChart() {
  const now = new Date();
  const year = now.getFullYear();
  const months = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Avg','Sep','Okt','Nov','Dec'];
  
  // Count sales per month (by datum_prodaje)
  const salesByMonth = new Array(12).fill(0);
  const revenueByMonth = new Array(12).fill(0);
  
  const allItems = [
    ...DATA.apartments.map(a => ({ datum: a.datum_prodaje, val: a.vrednost_sa_pdv })),
    ...(DATA.garages || []).map(g => ({ datum: g.datum_prodaje, val: g.vrednost })),
    ...(DATA.ostave || []).map(o => ({ datum: o.datum_prodaje, val: o.vrednost }))
  ];
  
  allItems.forEach(item => {
    if (!item.datum) return;
    const d = new Date(item.datum);
    if (d.getFullYear() !== year) return;
    salesByMonth[d.getMonth()]++;
    revenueByMonth[d.getMonth()] += item.val || 0;
  });
  
  const totalSalesYear = salesByMonth.reduce((s,v) => s+v, 0);
  const totalRevenueYear = revenueByMonth.reduce((s,v) => s+v, 0);
  
  if (totalSalesYear === 0) return ''; // Don't show empty chart
  
  const maxSales = Math.max(...salesByMonth, 1);
  const maxRevenue = Math.max(...revenueByMonth, 1);
  const currentMonth = now.getMonth();
  
  return `
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-header">
        <div class="panel-title">🏷️ Prodaja po mesecima ${year}</div>
        <div style="font-size:12px; color:var(--text-dim);">${totalSalesYear} prodaja · ${fmtEur(totalRevenueYear)}</div>
      </div>
      <div style="padding:16px;">
        <div style="display:grid; grid-template-columns:repeat(12,1fr); gap:4px; align-items:end; height:110px; margin-bottom:8px;">
          ${months.map((m, i) => {
            const sales = salesByMonth[i];
            const rev = revenueByMonth[i];
            const hPct = Math.round((sales / maxSales) * 100);
            const isCurrent = i === currentMonth;
            const isToday = isCurrent;
            return `
              <div style="display:flex; flex-direction:column; align-items:center; gap:3px; height:100%;" title="${m}: ${sales} prodaja · ${fmtEur(rev)}">
                <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end; width:100%;">
                  ${sales > 0 ? '<div style="font-size:9px; font-weight:700; text-align:center; color:' + (isCurrent ? 'var(--accent)' : 'var(--success)') + '; margin-bottom:2px;">' + sales + '</div>' : ''}
                  <div style="width:100%; height:${hPct}%; min-height:${sales>0?'4px':'0'}; background:${isCurrent ? 'linear-gradient(to top, var(--accent), #e3b584)' : 'linear-gradient(to top, #22c55e, #4ade80)'}; border-radius:3px 3px 0 0; transition:height 0.3s;"></div>
                </div>
                <div style="font-size:9px; color:${isCurrent ? 'var(--accent)' : 'var(--text-dim)'}; font-weight:${isCurrent ? '700' : '400'};">${m}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; font-size:11px; color:var(--text-dim);">
          <span>🟢 Realizovane prodaje po mesecima</span>
          <span>Trenutni mesec: <strong style="color:var(--accent);">${fmtEur(revenueByMonth[currentMonth])}</strong></span>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// ACTIVITY LOG (Dnevnik izmena)
// ============================================
function renderActivity(c) {
  const log = DATA.activity_log || [];
  
  const actionIcons = {
    'PRODAJA': '🔑', 'UPLATA': '💰', 'PRIZNANICA': '🧾',
    'IZMENA': '✏️', 'BRISANJE': '🗑️', 'TELEFON': '📞',
    'DOKUMENT': '📄', 'PLAN': '📋', 'PONIŠTENA_PRODAJA': '↩️',
    'LOGIN': '🔐', 'SISTEM': '⚙️'
  };
  
  const actionColors = {
    'PRODAJA': 'var(--success)', 'UPLATA': 'var(--accent)',
    'PRIZNANICA': '#a78bfa', 'IZMENA': 'var(--warning)',
    'BRISANJE': 'var(--danger)', 'PONIŠTENA_PRODAJA': 'var(--warning)',
    'LOGIN': 'var(--text-dim)', 'SISTEM': 'var(--text-dim)'
  };
  
  // Group by date
  const byDate = {};
  log.forEach(e => {
    const d = new Date(e.ts);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(e);
  });
  
  const sortedDates = Object.keys(byDate).sort().reverse();
  
  c.innerHTML = `
    <div style="max-width:900px; margin:0 auto;">
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card">
          <div class="stat-label">Ukupno akcija</div>
          <div class="stat-value">${log.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Prodaja</div>
          <div class="stat-value success">${log.filter(e=>e.action==='PRODAJA').length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uplate</div>
          <div class="stat-value accent">${log.filter(e=>e.action==='UPLATA').length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Izmene</div>
          <div class="stat-value">${log.filter(e=>e.action==='IZMENA').length}</div>
        </div>
      </div>
      
      ${log.length === 0 ? `
        <div class="panel">
          <div class="empty-state" style="padding:60px;">Još nema zabeleženih aktivnosti. Dnevnik se popunjava automatski pri svakoj prodaji, uplati ili izmeni.</div>
        </div>
      ` : sortedDates.map(dateKey => {
        const entries = byDate[dateKey];
        const d = new Date(dateKey);
        const months = ['januar','februar','mart','april','maj','jun','jul','avgust','septembar','oktobar','novembar','decembar'];
        const dateLabel = `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
        return `
          <div class="panel" style="margin-bottom:12px;">
            <div class="panel-header" style="background:var(--surface-2);">
              <div class="panel-title" style="font-size:13px;">${dateLabel}</div>
              <div style="font-size:12px; color:var(--text-dim);">${entries.length} ${entries.length===1?'akcija':'akcija'}</div>
            </div>
            <div>
              ${entries.map(e => {
                const t = new Date(e.ts);
                const timeStr = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
                const icon = actionIcons[e.action] || '•';
                const color = actionColors[e.action] || 'var(--text-dim)';
                return `
                  <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 16px; border-bottom:1px solid var(--border);">
                    <div style="font-size:18px; flex-shrink:0; margin-top:1px;">${icon}</div>
                    <div style="flex:1; min-width:0;">
                      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <span style="font-size:12px; font-weight:700; color:${color}; text-transform:uppercase;">${e.action}</span>
                        <span style="font-size:12px; color:var(--text-dim);">${timeStr}</span>
                        <span style="font-size:11px; color:var(--text-dim);">·</span>
                        <span style="font-size:11px; color:var(--text-dim);">${e.user || 'sistem'}</span>
                      </div>
                      <div style="font-size:13px; margin-top:2px; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e.details || ''}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

init();
