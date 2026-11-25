// Billfish Log — offline-first catch log for billfish crews.
// Data flow: every save goes to a local outbox first (localStorage), then uploads to Supabase when there is signal.
// Each boat's catches are cached on the device so the log opens and works with no connection.
import { SUPABASE_URL, SUPABASE_ANON_KEY, PILOT_BOAT_ONLY, APP_NAME } from './config.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ------------------------------------------------------------------ constants
const LISTS = {
  species: ['Blue Marlin', 'White Marlin', 'Sailfish', 'Spearfish', 'Swordfish', 'Other Billfish'],
  result: ['Released', 'Tagged & Released', 'Boated', 'Lost', 'Missed Bite'],
  spread: ['Short Rigger', 'Long Rigger', 'Short Corner', 'Long Corner', 'Flat Line', 'Center Rigger / Shotgun', 'Teaser'],
  lure_type: ['Artificial Lure', 'Ballyhoo', 'Live Bait', 'Dead Bait', 'Fly', 'Other'],
  tide: ['Incoming / Flood', 'Outgoing / Ebb', 'High Slack', 'Low Slack'],
  omni: ['Marked fish', 'Marked bait only', 'No mark', 'Not using Omni'],
  seas: ['Calm', 'Light Chop', 'Moderate', 'Rough'],
};
// Export columns: same order as the original "Catch Log" spreadsheet, plus GPS.
const FIELDS = [
  ['catch_date', 'Date'], ['bite_time', 'Time of Bite'], ['species', 'Species'], ['result', 'Result'], ['angler', 'Angler'],
  ['spread', 'Spread Position'], ['lure_type', 'Lure / Bait Type'], ['lure_name', 'Lure Name / Colour'], ['tide', 'Tide'],
  ['location', 'Location / Area'], ['depth_ft', 'Depth (ft)'], ['water_temp_f', 'Water Temp (°F)'], ['omni', 'Omni Sonar'],
  ['fight_min', 'Fight Time (min)'], ['weight_lb', 'Est. Weight (lb)'], ['seas', 'Sea Conditions'], ['notes', 'Notes'],
  ['lat', 'Latitude'], ['lng', 'Longitude'],
];
const MUST = [['species', 'species'], ['spread', 'spread'], ['lure_type', 'lure type'], ['tide', 'tide']];
const CHIP_FIELDS = ['species', 'result', 'angler', 'spread', 'lure_type', 'tide', 'omni', 'seas'];
const TEXT_FIELDS = ['lure_name', 'location', 'depth_ft', 'water_temp_f', 'fight_min', 'weight_lb', 'notes'];
const NUMS = { depth_ft: [0, 40000, 'Depth'], water_temp_f: [20, 120, 'Water temp'], fight_min: [0, 1440, 'Fight time'], weight_lb: [0, 3000, 'Weight'] };
const MAXLEN = { species: 60, result: 60, angler: 60, spread: 60, lure_type: 60, lure_name: 120, tide: 60, location: 120, omni: 60, seas: 60, notes: 2000 };
const CARRY = ['tide', 'location', 'water_temp_f', 'seas'];
const ROW_COLS = ['id', 'boat_id', 'catch_date', 'bite_time', 'species', 'result', 'angler', 'spread', 'lure_type', 'lure_name', 'tide',
  'location', 'lat', 'lng', 'depth_ft', 'water_temp_f', 'omni', 'fight_min', 'weight_lb', 'seas', 'notes', 'deleted_at'];
const RESULT_CLASS = { 'Released': 'good', 'Tagged & Released': 'good', 'Boated': 'blue', 'Lost': 'warn', 'Missed Bite': '' };
const LIST_PAGE = 150;
// What's in a photo: the billfish species plus the other fish the crew lands offshore.
const FISH = ['Blue Marlin', 'White Marlin', 'Sailfish', 'Spearfish', 'Swordfish', 'Mahi-Mahi', 'Yellowfin Tuna',
  'Blackfin Tuna', 'Bluefin Tuna', 'Wahoo', 'King Mackerel', 'Other'];
const PHOTO_BUCKET = 'catch-photos';
const PHOTO_COLS = ['id', 'boat_id', 'catch_id', 'day_id', 'path', 'thumb_path', 'width', 'height', 'fish', 'caption', 'taken_at', 'deleted_at'];
// Fishing days (everything that isn't a billfish bite)
const DAY_TYPES = ['Offshore trolling', 'Bottom fishing', 'Live bait / kite', 'Jigging', 'Inshore', 'Other'];
const DAY_FISH = ['Mahi-Mahi', 'Yellowfin Tuna', 'Blackfin Tuna', 'Wahoo', 'King Mackerel', 'Amberjack', 'Grouper', 'Snapper', 'Cobia', 'Triggerfish'];
const DAY_COLS = ['id', 'boat_id', 'day_date', 'fishing_type', 'location', 'crew', 'seas', 'water_temp_f', 'catches', 'notes', 'deleted_at'];

// ------------------------------------------------------------------ local storage
let storageWarned = false;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { if (!storageWarned) { storageWarned = true; toast('This device is out of storage space for the log. Free up space so offline bites are kept.'); } return false; }
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const K = {
  lastUser: 'bl1.lastUser',
  installDismissed: 'bl1.installDismissed',
  pendingJoin: 'bl1.pendingJoin',
  boats: u => `bl1.u.${u}.boats`,
  boatId: u => `bl1.u.${u}.boatId`,
  outbox: u => `bl1.u.${u}.outbox`,
  profile: u => `bl1.u.${u}.profile`,
  draft: u => `bl1.u.${u}.draft`,
  rows: b => `bl1.b.${b}.rows`,
  cursor: b => `bl1.b.${b}.cursor`,
  crew: b => `bl1.b.${b}.crew`,
  photos: b => `bl1.b.${b}.photos`,
  pcursor: b => `bl1.b.${b}.pcursor`,
  days: b => `bl1.b.${b}.days`,
  dcursor: b => `bl1.b.${b}.dcursor`,
  photoOutbox: u => `bl1.u.${u}.photoOutbox`,
  dayOutbox: u => `bl1.u.${u}.dayOutbox`,
  dayDraft: u => `bl1.u.${u}.dayDraft`,
};

// ------------------------------------------------------------------ state
const S = {
  sb: null, user: null, authOffline: false, profile: null,
  boats: [], boatId: null, crew: [], rows: new Map(), outbox: [],
  view: 'log', range: 'season', listLimit: LIST_PAGE,
  syncing: false, syncAgain: false, lastSyncAt: null, lastSyncErr: null,
  channel: null, flashId: null, form: null, pendingJoin: null, installEvt: null,
  authMode: 'in', signingInFor: null, recovery: false, signoutArmed: false,
  reauth: false, ready: false, gen: 0, authLinkErr: null,
  photos: new Map(), photoOutbox: [], days: new Map(), dayOutbox: [], dayForm: null, pv: null, adding: 0, uploadingPhotoId: null,
};

// ------------------------------------------------------------------ small helpers
const s = v => (v == null ? '' : String(v));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(s(t)); return m ? `${pad(+m[1])}:${m[2]}` : ''; };
const parseTs = t => Date.parse(s(t).replace(/(\.\d{3})\d+/, '$1'));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const fmtCode = c => { const x = s(c).toUpperCase(); return x.length === 8 ? `${x.slice(0, 4)}-${x.slice(4)}` : x; };
const curBoat = () => S.boats.find(b => b.id === S.boatId) || null;
const isCaptain = () => curBoat()?.role === 'captain';

function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s(t)); if (!m) return '';
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}`;
}
function fmtDate(iso, long) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(iso)); if (!m) return s(iso) || 'No date';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const base = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  if (iso === todayISO()) return long ? base : 'Today';
  if (iso === isoDate(y)) return long ? base : 'Yesterday';
  return base;
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
let toastTimer = null;
function toast(msg, ms = 3400) {
  const t = $('#toast'); t.textContent = ''; t.classList.remove('off');
  requestAnimationFrame(() => { t.textContent = msg; }); // set after a frame so screen readers announce it
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.add('off'); }, ms);
}
function setMsg(sel, text, kind) { const el = $(sel); el.textContent = text || ''; el.className = 'form-msg' + (kind ? ' ' + kind : ''); }
function isNetErr(e) {
  if (!e) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.name === 'AuthRetryableFetchError') return true;
  const m = s(e.message || e.error_description || e);
  return /fetch|network|load failed|timed? ?out|offline|connection/i.test(m) || e.status === 0 || e.code === '' || (e.status === undefined && e.code === undefined && /TypeError/.test(s(e.name)));
}
function friendly(e) {
  if (!e) return 'Something went wrong. Try again.';
  if (isNetErr(e)) return 'No connection right now. Try again when you have signal.';
  const m = s(e.message || e.error_description || e);
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them and try again.";
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we emailed you, then sign in.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'There is already an account with that email. Sign in instead.';
  if (/password.*(at least|characters)|weak password/i.test(m)) return 'Use a password of at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries in a short time. Wait a few minutes and try again.';
  if (/valid email|invalid.*email|email.*invalid/i.test(m)) return 'Enter a full email address, like name@example.com.';
  if (/jwt|token.*expired|not authenticated|sign in first/i.test(m)) return 'Your sign-in expired. Sign in again.';
  if (/row-level security|permission denied|violates row/i.test(m)) return "You don't have permission to change that on this boat.";
  if (/violates check constraint/i.test(m)) return 'One of the numbers is out of range. Check depth, water temp, fight time and weight.';
  return m.length < 160 ? m : 'Something went wrong. Try again.';
}
const timeoutSignal = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
function q(builder, ms = 20000) { const sig = timeoutSignal(ms); return sig && builder.abortSignal ? builder.abortSignal(sig) : builder; }

// ------------------------------------------------------------------ cache load / save
function loadUserCache(uid) {
  S.boats = LS.get(K.boats(uid), []) || [];
  S.profile = LS.get(K.profile(uid), null);
  S.outbox = (LS.get(K.outbox(uid), []) || []).filter(o => o && o.id && o.row);
  S.photoOutbox = (LS.get(K.photoOutbox(uid), []) || []).filter(o => o && o.id && o.row);
  S.dayOutbox = (LS.get(K.dayOutbox(uid), []) || []).filter(o => o && o.id && o.row);
  const want = LS.get(K.boatId(uid), null);
  S.boatId = S.boats.some(b => b.id === want) ? want : (S.boats[0]?.id || null);
  loadBoatCache();
}
function loadBoatCache() {
  S.gen++;
  S.rows = new Map(Object.entries(S.boatId ? (LS.get(K.rows(S.boatId), {}) || {}) : {}));
  S.crew = S.boatId ? (LS.get(K.crew(S.boatId), []) || []) : [];
  S.photos = new Map(Object.entries(S.boatId ? (LS.get(K.photos(S.boatId), {}) || {}) : {}));
  S.days = new Map(Object.entries(S.boatId ? (LS.get(K.days(S.boatId), {}) || {}) : {}));
  S.listLimit = LIST_PAGE;
}
const saveRows = () => { if (S.boatId) LS.set(K.rows(S.boatId), Object.fromEntries(S.rows)); };
function saveOutbox() {
  if (!S.user) return true;
  if (LS.set(K.outbox(S.user.id), S.outbox)) return true;
  // Out of space: drop cached copies of the log (they re-download) to make room for un-uploaded bites.
  Object.keys(localStorage).filter(k => /^bl1\.b\./.test(k)).forEach(k => LS.del(k));
  return LS.set(K.outbox(S.user.id), S.outbox);
}
const boatIds = () => new Set(S.boats.map(b => b.id));
// Outbox items for boats this person is still on (others can never upload and are shown separately on the Boat tab).
const liveOutbox = () => { const ids = boatIds(); return S.outbox.filter(o => ids.has(o.boat_id) || !S.boats.length); };
const saveBoats = () => { if (S.user) { LS.set(K.boats(S.user.id), S.boats); LS.set(K.boatId(S.user.id), S.boatId); } };

function outboxMap() { const m = new Map(); S.outbox.forEach(o => m.set(o.id, o)); return m; }
function entries() {
  const ob = outboxMap();
  const m = new Map(S.rows);
  for (const o of S.outbox) if (o.boat_id === S.boatId) m.set(o.id, o.row);
  const out = [];
  for (const [id, r] of m) {
    if (!r || r.deleted_at) continue;
    const o = ob.get(id);
    out.push(Object.assign({}, r, { id, _pending: !!o, _error: o ? o.error : null }));
  }
  out.sort((a, b) => (s(b.catch_date) + hm(b.bite_time)).localeCompare(s(a.catch_date) + hm(a.bite_time)) || s(b.created_at).localeCompare(s(a.created_at)));
  return out;
}
const missing = e => MUST.filter(([k]) => !s(e[k]).trim()).map(([, l]) => l);

// ------------------------------------------------------------------ views
const MAIN_VIEWS = ['log', 'days', 'photos', 'summary', 'boat'];
function show(v) {
  S.view = v;
  const main = MAIN_VIEWS.includes(v);
  $('#v-loading').hidden = v !== 'loading';
  $('#v-auth').hidden = v !== 'auth';
  $('#v-onboard').hidden = v !== 'onboard';
  $('#main-head').hidden = !main;
  $('#tabs').hidden = !main;
  MAIN_VIEWS.forEach(x => { $('#v-' + x).hidden = v !== x; });
  $('#v-form').hidden = v !== 'form';
  $('#v-dayform').hidden = v !== 'dayform';
  $('#v-photo').hidden = v !== 'photo';
  $$('.tab').forEach(b => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  render();
}
function route() {
  if (!S.user) return show('auth');
  if (!S.boats.length) return show('onboard');
  if (!MAIN_VIEWS.includes(S.view) && !['form', 'dayform', 'photo'].includes(S.view)) return show('log');
  show(S.view);
}

function render() {
  if (MAIN_VIEWS.includes(S.view)) renderHeader();
  if (S.view === 'log') renderLog();
  else if (S.view === 'summary') renderSummary();
  else if (S.view === 'boat') renderBoat();
  else if (S.view === 'onboard') renderOnboard();
  else if (S.view === 'auth') renderAuth();
  else if (S.view === 'photos') renderPhotos();
  else if (S.view === 'days') renderDays();
  else if (S.view === 'photo') updatePhotoMeta();
}

// ------------------------------------------------------------------ header + status
function syncState() {
  const live = liveOutbox();
  const ids = boatIds();
  const extra = [...S.photoOutbox, ...S.dayOutbox].filter(o => ids.has(o.boat_id));
  const n = live.length + extra.length;
  const errs = live.filter(o => o.error).length + extra.filter(o => o.error).length;
  const be = live.filter(o => o.error).length, pe = S.photoOutbox.filter(o => o.error && ids.has(o.boat_id)).length, de = S.dayOutbox.filter(o => o.error && ids.has(o.boat_id)).length;
  const what = be && !pe && !de ? (be === 1 ? 'bite needs' : 'bites need') : pe && !be && !de ? (pe === 1 ? 'photo needs' : 'photos need') : de && !be && !pe ? (de === 1 ? 'fishing day needs' : 'fishing days need') : 'items need';
  const offline = navigator.onLine === false || S.authOffline || !S.sb || (!S.syncing && !!S.lastSyncErr && isNetErr(S.lastSyncErr));
  if (errs) return ['bad', `${errs} ${what} fixing`];
  if (offline) return [n ? 'wait' : 'bad', n ? `Offline · ${n} waiting` : 'Offline'];
  if (S.syncing) return ['wait', n ? `Uploading ${n}…` : 'Syncing…'];
  if (n) return ['wait', `${n} waiting to upload`];
  if (S.lastSyncErr) return ['bad', 'No signal · saved copy'];
  if (S.lastSyncAt) return ['ok', 'Synced'];
  return ['', 'Connecting…'];
}
function renderHeader() {
  const b = curBoat();
  $('#head-boat').textContent = b ? (b.name + (b.home_port ? ' · ' + b.home_port : '')) : '';
  $('#boat-switch').classList.toggle('static', PILOT_BOAT_ONLY);
  $('#head-title').textContent = S.view === 'summary' ? 'Summary' : S.view === 'boat' ? 'Boat & crew' : S.view === 'photos' ? 'Photos' : S.view === 'days' ? 'Fishing days' : 'Billfish log';
  const [cls, text] = syncState();
  $('#status').className = 'status ' + cls; $('#status-text').textContent = text;

  const ban = $('#banner'); ban.replaceChildren(); let msg = null;
  const errs = liveOutbox().filter(o => o.error);
  const bids = boatIds();
  const perr = S.photoOutbox.filter(o => o.error && bids.has(o.boat_id)), derr = S.dayOutbox.filter(o => o.error && bids.has(o.boat_id));
  if (errs.length) msg = [`${errs.length === 1 ? 'A bite' : errs.length + ' bites'} couldn't upload. `, `On the Billfish tab, tap the bite marked "Couldn't upload" to see why and fix it. It's kept on this phone until then.`];
  else if (derr.length) msg = [`${derr.length === 1 ? 'A fishing day' : derr.length + ' fishing days'} couldn't upload. `, `On the Fishing tab, tap the day marked "Couldn't upload" to see why.`];
  else if (perr.length) msg = [`${perr.length === 1 ? 'A photo' : perr.length + ' photos'} couldn't upload. `, `On the Photos tab, tap the photo marked "Couldn't upload" to see why.`];
  else if (S.authOffline && navigator.onLine !== false) msg = ['Signed out on the server. ', 'Your bites are safe on this phone. Sign in again to upload them.'];
  else if (S.lastSyncErr && navigator.onLine !== false && !S.syncing) msg = ['No signal right now. ', 'Keep logging. Bites are saved on this phone and upload when you get signal back.'];
  ban.hidden = !msg; if (msg) ban.append(h('b', { text: msg[0] }), msg[1]);
  if (msg && S.authOffline && navigator.onLine !== false) ban.append(' ', h('button', { class: 'link', type: 'button', text: 'Sign in', onclick: startReauth }));

  renderInstallBanner();
}

