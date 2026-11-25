// Billfish Log — offline-first catch log for billfish crews.
// Data flow: every save goes to a local outbox first (localStorage), then uploads to Supabase when there is signal.
// Each boat's catches are cached on the device so the log opens and works with no connection.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
  boats: u => `bl1.u.${u}.boats`,
  boatId: u => `bl1.u.${u}.boatId`,
  outbox: u => `bl1.u.${u}.outbox`,
  profile: u => `bl1.u.${u}.profile`,
  draft: u => `bl1.u.${u}.draft`,
  rows: b => `bl1.b.${b}.rows`,
  cursor: b => `bl1.b.${b}.cursor`,
  crew: b => `bl1.b.${b}.crew`,
};

// ------------------------------------------------------------------ state
const S = {
  sb: null, user: null, authOffline: false, profile: null,
  boats: [], boatId: null, crew: [], rows: new Map(), outbox: [],
  view: 'log', range: 'season', listLimit: LIST_PAGE,
  syncing: false, syncAgain: false, lastSyncAt: null, lastSyncErr: null,
  channel: null, flashId: null, form: null, pendingJoin: null, installEvt: null,
  authMode: 'in', signingInFor: null, recovery: false, signoutArmed: false,
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
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function setMsg(sel, text, kind) { const el = $(sel); el.textContent = text || ''; el.className = 'form-msg' + (kind ? ' ' + kind : ''); }
function isNetErr(e) {
  if (!e) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
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
  const want = LS.get(K.boatId(uid), null);
  S.boatId = S.boats.some(b => b.id === want) ? want : (S.boats[0]?.id || null);
  loadBoatCache();
}
function loadBoatCache() {
  S.rows = new Map(Object.entries(S.boatId ? (LS.get(K.rows(S.boatId), {}) || {}) : {}));
  S.crew = S.boatId ? (LS.get(K.crew(S.boatId), []) || []) : [];
  S.listLimit = LIST_PAGE;
}
const saveRows = () => { if (S.boatId) LS.set(K.rows(S.boatId), Object.fromEntries(S.rows)); };
const saveOutbox = () => { if (S.user) LS.set(K.outbox(S.user.id), S.outbox); };
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
const MAIN_VIEWS = ['log', 'summary', 'boat'];
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
  $$('.tab').forEach(b => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  render();
}
function route() {
  if (!S.user) return show('auth');
  if (!S.boats.length) return show('onboard');
  if (!MAIN_VIEWS.includes(S.view) && S.view !== 'form') return show('log');
  show(S.view);
}

function render() {
  if (MAIN_VIEWS.includes(S.view)) renderHeader();
  if (S.view === 'log') renderLog();
  else if (S.view === 'summary') renderSummary();
  else if (S.view === 'boat') renderBoat();
  else if (S.view === 'onboard') renderOnboard();
  else if (S.view === 'auth') renderAuth();
}

// ------------------------------------------------------------------ header + status
function syncState() {
  const n = S.outbox.length;
  const errs = S.outbox.filter(o => o.error).length;
  const offline = navigator.onLine === false || S.authOffline || !S.sb;
  if (errs) return ['bad', `${errs} ${errs === 1 ? 'bite needs' : 'bites need'} fixing`];
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
  $('#head-title').textContent = S.view === 'summary' ? 'Summary' : S.view === 'boat' ? 'Boat & crew' : 'Billfish Log';
  const [cls, text] = syncState();
  $('#status').className = 'status ' + cls; $('#status-text').textContent = text;

  const ban = $('#banner'); ban.replaceChildren(); let msg = null;
  const errs = S.outbox.filter(o => o.error);
  if (errs.length) msg = [`${errs.length === 1 ? 'A bite' : errs.length + ' bites'} couldn't upload. `, `Tap the bite marked "Couldn't upload" to see why and fix it. It's kept on this phone until then.`];
  else if (S.authOffline && navigator.onLine !== false) msg = ['Signed out on the server. ', 'Your bites are safe on this phone. Sign in again to upload them.'];
  else if (S.lastSyncErr && navigator.onLine !== false && !S.syncing) msg = ['No signal right now. ', 'Keep logging. Bites are saved on this phone and upload when you get signal back.'];
  ban.hidden = !msg; if (msg) ban.append(h('b', { text: msg[0] }), msg[1]);
  if (msg && S.authOffline && navigator.onLine !== false) ban.append(' ', h('button', { class: 'link', type: 'button', text: 'Sign in', onclick: () => { S.user = null; show('auth'); } }));

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
  return h('button', { type: 'button', class: 'row' + (S.flashId === e.id ? ' flash' : ''), 'aria-label': `Edit ${fmtTime(e.bite_time) || ''} ${s(e.species) || 'bite'}`, onclick: () => openForm(e.id) },
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

  // boats
  const bl = $('#boat-list'); bl.replaceChildren();
  S.boats.forEach(x => bl.append(h('button', { type: 'button', 'aria-current': String(x.id === S.boatId), onclick: () => switchBoat(x.id) },
    h('span', { text: x.name }), h('small', { text: x.id === S.boatId ? 'Open now' : (x.role === 'captain' ? 'Captain' : 'Crew') }))));

  // account
  $('#me-email').textContent = S.user?.email ? `Signed in as ${S.user.email}` : '';
  if (document.activeElement !== $('#me-name')) $('#me-name').value = s(S.profile?.display_name);
  const so = $('#btn-signout');
  so.textContent = S.signoutArmed ? `Sign out anyway (${S.outbox.length} not uploaded)` : 'Sign out';
  so.className = 'btn' + (S.signoutArmed ? ' danger' : '');
  $('#leave-text').textContent = `Leave ${b.name}? You'll stop seeing its log. Bites you logged stay in the boat's log.`;

  renderInstallCard();
}

// ------------------------------------------------------------------ install (home screen)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installSteps() {
  if (S.installEvt) return h('div', { class: 'stack' }, h('p', { text: 'Install Billfish Log so it opens from your home screen like any other app, full screen and offline.' }),
    h('button', { class: 'btn primary', type: 'button', text: 'Install app', onclick: async () => { const e = S.installEvt; S.installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) {} render(); } }));
  if (isIOS()) return h('div', {}, h('p', { text: 'Open this page in Safari, then:' }),
    h('ol', { class: 'steps' }, h('li', { text: 'Tap the Share button (the square with an arrow).' }), h('li', { text: 'Scroll down and tap "Add to Home Screen".' }), h('li', { text: 'Tap Add. Open Billfish Log from the new icon from now on.' })));
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
    h('b', { text: 'Put Billfish Log on your home screen. ' }),
    isIOS() && !S.installEvt ? 'In Safari, tap Share, then "Add to Home Screen". ' : '',
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
  if (S.pendingJoin && !$('#auth-msg').textContent) setMsg('#auth-msg', `Sign in or create an account to join the boat with code ${fmtCode(S.pendingJoin)}.`, 'ok');
}
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
  busy('#auth-submit', true); setMsg('#auth-msg', '');
  try {
    if (S.authMode === 'up') {
      const { data, error } = await S.sb.auth.signUp({ email, password: pass, options: { data: { display_name: name }, emailRedirectTo: appUrl() } });
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
  if (S.signingInFor === user.id) { route(); return; }
  S.signingInFor = user.id;
  try {
    await refreshAccount();
    if (S.pendingJoin) await joinBoat(S.pendingJoin, true);
  } finally { S.signingInFor = null; }
  if (S.view === 'auth' || S.view === 'loading' || (S.view === 'onboard' && S.boats.length)) S.view = 'log';
  route();
  restoreDraft();
  subscribeRealtime();
  syncNow();
}
function handleSignedOut() {
  stopRealtime();
  S.user = null; S.boats = []; S.boatId = null; S.rows = new Map(); S.outbox = []; S.crew = []; S.profile = null;
  S.lastSyncAt = null; S.lastSyncErr = null; S.signoutArmed = false;
  LS.del(K.lastUser);
  show('auth');
}
async function signOut() {
  if (S.outbox.length && !S.signoutArmed) { S.signoutArmed = true; renderBoat(); toast(`${S.outbox.length} ${S.outbox.length === 1 ? 'bite has' : 'bites have'} not uploaded. They stay on this phone and upload when you sign back in.`, 6000); return; }
  const uid = S.user?.id;
  if (uid) { // forget cached boat data on this device; keep any un-uploaded bites
    (LS.get(K.boats(uid), []) || []).forEach(b => { LS.del(K.rows(b.id)); LS.del(K.cursor(b.id)); LS.del(K.crew(b.id)); });
    LS.del(K.boats(uid)); LS.del(K.boatId(uid)); LS.del(K.profile(uid)); LS.del(K.draft(uid));
  }
  try { await S.sb?.auth.signOut({ scope: 'local' }); } catch (e) {}
  handleSignedOut();
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
    if (!S.boats.some(b => b.id === S.boatId)) { S.boatId = S.boats[0]?.id || null; loadBoatCache(); subscribeRealtime(); }
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
  S.pendingJoin = null;
  if (error) { const m = friendly(error); setMsg('#join-msg', m, 'bad'); if (quiet) toast(m, 5000); return false; }
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
  if (await rpcAction('remove_member', { p_boat: S.boatId, p_user: c.user_id }, `${c.name || 'They'} were removed from the boat.`)) await refreshCrew().catch(() => {});
}
async function leaveBoat() {
  const b = curBoat(); if (!b) return;
  if (await rpcAction('remove_member', { p_boat: b.id, p_user: S.user.id }, `You left ${b.name}.`)) {
    LS.del(K.rows(b.id)); LS.del(K.cursor(b.id)); LS.del(K.crew(b.id));
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
  const { error } = await q(S.sb.from('boats').update({ settings }).eq('id', b.id));
  if (error) { toast(friendly(error), 5000); return; }
  b.settings = settings; saveBoats(); renderBoat();
}
async function saveBoatDetails(ev) {
  ev.preventDefault();
  const b = curBoat(); if (!b) return;
  const name = $('#boat-name').value.trim(), port = $('#boat-port').value.trim();
  if (!name) { setMsg('#boat-msg', 'The boat needs a name.', 'bad'); return; }
  if (!S.sb || navigator.onLine === false) { setMsg('#boat-msg', 'Saving boat details needs signal.', 'bad'); return; }
  const { error } = await q(S.sb.from('boats').update({ name, home_port: port }).eq('id', b.id));
  if (error) { setMsg('#boat-msg', friendly(error), 'bad'); return; }
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
  const text = `Join ${b.name} on Billfish Log so we all log bites in one place. Invite code: ${fmtCode(b.invite_code)}`;
  if (navigator.share) {
    try { await navigator.share({ title: `Join ${b.name} on Billfish Log`, text, url: link }); return; }
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
  saveOutbox();
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
    await pushOutbox();
    if (S.boatId) await pullBoat(S.boatId);
    S.lastSyncAt = Date.now(); S.lastSyncErr = null;
  } catch (e) {
    S.lastSyncErr = e;
    if (!isNetErr(e)) console.warn('sync', e);
    if (/jwt|expired|not authenticated/i.test(s(e?.message))) {
      const { data } = await S.sb.auth.refreshSession().catch(() => ({ data: null }));
      if (!data?.session && navigator.onLine !== false) S.authOffline = true;
    }
  } finally {
    S.syncing = false;
    if (S.view !== 'form') render(); else renderHeaderIfMain();
    if (S.syncAgain) { S.syncAgain = false; setTimeout(syncNow, 300); }
  }
}
function renderHeaderIfMain() { if (MAIN_VIEWS.includes(S.view)) renderHeader(); }
async function pushOutbox() {
  for (const item of S.outbox.slice()) {
    if (item.error && item.errorRow === item.row) continue; // already rejected; waits for the user to fix it
    const payload = {};
    ROW_COLS.forEach(k => { payload[k] = item.row[k] === undefined ? null : item.row[k]; });
    payload.id = item.id; payload.boat_id = item.boat_id;
    const { error } = await q(S.sb.from('catches').upsert(payload, { onConflict: 'id' }));
    if (error) {
      if (isNetErr(error) || /jwt|expired/i.test(s(error.message))) throw error;
      item.error = friendly(error); item.errorRow = item.row; saveOutbox();
      continue;
    }
    const i = S.outbox.indexOf(item);
    if (i >= 0) { // only drop it if it wasn't edited again while uploading
      S.outbox.splice(i, 1); saveOutbox();
      if (item.boat_id === S.boatId) {
        if (item.row.deleted_at) S.rows.delete(item.id); else S.rows.set(item.id, { ...item.row });
        saveRows();
      }
    }
  }
}
async function pullBoat(bid) {
  const cursor = LS.get(K.cursor(bid), null);
  const since = cursor ? new Date(parseTs(cursor) - 5 * 60 * 1000).toISOString() : null;
  const rows = bid === S.boatId ? S.rows : new Map(Object.entries(LS.get(K.rows(bid), {}) || {}));
  const pending = outboxMap();
  let maxTs = cursor, from = 0;
  for (let page = 0; page < 100; page++) {
    let qb = S.sb.from('catches').select('*').eq('boat_id', bid).order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 999);
    if (since) qb = qb.gte('updated_at', since);
    else qb = qb.is('deleted_at', null);
    const { data, error } = await q(qb, 30000);
    if (error) throw error;
    for (const r of data) {
      if (!maxTs || parseTs(r.updated_at) > parseTs(maxTs)) maxTs = r.updated_at;
      if (pending.has(r.id)) continue; // this phone's newer edit wins until it uploads
      if (r.deleted_at) rows.delete(r.id); else rows.set(r.id, r);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  if (bid !== S.boatId && rows === S.rows) return;
  LS.set(K.rows(bid), Object.fromEntries(rows));
  if (maxTs) LS.set(K.cursor(bid), maxTs);
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
  if (draft) S.form = draft;
  else if (id) {
    const e = all.find(x => x.id === id); if (!e) return;
    const d = {}; ROW_COLS.forEach(k => { d[k] = e[k] == null ? '' : e[k]; }); d.created_at = e.created_at;
    S.form = { id, boat_id: e.boat_id || S.boatId, data: d, carried: false, error: e._error };
  } else {
    const t = todayISO(); const d = { catch_date: t, bite_time: nowHM() };
    const last = all.find(e => e.catch_date === t);
    let carried = false;
    if (last) CARRY.forEach(k => { if (s(last[k])) { d[k] = last[k]; carried = true; } });
    S.form = { id: null, boat_id: S.boatId, data: d, carried: carried ? fmtTime(last.bite_time) || 'last' : false };
  }
  const f = S.form;
  $('#form-title').textContent = f.id ? 'Edit bite' : 'New bite';
  $('#btn-save').textContent = f.id ? 'Save changes' : 'Save bite';
  $('#carry').hidden = !f.carried;
  if (f.carried) $('#carry-text').textContent = `Tide, location, water temp and seas copied from the ${f.carried} bite.`;
  $('#del-zone').hidden = !f.id; $('#del-confirm').hidden = true; $('#btn-del').hidden = false;
  fillDatalists(); setFormFields(); updateMissing();
  if (f.error) $('#missing-note').textContent = `Couldn't upload: ${f.error} Fix it and save again.`;
  show('form'); window.scrollTo(0, 0);
  saveDraft();
}
function updateMissing() {
  const miss = missing(S.form.data);
  $('#missing-note').textContent = miss.length ? `Still missing: ${miss.join(', ')}. You can save now and fill it in later.` : '';
}
let draftTimer = null;
function formChanged() { updateMissing(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); }
function saveDraft() { if (!S.form || !S.user) return; readFormFields(); LS.set(K.draft(S.user.id), S.form); }
function restoreDraft() {
  if (!S.user || S.view === 'form') return;
  const d = LS.get(K.draft(S.user.id), null);
  if (d && d.data && typeof d.data === 'object' && d.boat_id && S.boats.some(b => b.id === d.boat_id)) {
    if (d.boat_id !== S.boatId) { S.boatId = d.boat_id; saveBoats(); loadBoatCache(); }
    openForm(null, d); toast('Picked up your unsaved bite.');
  }
}
function closeForm() { if (S.user) LS.del(K.draft(S.user.id)); S.form = null; show('log'); }
function fieldError(k, msg) {
  const el = $('#f-' + k); el.setAttribute('aria-invalid', 'true');
  const fld = el.closest('.fld'); fld.querySelector('.err')?.remove();
  fld.append(h('div', { class: 'err', text: msg }));
}
function saveForm() {
  readFormFields();
  const f = S.form, src = f.data, row = {};
  let firstBad = null;
  TEXT_FIELDS.forEach(k => { const el = $('#f-' + k); el.removeAttribute('aria-invalid'); el.closest('.fld').querySelector('.err')?.remove(); });
  for (const [k, max] of Object.entries(MAXLEN)) { const v = s(src[k]).trim(); row[k] = v ? v.slice(0, max) : null; }
  for (const [k, [lo, hi, label]] of Object.entries(NUMS)) {
    const raw = s(src[k]).trim().replace(/,/g, '');
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
  row.id = f.id || uuid();
  row.boat_id = f.boat_id || S.boatId;
  row.created_at = src.created_at || new Date().toISOString();
  queueRow(row);
  S.flashId = row.id;
  if (S.user) LS.del(K.draft(S.user.id));
  const offline = navigator.onLine === false || !S.sb || S.authOffline || !!S.lastSyncErr;
  toast(f.id ? (offline ? 'Changes saved on this phone. They upload when you have signal.' : 'Changes saved') : (offline ? 'Bite saved on this phone. It uploads when you have signal.' : 'Bite saved'));
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
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false;
    if (!S.form) return;
    S.form.data.lat = Math.round(pos.coords.latitude * 1e6) / 1e6; S.form.data.lng = Math.round(pos.coords.longitude * 1e6) / 1e6;
    renderGps(); formChanged();
  }, err => {
    btn.disabled = false; renderGps();
    toast(err.code === 1 ? 'Location is turned off for this app. Allow it in your phone settings to mark GPS.' : "Couldn't get a GPS fix. Try again in open sky.", 5000);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}

// ------------------------------------------------------------------ wiring
function wire() {
  // auth
  $('#auth-tab-in').addEventListener('click', () => { S.authMode = 'in'; setMsg('#auth-msg', ''); renderAuth(); });
  $('#auth-tab-up').addEventListener('click', () => { S.authMode = 'up'; setMsg('#auth-msg', ''); renderAuth(); });
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-forgot').addEventListener('click', forgotPassword);
  // onboarding
  $('#join-form').addEventListener('submit', ev => { ev.preventDefault(); joinBoat($('#join-code').value); });
  $('#create-form').addEventListener('submit', createBoat);
  $('#ob-back').addEventListener('click', () => { S.view = 'log'; route(); });
  $('#ob-signout').addEventListener('click', signOut);
  // main
  $$('.tab').forEach(b => b.addEventListener('click', () => { show(b.dataset.v); window.scrollTo(0, 0); if (b.dataset.v === 'boat') refreshCrew().catch(() => {}); }));
  $('#boat-switch').addEventListener('click', () => { show('boat'); setTimeout(() => $('#boat-list').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); });
  $('#status').addEventListener('click', () => {
    if (S.authOffline && navigator.onLine !== false) { S.user = null; show('auth'); return; }
    if (navigator.onLine === false) { toast(S.outbox.length ? `No signal. ${S.outbox.length} waiting on this phone; they upload when you get signal.` : 'No signal. The log still works; new bites upload later.'); return; }
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
  $('#btn-back').addEventListener('click', closeForm);
  $('#btn-cancel').addEventListener('click', closeForm);
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
  $('#gps-clear').addEventListener('click', () => { S.form.data.lat = ''; S.form.data.lng = ''; renderGps(); formChanged(); });
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
    if (S.view === 'form') return; // never reload in the middle of logging a bite
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
}

async function boot() {
  wire();
  registerSW();
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (join) { S.pendingJoin = join.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); $('#join-code').value = fmtCode(S.pendingJoin); }
  if (join || params.has('code')) history.replaceState(null, '', location.pathname + location.hash);

  // Offline-first: show the last signed-in person's cached log straight away.
  const last = LS.get(K.lastUser, null);
  if (last && last.id) { S.user = last; loadUserCache(last.id); S.view = 'log'; route(); restoreDraft(); }

  const lib = window.supabase;
  if (!lib || !lib.createClient) { S.authOffline = !!last; if (!last) show('auth'); render(); return; }
  S.sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bl1.auth' },
    global: { fetch: (...args) => window.fetch(...args) }, // look up fetch at call time (lets tests simulate no signal)
  });
  S.sb.auth.onAuthStateChange((event, session) => {
    // run outside the auth callback (calling Supabase inside it can deadlock)
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.authMode = 'in'; show('auth'); setMsg('#auth-msg', 'Choose a new password.', 'ok'); return; }
      if (event === 'SIGNED_OUT') { if (S.user) handleSignedOut(); return; }
      if (session?.user && event === 'SIGNED_IN' && (!S.user || S.user.id !== session.user.id || S.authOffline)) onSignedIn(session.user);
    }, 0);
  });
  let session = null, err = null;
  try { const r = await S.sb.auth.getSession(); session = r.data?.session || null; err = r.error || null; }
  catch (e) { err = e; }
  if (S.recovery) return;
  if (session) { await onSignedIn(session.user); return; }
  if (last && (err || navigator.onLine === false)) { S.authOffline = isNetErr(err) || navigator.onLine === false ? false : true; render(); return; }
  if (last) { S.authOffline = true; render(); return; } // keep their offline bites visible; banner asks them to sign in
  show('auth');
}

boot();
