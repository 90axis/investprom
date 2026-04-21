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
  
  // Show loading spinner while syncing
  const content = document.getElementById('content');
  if (content) content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:16px;"><div style="width:40px;height:40px;border:3px solid var(--surface-3);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;"></div><div style="color:var(--text-dim);">Učitavanje podataka...</div></div>';
  
  switchView('dashboard');
  
  if (_isOnline) {
    syncFromSupabase().then(() => {
      renderView();
      updateNotificationBadge();
    }).catch(() => {
      renderView();
    });
  } else {
    renderView();
  }
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
  const titleEl = document.getElementById('pageTitle');
  if (view === 'dashboard') {
    titleEl.innerHTML = '<img src="data:image/png;base64,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" alt="Invest Prom" style="height:32px; object-fit:contain; vertical-align:middle;">';
  } else {
    titleEl.textContent = titles[view] || view;
  }
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
  
  // Očekivane uplate u tekućem mesecu
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let expectedThisMonth = 0;
  const processForExpected = (item) => {
    if (item.vlasnik_parcele) return;
    if (item.planirane_rate && item.planirane_rate[currentMonthKey]) {
      expectedThisMonth += item.planirane_rate[currentMonthKey];
    }
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum || rata.isplacena) return;
        const mk = rata.datum.substring(0,7);
        if (mk === currentMonthKey) expectedThisMonth += rata.iznos || 0;
      });
    }
  };
  apts.forEach(processForExpected);
  gar.forEach(processForExpected);
  ost.forEach(processForExpected);
  
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
      <div class="stat-card" style="border-color:var(--warning, #f0a500); cursor:pointer;" onclick="showExpectedThisMonth()" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
        <div class="stat-label">Očekivane uplate (${now.toLocaleString('sr-Latn', {month:'long'})})</div>
        <div class="stat-value" style="color:var(--warning, #f0a500);">${fmtEur(expectedThisMonth)}</div>
        <div class="stat-sub">planirane rate za tekući mesec · klikni za detalje</div>
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
        // Koristimo string substring da izbegnemo timezone bug
        const rYear = parseInt(rata.datum.substring(0, 4));
        const rMonth = parseInt(rata.datum.substring(5, 7)) - 1;
        if (rYear === year) {
          expected[rMonth] += rata.iznos || 0;
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
          <input type="number" step="0.1" id="f_pdv_pct" value="${a.pdv_pct ?? 10}" min="0" max="100" oninput="recalcApartment()">
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
  const pdvPct = parseFloat(document.getElementById('f_pdv_pct')?.value) ?? 10;
  
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
    pdv_pct: parseFloat(document.getElementById('f_pdv_pct')?.value) ?? 10,
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
  
  // Save to Supabase - insert payment directly by lamela/stan lookup
  if (_isOnline) {
    sbUpsertApartment(a).then(() => {
      const sb = getSupabase();
      if (!sb || !a._id) return;
      sb.from('apartment_payments').insert({
        apartment_id: a._id,
        month_key: monthKey,
        amount: receiptAmount,
        payment_date: date || null,
        tip: 'uplata'
      }).then(({error}) => { if(error) console.error('payment insert', error.message); });
    }).catch(()=>{});
  }
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
  const byMonth = {};
  
  const addToMonth = (monthKey, entry) => {
    if (!byMonth[monthKey]) byMonth[monthKey] = { actualPaid: 0, expected: 0, entries: [] };
    byMonth[monthKey].entries.push(entry);
  };
  
  const processItem = (item, label, customer) => {
    if (item.vlasnik_parcele) return;
    
    if (item.uplate) {
      Object.entries(item.uplate).forEach(([mk, amt]) => {
        const key = mk.substring(0,7);
        if (!byMonth[key]) byMonth[key] = { actualPaid: 0, expected: 0, entries: [] };
        byMonth[key].actualPaid += amt;
        byMonth[key].entries.push({ type: 'paid', item: label, customer, amount: amt, source: 'Naplaćeno' });
      });
    }
    
    if (item.planirane_rate) {
      Object.entries(item.planirane_rate).forEach(([mk, amt]) => {
        const key = mk.substring(0,7);
        if (!byMonth[key]) byMonth[key] = { actualPaid: 0, expected: 0, entries: [] };
        byMonth[key].expected += amt;
        byMonth[key].entries.push({ type: 'planned', item: label, customer, amount: amt, source: 'Plan iz Excela' });
      });
    }
    
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum) return;
        // Koristimo string substring da izbegnemo timezone bug
        const mk = rata.datum.substring(0, 7);
        if (!byMonth[mk]) byMonth[mk] = { actualPaid: 0, expected: 0, entries: [] };
        if (rata.isplacena) {
          // isplacena rata je vec u item.uplate mapi — ne broji dvostruko
          // samo je prikazujemo kao planned-paid za informaciju
        } else {
          byMonth[mk].expected += rata.iznos || 0;
          byMonth[mk].entries.push({
            type: 'planned',
            item: label, customer, amount: rata.iznos || 0,
            source: rata.opis || 'Plan otplate'
          });
        }
      });
    }
  };
  
  DATA.apartments.forEach(a => processItem(a, `Stan ${a.lamela}-${a.stan}`, a.ime || '—'));
  (DATA.garages || []).forEach(g => processItem(g, `Garaža G-${g.broj}`, g.ime || '—'));
  (DATA.ostave || []).forEach(o => processItem(o, `Ostava ${o.broj || ''}`, o.ime || '—'));
  
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  
  // Always show current month + 3 months ahead
  const highlightKeys = [currentKey];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    highlightKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  highlightKeys.forEach(k => {
    if (!byMonth[k]) byMonth[k] = { actualPaid: 0, expected: 0, entries: [] };
  });
  
  // Ensure all months from 2024 to 2030 exist so calendar is complete
  const startYear = 2025;
  const endYear = 2029;
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2,'0')}`;
      if (!byMonth[key]) byMonth[key] = { actualPaid: 0, expected: 0, entries: [] };
    }
  }
  
  const sortedKeys = Object.keys(byMonth).sort();
  
  let sum4MonthsExpected = 0, sum4MonthsPaid = 0;
  highlightKeys.forEach(k => {
    const m = byMonth[k];
    if (m) { sum4MonthsExpected += m.expected + m.actualPaid; sum4MonthsPaid += m.actualPaid; }
  });
  
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
  
  // Separate planned paid vs unexpected paid
  // plannedPaid = payments that correspond to planirane_rate entries
  // unexpectedPaid = payments with no corresponding plan
  const plannedEntries = data.entries ? data.entries.filter(e => e.type === 'planned') : [];
  const paidEntries = data.entries ? data.entries.filter(e => e.type === 'paid') : [];
  const plannedTotal = plannedEntries.reduce((s,e) => s + e.amount, 0);
  const paidTotal = paidEntries.reduce((s,e) => s + e.amount, 0);
  
  // Paid against plan vs unexpected
  const paidAgainstPlan = Math.min(paidTotal, plannedTotal);
  const unexpectedAmount = Math.max(0, paidTotal - plannedTotal);
  
  const hasPlanned = expected > 0 || plannedTotal > 0;
  const hasUnexpected = unexpectedAmount > 0 && expected === 0 && plannedTotal === 0;
  const hasMixed = unexpectedAmount > 0 && (expected > 0 || plannedTotal > 0);
  
  const total = paid + expected;
  const paidPct = (paid + expected) > 0 ? Math.round(paid/(paid+expected)*100) : 0;
  const entriesCount = data.entries ? data.entries.filter(e => e.amount > 0).length : 0;
  
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
        ${hasMixed ? `
          <!-- Mixed: planned + unexpected - show two bars -->
          <div style="height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-bottom:2px;">
            <div style="height:100%; width:${paidPct}%; background:linear-gradient(to right, #22c55e, #4ade80);"></div>
          </div>
          <div style="height:4px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-bottom:4px;">
            <div style="height:100%; width:100%; background:linear-gradient(to right, #3b82f6, #60a5fa); opacity:0.7;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px;">
            <span style="color:var(--success);">${fmtEur(paid)}</span>
            <span style="color:var(--accent);">${fmtEur(expected)}</span>
          </div>
          <div style="font-size:9px; color:#60a5fa; margin-top:2px;">⚡ sadrži neočekivane uplate</div>
        ` : hasUnexpected ? `
          <!-- Only unexpected -->
          <div style="height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-bottom:4px;">
            <div style="height:100%; width:100%; background:linear-gradient(to right, #3b82f6, #60a5fa);"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px;">
            <span style="color:#60a5fa;">⚡ ${fmtEur(paid)}</span>
            <span style="color:var(--text-dim); font-style:italic;">neočekivano</span>
          </div>
        ` : `
          <!-- Only planned -->
          <div style="height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-bottom:4px;">
            <div style="height:100%; width:${paidPct}%; background:linear-gradient(to right, #22c55e, #4ade80);"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px;">
            <span style="color:var(--success);">${fmtEur(paid)}</span>
            <span style="color:${expected > 0 ? 'var(--accent)' : 'var(--text-dim)'};">${fmtEur(expected)}</span>
          </div>
        `}
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
        // Koristimo string substring da izbegnemo timezone bug
        const k = rata.datum.substring(0, 7);
        if (k === monthKey) {
          if (rata.isplacena) {
            // isplacena rata je vec u item.uplate mapi — ne broji dvostruko
          } else {
            plannedEntries.push({
              label, customer, amount: rata.iznos || 0,
              source: rata.opis || 'Plan otplate', onclickJs
            });
          }
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


// ============================================
// MODAL: Očekivane uplate tekućeg meseca
// ============================================
function showExpectedThisMonth() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthName = now.toLocaleString('sr-Latn', {month:'long', year:'numeric'});
  
  const entries = [];
  
  const collectItem = (item, label, customer, onclickJs) => {
    if (item.vlasnik_parcele) return;
    // planirane_rate
    if (item.planirane_rate && item.planirane_rate[currentMonthKey]) {
      entries.push({
        label, customer, amount: item.planirane_rate[currentMonthKey],
        source: 'Plan', onclickJs
      });
    }
    // plan_otplate - samo neplaćene
    if (item.plan_otplate && item.plan_otplate.rate) {
      item.plan_otplate.rate.forEach(rata => {
        if (!rata.datum || rata.isplacena) return;
        if (rata.datum.substring(0,7) === currentMonthKey) {
          entries.push({
            label, customer, amount: rata.iznos || 0,
            source: rata.opis || 'Plan otplate', onclickJs
          });
        }
      });
    }
  };
  
  DATA.apartments.forEach(a => {
    const imaAktivanPlan = a.plan_otplate && a.plan_otplate.rate && a.plan_otplate.rate.length > 0;
    if (!a.prodat && !imaAktivanPlan) return;
    collectItem(a, `Stan ${a.lamela}-${a.stan}`, a.ime || '—',
      `openApartment('${a.lamela}', ${a.stan})`);
  });
  (DATA.garages || []).forEach(g => {
    if (!g.prodat) return;
    collectItem(g, `Garaža G-${g.broj}`, g.ime || '—',
      `openGarage(${g.broj})`);
  });
  (DATA.ostave || []).forEach((o, idx) => {
    if (!o.prodat) return;
    collectItem(o, `Ostava ${o.broj || ''}`, o.ime || '—',
      `openOstava(${idx})`);
  });
  
  entries.sort((a,b) => b.amount - a.amount);
  const total = entries.reduce((s,e) => s + e.amount, 0);
  
  const m = document.getElementById('modalContent');
  m.style.maxWidth = '700px';
  m.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="modal-title">Očekivane uplate</div>
        <div class="modal-title-sub">${monthName} · ${entries.length} rata</div>
      </div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div style="background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.4); padding:14px 16px; border-radius:10px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:13px; color:var(--text-dim);">Ukupno očekivano</div>
        <div style="font-size:22px; font-weight:700; color:var(--warning);">${fmtEur(total)}</div>
      </div>
      ${entries.length === 0 ? '<div class="empty-state" style="padding:40px;">Nema planiranih rata za ovaj mesec</div>' : `
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          <table class="data-table" style="background:transparent; margin:0;">
            <thead>
              <tr>
                <th>Stavka</th>
                <th>Kupac</th>
                <th>Opis</th>
                <th class="num">Iznos</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(e => `
                <tr onclick="closeModal(); setTimeout(() => ${e.onclickJs}, 100);" style="cursor:pointer;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
                  <td><strong style="color:var(--accent);">${e.label}</strong></td>
                  <td>${e.customer}</td>
                  <td style="font-size:12px; color:var(--text-dim);">${e.source}</td>
                  <td class="num" style="color:var(--warning); font-weight:600;">${fmtEur(e.amount)}</td>
                </tr>
              `).join('')}
              <tr style="background:var(--surface-3);">
                <td colspan="3" style="font-weight:700;">UKUPNO</td>
                <td class="num" style="color:var(--warning); font-weight:700; font-size:15px;">${fmtEur(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Zatvori</button>
      <button class="btn btn-ghost" onclick="closeModal(); switchView('kalendar')">Kalendar →</button>
    </div>
  `;
  document.getElementById('modal').classList.add('active');
}

init();