// ------------------------------------------------------------------ log view
function renderLog() {
  const all = entries();
  const t = todayISO(); const td = all.filter(e => e.catch_date === t);
  $('#today-date').textContent = fmtDate(t, true);
  $('#t-bites').textContent = td.length;
  $('#t-rel').textContent = td.filter(e => e.result === 'Released' || e.result === 'Tagged & Released').length;
  $('#t-boat').textContent = td.filter(e => e.result === 'Boated').length;
  $('#t-lost').textContent = td.filter(e => e.result === 'Lost' || e.result === 'Missed Bite').length;

  const area = $('#list-area'); area.replaceChildren();
  if (!all.length) {
    const first = !S.lastSyncAt && !S.lastSyncErr && navigator.onLine !== false && S.sb && !S.authOffline;
    area.append(h('div', { class: 'section-title', text: 'Bites' }),
      h('div', { class: 'empty' }, h('b', { text: first ? 'Loading the log…' : 'No bites logged yet' }),
        first ? "Bites from everyone on the boat show up here." : 'Tap Log a bite after the next fish, even a missed bite. Everyone on the boat sees the same log.'));
    return;
  }
  const counts = new Map(); all.forEach(e => counts.set(e.catch_date, (counts.get(e.catch_date) || 0) + 1));
  let cur = null, list = null;
  for (const e of all.slice(0, S.listLimit)) {
    if (e.catch_date !== cur) {
      cur = e.catch_date; const n = counts.get(cur);
      area.append(h('div', { class: 'section-title', text: `${fmtDate(cur)} · ${n} ${n === 1 ? 'bite' : 'bites'}` }));
      list = h('div', { class: 'list' }); area.append(list);
    }
    list.append(rowEl(e));
  }
  if (all.length > S.listLimit) area.append(h('button', { class: 'btn more', type: 'button', text: `Show older bites (${all.length - S.listLimit} more)`, onclick: () => { S.listLimit += LIST_PAGE * 2; renderLog(); } }));
}
function rowEl(e) {
  const tm = fmtTime(e.bite_time).split(' ');
  const det = [e.angler, e.spread, e.lure_type, e.lure_name, e.tide, e.location].map(s).filter(Boolean).join(' · ');
  const miss = missing(e);
  const pills = [];
  if (e.result) pills.push(h('span', { class: 'pill ' + (RESULT_CLASS[e.result] || ''), text: s(e.result) }));
  if (e._error) pills.push(h('span', { class: 'pill err', text: "Couldn't upload" }));
  else if (e._pending) pills.push(h('span', { class: 'pill sync', text: 'Not uploaded yet' }));
  if (miss.length) pills.push(h('span', { class: 'pill need', text: 'Missing ' + miss.join(', ') }));
  const np = photosFor(e.id).length;
  if (np) pills.push(h('span', { class: 'pill blue', text: np === 1 ? '1 photo' : `${np} photos` }));
  return h('button', { type: 'button', class: 'row' + (S.flashId === e.id ? ' flash' : ''), onclick: () => openForm(e.id) },
    h('div', { class: 't' }, tm[0] || '—', h('small', { text: tm[1] || '' })),
    h('div', { class: 'main' },
      h('div', { class: 'sp', text: s(e.species) || 'Species not set' }),
      det ? h('div', { class: 'det', text: det }) : null,
      pills.length ? h('div', { class: 'pills' }, pills) : null));
}

// ------------------------------------------------------------------ summary view
function inRange(e) {
  const t = todayISO(), d = s(e.catch_date);
  if (S.range === 'today') return d === t;
  if (S.range === 'week') { const w = new Date(); w.setDate(w.getDate() - 6); return d >= isoDate(w) && d <= t; }
  if (S.range === 'season') return d.startsWith(String(new Date().getFullYear()));
  return true;
}
function anglerOptions() {
  const b = curBoat();
  const set = Array.isArray(b?.settings?.anglers) && b.settings.anglers.length ? b.settings.anglers.map(s).filter(Boolean)
    : [...S.crew.map(c => s(c.name)).filter(Boolean), 'Guest'];
  return [...new Set(set)];
}
function renderSummary() {
  $('#season-btn').textContent = 'Season';
  $('#season-btn').setAttribute('aria-label', `${new Date().getFullYear()} season`);
  $$('#range button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === S.range)));
  const all = entries();
  const list = all.filter(inRange); const n = list.length;
  const count = (k, v) => list.filter(e => e[k] === v).length;
  const rel = count('result', 'Released') + count('result', 'Tagged & Released');
  const kp = $('#kpis'); kp.replaceChildren();
  [[n, 'Bites logged'], [rel, 'Released (incl. tagged)'], [n ? Math.round(rel / n * 100) + '%' : '—', 'Release rate'],
   [count('result', 'Boated'), 'Boated'], [count('result', 'Lost') + count('result', 'Missed Bite'), 'Lost / missed']]
    .forEach(([v, l]) => kp.append(h('div', { class: 'kpi' }, h('b', { text: String(v) }), h('span', { text: l }))));

  const br = $('#breaks'); br.replaceChildren();
  const block = (title, key, opts, topOnly) => {
    const counts = new Map(); (opts || []).forEach(o => counts.set(o, 0));
    list.forEach(e => { const v = s(e[key]).trim(); if (v) counts.set(v, (counts.get(v) || 0) + 1); });
    let rows = [...counts];
    if (topOnly) rows = rows.sort((a, b) => b[1] - a[1]).slice(0, 8);
    const notSet = list.filter(e => !s(e[key]).trim()).length;
    const max = Math.max(1, ...rows.map(r => r[1]));
    const box = h('div', { class: 'brk' }, h('h3', { text: title }));
    if (!rows.length) box.append(h('div', { class: 'note', style: 'margin:0', text: 'Nothing logged yet.' }));
    rows.forEach(([lbl, c]) => box.append(h('div', { class: 'bar' + (c ? '' : ' zero') },
      h('span', { class: 'lbl', text: lbl }),
      h('span', { class: 'n' }, String(c), h('small', { text: n ? Math.round(c / n * 100) + '%' : '0%' })),
      h('div', { class: 'trk' }, h('div', { class: 'fill', style: `width:${(c / max * 100).toFixed(1)}%` })))));
    if (notSet && n) box.append(h('div', { class: 'note', style: 'margin:8px 0 0', text: `${notSet} not filled in` }));
    br.append(box);
  };
  block('By species', 'species', LISTS.species);
  block('By spread position', 'spread', LISTS.spread);
  block('By lure / bait type', 'lure_type', LISTS.lure_type);
  block('By tide', 'tide', LISTS.tide);
  block('By angler', 'angler', anglerOptions().filter(a => a !== 'Guest').concat('Guest'));
  block('By result', 'result', LISTS.result);
  block('Omni sonar', 'omni', LISTS.omni);
  block('Top locations', 'location', null, true);
}

// ------------------------------------------------------------------ export
function csvCell(v) {
  let c = s(v);
  if (/^[=+@\t\r]/.test(c) || /^-[^\d.]/.test(c)) c = "'" + c;
  return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
}
async function doExport() {
  const rows = entries().slice().reverse();
  if (!rows.length) { toast('No bites to download yet.'); return; }
  const lines = [FIELDS.map(f => f[1]).map(csvCell).join(',')];
  rows.forEach(e => lines.push(FIELDS.map(([k]) => k === 'bite_time' ? fmtTime(e.bite_time) : e[k]).map(csvCell).join(',')));
  const csv = '﻿' + lines.join('\r\n') + '\r\n';
  const name = `${s(curBoat()?.name || 'billfish').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'billfish'}-log-${todayISO()}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  try {
    const file = new File([blob], name, { type: 'text/csv' });
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Downloaded. Open it in Excel, Numbers or Google Sheets.');
}

// ------------------------------------------------------------------ boat view
function renderBoat() {
  const b = curBoat(); if (!b) return;
  const cap = b.role === 'captain';
  $('#invite-code').textContent = fmtCode(b.invite_code);
  $('#regen-wrap').hidden = !cap;

  // crew
  const cl = $('#crew-list'); cl.replaceChildren();
  const crew = S.crew.slice().sort((x, y) => (x.role === y.role ? s(x.name).localeCompare(s(y.name)) : x.role === 'captain' ? -1 : 1));
  if (!crew.length) cl.append(h('p', { class: 'note', style: 'margin:0', text: navigator.onLine === false ? 'The crew list loads when you have signal.' : 'Loading crew…' }));
  crew.forEach(c => {
    const me = c.user_id === S.user?.id;
    const acts = h('div', { class: 'acts' });
    if (cap && !me) {
      acts.append(h('button', { class: 'btn small', type: 'button', text: c.role === 'captain' ? 'Make crew' : 'Make captain', onclick: () => setRole(c, c.role === 'captain' ? 'crew' : 'captain') }));
      const rm = h('button', { class: 'btn small danger', type: 'button', text: 'Remove' });
      rm.addEventListener('click', () => {
        if (rm.dataset.armed) { removeMember(c); return; }
        rm.dataset.armed = '1'; rm.textContent = `Remove ${c.name || 'them'}?`;
        setTimeout(() => { if (rm.isConnected) { delete rm.dataset.armed; rm.textContent = 'Remove'; } }, 5000);
      });
      acts.append(rm);
    }
    cl.append(h('div', { class: 'person' },
      h('div', { class: 'who' }, (c.name || 'Crew member') + (me ? ' (you)' : ''), h('small', { text: c.role === 'captain' ? 'Captain' : 'Crew' })),
      acts));
  });

  // angler buttons
  const tags = $('#angler-tags'); tags.replaceChildren();
  const custom = Array.isArray(b.settings?.anglers) && b.settings.anglers.length;
  anglerOptions().forEach(name => tags.append(h('span', { class: 'tagchip' }, name,
    cap ? h('button', { type: 'button', 'aria-label': `Remove ${name}`, text: '×', onclick: () => saveAnglers(anglerOptions().filter(x => x !== name)) }) : null)));
  $('#angler-add-form').hidden = !cap;
  $('#anglers-help').textContent = cap
    ? (custom ? 'The names on the "Angler on the rod" buttons when logging a bite.' : 'Right now these come from your crew list. Add or remove names to set your own.')
    : 'The names on the "Angler on the rod" buttons. Your captain can change them.';

  // boat details
  $('#boat-form').hidden = !cap;
  if (document.activeElement !== $('#boat-name') && document.activeElement !== $('#boat-port')) {
    $('#boat-name').value = s(b.name); $('#boat-port').value = s(b.home_port);
  }

  // boats (hidden during the single-boat pilot)
  $('#boats-card').hidden = PILOT_BOAT_ONLY && S.boats.length <= 1;
  $('#leave-wrap').hidden = PILOT_BOAT_ONLY;
  const bl = $('#boat-list'); bl.replaceChildren();
  S.boats.forEach(x => bl.append(h('button', { type: 'button', 'aria-current': String(x.id === S.boatId), onclick: () => switchBoat(x.id) },
    h('span', { text: x.name }), h('small', { text: x.id === S.boatId ? 'Open now' : (x.role === 'captain' ? 'Captain' : 'Crew') }))));

  // account
  $('#me-email').textContent = S.user?.email ? `Signed in as ${S.user.email}` : '';
  if (document.activeElement !== $('#me-name')) $('#me-name').value = s(S.profile?.display_name);
  const so = $('#btn-signout');
  const offlineNow = navigator.onLine === false || !!S.lastSyncErr;
  so.textContent = !S.signoutArmed ? 'Sign out'
    : pendingCount() ? `Sign out anyway (${pendingCount()} not uploaded)`
    : offlineNow ? "Sign out? You can't sign back in without signal" : 'Tap again to sign out';
  so.className = 'btn' + (S.signoutArmed ? ' danger' : '');
  const mine = [...S.outbox, ...S.photoOutbox, ...S.dayOutbox].filter(o => o.boat_id === b.id).length;
  $('#leave-text').textContent = `Leave ${b.name}? You'll stop seeing its log. Bites you logged stay in the boat's log.` + (mine ? ` ${mine} ${mine === 1 ? 'bite' : 'bites'} on this phone haven't uploaded yet; get signal first or they'll be lost.` : '');

  // bites stuck for a boat you're no longer on
  const ids = boatIds(); const orphans = S.outbox.filter(o => !ids.has(o.boat_id));
  let orphanCard = $('#orphan-card'); if (orphanCard) orphanCard.remove();
  if (orphans.length && S.boats.length) {
    orphanCard = h('div', { class: 'card', id: 'orphan-card' }, h('h2', { text: "Bites that can't upload" }),
      h('p', { text: `${orphans.length} ${orphans.length === 1 ? 'bite was' : 'bites were'} logged on this phone for a boat you're no longer on, so ${orphans.length === 1 ? 'it' : 'they'} can't upload.` }),
      h('button', { class: 'btn danger', type: 'button', text: 'Discard them', onclick: () => { S.outbox = S.outbox.filter(o => ids.has(o.boat_id)); saveOutbox(); render(); toast('Discarded.'); } }));
    $('#crew-list').closest('.card').after(orphanCard);
  }

  renderInstallCard();
}

// ------------------------------------------------------------------ install (home screen)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installSteps() {
  if (S.installEvt) return h('div', { class: 'stack' }, h('p', { text: `Install ${APP_NAME} so it opens from your home screen like any other app, full screen and offline.` }),
    h('button', { class: 'btn primary', type: 'button', text: 'Install app', onclick: async () => { const e = S.installEvt; S.installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) {} render(); } }));
  if (isIOS()) return h('div', {}, h('p', { text: 'Open this page in Safari, then:' }),
    h('ol', { class: 'steps' }, h('li', { text: 'Tap the Share button (the square with an arrow).' }), h('li', { text: 'Scroll down and tap "Add to Home Screen".' }), h('li', { text: 'Tap Add. From now on, open the log from the new icon.' })));
  return h('div', {}, h('p', { text: 'In Chrome or Edge, open the browser menu and choose "Install app" or "Add to Home screen". On a computer you can also just bookmark this page.' }));
}
function renderInstallCard() {
  const show = !isStandalone();
  $('#install-card').hidden = !show;
  if (show) $('#install-body').replaceChildren(installSteps());
}
function renderInstallBanner() {
  const ban = $('#install-banner');
  const mobile = matchMedia('(pointer: coarse)').matches;
  const want = S.view === 'log' && !isStandalone() && mobile && !LS.get(K.installDismissed, false) && (isIOS() || S.installEvt);
  ban.hidden = !want; if (!want) return;
  ban.replaceChildren(
    h('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: () => { LS.set(K.installDismissed, true); renderInstallBanner(); } }),
    h('b', { text: 'Put the log on your home screen. ' }),
    isIOS() && !S.installEvt ? (pendingCount() ? `First let your ${pendingCount()} un-uploaded ${pendingCount() === 1 ? 'entry' : 'entries'} upload here (the home-screen app keeps its own storage). Then in Safari tap Share, then "Add to Home Screen". ` : 'In Safari, tap Share, then "Add to Home Screen". ') : '',
    h('button', { class: 'link', type: 'button', text: S.installEvt ? 'Install' : 'Show me how', onclick: () => { if (S.installEvt) { const e = S.installEvt; S.installEvt = null; e.prompt(); render(); } else { show('boat'); setTimeout(() => $('#install-card').scrollIntoView({ behavior: 'smooth' }), 50); } } }));
}

// ------------------------------------------------------------------ auth
function renderAuth() {
  const up = S.authMode === 'up', rec = S.recovery;
  $('#auth-tab-in').setAttribute('aria-pressed', String(!up)); $('#auth-tab-up').setAttribute('aria-pressed', String(up));
  $('#auth-tab-in').parentElement.hidden = rec;
  $('#auth-name-wrap').hidden = !up || rec;
  $('#auth-email').closest('.fld').hidden = rec;
  $('#auth-pass').setAttribute('autocomplete', up || rec ? 'new-password' : 'current-password');
  $('#auth-pass').previousElementSibling.textContent = rec ? 'New password (at least 8 characters)' : up ? 'Password (at least 8 characters)' : 'Password';
  $('#auth-submit').textContent = rec ? 'Save new password' : up ? 'Create account' : 'Sign in';
  $('#auth-forgot').hidden = up || rec;
  $('#auth-code-wrap').hidden = !(PILOT_BOAT_ONLY && up && !rec);
  if (S.pendingJoin && !$('#auth-code').value) $('#auth-code').value = fmtCode(S.pendingJoin);
  $('#auth-back').hidden = !(S.reauth && S.user);
  $('#auth-hint').hidden = !(isStandalone() && !up && !rec && !S.reauth);
  if (S.authLinkErr && !$('#auth-msg').textContent) { setMsg('#auth-msg', 'That email link has expired or was already used. Sign in below, or tap "Forgot your password?" to get a new one.', 'bad'); S.authLinkErr = null; }
  else if (S.pendingJoin && !$('#auth-msg').textContent) setMsg('#auth-msg', `Create an account (or sign in) to join the boat. The boat code ${fmtCode(S.pendingJoin)} is filled in for you.`, 'ok');
}
function startReauth() { S.reauth = true; S.authMode = 'in'; setMsg('#auth-msg', ''); if (S.user?.email) $('#auth-email').value = S.user.email; show('auth'); }
async function submitAuth(ev) {
  ev.preventDefault();
  const email = $('#auth-email').value.trim(), pass = $('#auth-pass').value, name = $('#auth-name').value.trim();
  if (!S.sb) { setMsg('#auth-msg', 'No connection right now. Signing in needs signal the first time.', 'bad'); return; }
  if (S.recovery) {
    if (pass.length < 8) { setMsg('#auth-msg', 'Use a password of at least 8 characters.', 'bad'); return; }
    busy('#auth-submit', true);
    const { error } = await S.sb.auth.updateUser({ password: pass });
    busy('#auth-submit', false);
    if (error) { setMsg('#auth-msg', friendly(error), 'bad'); return; }
    S.recovery = false; setMsg('#auth-msg', ''); toast('Password changed.');
    const { data } = await S.sb.auth.getSession(); if (data?.session) await onSignedIn(data.session.user);
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg('#auth-msg', 'Enter a full email address, like name@example.com.', 'bad'); $('#auth-email').focus(); return; }
  if (pass.length < (S.authMode === 'up' ? 8 : 1)) { setMsg('#auth-msg', S.authMode === 'up' ? 'Use a password of at least 8 characters.' : 'Enter your password.', 'bad'); $('#auth-pass').focus(); return; }
  if (S.authMode === 'up' && !name) { setMsg('#auth-msg', 'Enter your name so your crew knows who logged what.', 'bad'); $('#auth-name').focus(); return; }
  const code = $('#auth-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (S.authMode === 'up' && PILOT_BOAT_ONLY && code.length !== 8) { setMsg('#auth-msg', "Enter the boat code from the captain's invite (8 letters and numbers, like ABCD-EFGH).", 'bad'); $('#auth-code').focus(); return; }
  if (S.authMode === 'up' && code) { S.pendingJoin = code; LS.set(K.pendingJoin, code); }
  busy('#auth-submit', true); setMsg('#auth-msg', '');
  try {
    if (S.authMode === 'up') {
      const { data, error } = await S.sb.auth.signUp({ email, password: pass, options: { data: { display_name: name }, emailRedirectTo: appUrl() + (S.pendingJoin ? '?join=' + S.pendingJoin : '') } });
      if (error) throw error;
      if (data.session) { await onSignedIn(data.session.user); return; }
      setMsg('#auth-msg', `Almost done. We emailed a confirmation link to ${email}. Open it, then come back and sign in.`, 'ok');
      S.authMode = 'in'; renderAuth();
    } else {
      const { data, error } = await S.sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      await onSignedIn(data.user);
    }
  } catch (e) { setMsg('#auth-msg', friendly(e), 'bad'); }
  finally { busy('#auth-submit', false); }
}
async function forgotPassword() {
  const email = $('#auth-email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg('#auth-msg', 'Type your email above first, then tap "Forgot your password?" again.', 'bad'); $('#auth-email').focus(); return; }
  if (!S.sb) { setMsg('#auth-msg', 'No connection right now.', 'bad'); return; }
  const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) setMsg('#auth-msg', friendly(error), 'bad');
  else setMsg('#auth-msg', `If ${email} has an account, a reset link is on its way. Open it on this device.`, 'ok');
}
const appUrl = () => location.origin + location.pathname;
function busy(sel, on) { const b = $(sel); b.disabled = on; b.setAttribute('aria-busy', String(on)); }

async function onSignedIn(user) {
  if (!user) return;
  const first = !S.user || S.user.id !== user.id;
  S.user = { id: user.id, email: user.email };
  S.authOffline = false;
  LS.set(K.lastUser, S.user);
  if (first) loadUserCache(user.id);
  if (S.recovery) { show('auth'); setMsg('#auth-msg', 'Choose a new password.', 'ok'); return; }
  S.reauth = false;
  if (!S.pendingJoin) S.pendingJoin = LS.get(K.pendingJoin, null);
  try { navigator.storage?.persist?.().catch(() => {}); } catch (e) {}
  if (S.signingInFor === user.id) { route(); return; }
  S.signingInFor = user.id;
  try {
    await refreshAccount();
    if (S.pendingJoin) await joinBoat(S.pendingJoin, true);
  } finally { S.signingInFor = null; }
  if (S.view === 'auth' || S.view === 'loading' || (S.view === 'onboard' && S.boats.length)) S.view = 'log';
  route();
  if (!restoreDayDraft()) restoreDraft();
  stopRealtime(); subscribeRealtime();
  S.ready = true;
  syncNow();
}
function handleSignedOut() {
  stopRealtime();
  S.user = null; S.boats = []; S.boatId = null; S.rows = new Map(); S.outbox = []; S.crew = []; S.profile = null;
  S.lastSyncAt = null; S.lastSyncErr = null; S.signoutArmed = false; S.recovery = false; S.reauth = false; S.ready = false;
  LS.del(K.lastUser);
  show('auth');
}
async function signOut() {
  if (!S.signoutArmed) {
    S.signoutArmed = true; renderBoat();
    if (pendingCount()) toast(`${pendingCount()} ${pendingCount() === 1 ? 'entry has' : 'entries have'} not uploaded. They stay on this phone and upload when you sign back in.`, 6000);
    setTimeout(() => { if (S.signoutArmed) { S.signoutArmed = false; if (S.view === 'boat') renderBoat(); } }, 8000);
    return;
  }
  const uid = S.user?.id;
  if (uid) { // forget cached boat data on this device; keep any un-uploaded bites
    (LS.get(K.boats(uid), []) || []).forEach(b => { LS.del(K.rows(b.id)); LS.del(K.cursor(b.id)); LS.del(K.crew(b.id)); });
    (LS.get(K.boats(uid), []) || []).forEach(b => { [K.photos, K.pcursor, K.days, K.dcursor].forEach(k => LS.del(k(b.id))); });
    LS.del(K.boats(uid)); LS.del(K.boatId(uid)); LS.del(K.profile(uid)); LS.del(K.draft(uid));
    IDB.clear('thumbs').catch(() => {}); thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls.clear();
  }
  let ok = false;
  try {
    const r = await Promise.race([S.sb?.auth.signOut({ scope: 'local' }), new Promise(res => setTimeout(() => res({ error: 'timeout' }), 8000))]);
    ok = !r?.error;
  } catch (e) {}
  if (!ok) { LS.del('bl1.auth'); LS.del('bl1.auth-code-verifier'); }
  handleSignedOut();
  if (!ok) location.reload(); // reset the client's in-memory session when the server couldn't be told
}

// ------------------------------------------------------------------ account + boats
async function refreshAccount() {
  if (!S.sb || !S.user) return;
  const uid = S.user.id;
  try {
    const [p, m] = await Promise.all([
      q(S.sb.from('profiles').select('id, display_name').eq('id', uid).maybeSingle()),
      q(S.sb.from('boat_members').select('role, boats(id, name, home_port, invite_code, settings)').eq('user_id', uid)),
    ]);
    if (p.error) throw p.error; if (m.error) throw m.error;
    if (S.user?.id !== uid) return;
    S.profile = p.data || { id: uid, display_name: '' }; LS.set(K.profile(uid), S.profile);
    S.boats = (m.data || []).filter(r => r.boats).map(r => ({ ...r.boats, role: r.role })).sort((a, b) => s(a.name).localeCompare(s(b.name)));
    if (!S.boats.some(b => b.id === S.boatId)) { S.boatId = S.boats[0]?.id || null; loadBoatCache(); stopRealtime(); subscribeRealtime(); S.lastSyncAt = null; }
    saveBoats();
    await refreshCrew();
  } catch (e) {
    if (isNetErr(e)) S.lastSyncErr = e; else console.warn('refreshAccount', e);
  }
}
async function refreshCrew() {
  if (!S.sb || !S.boatId) return;
  const bid = S.boatId;
  const { data: mem, error } = await q(S.sb.from('boat_members').select('user_id, role, joined_at').eq('boat_id', bid));
  if (error) throw error;
  const ids = (mem || []).map(m => m.user_id);
  let names = {};
  if (ids.length) {
    const { data: profs, error: e2 } = await q(S.sb.from('profiles').select('id, display_name').in('id', ids));
    if (e2) throw e2;
    (profs || []).forEach(p => { names[p.id] = p.display_name; });
  }
  if (bid !== S.boatId) return;
  S.crew = (mem || []).map(m => ({ user_id: m.user_id, role: m.role, name: s(names[m.user_id]) }));
  LS.set(K.crew(bid), S.crew);
  const mine = S.crew.find(c => c.user_id === S.user?.id), cb = curBoat();
  if (mine && cb && cb.role !== mine.role) { cb.role = mine.role; saveBoats(); }
  render();
}
function switchBoat(id) {
  if (id === S.boatId) return;
  S.boatId = id; saveBoats(); loadBoatCache(); stopRealtime(); subscribeRealtime();
  S.lastSyncAt = null; S.view = 'log'; show('log'); window.scrollTo(0, 0);
  toast(`Switched to ${curBoat()?.name || 'boat'}`);
  syncNow(); refreshCrew().catch(() => {});
}
async function joinBoat(code, quiet) {
  const clean = s(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8) { setMsg('#join-msg', 'Invite codes are 8 letters and numbers, like ABCD-EFGH.', 'bad'); return false; }
  if (!S.sb) { setMsg('#join-msg', 'Joining a boat needs signal.', 'bad'); return false; }
  const { data, error } = await q(S.sb.rpc('join_boat', { p_code: clean }));
  if (error && isNetErr(error)) { setMsg('#join-msg', friendly(error), 'bad'); return false; } // keep the code to retry
  S.pendingJoin = null; LS.del(K.pendingJoin);
  if (error || !data) {
    const m = error ? friendly(error) : "That boat code isn't right. Check it with your captain and try again.";
    setMsg('#join-msg', m, 'bad'); $('#join-code').value = fmtCode(clean); if (quiet) toast(m, 6000); return false;
  }
  await refreshAccount();
  if (data && S.boats.some(b => b.id === data)) { S.boatId = data; saveBoats(); loadBoatCache(); stopRealtime(); subscribeRealtime(); refreshCrew().catch(() => {}); }
  toast(`You're on the crew of ${curBoat()?.name || 'the boat'}.`);
  $('#join-code').value = ''; setMsg('#join-msg', '');
  S.view = 'log'; route(); syncNow();
  return true;
}
async function createBoat(ev) {
  ev.preventDefault();
  const name = $('#create-name').value.trim(), port = $('#create-port').value.trim();
  if (!name) { setMsg('#create-msg', 'Enter the boat name.', 'bad'); $('#create-name').focus(); return; }
  if (!S.sb) { setMsg('#create-msg', 'Creating a boat needs signal.', 'bad'); return; }
  const btn = ev.submitter || $('#create-form button[type=submit]'); btn.disabled = true;
  const { data, error } = await q(S.sb.rpc('create_boat', { p_name: name, p_home_port: port }));
  btn.disabled = false;
  if (error) { setMsg('#create-msg', friendly(error), 'bad'); return; }
  await refreshAccount();
  const id = Array.isArray(data) ? data[0]?.id : data?.id;
  if (id) { S.boatId = id; saveBoats(); loadBoatCache(); stopRealtime(); subscribeRealtime(); refreshCrew().catch(() => {}); }
  $('#create-name').value = ''; $('#create-port').value = ''; setMsg('#create-msg', '');
  toast(`${name} is set up. Share the invite code with your crew.`, 5000);
  S.view = 'boat'; route(); window.scrollTo(0, 0); syncNow();
}
function renderOnboard() {
  $('#ob-back').hidden = !S.boats.length;
  $('#create-form').hidden = PILOT_BOAT_ONLY;
  $('#ob-title').textContent = PILOT_BOAT_ONLY ? 'Join the boat' : 'Set up your boat';
  if (!$('#join-code').value && S.pendingJoin) $('#join-code').value = fmtCode(S.pendingJoin);
  $('#ob-hello').textContent = S.profile?.display_name ? `Welcome aboard, ${S.profile.display_name}` : 'Welcome aboard';
}
async function rpcAction(fn, args, okMsg) {
  if (!S.sb || navigator.onLine === false) { toast('That needs signal. Try again when you are connected.'); return null; }
  const { data, error } = await q(S.sb.rpc(fn, args));
  if (error) { toast(friendly(error), 5000); return null; }
  if (okMsg) toast(okMsg);
  return { data };
}
async function setRole(c, role) {
  if (await rpcAction('set_member_role', { p_boat: S.boatId, p_user: c.user_id, p_role: role }, `${c.name || 'They'} ${role === 'captain' ? 'is now a captain' : 'is now crew'}.`)) {
    await refreshCrew().catch(() => {});
  }
}
async function removeMember(c) {
  const r = await rpcAction('remove_member', { p_boat: S.boatId, p_user: c.user_id }, `${c.name || 'They'} ${c.name ? 'was' : 'were'} removed. The boat code was changed so the old invite no longer works.`);
  if (r) {
    const b = curBoat(); if (b && r.data) { b.invite_code = r.data; saveBoats(); }
    await refreshCrew().catch(() => {}); renderBoat();
  }
}
async function leaveBoat() {
  const b = curBoat(); if (!b) return;
  if ([...S.outbox, ...S.photoOutbox, ...S.dayOutbox].some(o => o.boat_id === b.id) && navigator.onLine !== false) { await syncNow(); }
  if (await rpcAction('remove_member', { p_boat: b.id, p_user: S.user.id }, `You left ${b.name}.`)) {
    LS.del(K.rows(b.id)); LS.del(K.cursor(b.id)); LS.del(K.crew(b.id));
    S.outbox = S.outbox.filter(o => o.boat_id !== b.id); saveOutbox();
    [K.photos, K.pcursor, K.days, K.dcursor].forEach(k => LS.del(k(b.id)));
    S.photoOutbox.filter(o => o.boat_id === b.id).forEach(o => IDB.del('pending', o.id).catch(() => {}));
    S.photoOutbox = S.photoOutbox.filter(o => o.boat_id !== b.id); savePhotoOutbox();
    S.dayOutbox = S.dayOutbox.filter(o => o.boat_id !== b.id); saveDayOutbox();
    S.boats = S.boats.filter(x => x.id !== b.id); S.boatId = S.boats[0]?.id || null; saveBoats(); loadBoatCache(); stopRealtime(); subscribeRealtime();
    $('#leave-confirm').hidden = true;
    S.view = 'log'; route(); syncNow();
  }
}
async function regenInvite() {
  const r = await rpcAction('regenerate_invite', { p_boat: S.boatId }, 'New code made. The old one no longer works.');
  if (r) { const b = curBoat(); b.invite_code = r.data; saveBoats(); $('#regen-confirm').hidden = true; $('#btn-regen').hidden = false; renderBoat(); }
}
async function saveAnglers(list) {
  const b = curBoat(); if (!b || !S.sb) return;
  if (navigator.onLine === false) { toast('Changing the angler buttons needs signal.'); return; }
  const clean = [...new Set(list.map(x => s(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
  const settings = { ...(b.settings || {}), anglers: clean };
  const { data, error } = await q(S.sb.from('boats').update({ settings }).eq('id', b.id).select('id'));
  if (error) { toast(friendly(error), 5000); return; }
  if (!data?.length) { toast('Only a captain can change that. Your role may have changed.', 5000); refreshAccount(); return; }
  b.settings = settings; saveBoats(); renderBoat();
}
async function saveBoatDetails(ev) {
  ev.preventDefault();
  const b = curBoat(); if (!b) return;
  const name = $('#boat-name').value.trim(), port = $('#boat-port').value.trim();
  if (!name) { setMsg('#boat-msg', 'The boat needs a name.', 'bad'); return; }
  if (!S.sb || navigator.onLine === false) { setMsg('#boat-msg', 'Saving boat details needs signal.', 'bad'); return; }
  const { data, error } = await q(S.sb.from('boats').update({ name, home_port: port }).eq('id', b.id).select('id'));
  if (error) { setMsg('#boat-msg', friendly(error), 'bad'); return; }
  if (!data?.length) { setMsg('#boat-msg', 'Only a captain can change that. Your role may have changed.', 'bad'); refreshAccount(); return; }
  b.name = name; b.home_port = port; saveBoats(); setMsg('#boat-msg', 'Saved.', 'ok'); render();
}
async function saveMyName(ev) {
  ev.preventDefault();
  const name = $('#me-name').value.trim();
  if (!name) { setMsg('#me-msg', 'Enter your name.', 'bad'); return; }
  if (!S.sb || navigator.onLine === false) { setMsg('#me-msg', 'Saving your name needs signal.', 'bad'); return; }
  const { error } = await q(S.sb.from('profiles').update({ display_name: name }).eq('id', S.user.id));
  if (error) { setMsg('#me-msg', friendly(error), 'bad'); return; }
  S.profile = { ...(S.profile || {}), display_name: name }; LS.set(K.profile(S.user.id), S.profile);
  setMsg('#me-msg', 'Saved.', 'ok'); refreshCrew().catch(() => {});
}
async function shareInvite() {
  const b = curBoat(); if (!b) return;
  const link = `${appUrl()}?join=${encodeURIComponent(b.invite_code)}`;
  const text = `Join the ${b.name} fishing log so we all log bites in one place. Tap the link, create an account, and you're in. Boat code: ${fmtCode(b.invite_code)}`;
  if (navigator.share) {
    try { await navigator.share({ title: `Join the ${b.name} fishing log`, text, url: link }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${link}`, 'Invite link copied. Paste it into a text to your crew.');
}
function copyText(text, okMsg) {
  const fallback = () => {
    const ta = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0', readonly: true }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); toast(ok ? okMsg : text, ok ? 3400 : 8000);
  };
  try { navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback); } catch (e) { fallback(); }
}

// ------------------------------------------------------------------ sync
function queueRow(row) {
  const item = { id: row.id, boat_id: row.boat_id, row, error: null, queuedAt: new Date().toISOString() };
  const i = S.outbox.findIndex(o => o.id === row.id);
  if (i >= 0) S.outbox[i] = item; else S.outbox.push(item);
  return saveOutbox();
}
async function syncNow() {
  if (!S.sb || !S.user || S.authOffline) { render(); return; }
  if (S.syncing) { S.syncAgain = true; return; }
  S.syncing = true; renderHeaderIfMain();
  try {
    // Never upload without a live session: an anonymous request would be refused and wrongly flag the bites as bad.
    const { data: sess, error: sessErr } = await S.sb.auth.getSession();
    if (!sess?.session) {
      if (sessErr && isNetErr(sessErr)) throw sessErr;
      if (navigator.onLine !== false) S.authOffline = true;
      return;
    }
    if (!S.channel) subscribeRealtime();
    await pushOutbox();
    if (S.boatId) await pullBoat(S.boatId);
    await pushDays();
    if (S.boatId) await pullDays(S.boatId);
    await pushPhotos();
    if (S.boatId) await pullPhotos(S.boatId);
    S.lastSyncAt = Date.now(); S.lastSyncErr = null;
  } catch (e) {
    S.lastSyncErr = e;
    if (!isNetErr(e)) console.warn('sync', e);
    if (/jwt|expired|not authenticated/i.test(s(e?.message)) || e?.status === 401) {
      const r = await S.sb.auth.refreshSession().catch(err => ({ data: null, error: err }));
      if (!r?.data?.session && r?.error && !isNetErr(r.error) && navigator.onLine !== false) S.authOffline = true;
    }
  } finally {
    S.syncing = false;
    if (!['form', 'dayform'].includes(S.view)) render(); else renderHeaderIfMain();
    if (S.syncAgain) { S.syncAgain = false; setTimeout(syncNow, 300); }
  }
}
function renderHeaderIfMain() { if (MAIN_VIEWS.includes(S.view)) renderHeader(); }
async function pushOutbox() {
  for (const item of S.outbox.slice()) {
    if (item.rejected) continue; // the server refused this version; it waits for the user to fix it
    if (!boatIds().has(item.boat_id) && S.boats.length) continue; // boat no longer ours; shown on the Boat tab
    const payload = {};
    ROW_COLS.forEach(k => { payload[k] = item.row[k] === undefined ? null : item.row[k]; });
    payload.id = item.id; payload.boat_id = item.boat_id;
    const { error, status } = await q(S.sb.from('catches').upsert(payload, { onConflict: 'id' }));
    if (error) {
      // Signal problems, server hiccups and expired sign-ins are temporary: keep the bite queued and try later.
      if (isNetErr(error) || !error.code || status === 0 || status === 401 || status === 408 || status === 429 || status >= 500 || /jwt|expired/i.test(s(error.message))) throw error;
      item.error = friendly(error); item.rejected = true; saveOutbox();
      continue;
    }
    const i = S.outbox.indexOf(item);
    if (i >= 0) { // only drop it if it wasn't edited again while uploading
      S.outbox.splice(i, 1); saveOutbox();
      if (item.boat_id === S.boatId) {
        if (item.row.deleted_at) S.rows.delete(item.id); else S.rows.set(item.id, { ...item.row });
        saveRows();
      } else {
        const m = LS.get(K.rows(item.boat_id), {}) || {};
        if (item.row.deleted_at) delete m[item.id]; else m[item.id] = { ...item.row };
        LS.set(K.rows(item.boat_id), m);
      }
    }
  }
}
async function pullBoat(bid) {
  const cursor = LS.get(K.cursor(bid), null);
  const since = cursor ? new Date(parseTs(cursor) - 5 * 60 * 1000).toISOString() : null;
  const gen = S.gen, cur = bid === S.boatId;
  const rows = cur ? S.rows : new Map(Object.entries(LS.get(K.rows(bid), {}) || {}));
  const pending = outboxMap();
  const PAGE = 250;
  let maxTs = cursor, from = 0;
  for (let page = 0; page < 400; page++) {
    let qb = S.sb.from('catches').select('*').eq('boat_id', bid).order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (since) qb = qb.gte('updated_at', since);
    else qb = qb.is('deleted_at', null);
    const { data, error } = await q(qb, 30000);
    if (error) throw error;
    if (cur && gen !== S.gen) { S.syncAgain = true; return; } // switched boats mid-pull; start over later
    for (const r of data) {
      if (!maxTs || parseTs(r.updated_at) > parseTs(maxTs)) maxTs = r.updated_at;
      if (pending.has(r.id)) continue; // this phone's newer edit wins until it uploads
      if (r.deleted_at) rows.delete(r.id); else rows.set(r.id, r);
    }
    // Save as we go so a dropped connection on a big first download doesn't start over from zero.
    if (LS.set(K.rows(bid), Object.fromEntries(rows))) { if (maxTs) LS.set(K.cursor(bid), maxTs); }
    else LS.del(K.cursor(bid));
    if (cur && S.view === 'log') renderLog();
    if (data.length < PAGE) break;
    from += PAGE;
  }
}
function subscribeRealtime() {
  if (!S.sb || !S.boatId || S.channel) return;
  const bid = S.boatId;
  try {
    S.channel = S.sb.channel('catches-' + bid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catches', filter: `boat_id=eq.${bid}` }, payload => {
        if (bid !== S.boatId) return;
        const r = payload.new && payload.new.id ? payload.new : null;
        const id = r ? r.id : payload.old?.id;
        if (!id || outboxMap().has(id)) return;
        if (!r || r.deleted_at) S.rows.delete(id); else S.rows.set(id, r);
        saveRows();
        if (S.view !== 'form') render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catch_photos', filter: `boat_id=eq.${bid}` }, payload => {
        if (bid !== S.boatId) return;
        const r = payload.new && payload.new.id ? payload.new : null;
        const id = r ? r.id : payload.old?.id;
        if (!id || S.photoOutbox.some(o => o.id === id)) return;
        if (!r || r.deleted_at) { S.photos.delete(id); forgetThumb(id); } else S.photos.set(id, r);
        savePhotos();
        if (['photos', 'log', 'days'].includes(S.view)) render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fishing_days', filter: `boat_id=eq.${bid}` }, payload => {
        if (bid !== S.boatId) return;
        const r = payload.new && payload.new.id ? payload.new : null;
        const id = r ? r.id : payload.old?.id;
        if (!id || S.dayOutbox.some(o => o.id === id)) return;
        if (!r || r.deleted_at) S.days.delete(id); else S.days.set(id, r);
        saveDays();
        if (S.view === 'days') render();
      })
      .subscribe();
  } catch (e) { S.channel = null; }
}
function stopRealtime() { if (S.channel) { try { S.sb.removeChannel(S.channel); } catch (e) {} S.channel = null; } }

// ------------------------------------------------------------------ bite form
function chipOptions(field) {
  if (field === 'angler') return anglerOptions();
  return LISTS[field];
}
function buildChips() {
  $$('.chips[data-field]').forEach(box => {
    const f = box.dataset.field; box.replaceChildren();
    const opts = chipOptions(f).slice();
    const cur = s(S.form.data[f]);
    if (cur && !opts.includes(cur) && f !== 'angler') opts.push(cur); // keep an older value visible
    opts.forEach(opt => box.append(h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(cur === opt), 'data-v': opt, text: opt,
      onclick: () => {
        S.form.data[f] = S.form.data[f] === opt ? '' : opt;
        if (f === 'angler') { $('#f-angler-other').value = ''; $('#angler-other-wrap').hidden = true; }
        syncChips(f); formChanged();
      },
    })));
    if (f === 'angler') box.append(h('button', { type: 'button', class: 'chip add', text: '+ Other name', onclick: () => {
      S.form.data.angler = ''; syncChips('angler');
      $('#angler-other-wrap').hidden = false; $('#f-angler-other').focus();
    } }));
  });
}
function syncChips(f) {
  $$(`.chips[data-field="${f}"] .chip[data-v]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.form.data[f])));
}
function fillDatalists() {
  const all = entries();
  const uniq = k => [...new Set(all.map(e => s(e[k]).trim()).filter(Boolean))].slice(0, 60);
  $('#dl-lure').replaceChildren(...uniq('lure_name').map(v => h('option', { value: v })));
  $('#dl-loc').replaceChildren(...uniq('location').map(v => h('option', { value: v })));
}
function setFormFields() {
  const d = S.form.data;
  $('#f-catch_date').value = s(d.catch_date); $('#f-bite_time').value = hm(d.bite_time);
  TEXT_FIELDS.forEach(k => { const el = $('#f-' + k); el.value = s(d[k]); el.removeAttribute('aria-invalid'); el.closest('.fld')?.querySelector('.err')?.remove(); });
  const a = s(d.angler); const known = anglerOptions().includes(a);
  $('#angler-other-wrap').hidden = !a || known; $('#f-angler-other').value = known ? '' : a;
  renderGps();
  buildChips();
}
function readFormFields() {
  const d = S.form.data;
  d.catch_date = $('#f-catch_date').value; d.bite_time = $('#f-bite_time').value;
  TEXT_FIELDS.forEach(k => { d[k] = $('#f-' + k).value; });
  const other = $('#f-angler-other').value.trim(); if (other) d.angler = other;
}
function openForm(id, draft) {
  if (!S.boatId) return;
  const all = entries();
  if (draft) S.form = { ...draft, newPhotos: [], removePhotos: [] };
  else if (id) {
    const e = all.find(x => x.id === id); if (!e) return;
    const d = {}; ROW_COLS.forEach(k => { d[k] = e[k] == null ? '' : e[k]; }); d.created_at = e.created_at;
    S.form = { id, boat_id: e.boat_id || S.boatId, data: d, carried: false, error: e._error, newPhotos: [], removePhotos: [] };
  } else {
    const t = todayISO(); const d = { catch_date: t, bite_time: nowHM() };
    const last = all.find(e => e.catch_date === t);
    let carried = false;
    if (last) CARRY.forEach(k => { if (s(last[k])) { d[k] = last[k]; carried = true; } });
    S.form = { id: null, newId: uuid(), boat_id: S.boatId, data: d, carried: carried ? fmtTime(last.bite_time) || 'last' : false, newPhotos: [], removePhotos: [] };
  }
  const f = S.form;
  $('#form-title').textContent = f.id ? 'Edit bite' : 'New bite';
  $('#btn-save').textContent = f.id ? 'Save changes' : 'Save bite';
  $('#carry').hidden = !f.carried;
  if (f.carried) $('#carry-text').textContent = `Tide, location, water temp and seas copied from the ${f.carried} bite.`;
  $('#del-zone').hidden = !f.id; $('#del-confirm').hidden = true; $('#btn-del').hidden = false;
  fillDatalists(); setFormFields(); updateMissing();
  renderFormPhotos('#f-photos', f, photosFor(f.id));
  $('#btn-save').disabled = false;
  $('#discard-confirm').hidden = true;
  show('form'); window.scrollTo(0, 0);
  saveDraft();
  if (!f.orig) f.orig = JSON.stringify(f.data);
}
function updateMissing() {
  const miss = missing(S.form.data);
  $('#missing-note').textContent = (S.form.error ? `Couldn't upload: ${S.form.error} Fix it and save again. ` : '')
    + (miss.length ? `Still missing: ${miss.join(', ')}. You can save now and fill it in later.` : '');
}
let draftTimer = null;
function formChanged() { updateMissing(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); }
function saveDraft() { if (!S.form || !S.user) return; readFormFields(); LS.set(K.draft(S.user.id), { ...S.form, newPhotos: [], removePhotos: [], staged: (S.form.newPhotos || []).length }); }
function restoreDraft() {
  if (!S.user || S.view === 'form') return;
  const d = LS.get(K.draft(S.user.id), null);
  if (d && d.data && typeof d.data === 'object' && d.boat_id && S.boats.some(b => b.id === d.boat_id)) {
    if (d.boat_id !== S.boatId) { S.boatId = d.boat_id; saveBoats(); loadBoatCache(); }
    openForm(null, d); toast(d.staged ? 'Picked up your unsaved bite. Add its photos again.' : 'Picked up your unsaved bite.', 5000);
  }
}
function closeForm(force) {
  if (S.form && force !== true) {
    readFormFields();
    if ((S.form.orig && JSON.stringify(S.form.data) !== S.form.orig) || S.form.newPhotos?.length || S.form.removePhotos?.length) { $('#discard-confirm').hidden = false; $('#discard-confirm').scrollIntoView({ block: 'nearest' }); return; }
  }
  if (S.user) LS.del(K.draft(S.user.id)); S.form = null; show('log');
}
function fieldError(k, msg) {
  const el = $('#f-' + k); el.setAttribute('aria-invalid', 'true');
  const fld = el.closest('.fld'); fld.querySelector('.err')?.remove();
  fld.append(h('div', { class: 'err', text: msg }));
}
async function saveForm() {
  if (!S.form || S.form.saving) return;
  if (S.adding > 0) { toast('Wait a moment, the photo is still being added.'); return; }
  clearTimeout(draftTimer);
  readFormFields();
  const f = S.form, src = f.data, row = {};
  let firstBad = null;
  TEXT_FIELDS.forEach(k => { const el = $('#f-' + k); el.removeAttribute('aria-invalid'); el.closest('.fld').querySelector('.err')?.remove(); });
  for (const [k, max] of Object.entries(MAXLEN)) { const v = s(src[k]).trim(); row[k] = v ? v.slice(0, max) : null; }
  for (const [k, [lo, hi, label]] of Object.entries(NUMS)) {
    const raw0 = s(src[k]).trim();
    const raw = /^\d*,\d{1,2}$/.test(raw0) ? raw0.replace(',', '.') : raw0.replace(/,/g, ''); // "79,5" is a decimal; "1,200" is a thousand
    if (!raw) { row[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { fieldError(k, `${label} must be a number.`); firstBad = firstBad || k; continue; }
    if (n < lo || n > hi) { fieldError(k, `${label} should be between ${lo} and ${hi}.`); firstBad = firstBad || k; continue; }
    row[k] = n;
  }
  if (firstBad) { $('#f-' + firstBad).focus(); $('#f-' + firstBad).scrollIntoView({ block: 'center' }); toast('Check the highlighted number.'); return; }
  row.catch_date = /^\d{4}-\d{2}-\d{2}$/.test(s(src.catch_date)) ? src.catch_date : todayISO();
  row.bite_time = hm(src.bite_time) || null;
  row.lat = Number.isFinite(+src.lat) && s(src.lat) !== '' ? +src.lat : null;
  row.lng = Number.isFinite(+src.lng) && s(src.lng) !== '' ? +src.lng : null;
  row.deleted_at = null;
  row.id = f.id || f.newId || uuid();
  row.boat_id = f.boat_id || S.boatId;
  row.created_at = src.created_at || new Date().toISOString();
  f.saving = true; $('#btn-save').disabled = true;
  if (!queueRow(row)) {
    f.saving = false; $('#btn-save').disabled = false;
    toast("This phone is out of storage, so the bite couldn't be saved. Free up space (delete photos or apps), then tap Save again.", 9000);
    return;
  }
  S.flashId = row.id;
  if (S.user) LS.del(K.draft(S.user.id));
  const photosOk = await commitFormPhotos(f, { catch_id: row.id, boat_id: row.boat_id, fish: row.species });
  if (!photosOk) toast('The bite is saved, but a photo could not be stored on this phone.', 6000);
  const offline = navigator.onLine === false || !S.sb || S.authOffline || !!S.lastSyncErr;
  const removedNote = f.removePhotos.length ? ` · ${f.removePhotos.length} photo${f.removePhotos.length === 1 ? '' : 's'} removed` : '';
  if (photosOk) toast((f.id ? (offline ? 'Changes saved on this phone. They upload when you have signal.' : 'Changes saved') : (offline ? 'Bite saved on this phone. It uploads when you have signal.' : 'Bite saved')) + removedNote);
  S.form = null;
  if (row.boat_id !== S.boatId) { S.boatId = row.boat_id; saveBoats(); loadBoatCache(); }
  show('log'); window.scrollTo(0, 0);
  syncNow();
  setTimeout(() => { S.flashId = null; if (S.view === 'log') renderLog(); }, 2500);
}
function deleteFromForm() {
  const f = S.form; if (!f?.id) return;
  const e = entries().find(x => x.id === f.id);
  const base = e ? Object.fromEntries(ROW_COLS.map(k => [k, e[k] === undefined ? null : e[k]])) : { id: f.id, boat_id: f.boat_id, catch_date: s(f.data.catch_date) || todayISO() };
  queueRow({ ...base, id: f.id, boat_id: f.boat_id || S.boatId, deleted_at: new Date().toISOString() });
  if (S.user) LS.del(K.draft(S.user.id));
  S.form = null; toast('Bite deleted'); show('log'); syncNow();
}
function renderGps() {
  const d = S.form.data; const has = s(d.lat) !== '' && s(d.lng) !== '' && d.lat != null && d.lng != null;
  $('#gps-coords').textContent = has ? `${(+d.lat).toFixed(5)}, ${(+d.lng).toFixed(5)}` : '';
  $('#gps-clear').hidden = !has;
}
function markGps() {
  if (!navigator.geolocation) { toast("This device can't share its position."); return; }
  const btn = $('#btn-gps'); btn.disabled = true; $('#gps-coords').textContent = 'Finding position…';
  const f = S.form;
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false;
    if (!f || S.form !== f) return;
    S.form.data.lat = Math.round(pos.coords.latitude * 1e6) / 1e6; S.form.data.lng = Math.round(pos.coords.longitude * 1e6) / 1e6;
    renderGps(); formChanged();
  }, err => {
    btn.disabled = false;
    if (!f || S.form !== f) return;
    renderGps();
    toast(err.code === 1 ? 'Location is turned off for this app. Allow it in your phone settings to mark GPS.' : "Couldn't get a GPS fix. Try again in open sky.", 5000);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}

// ------------------------------------------------------------------ photo storage on the phone (IndexedDB)
// Photos are too big for localStorage. Un-uploaded photos ('pending') and viewed thumbnails ('thumbs') live here.
const IDB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('no indexedDB')); return; }
      const r = indexedDB.open('bl-photos', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('pending', { keyPath: 'id' }); d.createObjectStore('thumbs', { keyPath: 'id' }); };
      r.onsuccess = () => {
        const d = r.result;
        d.onclose = () => { dbp = null; };
        d.onversionchange = () => { d.close(); dbp = null; };
        res(d);
      };
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      let tx;
      try { tx = d.transaction(store, mode); } catch (e) { dbp = null; rej(e); return; } // connection was lost; reopen next time
      const st = tx.objectStore(store);
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  return {
    get: (st, k) => run(st, 'readonly', s => s.get(k)),
    put: (st, v) => run(st, 'readwrite', s => s.put(v)),
    del: (st, k) => run(st, 'readwrite', s => s.delete(k)),
    keys: st => run(st, 'readonly', s => s.getAllKeys()),
    clear: st => run(st, 'readwrite', s => s.clear()),
  };
})();
const thumbUrls = new Map();   // photo id -> object URL of its thumbnail (kept for the session)

// ------------------------------------------------------------------ photos: data
const savePhotos = () => { if (S.boatId) LS.set(K.photos(S.boatId), Object.fromEntries(S.photos)); };
function saveWithRoom(key, value) {
  if (LS.set(key, value)) return true;
  Object.keys(localStorage).filter(k => /^bl1\.b\./.test(k)).forEach(k => LS.del(k)); // cached copies re-download
  return LS.set(key, value);
}
const savePhotoOutbox = () => (S.user ? saveWithRoom(K.photoOutbox(S.user.id), S.photoOutbox) : true);
const pendingCount = () => S.outbox.length + S.photoOutbox.length + S.dayOutbox.length;
// A deleted photo's thumbnail shouldn't linger on the phone.
function forgetThumb(id) { IDB.del('thumbs', id).catch(() => {}); const u = thumbUrls.get(id); if (u) { URL.revokeObjectURL(u); thumbUrls.delete(id); } }
function photosList() {
  const m = new Map(S.photos);
  const pend = new Map();
  for (const o of S.photoOutbox) if (o.boat_id === S.boatId) { m.set(o.id, o.row); pend.set(o.id, o); }
  const out = [];
  for (const [id, r] of m) {
    if (!r || r.deleted_at) continue;
    const o = pend.get(id);
    out.push(Object.assign({}, r, { id, _pending: !!o, _error: o ? o.error : null }));
  }
  out.sort((a, b) => s(b.taken_at || b.created_at).localeCompare(s(a.taken_at || a.created_at)));
  return out;
}
const photosFor = catchId => (catchId ? photosList().filter(p => p.catch_id === catchId) : []);
const photosForDay = dayId => (dayId ? photosList().filter(p => p.day_id === dayId) : []);

// Shrink a picked photo to a 1600px JPEG (fast to upload on weak signal) plus a 420px thumbnail.
// When a photo was really taken (EXIF DateTimeOriginal), so library photos land on the right day.
async function exifDate(file) {
  try {
    const buf = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (buf.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const marker = buf.getUint16(off), len = buf.getUint16(off + 2);
      if (marker === 0xFFE1 && buf.getUint32(off + 4) === 0x45786966) { // "Exif"
        const tiff = off + 10, le = buf.getUint16(tiff) === 0x4949;
        const u16 = o => buf.getUint16(o, le), u32 = o => buf.getUint32(o, le);
        const findTag = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; };
        const ifd0 = tiff + u32(tiff + 4);
        const exifPtr = findTag(ifd0, 0x8769); if (!exifPtr) return null;
        const exif = tiff + u32(exifPtr + 8);
        const dt = findTag(exif, 0x9003) || findTag(exif, 0x9004); if (!dt) return null;
        const at = tiff + u32(dt + 8); let str = '';
        for (let i = 0; i < 19; i++) str += String.fromCharCode(buf.getUint8(at + i));
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(str);
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); // camera local time
        return isNaN(d) || d.getFullYear() < 1990 ? null : d.toISOString();
      }
      if ((marker & 0xFF00) !== 0xFF00) return null;
      off += 2 + len;
    }
  } catch (e) {}
  return null;
}
async function processImage(file) {
  const takenAt = await exifDate(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('empty image');
    const draw = (max, quality) => new Promise((res, rej) => {
      const k = Math.min(1, max / Math.max(W, H)); const w = Math.max(1, Math.round(W * k)), hh = Math.max(1, Math.round(H * k));
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(img, 0, 0, w, hh);
      c.toBlob(b => { c.width = 0; c.height = 0; (b ? res({ blob: b, w, h: hh }) : rej(new Error('encode failed'))); }, 'image/jpeg', quality); // free canvas memory (iPhone limit)
    });
    const full = await draw(1600, 0.82); const thumb = await draw(420, 0.72);
    return { id: uuid(), full: full.blob, thumb: thumb.blob, width: full.w, height: full.h,
      taken_at: takenAt || new Date(file.lastModified || Date.now()).toISOString() };
  } finally { URL.revokeObjectURL(url); }
}
function showAdding() {
  ['#btn-add-photos', '#btn-f-photo', '#btn-d-photo'].forEach(sel => { $(sel).disabled = S.adding > 0; });
  $('#btn-save').disabled = S.adding > 0 || !!S.form?.saving;
  $('#day-save').disabled = S.adding > 0 || !!S.dayForm?.saving;
  $$('.adding-note').forEach(el => el.remove());
  if (S.adding > 0) {
    const txt = `Adding ${S.adding} ${S.adding === 1 ? 'photo' : 'photos'}…`;
    ['#f-photos', '#d-photos'].forEach(sel => $(sel).after(h('p', { class: 'note adding-note', style: 'margin:0 0 8px', text: txt })));
  }
  if (S.view === 'photos') renderPhotos();
}
async function stageFiles(files) {
  const out = [];
  S.adding += files.length; showAdding();
  for (const f of files) {
    try { const st = await processImage(f); thumbUrls.set(st.id, URL.createObjectURL(st.thumb)); out.push(st); }
    catch (e) {
      toast(/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
        ? "That's an iPhone HEIC photo this browser can't open. Add it from the phone (Safari) instead."
        : "One photo couldn't be read. Try a different photo.", 6000);
    }
    finally { S.adding--; showAdding(); }
  }
  return out;
}
// Put a processed photo in the upload queue. Returns false if the phone can't store it.
async function queuePhoto(st, link) {
  const bid = link.boat_id || S.boatId;
  try { await IDB.put('pending', { id: st.id, full: st.full, thumb: st.thumb }); }
  catch (e) { toast("This phone couldn't save the photo (storage full or private browsing).", 7000); return false; }
  const row = {
    id: st.id, boat_id: bid, catch_id: link.catch_id || null, day_id: link.day_id || null,
    path: `${bid}/${st.id}.jpg`, thumb_path: `${bid}/${st.id}_t.jpg`, width: st.width, height: st.height,
    fish: link.fish || null, caption: link.caption || null, taken_at: st.taken_at, deleted_at: null, created_at: new Date().toISOString(),
  };
  const entry = { id: st.id, boat_id: bid, row, needsUpload: true, error: null };
  const at = S.photoOutbox.findIndex(o => o.id === st.id);
  if (at >= 0) S.photoOutbox[at] = entry; else S.photoOutbox.push(entry);
  if (!savePhotoOutbox()) {
    S.photoOutbox = S.photoOutbox.filter(o => o.id !== st.id); IDB.del('pending', st.id).catch(() => {});
    toast("This phone couldn't save the photo (storage full).", 7000); return false;
  }
  return true;
}
// Change a photo's details (or delete it): queue an updated row.
function queuePhotoEdit(p, changes) {
  const i = S.photoOutbox.findIndex(o => o.id === p.id);
  const base = i >= 0 ? S.photoOutbox[i].row : Object.fromEntries(PHOTO_COLS.map(k => [k, p[k] === undefined ? null : p[k]]));
  const row = { ...base, ...changes };
  if (i >= 0) S.photoOutbox[i] = { ...S.photoOutbox[i], row, error: null, rejected: false };
  else S.photoOutbox.push({ id: p.id, boat_id: p.boat_id, row, needsUpload: false, error: null });
  savePhotoOutbox();
}

// ------------------------------------------------------------------ photos & days: sync
function isTransient(error, status) {
  return isNetErr(error) || !error.code || status === 0 || status === 401 || status === 408 || status === 429 || status >= 500 || /jwt|expired/i.test(s(error.message));
}
async function uploadObject(path, blob) {
  const { error } = await S.sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (!error) return;
  const m = s(error.message), code = s(error.statusCode || error.status);
  if (/already exists|duplicate/i.test(m) || code === '409') return; // uploaded on an earlier try
  if (isNetErr(error) || !code || +code >= 500 || code === '429' || code === '401' || code === '408') throw Object.assign(new Error(m || 'upload failed'), { transient: true });
  throw Object.assign(new Error(m || 'upload refused'), { transient: false });
}
async function pushPhotos() {
  const ids = boatIds();
  for (const item of S.photoOutbox.slice()) {
    if (item.rejected || (!ids.has(item.boat_id) && S.boats.length)) continue;
    try {
      if (item.needsUpload) {
        let blobs;
        try { blobs = await IDB.get('pending', item.id); }
        catch (e) { throw Object.assign(e || new Error('storage'), { transient: true }); } // phone storage hiccup: try again later
        if (!blobs) { item.error = "The photo file was lost on this phone. Delete it and add it again."; item.rejected = true; savePhotoOutbox(); continue; }
        S.uploadingPhotoId = item.id;
        try {
          await uploadObject(item.row.thumb_path, blobs.thumb);
          await uploadObject(item.row.path, blobs.full);
        } finally { S.uploadingPhotoId = null; }
        item.needsUpload = false; savePhotoOutbox();
      }
    } catch (e) {
      if (e.transient !== false) throw e;
      item.error = friendly(e); item.rejected = true; savePhotoOutbox(); continue;
    }
    const payload = {}; PHOTO_COLS.forEach(k => { payload[k] = item.row[k] === undefined ? null : item.row[k]; });
    const { error, status } = await q(S.sb.from('catch_photos').upsert(payload, { onConflict: 'id' }));
    if (error) {
      if (isTransient(error, status)) throw error;
      item.error = friendly(error); item.rejected = true; savePhotoOutbox(); continue;
    }
    const i = S.photoOutbox.indexOf(item);
    if (i < 0 && !S.photoOutbox.some(o => o.id === item.id) && !item.row.deleted_at) {
      // Deleted on this phone while it was uploading: mark it deleted on the server too.
      await q(S.sb.from('catch_photos').upsert({ ...payload, deleted_at: new Date().toISOString() }, { onConflict: 'id' }));
      IDB.del('pending', item.id).catch(() => {});
      continue;
    }
    if (i >= 0) {
      S.photoOutbox.splice(i, 1); savePhotoOutbox();
      const blobs = await IDB.get('pending', item.id).catch(() => null);
      if (blobs) { IDB.put('thumbs', { id: item.id, blob: blobs.thumb, at: Date.now() }).catch(() => {}); IDB.del('pending', item.id).catch(() => {}); }
      if (item.boat_id === S.boatId) { if (item.row.deleted_at) S.photos.delete(item.id); else S.photos.set(item.id, { ...item.row }); savePhotos(); }
      if (item.row.deleted_at) {
        forgetThumb(item.id);
        S.sb.storage.from(PHOTO_BUCKET).remove([item.row.path, item.row.thumb_path]).catch(() => {}); // only the adder or a captain may; otherwise the file just stays hidden
      }
    }
  }
}
const saveDays = () => { if (S.boatId) LS.set(K.days(S.boatId), Object.fromEntries(S.days)); };
const saveDayOutbox = () => (S.user ? saveWithRoom(K.dayOutbox(S.user.id), S.dayOutbox) : true);
async function pushDays() {
  const ids = boatIds();
  for (const item of S.dayOutbox.slice()) {
    if (item.rejected || (!ids.has(item.boat_id) && S.boats.length)) continue;
    const payload = {}; DAY_COLS.forEach(k => { payload[k] = item.row[k] === undefined ? null : item.row[k]; });
    const { error, status } = await q(S.sb.from('fishing_days').upsert(payload, { onConflict: 'id' }));
    if (error) {
      if (isTransient(error, status)) throw error;
      item.error = friendly(error); item.rejected = true; saveDayOutbox(); continue;
    }
    const i = S.dayOutbox.indexOf(item);
    if (i >= 0) {
      S.dayOutbox.splice(i, 1); saveDayOutbox();
      if (item.boat_id === S.boatId) { if (item.row.deleted_at) S.days.delete(item.id); else S.days.set(item.id, { ...item.row }); saveDays(); }
    }
  }
}
// Download changes since the last sync for photos or days (same scheme as bites: server cursor + 5 min overlap).
async function pullTable(bid, table, rowsKey, cursorKey, pendingIds, getMap) {
  const cursor = LS.get(cursorKey(bid), null);
  const since = cursor ? new Date(parseTs(cursor) - 5 * 60 * 1000).toISOString() : null;
  const gen = S.gen, cur = bid === S.boatId;
  const rows = cur ? getMap() : new Map(Object.entries(LS.get(rowsKey(bid), {}) || {}));
  const PAGE = 250; let maxTs = cursor, from = 0;
  for (let page = 0; page < 400; page++) {
    let qb = S.sb.from(table).select('*').eq('boat_id', bid).order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    qb = since ? qb.gte('updated_at', since) : qb.is('deleted_at', null);
    const { data, error } = await q(qb, 30000);
    if (error) throw error;
    if (cur && gen !== S.gen) { S.syncAgain = true; return; }
    for (const r of data) {
      if (!maxTs || parseTs(r.updated_at) > parseTs(maxTs)) maxTs = r.updated_at;
      if (pendingIds.has(r.id)) continue;
      if (r.deleted_at) { rows.delete(r.id); if (table === 'catch_photos') forgetThumb(r.id); } else rows.set(r.id, r);
    }
    if (LS.set(rowsKey(bid), Object.fromEntries(rows))) { if (maxTs) LS.set(cursorKey(bid), maxTs); } else LS.del(cursorKey(bid));
    if (data.length < PAGE) break;
    from += PAGE;
  }
}
const pullPhotos = bid => pullTable(bid, 'catch_photos', K.photos, K.pcursor, new Set(S.photoOutbox.map(o => o.id)), () => S.photos);
const pullDays = bid => pullTable(bid, 'fishing_days', K.days, K.dcursor, new Set(S.dayOutbox.map(o => o.id)), () => S.days);

// ------------------------------------------------------------------ photos: showing them
const thumbQueue = []; let thumbWorkers = 0;
function loadThumb(img, p) {
  if (thumbUrls.has(p.id)) { img.src = thumbUrls.get(p.id); return; }
  thumbQueue.push([img, p]); pumpThumbs();
}
function pumpThumbs() {
  while (thumbWorkers < 4 && thumbQueue.length) {
    const [img, p] = thumbQueue.shift(); if (!img.isConnected) continue;
    thumbWorkers++;
    thumbBlobUrl(p).then(u => { if (u && img.isConnected) img.src = u; }).catch(() => {}).finally(() => { thumbWorkers--; pumpThumbs(); });
  }
}
const thumbInflight = new Map();
function thumbBlobUrl(p) {
  if (thumbUrls.has(p.id)) return Promise.resolve(thumbUrls.get(p.id));
  if (!thumbInflight.has(p.id)) thumbInflight.set(p.id, fetchThumb(p).finally(() => thumbInflight.delete(p.id)));
  return thumbInflight.get(p.id);
}
async function fetchThumb(p) {
  if (thumbUrls.has(p.id)) return thumbUrls.get(p.id);
  let blob = (await IDB.get('pending', p.id).catch(() => null))?.thumb || (await IDB.get('thumbs', p.id).catch(() => null))?.blob;
  if (!blob && S.sb && navigator.onLine !== false && p.thumb_path) {
    const { data, error } = await S.sb.storage.from(PHOTO_BUCKET).download(p.thumb_path);
    if (!error && data) { blob = data; IDB.put('thumbs', { id: p.id, blob, at: Date.now() }).catch(() => {}); }
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob); thumbUrls.set(p.id, u); return u;
}
async function fullBlob(p) {
  const pend = await IDB.get('pending', p.id).catch(() => null);
  if (pend?.full) return pend.full;
  if (!S.sb || navigator.onLine === false) return null;
  const { data, error } = await S.sb.storage.from(PHOTO_BUCKET).download(p.path);
  return error ? null : data;
}
function photoTile(p, onclick) {
  const img = h('img', { alt: p.fish ? p.fish : 'Fishing photo', loading: 'lazy' });
  loadThumb(img, p);
  return h('button', { type: 'button', class: 'ptile', onclick },
    img,
    p.fish ? h('span', { class: 'tag', text: p.fish }) : null,
    p._error ? h('span', { class: 'up err', text: "Couldn't upload" }) : p._pending ? h('span', { class: 'up', text: 'Not uploaded' }) : null);
}
function renderPhotos() {
  const all = photosList();
  const area = $('#photo-area'); area.replaceChildren();
  if (S.adding) area.append(h('p', { class: 'note', text: `Adding ${S.adding} ${S.adding === 1 ? 'photo' : 'photos'}…` }));
  if (!all.length) {
    area.append(h('div', { class: 'empty', style: 'margin-top:12px' }, h('b', { text: 'No photos yet' }), 'Tap Add photos to put the first fish of the season in here.'));
    return;
  }
  let cur = null, grid = null;
  all.forEach((p, i) => {
    const d = s(p.taken_at || p.created_at).slice(0, 10);
    const localDay = d ? isoDate(new Date(p.taken_at || p.created_at)) : '';
    if (localDay !== cur) {
      cur = localDay;
      area.append(h('div', { class: 'section-title', text: localDay ? fmtDate(localDay) : 'Undated' }));
      grid = h('div', { class: 'pgrid' }); area.append(grid);
    }
    grid.append(photoTile(p, () => openPhoto(all.map(x => x.id), i)));
  });
}
async function addPhotosFromGallery(files) {
  if (!files.length) return;
  const staged = await stageFiles(files);
  const added = [];
  for (const st of staged) if (await queuePhoto(st, {})) added.push(st.id);
  render(); syncNow();
  if (added.length) {
    toast(added.length === 1 ? 'Photo added. Tap it to say what fish it is.' : `${added.length} photos added. Tap one to say what fish it is.`, 4500);
  }
}

// ------------------------------------------------------------------ one photo (viewer)
function openPhoto(ids, i) {
  S.pv = { ids, i, changed: false };
  show('photo'); window.scrollTo(0, 0);
  renderPhotoViewer();
}
function photoFishOptions() {
  const fromDays = daysList().flatMap(d => Object.keys(d.catches || {}));
  return [...new Set([...FISH.filter(f => f !== 'Other'), ...DAY_FISH, ...fromDays, 'Other'])];
}
function currentPhoto() { if (!S.pv) return null; const id = S.pv.ids[S.pv.i]; return photosList().find(p => p.id === id) || null; }
function renderPhotoViewer() {
  const p = currentPhoto();
  if (!p) { S.pv = null; show('photos'); return; }
  $('#pv-title').textContent = p.fish || 'Photo';
  $('#pv-count').textContent = S.pv.ids.length > 1 ? `${S.pv.i + 1} of ${S.pv.ids.length}` : '';
  $('#pv-prev').disabled = S.pv.i <= 0; $('#pv-next').disabled = S.pv.i >= S.pv.ids.length - 1;
  const img = $('#pv-img'); img.alt = p.fish || 'Fishing photo'; img.removeAttribute('src');
  const id = p.id;
  thumbBlobUrl(p).then(u => { if (u && currentPhoto()?.id === id && !img.dataset.full) img.src = u; });
  delete img.dataset.full;
  S.pv.full = null;
  fullBlob(p).then(b => { if (b && currentPhoto()?.id === id) { S.pv.full = { id, blob: b }; const u = URL.createObjectURL(b); img.onload = () => URL.revokeObjectURL(u); img.dataset.full = '1'; img.src = u; } });
  updatePhotoMeta(p);
  const bite = p.catch_id ? entries().find(e => e.id === p.catch_id) : null;
  const day = p.day_id ? daysList().find(d => d.id === p.day_id) : null;
  const link = $('#pv-bite');
  link.hidden = !bite && !day;
  const keepEdits = () => { if (S.pv && (S.pv.changed || $('#pv-caption').value.trim() !== s(currentPhoto()?.caption))) savePhotoDetails(true); };
  if (bite) { link.textContent = `From the ${fmtTime(bite.bite_time) || ''} ${s(bite.species) || 'billfish'} bite on ${fmtDate(bite.catch_date, true)}`.replace(/\s+/g, ' '); link.onclick = () => { keepEdits(); openForm(bite.id); }; }
  else if (day) { link.textContent = `From the ${fmtDate(day.day_date, true)} fishing day`; link.onclick = () => { keepEdits(); openDayForm(day.id); }; }
  // fish chips + caption
  const box = $('#pv-fish'); box.replaceChildren();
  const opts = photoFishOptions(); if (p.fish && !opts.includes(p.fish)) opts.splice(opts.length - 1, 0, p.fish);
  S.pv.fish = p.fish || ''; S.pv.changed = false;
  const mark = () => $$('#pv-fish .chip[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.pv.fish)));
  opts.forEach(f => box.append(h('button', { type: 'button', class: 'chip', 'data-v': f, 'aria-pressed': String(S.pv.fish === f), text: f, onclick: () => {
    S.pv.fish = S.pv.fish === f ? '' : f; S.pv.changed = true; $('#pv-other').value = ''; mark();
  } })));
  $('#pv-other').value = '';
  $('#pv-caption').value = s(p.caption);
  $('#pv-del-confirm').hidden = true; $('#pv-del').hidden = false;
}
function updatePhotoMeta(p) {
  p = p || currentPhoto(); if (!p) return;
  const who = S.crew.find(c => c.user_id === p.created_by)?.name;
  const when = p.taken_at ? `${fmtDate(isoDate(new Date(p.taken_at)), true)} · ${new Date(p.taken_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  $('#pv-meta').textContent = [when, who ? `Added by ${who}` : '', p._error ? `Couldn't upload: ${p._error}` : p._pending ? 'Not uploaded yet' : ''].filter(Boolean).join(' · ');
}
function savePhotoDetails(quiet) {
  const p = currentPhoto(); if (!p) return;
  const caption = $('#pv-caption').value.trim().slice(0, 300) || null;
  const fish = S.pv.fish || null;
  if (s(fish) === s(p.fish) && s(caption) === s(p.caption)) { if (!quiet) toast('Nothing to save.'); return; }
  queuePhotoEdit(p, { fish, caption });
  S.pv.changed = false;
  if (!quiet) toast('Saved');
  renderPhotoViewer(); syncNow();
}
function stepPhoto(d) {
  if (!S.pv) return;
  if (S.pv.changed || $('#pv-caption').value.trim() !== s(currentPhoto()?.caption)) savePhotoDetails(true);
  S.pv.i = Math.max(0, Math.min(S.pv.ids.length - 1, S.pv.i + d)); renderPhotoViewer(); window.scrollTo(0, 0);
}
function closePhoto() {
  if (S.pv && (S.pv.changed || $('#pv-caption').value.trim() !== s(currentPhoto()?.caption))) savePhotoDetails(true);
  S.pv = null; show('photos');
}
function deletePhoto() {
  const p = currentPhoto(); if (!p) return;
  const pend = S.photoOutbox.find(o => o.id === p.id);
  if (pend && pend.needsUpload && S.uploadingPhotoId !== p.id) { // never left the phone: just drop it
    S.photoOutbox = S.photoOutbox.filter(o => o.id !== p.id); savePhotoOutbox(); IDB.del('pending', p.id).catch(() => {});
  } else queuePhotoEdit(p, { deleted_at: new Date().toISOString() });
  S.pv.ids.splice(S.pv.i, 1); if (S.pv.i >= S.pv.ids.length) S.pv.i = S.pv.ids.length - 1;
  toast('Photo deleted'); syncNow();
  if (!S.pv.ids.length) { S.pv = null; show('photos'); } else renderPhotoViewer();
}
async function sharePhoto() {
  const p = currentPhoto(); if (!p) return;
  const b = S.pv?.full?.id === p.id ? S.pv.full.blob : null;
  if (!b) { toast(navigator.onLine === false ? 'The full photo needs signal to load first.' : 'Still loading the full photo. Tap again in a moment.'); return; }
  const name = `${(p.fish || 'fish').replace(/[^\w-]+/g, '-').toLowerCase()}-${s(p.taken_at).slice(0, 10) || todayISO()}.jpg`;
  const file = new File([b], name, { type: 'image/jpeg' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: p.fish || 'Fishing photo' }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  const u = URL.createObjectURL(b); const a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}

// ------------------------------------------------------------------ photos inside the bite / day forms
// New photos are held in the form until Save, so Cancel throws them away cleanly.
function renderFormPhotos(boxSel, form, existing) {
  const box = $(boxSel); box.replaceChildren();
  existing.filter(p => !form.removePhotos.includes(p.id)).forEach(p => {
    const img = h('img', { alt: p.fish || 'Photo' }); loadThumb(img, p);
    box.append(h('div', { class: 'fthumb' }, img, h('button', { type: 'button', 'aria-label': 'Remove photo', text: '×', onclick: () => { form.removePhotos.push(p.id); renderFormPhotos(boxSel, form, existing); } })));
  });
  form.newPhotos.forEach(st => {
    const img = h('img', { alt: 'New photo', src: thumbUrls.get(st.id) || '' });
    box.append(h('div', { class: 'fthumb' }, img, h('button', { type: 'button', 'aria-label': 'Remove photo', text: '×', onclick: () => { form.newPhotos = form.newPhotos.filter(x => x !== st); renderFormPhotos(boxSel, form, existing); } })));
  });
}
async function commitFormPhotos(form, link) {
  for (const id of form.removePhotos) {
    const p = photosList().find(x => x.id === id); if (!p) continue;
    const pend = S.photoOutbox.find(o => o.id === id);
    if (pend && pend.needsUpload && S.uploadingPhotoId !== id) { S.photoOutbox = S.photoOutbox.filter(o => o.id !== id); savePhotoOutbox(); IDB.del('pending', id).catch(() => {}); }
    else queuePhotoEdit(p, { deleted_at: new Date().toISOString() });
  }
  let ok = true;
  for (const st of form.newPhotos) ok = (await queuePhoto(st, link)) && ok;
  return ok;
}

// ------------------------------------------------------------------ fishing days: data
function daysList() {
  const m = new Map(S.days); const pend = new Map();
  for (const o of S.dayOutbox) if (o.boat_id === S.boatId) { m.set(o.id, o.row); pend.set(o.id, o); }
  const out = [];
  for (const [id, r] of m) {
    if (!r || r.deleted_at) continue;
    const o = pend.get(id);
    out.push(Object.assign({}, r, { id, _pending: !!o, _error: o ? o.error : null }));
  }
  out.sort((a, b) => s(b.day_date).localeCompare(s(a.day_date)) || s(b.created_at).localeCompare(s(a.created_at)));
  return out;
}
const tallyOf = d => Object.entries(d.catches && typeof d.catches === 'object' ? d.catches : {}).filter(([, n]) => +n > 0).sort((a, b) => b[1] - a[1]);
const tallyText = d => tallyOf(d).map(([f, n]) => `${f} ${n}`).join(' · ');

function renderDays() {
  const all = daysList();
  const yr = String(new Date().getFullYear());
  const season = all.filter(d => s(d.day_date).startsWith(yr));
  const totals = new Map(); season.forEach(d => tallyOf(d).forEach(([f, n]) => totals.set(f, (totals.get(f) || 0) + (+n))));
  const top = [...totals].sort((a, b) => b[1] - a[1]);
  $('#d-season').textContent = season.length
    ? `${season.length} ${season.length === 1 ? 'day' : 'days'} this season` + (top.length ? ` · ${top.slice(0, 4).map(([f, n]) => `${f} ${n}`).join(' · ')}` : '')
    : 'No fishing days logged this season yet.';
  const area = $('#days-area'); area.replaceChildren();
  if (!all.length) {
    area.append(h('div', { class: 'empty', style: 'margin-top:12px' }, h('b', { text: 'No fishing days yet' }),
      'Tap Log a fishing day after a day of mahi, tuna, wahoo or bottom fishing.'));
    return;
  }
  const list = h('div', { class: 'list', style: 'margin-top:12px' }); area.append(list);
  all.forEach(d => {
    const pills = [];
    const np = photosForDay(d.id).length;
    if (np) pills.push(h('span', { class: 'pill blue', text: np === 1 ? '1 photo' : `${np} photos` }));
    if (d._error) pills.push(h('span', { class: 'pill err', text: "Couldn't upload" }));
    else if (d._pending) pills.push(h('span', { class: 'pill sync', text: 'Not uploaded yet' }));
    const sub = [d.fishing_type, d.location, (d.crew || []).join(', ')].map(s).filter(Boolean).join(' · ');
    const dt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(d.day_date));
    const day = dt ? new Date(+dt[1], +dt[2] - 1, +dt[3]) : null;
    list.append(h('button', { type: 'button', class: 'row', onclick: () => openDayForm(d.id) },
      h('div', { class: 't' }, day ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—', h('small', { text: day ? day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() : '' })),
      h('div', { class: 'main' },
        h('div', { class: 'sp', text: tallyText(d) || 'No fish tallied' }),
        sub ? h('div', { class: 'det', text: sub }) : null,
        pills.length ? h('div', { class: 'pills' }, pills) : null)));
  });
}

// ------------------------------------------------------------------ fishing day form
function openDayForm(id) {
  if (!S.boatId) return;
  const all = daysList();
  if (id) {
    const d = all.find(x => x.id === id); if (!d) return;
    S.dayForm = { id, boat_id: d.boat_id || S.boatId, data: { ...d, crew: [...(d.crew || [])], catches: { ...(d.catches || {}) } }, error: d._error, newPhotos: [], removePhotos: [] };
  } else {
    S.dayForm = { id: null, newId: uuid(), boat_id: S.boatId, data: { day_date: todayISO(), crew: [], catches: {} }, newPhotos: [], removePhotos: [] };
  }
  return showDayForm();
}
function showDayForm() {
  const f = S.dayForm, all = daysList();
  $('#day-title').textContent = f.id ? 'Edit fishing day' : 'New fishing day';
  $('#day-save').textContent = f.id ? 'Save changes' : 'Save day';
  $('#day-del-zone').hidden = !f.id; $('#day-del-confirm').hidden = true; $('#day-del').hidden = false;
  $('#day-discard').hidden = true;
  $('#d-date').value = s(f.data.day_date); $('#d-location').value = s(f.data.location);
  $('#d-temp').value = s(f.data.water_temp_f); $('#d-notes').value = s(f.data.notes);
  $('#d-crew-other').value = ''; $('#d-addfish').value = '';
  $('#day-save').disabled = false;
  $('#day-note').textContent = f.error ? `Couldn't upload: ${f.error} Fix it and save again.` : '';
  renderDayChips(); renderTally(); renderFormPhotos('#d-photos', f, photosForDay(f.id));
  const locs = [...new Set([...entries().map(e => s(e.location).trim()), ...all.map(d => s(d.location).trim())].filter(Boolean))].slice(0, 60);
  $('#dl-loc').replaceChildren(...locs.map(v => h('option', { value: v })));
  readDayForm(); if (!f.orig) f.orig = JSON.stringify(f.data);
  show('dayform'); window.scrollTo(0, 0);
}
let dayDraftTimer = null;
function dayDraftSoon() {
  clearTimeout(dayDraftTimer);
  dayDraftTimer = setTimeout(() => { if (S.dayForm && S.user) { readDayForm(); LS.set(K.dayDraft(S.user.id), { ...S.dayForm, newPhotos: [], removePhotos: [], staged: S.dayForm.newPhotos.length }); } }, 300);
}
function restoreDayDraft() {
  if (!S.user || ['form', 'dayform'].includes(S.view)) return false;
  const d = LS.get(K.dayDraft(S.user.id), null);
  if (!d || !d.data || !d.boat_id || !S.boats.some(b => b.id === d.boat_id)) return false;
  if (d.boat_id !== S.boatId) { S.boatId = d.boat_id; saveBoats(); loadBoatCache(); }
  S.dayForm = { ...d, newPhotos: [], removePhotos: [] };
  showDayForm();
  toast(d.staged ? 'Picked up your unsaved fishing day. Add its photos again.' : 'Picked up your unsaved fishing day.', 5000);
  return true;
}
const clearDayDraft = () => { clearTimeout(dayDraftTimer); if (S.user) LS.del(K.dayDraft(S.user.id)); };
function renderDayChips() {
  const d = S.dayForm.data;
  const single = (sel, field, opts) => {
    const box = $(sel); box.replaceChildren();
    const list = opts.slice(); if (d[field] && !list.includes(d[field])) list.push(d[field]);
    list.forEach(o => box.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(d[field] === o), text: o, onclick: () => { d[field] = d[field] === o ? '' : o; renderDayChips(); dayDraftSoon(); } })));
  };
  single('#d-type', 'fishing_type', DAY_TYPES);
  single('#d-seas', 'seas', LISTS.seas);
  const crewBox = $('#d-crew'); crewBox.replaceChildren();
  const names = [...new Set([...anglerOptions().filter(n => n !== 'Guest'), ...d.crew])];
  names.forEach(n => crewBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(d.crew.includes(n)), text: n, onclick: () => {
    d.crew = d.crew.includes(n) ? d.crew.filter(x => x !== n) : [...d.crew, n]; renderDayChips(); dayDraftSoon();
  } })));
}
function renderTally() {
  const d = S.dayForm.data; const box = $('#d-tally'); box.replaceChildren();
  const others = daysList().flatMap(x => Object.keys(x.catches || {}));
  const fish = [...new Set([...DAY_FISH, ...others, ...Object.keys(d.catches)])];
  fish.forEach(f => {
    const n = +d.catches[f] || 0;
    const set = v => { const x = Math.max(0, Math.min(999, v)); if (x) d.catches[f] = x; else delete d.catches[f]; renderTally(); dayDraftSoon(); };
    box.append(h('div', { class: 'trow' + (n ? ' on' : '') },
      h('span', { class: 'tname', text: f }),
      h('button', { type: 'button', class: 'tbtn', 'aria-label': `One less ${f}`, text: '−', disabled: !n, onclick: () => set(n - 1) }),
      h('span', { class: 'tnum', text: String(n), 'aria-live': 'polite' }),
      h('button', { type: 'button', class: 'tbtn', 'aria-label': `One more ${f}`, text: '+', onclick: () => set(n + 1) })));
  });
}
function readDayForm() {
  const d = S.dayForm.data;
  d.day_date = $('#d-date').value; d.location = $('#d-location').value; d.water_temp_f = $('#d-temp').value; d.notes = $('#d-notes').value;
}
function dayFormChanged() {
  readDayForm();
  return JSON.stringify(S.dayForm.data) !== S.dayForm.orig || S.dayForm.newPhotos.length || S.dayForm.removePhotos.length
    || !!$('#d-addfish').value.trim() || !!$('#d-crew-other').value.trim();
}
function closeDayForm(force) {
  if (S.dayForm && force !== true && dayFormChanged()) { $('#day-discard').hidden = false; $('#day-discard').scrollIntoView({ block: 'nearest' }); return; }
  clearDayDraft(); S.dayForm = null; show('days');
}
// Match a typed fish name to one already used ("mahi-mahi" -> "Mahi-Mahi") so tallies add up.
function canonicalFish(name, existing) {
  const v = s(name).trim().slice(0, 60); if (!v) return '';
  const all = [...DAY_FISH, ...FISH, ...existing, ...daysList().flatMap(x => Object.keys(x.catches || {}))];
  return all.find(x => x.toLowerCase() === v.toLowerCase()) || v;
}
async function saveDayForm() {
  const f = S.dayForm; if (!f || f.saving) return;
  if (S.adding > 0) { toast('Wait a moment, the photo is still being added.'); return; }
  readDayForm();
  const d = f.data;
  const typed = canonicalFish($('#d-addfish').value, Object.keys(d.catches));
  if (typed) { d.catches[typed] = (+d.catches[typed] || 0) + 1; $('#d-addfish').value = ''; renderTally(); }
  const other = $('#d-crew-other').value.trim();
  if (other && !d.crew.includes(other)) d.crew.push(other.slice(0, 60));
  let temp = null;
  const raw0 = s(d.water_temp_f).trim();
  if (raw0) {
    const n = Number(/^\d*,\d{1,2}$/.test(raw0) ? raw0.replace(',', '.') : raw0.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 20 || n > 120) { $('#d-temp').focus(); toast('Water temp should be a number between 20 and 120.'); return; }
    temp = n;
  }
  const id = f.id || f.newId || uuid();
  f.saving = true; $('#day-save').disabled = true;
  const catches = {}; Object.entries(d.catches).forEach(([k, v]) => { if (+v > 0) catches[s(k).slice(0, 60)] = Math.min(999, Math.round(+v)); });
  const row = {
    id, boat_id: f.boat_id || S.boatId,
    day_date: /^\d{4}-\d{2}-\d{2}$/.test(s(d.day_date)) ? d.day_date : todayISO(),
    fishing_type: s(d.fishing_type).trim().slice(0, 60) || null, location: s(d.location).trim().slice(0, 120) || null,
    crew: d.crew.map(x => s(x).slice(0, 60)).slice(0, 30), seas: s(d.seas).trim() || null, water_temp_f: temp,
    catches, notes: s(d.notes).trim().slice(0, 4000) || null, deleted_at: null, created_at: d.created_at || new Date().toISOString(),
  };
  const i = S.dayOutbox.findIndex(o => o.id === id);
  const item = { id, boat_id: row.boat_id, row, error: null };
  if (i >= 0) S.dayOutbox[i] = item; else S.dayOutbox.push(item);
  if (!saveDayOutbox()) { f.saving = false; $('#day-save').disabled = false; toast("This phone is out of storage, so the day couldn't be saved. Free up space, then tap Save again.", 9000); return; }
  const kinds = Object.keys(catches);
  const photosOk = await commitFormPhotos(f, { day_id: id, boat_id: row.boat_id, fish: kinds.length === 1 ? kinds[0] : null });
  clearDayDraft(); S.dayForm = null;
  const removedNote = f.removePhotos.length ? ` · ${f.removePhotos.length} photo${f.removePhotos.length === 1 ? '' : 's'} removed` : '';
  toast(photosOk ? (f.id ? 'Fishing day updated' : 'Fishing day saved') + removedNote : 'Day saved, but a photo could not be stored on this phone.');
  show('days'); window.scrollTo(0, 0); syncNow();
}
function deleteDay() {
  const f = S.dayForm; if (!f?.id) return;
  const base = daysList().find(x => x.id === f.id) || f.data;
  const row = Object.fromEntries(DAY_COLS.map(k => [k, base[k] === undefined ? null : base[k]]));
  row.id = f.id; row.boat_id = f.boat_id || S.boatId; row.deleted_at = new Date().toISOString();
  const i = S.dayOutbox.findIndex(o => o.id === f.id);
  const item = { id: f.id, boat_id: row.boat_id, row, error: null };
  if (i >= 0) S.dayOutbox[i] = item; else S.dayOutbox.push(item);
  saveDayOutbox();
  clearDayDraft(); S.dayForm = null; toast('Fishing day deleted'); show('days'); syncNow();
}

// ------------------------------------------------------------------ wiring
function wire() {
  // auth
  $('#auth-tab-in').addEventListener('click', () => { S.authMode = 'in'; setMsg('#auth-msg', ''); renderAuth(); });
  $('#auth-tab-up').addEventListener('click', () => { S.authMode = 'up'; setMsg('#auth-msg', ''); renderAuth(); });
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-forgot').addEventListener('click', forgotPassword);
  $('#auth-back').addEventListener('click', () => { S.reauth = false; setMsg('#auth-msg', ''); S.view = 'log'; route(); });
  // onboarding
  $('#join-form').addEventListener('submit', ev => { ev.preventDefault(); joinBoat($('#join-code').value); });
  $('#create-form').addEventListener('submit', createBoat);
  $('#ob-back').addEventListener('click', () => { S.view = 'log'; route(); });
  $('#ob-signout').addEventListener('click', signOut);
  // main
  $$('.tab').forEach(b => b.addEventListener('click', () => { show(b.dataset.v); window.scrollTo(0, 0); if (b.dataset.v === 'boat') refreshCrew().catch(() => {}); }));
  $('#boat-switch').addEventListener('click', () => { if (PILOT_BOAT_ONLY && S.boats.length <= 1) return; show('boat'); setTimeout(() => $('#boat-list').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); });
  $('#status').addEventListener('click', () => {
    if (S.authOffline && navigator.onLine !== false) { startReauth(); return; }
    const waiting = S.outbox.length + S.photoOutbox.length + S.dayOutbox.length;
    if (navigator.onLine === false) { toast(waiting ? `No signal. ${waiting} waiting on this phone; they upload when you get signal.` : 'No signal. The log still works; new entries upload later.'); return; }
    toast('Syncing…', 1500); syncNow();
  });
  $('#btn-new').addEventListener('click', () => openForm(null));
  $$('#range button').forEach(b => b.addEventListener('click', () => { S.range = b.dataset.r; renderSummary(); }));
  $('#btn-export').addEventListener('click', doExport);
  // boat tab
  $('#btn-share-invite').addEventListener('click', shareInvite);
  $('#btn-copy-code').addEventListener('click', () => copyText(fmtCode(curBoat()?.invite_code), 'Code copied.'));
  $('#btn-regen').addEventListener('click', () => { $('#regen-confirm').hidden = false; $('#btn-regen').hidden = true; });
  $('#regen-no').addEventListener('click', () => { $('#regen-confirm').hidden = true; $('#btn-regen').hidden = false; });
  $('#regen-yes').addEventListener('click', regenInvite);
  $('#angler-add-form').addEventListener('submit', ev => { ev.preventDefault(); const v = $('#angler-add').value.trim(); if (!v) return; $('#angler-add').value = ''; saveAnglers([...anglerOptions(), v]); });
  $('#boat-form').addEventListener('submit', saveBoatDetails);
  $('#btn-add-boat').addEventListener('click', () => { setMsg('#join-msg', ''); setMsg('#create-msg', ''); show('onboard'); window.scrollTo(0, 0); });
  $('#me-form').addEventListener('submit', saveMyName);
  $('#btn-signout').addEventListener('click', signOut);
  $('#btn-leave').addEventListener('click', () => { $('#leave-confirm').hidden = false; });
  $('#leave-no').addEventListener('click', () => { $('#leave-confirm').hidden = true; });
  $('#leave-yes').addEventListener('click', leaveBoat);
  // form
  $('#btn-back').addEventListener('click', () => closeForm());
  $('#btn-cancel').addEventListener('click', () => closeForm());
  $('#discard-no').addEventListener('click', () => { $('#discard-confirm').hidden = true; });
  $('#discard-yes').addEventListener('click', () => closeForm(true));
  $('#btn-save').addEventListener('click', saveForm);
  $('#btn-now').addEventListener('click', () => { $('#f-catch_date').value = todayISO(); $('#f-bite_time').value = nowHM(); formChanged(); });
  $('#carry-clear').addEventListener('click', () => {
    CARRY.forEach(k => { S.form.data[k] = ''; }); ['location', 'water_temp_f'].forEach(k => { $('#f-' + k).value = ''; });
    syncChips('tide'); syncChips('seas'); $('#carry').hidden = true; S.form.carried = false; formChanged();
  });
  ['f-catch_date', 'f-bite_time', 'f-angler-other', ...TEXT_FIELDS.map(k => 'f-' + k)].forEach(id => $('#' + id).addEventListener('input', () => {
    if (!S.form) return;
    if (id === 'f-angler-other' && $('#f-angler-other').value.trim()) { S.form.data.angler = ''; syncChips('angler'); }
    formChanged();
  }));
  $('#btn-gps').addEventListener('click', markGps);
  // photos
  $('#btn-add-photos').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', ev => { const files = [...ev.target.files]; ev.target.value = ''; addPhotosFromGallery(files); });
  $('#btn-f-photo').addEventListener('click', () => $('#f-photo-input').click());
  $('#f-photo-input').addEventListener('change', async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; if (!S.form) return;
    const f = S.form; const staged = await stageFiles(files); if (S.form !== f) return;
    f.newPhotos.push(...staged); renderFormPhotos('#f-photos', f, photosFor(f.id)); saveDraft();
  });
  $('#pv-back').addEventListener('click', closePhoto);
  $('#pv-prev').addEventListener('click', () => stepPhoto(-1));
  $('#pv-next').addEventListener('click', () => stepPhoto(1));
  $('#pv-save').addEventListener('click', () => savePhotoDetails(false));
  $('#pv-caption').addEventListener('input', () => { if (S.pv) S.pv.changed = true; });
  $('#pv-share').addEventListener('click', sharePhoto);
  $('#pv-del').addEventListener('click', () => { $('#pv-del-confirm').hidden = false; $('#pv-del').hidden = true; });
  $('#pv-del-no').addEventListener('click', () => { $('#pv-del-confirm').hidden = true; $('#pv-del').hidden = false; });
  $('#pv-del-yes').addEventListener('click', deletePhoto);
  // fishing days
  $('#btn-new-day').addEventListener('click', () => openDayForm(null));
  ['#d-date', '#d-location', '#d-temp', '#d-notes', '#d-crew-other'].forEach(sel => $(sel).addEventListener('input', dayDraftSoon));
  $('#pv-other').addEventListener('input', () => {
    if (!S.pv) return; const v = $('#pv-other').value.trim().slice(0, 60);
    if (v) { S.pv.fish = v; S.pv.changed = true; $$('#pv-fish .chip[data-v]').forEach(b => b.setAttribute('aria-pressed', 'false')); }
  });
  $('#day-back').addEventListener('click', () => closeDayForm());
  $('#day-cancel').addEventListener('click', () => closeDayForm());
  $('#day-discard-no').addEventListener('click', () => { $('#day-discard').hidden = true; });
  $('#day-discard-yes').addEventListener('click', () => closeDayForm(true));
  $('#day-save').addEventListener('click', saveDayForm);
  $('#day-del').addEventListener('click', () => { $('#day-del-confirm').hidden = false; $('#day-del').hidden = true; });
  $('#day-del-no').addEventListener('click', () => { $('#day-del-confirm').hidden = true; $('#day-del').hidden = false; });
  $('#day-del-yes').addEventListener('click', deleteDay);
  $('#d-addfish-form').addEventListener('submit', ev => {
    ev.preventDefault(); if (!S.dayForm) return;
    const v = $('#d-addfish').value.trim().slice(0, 60); if (!v) return;
    $('#d-addfish').value = ''; const name = canonicalFish(v, Object.keys(S.dayForm.data.catches));
    S.dayForm.data.catches[name] = (+S.dayForm.data.catches[name] || 0) + 1; renderTally(); dayDraftSoon();
  });
  $('#btn-d-photo').addEventListener('click', () => $('#d-photo-input').click());
  $('#d-photo-input').addEventListener('change', async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; if (!S.dayForm) return;
    const f = S.dayForm; const staged = await stageFiles(files); if (S.dayForm !== f) return;
    f.newPhotos.push(...staged); renderFormPhotos('#d-photos', f, photosForDay(f.id)); dayDraftSoon();
  });
  $('#gps-clear').addEventListener('click', () => { if (!S.form) return; S.form.data.lat = ''; S.form.data.lng = ''; renderGps(); formChanged(); });
  $('#btn-del').addEventListener('click', () => {
    $('#del-text').textContent = `Delete the ${fmtTime(S.form.data.bite_time) || ''} ${s(S.form.data.species) || 'bite'}? Everyone on the boat stops seeing it.`.replace(/\s+/g, ' ');
    $('#del-confirm').hidden = false; $('#btn-del').hidden = true;
  });
  $('#del-keep').addEventListener('click', () => { $('#del-confirm').hidden = true; $('#btn-del').hidden = false; });
  $('#del-yes').addEventListener('click', deleteFromForm);

  // connectivity
  addEventListener('online', () => { S.lastSyncErr = null; render(); syncNow(); refreshAccount(); });
  addEventListener('offline', () => renderHeaderIfMain());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncNow(); if (S.view === 'log') renderLog(); } });
  setInterval(() => { if (!document.hidden && S.user) syncNow(); }, 45000);
  setInterval(() => { if (S.view === 'log') renderLog(); }, 60000); // roll "Today" over at midnight
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; render(); });
  addEventListener('appinstalled', () => { S.installEvt = null; render(); });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (['form', 'dayform', 'photo', 'auth'].includes(S.view)) return; // never reload in the middle of logging or signing in
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
}

async function boot() {
  registerSW();
  wire();
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (join) { S.pendingJoin = join.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); LS.set(K.pendingJoin, S.pendingJoin); }
  else S.pendingJoin = LS.get(K.pendingJoin, null);
  if (S.pendingJoin) { $('#join-code').value = fmtCode(S.pendingJoin); $('#auth-code').value = fmtCode(S.pendingJoin); S.authMode = 'up'; }
  if (join) history.replaceState(null, '', location.pathname + location.hash);
  // Email links: a password-reset link carries type=recovery; an expired link carries error_code.
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('type') === 'recovery') { S.recovery = true; S.authMode = 'in'; }
  if (hp.get('error_code')) { S.authLinkErr = hp.get('error_code'); S.authMode = 'in'; history.replaceState(null, '', location.pathname + location.search); }

  // Offline-first: show the last signed-in person's cached log straight away.
  const last = LS.get(K.lastUser, null);
  if (last && last.id) { S.user = last; loadUserCache(last.id); S.view = 'log'; route(); if (!restoreDayDraft()) restoreDraft(); }

  const lib = window.supabase;
  if (!lib || !lib.createClient) { S.authOffline = !!last; if (!last) show('auth'); render(); return; }
  S.sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bl1.auth' },
    // Look up fetch at call time (lets tests simulate no signal) and give every request a deadline,
    // so a connection that hangs offshore can't freeze syncing or the sign-in buttons.
    global: { fetch: (url, opts = {}) => window.fetch(url, { ...opts, signal: opts.signal || timeoutSignal(/\/storage\/v1\//.test(String(url?.url || url)) ? 180000 : 25000) }) },
  });
  S.sb.auth.onAuthStateChange((event, session) => {
    // run outside the auth callback (calling Supabase inside it can deadlock)
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.authMode = 'in'; show('auth'); setMsg('#auth-msg', 'Choose a new password.', 'ok'); return; }
      if (event === 'SIGNED_OUT') { if (S.user) handleSignedOut(); return; }
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && (!S.user || S.user.id !== session.user.id || S.authOffline || !S.ready)) onSignedIn(session.user);
    }, 0);
  });
  let session = null, err = null;
  try { const r = await S.sb.auth.getSession(); session = r.data?.session || null; err = r.error || null; }
  catch (e) { err = e; }
  if (session && S.recovery) { show('auth'); setMsg('#auth-msg', 'Choose a new password.', 'ok'); return; }
  if (session) { await onSignedIn(session.user); return; }
  if (last && (err || navigator.onLine === false)) { S.authOffline = isNetErr(err) || navigator.onLine === false ? false : true; render(); return; }
  if (last) { S.authOffline = true; render(); return; } // keep their offline bites visible; banner asks them to sign in
  if (S.authLinkErr) S.authMode = 'in';
  show('auth');
}

boot();
