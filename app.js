(() => {
'use strict';

const KEY = 'dansk.state.v1', AI_KEY = 'dansk.ai.key';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), overlay = $('#overlay'), sheet = $('#sheet'), tabbar = $('#tabbar'), toastEl = $('#toast');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// ───────── Dates (local calendar days as YYYY-MM-DD, which sort correctly as strings) ─────────
const dstr = (d = new Date()) => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return dstr(d); };
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const today = () => dstr();

// ───────── Course content index ─────────
const ITEM = {}, UNIT = {};
UNITS.forEach(u => {
  UNIT[u.id] = u;
  u.items = u.items.map((r, i) => (ITEM[u.id + ':' + i] = { id: u.id + ':' + i, unit: u.id, m: u.m, da: r[0], en: r[1], ex: r[2] || '', exEn: r[3] || '' }));
});
const MOD = id => MODULES.find(m => m.id === id);
const modItems = m => UNITS.filter(u => u.m === m).flatMap(u => u.items);

// ───────── State ─────────
// custom  = the user's vocabulary bank: [{id, da, en, notes, added}]
// vs      = learning record per vocabulary word: {n, ok, bad, step, iv, due, last, hist}
// items   = spaced-repetition record per course word
const DEF_INTERVALS = [2, 4, 10, 20, 40, 80, 160];
const fresh = () => ({ app: 'dansk', v: 2, created: today(), onboarded: false, module: 1, newPerDay: 8, slow: false, voice: '', hintOff: false, items: {}, days: {}, drills: {}, custom: [], vs: {}, sessions: [], cfg: { minutes: 20, intervals: DEF_INTERVALS.slice() }, vsort: 'new', lastBackup: '' });
function migrate(s) {
  s.cfg = Object.assign({ minutes: 20, intervals: DEF_INTERVALS.slice() }, s.cfg);
  // Earlier versions scheduled the user's own words together with course words.
  s.custom.forEach(c => {
    const old = s.items['c:' + c.id];
    if (old && !s.vs[c.id]) s.vs[c.id] = { n: old.reps, ok: old.reps, bad: old.lapses || 0, step: Math.min(old.reps, 2), iv: old.iv, due: old.due, last: old.first, hist: [] };
    delete s.items['c:' + c.id];
  });
  return s;
}
function load() {
  try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.items) return migrate(Object.assign(fresh(), r)); } catch (e) { /* fall through to a fresh state */ }
  return fresh();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save progress on this device'); } }
const day = () => (S.days[today()] = S.days[today()] || { rev: 0, ok: 0, new: 0, drill: 0, dok: 0, sec: 0 });

// ───────── Vocabulary bank ─────────
const byId = id => S.custom.find(c => c.id === id);
const vs = id => S.vs[id] || { n: 0, ok: 0, bad: 0, step: 0, iv: 0, due: '', last: '', hist: [] };
const vsW = id => (S.vs[id] = S.vs[id] || vs(id));
const statusOf = c => { const v = vs(c.id); return !v.n ? 'new' : v.iv >= 40 ? 'mastered' : v.step >= 3 ? 'reviewing' : 'learning'; };
const posOf = c => /^at\s/i.test(c.da) ? 'verb' : /^(en|et)\s/i.test(c.da) ? 'noun' : /\s/.test(c.da.trim()) ? 'expression' : '';
const isDueV = c => { const v = vs(c.id); return !v.n || v.due <= today(); };
const overdueV = c => { const v = vs(c.id); return v.n > 0 && v.due < today(); };
const intervalFor = step => { const a = S.cfg.intervals; return step <= a.length ? a[Math.max(0, step - 1)] : a[a.length - 1] * Math.pow(2, step - a.length); };
const newId = () => Date.now().toString(36) + rnd(100, 999);

// Applies one submitted answer to a word's learning record. Scheduling is rule-based only.
// kind: 'ok' | 'part' | 'bad'. A correct answer on a word that is not yet due, or on a second
// attempt within the same session, is logged but does not lengthen the interval.
function record(c, kind, answer, src, noAdvance) {
  const v = vsW(c.id), t = today(), early = v.n > 0 && v.due > t;
  v.n++; v.last = t;
  v.hist.unshift({ d: t, k: kind, a: answer, s: src }); v.hist = v.hist.slice(0, 12);
  if (kind === 'ok') {
    v.ok++;
    if (!noAdvance && !early) { v.step++; v.iv = intervalFor(v.step); v.due = addDays(t, v.iv); }
  } else {
    v.bad++; v.step = kind === 'part' ? Math.max(0, v.step - 1) : 0; v.iv = 1; v.due = addDays(t, 1);
  }
}

// ───────── Course helpers ─────────
const learned = m => modItems(m).filter(it => S.items[it.id]).length;
const dueIds = () => { const t = today(); return Object.keys(S.items).filter(id => ITEM[id] && S.items[id].due <= t); };
const freshPool = () => modItems(S.module).filter(it => !S.items[it.id]);
const newLeft = () => Math.min(Math.max(0, S.newPerDay - day().new), freshPool().length);
function markKnown(m) {
  const t = today();
  modItems(m).forEach(it => { if (!S.items[it.id]) S.items[it.id] = { iv: rnd(30, 90), ef: 2.5, due: addDays(t, rnd(7, 60)), reps: 2, lapses: 0, first: t }; });
}

// ───────── Speech ─────────
let voices = [];
const canSpeak = 'speechSynthesis' in window;
function loadVoices() { if (canSpeak) voices = speechSynthesis.getVoices().filter(v => /^da([-_]|$)/i.test(v.lang)); }
const hasVoice = () => { if (!voices.length) loadVoices(); return voices.length > 0; };
const pickVoice = () => voices.find(v => v.name === S.voice) || voices.find(v => /premium|enhanced|natural/i.test(v.name)) || voices[0];
function speak(text, slow) {
  if (!canSpeak || !text) return;
  hasVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/…/g, '').replace(/\s[–-]\s/g, ', '));
  u.lang = 'da-DK';
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = slow ? 0.55 : (S.slow ? 0.75 : 0.95);
  speechSynthesis.speak(u);
}
if (canSpeak) {
  loadVoices();
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { loadVoices(); if (tab === 'settings' && overlay.hidden && !typing()) render(); });
}

// ───────── Small UI pieces ─────────
const SPK = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const CHECK = '<svg class="bigcheck" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg>';
const spk = (t, cls = '') => `<button class="spk ${cls}" data-a="say" data-t="${esc(t)}" aria-label="Play">${SPK}</button>`;
const slowBtn = t => `<button class="slowbtn" data-a="say" data-slow="1" data-t="${esc(t)}">Slow</button>`;
const bar = (n, d) => `<div class="prog"><i style="width:${d ? Math.round(n / d * 100) : 0}%"></i></div>`;
const fmtIv = d => d < 30 ? d + 'd' : d < 365 ? Math.round(d / 30) + 'mo' : (d / 365).toFixed(1) + 'y';
const stDot = id => { const st = S.items[id]; return `<span class="st ${st ? (st.iv >= 21 ? 'known' : 'learning') : ''}"></span>`; };
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };

let toastT;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3000); }

function openSheet(html) { sheet.innerHTML = `<div class="sheet-bg" data-a="closeSheet"></div><div class="sheet-panel"><div class="grab"></div>${html}</div>`; sheet.hidden = false; }
function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; }
function confirmSheet(title, body, okLabel, okAction, danger) {
  openSheet(`<h2>${esc(title)}</h2><p class="muted">${body}</p>
    <button class="btn ${danger ? 'danger' : 'primary'} block" data-a="${okAction}">${esc(okLabel)}</button>
    <button class="btn ghost block" data-a="closeSheet">Cancel</button>`);
}

// ───────── Tabs ─────────
let tab = 'today', viewMod = S.module, obStep = 0;
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function render() {
  if (!S.onboarded) { tabbar.hidden = true; view.innerHTML = onboarding(); return; }
  tabbar.hidden = false;
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  view.innerHTML = ({ today: vToday, vocab: vVocab, course: vCourse, progress: vProgress, settings: vSettings })[tab]();
}

function onboarding() {
  if (obStep === 0) return `<div class="ob">
    <h1>Dansk</h1>
    <p class="lead">Build your Danish vocabulary by meeting your own words again and again in real Danish texts.</p>
    <div class="list">
      <div class="li static"><span class="grow"><b>Your words</b><small>You choose every word and write its translation</small></span></div>
      <div class="li static"><span class="grow"><b>In context</b><small>Each review is a short Danish text with your words in it</small></span></div>
      <div class="li static"><span class="grow"><b>Spaced out</b><small>Words you miss come back sooner, words you know come back later</small></span></div>
    </div>
    <button class="btn primary block" data-a="obNext">Get started</button>
  </div>`;
  return `<div class="ob">
    <h1>Course level</h1>
    <p class="lead">The app also has an optional course that follows Danskuddannelse 3. Pick the module you are studying. Earlier modules are marked as known.</p>
    <div class="list">${MODULES.map(m => `
      <button class="li" data-a="obPick" data-m="${m.id}"><span class="dot">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b><small>${m.desc}</small></span><span class="chev">›</span></button>`).join('')}</div>
  </div>`;
}

function vToday() {
  const h = new Date().getHours(), greet = h < 10 ? 'Godmorgen' : h < 18 ? 'Goddag' : 'Godaften';
  const date = new Date().toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
  const news = S.custom.filter(c => !vs(c.id).n).length, due = S.custom.filter(c => vs(c.id).n && isDueV(c)).length;
  const { pick } = vocabQueue(false), mins = Math.max(1, Math.round(pick.length * 40 / 60));
  const upcoming = S.custom.map(c => vs(c.id)).filter(v => v.n && v.due > today()).map(v => v.due).sort()[0];
  const cDue = dueIds().length, cNew = newLeft();
  const stale = S.custom.length + Object.keys(S.items).length >= 10 && (!S.lastBackup || S.lastBackup < addDays(today(), -14));
  let card;
  if (!S.custom.length) card = `<h2>Start your vocabulary</h2><p class="muted">Add the Danish words you want to learn, with your own translations. Sessions are built from them.</p><button class="btn primary block" data-a="tab" data-tab="vocab">Add words</button>`;
  else if (pick.length) card = `<h2>Today's session</h2><p class="muted">${due} to review · ${news} new · about ${mins} min</p><button class="btn primary block" data-a="vStart">Start session</button>`;
  else card = `<h2>Nothing due today</h2><p class="muted">${upcoming ? 'Next review on ' + upcoming + '.' : ''} You can still practise words ahead of schedule.</p><button class="btn tint block" data-a="vAhead">Practise anyway</button>`;
  return `
  <header class="top"><div><p class="eyebrow">${esc(date)}</p><h1>${greet}</h1></div></header>
  <section class="card">${card}</section>
  ${!standalone() && !S.hintOff ? `<section class="note"><b>Add to Home Screen first</b><p>In Safari tap Share, then “Add to Home Screen”, and always open Dansk from that icon. Progress made in a browser tab is stored separately.</p><button class="link" data-a="hintOff">Got it</button></section>` : ''}
  ${stale ? `<section class="note"><b>Time for a backup</b><p>${S.lastBackup ? 'Your last backup is more than two weeks old.' : 'You have not saved a backup yet.'}</p><button class="link" data-a="export">Save backup file</button></section>` : ''}
  <div class="list">
    <button class="li" data-a="tab" data-tab="vocab"><span class="grow"><b>Vocabulary</b><small>${S.custom.length} ${S.custom.length === 1 ? 'word' : 'words'} in your bank</small></span><span class="chev">›</span></button>
    <button class="li" data-a="${cDue + cNew ? 'start' : 'tab'}" data-tab="course"><span class="grow"><b>Course session</b><small>${cDue + cNew ? `${cDue} to review · ${cNew} new` : 'Nothing due in the course'}</small></span><span class="chev">›</span></button>
  </div>`;
}

const SORTS = { new: 'Newest first', az: 'A to Z', due: 'Next review', hard: 'Most missed' };
function sortedVocab() {
  const a = S.custom.slice(), k = S.vsort;
  if (k === 'az') a.sort((x, y) => x.da.replace(/^(en|et|at)\s+/i, '').localeCompare(y.da.replace(/^(en|et|at)\s+/i, ''), 'da'));
  else if (k === 'due') a.sort((x, y) => (vs(x.id).due || '0') < (vs(y.id).due || '0') ? -1 : 1);
  else if (k === 'hard') a.sort((x, y) => vs(y.id).bad - vs(x.id).bad);
  else a.reverse();
  return a;
}
const vocabRow = c => { const v = vs(c.id), st = statusOf(c); return `
  <button class="li" data-a="word" data-id="${c.id}" data-s="${esc((c.da + ' ' + c.en).toLowerCase())}"><span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}</small></span><span class="meta"><span class="pill ${st}">${st}</span><small>${!v.n ? '' : v.due <= today() ? 'due' : v.due.slice(5)}</small></span></button>`; };

function vVocab() {
  return `
  <header class="top"><div><h1>Vocabulary</h1></div></header>
  <section class="card form">
    <input id="wDa" type="text" placeholder="Danish word or expression" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" lang="da" enterkeyhint="next">
    <input id="wEn" type="text" placeholder="English translation" autocapitalize="none" autocomplete="off" enterkeyhint="next">
    <input id="wNo" type="text" placeholder="Notes (optional)" autocomplete="off" enterkeyhint="done">
    <button class="btn primary block" data-a="addWord">Add word</button>
    <button class="btn ghost block" data-a="bulk">Paste a list</button>
    <small class="center">Separate alternative translations with a semicolon.</small>
  </section>
  ${S.custom.length ? `
  <div class="tools"><input id="vSearch" type="search" placeholder="Search ${S.custom.length} words" autocapitalize="none" autocomplete="off"><select data-c="vsort">${Object.keys(SORTS).map(k => `<option value="${k}" ${S.vsort === k ? 'selected' : ''}>${SORTS[k]}</option>`).join('')}</select></div>
  <div class="list" id="vList">${sortedVocab().map(vocabRow).join('')}</div>`
    : `<p class="empty">No words yet. Add one above, or paste a list of words with their translations.</p>`}`;
}

function wordSheet(id) {
  const c = byId(id); if (!c) return;
  const v = vs(id), st = statusOf(c), pos = posOf(c), K = { ok: 'Correct', part: 'Partly right', bad: 'Incorrect' };
  openSheet(`<div class="row">${spk(c.da)}<div class="grow"><h2>${esc(c.da)}</h2><p class="muted tight">${pos ? pos + ' · ' : ''}added ${c.added}</p></div><span class="pill ${st}">${st}</span></div>
    <div class="card form flat">
      <input id="eDa" type="text" value="${esc(c.da)}" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" lang="da">
      <input id="eEn" type="text" value="${esc(c.en)}" placeholder="English translation" autocapitalize="none" autocomplete="off">
      <input id="eNo" type="text" value="${esc(c.notes || '')}" placeholder="Notes (optional)" autocomplete="off">
      <button class="btn tint block" data-a="saveWord" data-id="${id}">Save changes</button>
    </div>
    <div class="list">
      <div class="li static slim"><span class="grow">Tested</span><span>${v.n} times</span></div>
      <div class="li static slim"><span class="grow">Correct / incorrect</span><span>${v.ok} / ${v.bad}</span></div>
      <div class="li static slim"><span class="grow">Current interval</span><span>${v.n ? v.iv + ' days' : '–'}</span></div>
      <div class="li static slim"><span class="grow">Next review</span><span>${!v.n ? 'next session' : v.due <= today() ? 'due now' : v.due}</span></div>
    </div>
    ${v.hist.length ? `<h3>Recent answers</h3><div class="list">${v.hist.map(h => `
      <div class="li static slim"><span class="grow"><b class="k-${h.k}">${K[h.k]}</b><small>${h.a ? '“' + esc(h.a) + '”' : 'no answer'} · ${esc(h.s || '')}</small></span><small>${h.d}</small></div>`).join('')}</div>` : ''}
    <button class="btn ghost block" data-a="read" data-id="${id}">Read this word in a text</button>
    <button class="btn ghost block red" data-a="askDelWord" data-id="${id}">Delete word</button>`);
}

// Accepts "danish <tab or dash or = or :> english" per line, or alternating Danish / English lines.
function parseBulk(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean), SEP = /\t+|\s+[-–—=]\s+|\s*=\s*|\s{3,}|:\s+/;
  let pairs = [];
  if (lines.some(l => SEP.test(l))) lines.forEach(l => { const m = l.split(SEP); if (m.length >= 2) pairs.push([m[0].trim(), m.slice(1).join(' ').trim()]); });
  else for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  pairs = pairs.filter(p => p[0] && p[1] && !(/^(danish|dansk)$/i.test(p[0]) && /^(english|engelsk)$/i.test(p[1])));
  const seen = new Set(S.custom.map(c => c.da.toLowerCase()));
  return pairs.map(([da, en]) => { const dup = seen.has(da.toLowerCase()); seen.add(da.toLowerCase()); return { da, en, dup }; });
}
let bulkParsed = [];
function bulkSheet(text) {
  openSheet(`<h2>Paste a list</h2><p class="muted">One word per line with its translation after a tab, dash or equals sign. A table copied as alternating Danish and English lines also works.</p>
    <textarea id="bulkT" rows="9" placeholder="at beslutte - to decide&#10;en mulighed - an opportunity; a possibility" autocapitalize="none" autocorrect="off" spellcheck="false">${esc(text || '')}</textarea>
    <button class="btn primary block" data-a="bulkReview">Review</button>`);
}
function bulkReview() {
  const text = $('#bulkT').value; bulkParsed = parseBulk(text);
  const ok = bulkParsed.filter(p => !p.dup);
  if (!bulkParsed.length) { toast('No word pairs found in that text'); return; }
  openSheet(`<h2>Review ${ok.length} ${ok.length === 1 ? 'word' : 'words'}</h2>
    <div class="list">${bulkParsed.map(p => `<div class="li static slim ${p.dup ? 'dim' : ''}"><span class="grow"><b>${esc(p.da)}</b><small>${esc(p.en)}${p.dup ? ' · already in your list, skipped' : ''}</small></span></div>`).join('')}</div>
    <button class="btn primary block" data-a="bulkSave" ${ok.length ? '' : 'disabled'}>Save ${ok.length} ${ok.length === 1 ? 'word' : 'words'}</button>
    <button class="btn ghost block" data-a="bulkBack">Back to edit</button>`);
  bulkSheet.text = text;
}

const DRILLS = {
  pairs: { name: 'Sound pairs', desc: 'Hear a word and pick which one it was' },
  numbers: { name: 'Numbers', desc: 'Hear a number and type the digits' },
  gender: { name: 'En or et?', desc: 'Pick the right article for each noun' },
  build: { name: 'Word order', desc: 'Put the sentence together' }
};

function vCourse() {
  const m = MOD(viewMod), units = UNITS.filter(u => u.m === viewMod), tot = modItems(viewMod).length, l = learned(viewMod);
  const cDue = dueIds().length, cNew = newLeft();
  return `
  <header class="top"><div><h1>Course</h1><p class="sub">Optional ready-made words and drills, following Danskuddannelse 3.</p></div></header>
  <section class="card"><h2>Course session</h2><p class="muted">${cDue} to review · ${cNew} new from ${MOD(S.module).name}</p>
    ${cDue + cNew ? `<button class="btn tint block" data-a="start">Start course session</button>` : freshPool().length ? `<button class="btn tint block" data-a="more">Learn 5 more words</button>` : ''}</section>
  <div class="seg">${MODULES.map(x => `<button class="${x.id === viewMod ? 'on' : ''}" data-a="viewMod" data-m="${x.id}">${x.id}</button>`).join('')}</div>
  <section class="card">
    <p class="eyebrow">${m.tag} · about ${m.level}${viewMod === S.module ? ' · current' : ''}</p><h2>${m.name}</h2><p class="muted">${m.desc}</p>
    ${bar(l, tot)}<small class="under">${l} of ${tot} words learned</small>
    ${viewMod === S.module ? '' : `<button class="btn tint block" data-a="setMod">Study this module</button>`}
    ${l < tot ? `<button class="btn ghost block" data-a="askKnown">I already know this module</button>` : ''}
  </section>
  <div class="list">${units.map((u, i) => { const n = u.items.filter(x => S.items[x.id]).length; return `
    <button class="li" data-a="unit" data-u="${u.id}"><span class="idx">${i + 1}</span><span class="grow"><b>${u.title}</b><small>${n} of ${u.items.length}</small></span>${n === u.items.length ? '<span class="tick">✓</span>' : ''}<span class="chev">›</span></button>`; }).join('')}</div>
  <h3>Drills</h3>
  <div class="list">${Object.keys(DRILLS).map(k => { const d = DRILLS[k], s = S.drills[k]; return `
    <button class="li" data-a="drill" data-k="${k}"><span class="grow"><b>${d.name}</b><small>${d.desc}</small></span><small>${s && s.n ? Math.round(s.ok / s.n * 100) + '%' : ''}</small><span class="chev">›</span></button>`; }).join('')}</div>`;
}

function vProgress() {
  const c = S.custom, count = st => c.filter(x => statusOf(x) === st).length;
  const tot = c.reduce((a, x) => a + vs(x.id).n, 0), ok = c.reduce((a, x) => a + vs(x.id).ok, 0);
  const hard = c.filter(x => vs(x.id).bad >= 2).sort((x, y) => vs(y.id).bad / vs(y.id).n - vs(x.id).bad / vs(x.id).n).slice(0, 8);
  const stat = (n, l) => `<div class="stat"><b>${n}</b><small>${l}</small></div>`;
  return `
  <header class="top"><div><h1>Progress</h1></div></header>
  <div class="stats">
    ${stat(c.length, 'words in your bank')}${stat(c.filter(x => vs(x.id).n && isDueV(x)).length, 'due today')}
    ${stat(c.filter(overdueV).length, 'overdue')}${stat(tot ? Math.round(ok / tot * 100) + '%' : '–', 'answer accuracy')}
  </div>
  <div class="list">
    <div class="li static slim"><span class="grow">New</span><span>${count('new')}</span></div>
    <div class="li static slim"><span class="grow">Learning</span><span>${count('learning')}</span></div>
    <div class="li static slim"><span class="grow">Reviewing</span><span>${count('reviewing')}</span></div>
    <div class="li static slim"><span class="grow">Mastered</span><span>${count('mastered')}</span></div>
  </div>
  <h3>Recent sessions</h3>
  ${S.sessions.length ? `<div class="list">${S.sessions.slice(0, 8).map(s => `<div class="li static slim"><span class="grow">${s.d}</span><span>${s.ok} of ${s.n} correct · ${s.n ? Math.round(s.ok / s.n * 100) : 0}%</span></div>`).join('')}</div>` : `<p class="empty">No sessions yet.</p>`}
  ${hard.length ? `<h3>Words that keep causing trouble</h3><div class="list">${hard.map(x => `<button class="li" data-a="word" data-id="${x.id}"><span class="grow"><b>${esc(x.da)}</b><small>${esc(x.en)}</small></span><small>missed ${vs(x.id).bad} of ${vs(x.id).n}</small><span class="chev">›</span></button>`).join('')}</div>` : ''}
  <div class="list"><button class="li" data-a="tab" data-tab="vocab"><span class="grow"><b>All words</b><small>Search the list and open any word for its history</small></span><span class="chev">›</span></button></div>
  <h3>Course</h3>
  <div class="list">${MODULES.map(m => { const t = modItems(m.id).length, l = learned(m.id); return `
    <div class="li static"><span class="dot">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b>${bar(l, t)}</span><small>${l}/${t}</small></div>`; }).join('')}</div>`;
}

let persisted = null;
const hasAI = () => { try { return !!localStorage.getItem(AI_KEY); } catch (e) { return false; } };
function vSettings() {
  return `
  <header class="top"><div><h1>Settings</h1></div></header>
  <h3>Vocabulary sessions</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>Session length</b><small>About ${Math.round(S.cfg.minutes * 60 / 40)} words per session</small></span><div class="stepper"><button data-a="mins" data-d="-5">−</button><span>${S.cfg.minutes}</span><button data-a="mins" data-d="5">+</button></div></div>
    <div class="li static"><span class="grow"><b>Review intervals</b><small>Days after each correct answer in a row</small></span><input type="text" class="short" data-c="intervals" value="${S.cfg.intervals.join(', ')}" inputmode="numeric"></div>
  </div>
  <p class="foot-note">A missed word comes back the next day and starts the intervals again. Each text is at most five sentences.</p>
  <h3>AI assistance (optional)</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>${hasAI() ? 'Key saved on this phone' : 'No key'}</b><small>${hasAI() ? 'Used to judge your answers and to write a text when none is found' : 'Without a key, answers are matched against your translations'}</small></span>${hasAI() ? `<button class="link" data-a="aiTest">Test</button>` : ''}</div>
    <div class="li static"><input type="password" id="aiKey" placeholder="Anthropic API key" autocomplete="off"><button class="link" data-a="aiSave">Save</button></div>
    ${hasAI() ? `<button class="li" data-a="aiRemove"><span class="grow"><b class="red">Remove key</b></span></button>` : ''}
  </div>
  <p class="foot-note">The key stays on this phone, is never part of a backup file, and is sent only to Anthropic. Usage is billed to your Anthropic account.</p>
  <h3>Speech</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>Slower speech</b></span><button class="switch ${S.slow ? 'on' : ''}" data-a="slow" aria-label="Slower speech"><i></i></button></div>
    <div class="li static"><span class="grow"><b>Voice</b></span>${voices.length ? `<select data-c="voice">${voices.map(v => `<option ${v.name === (pickVoice() || {}).name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<small>No Danish voice</small>'}</div>
  </div>
  <h3>Course</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>New course words per day</b></span><div class="stepper"><button data-a="npd" data-d="-2">−</button><span>${S.newPerDay}</span><button data-a="npd" data-d="2">+</button></div></div>
  </div>
  <h3>Your data</h3>
  <div class="list">
    <button class="li" data-a="export"><span class="grow"><b>Save backup file</b><small>${S.lastBackup ? 'Last saved ' + S.lastBackup : 'Never saved'} · everything, as JSON</small></span><span class="chev">›</span></button>
    <button class="li" data-a="import"><span class="grow"><b>Restore from backup file</b><small>Replaces what is on this phone</small></span><span class="chev">›</span></button>
    <button class="li" data-a="csv"><span class="grow"><b>Export vocabulary as CSV</b><small>Words, translations and learning status</small></span><span class="chev">›</span></button>
  </div>
  <p class="foot-note">Everything is stored on this phone only${persisted === true ? ', in protected storage' : ''}. Deleting the Home Screen icon deletes it, so keep a backup file in Files or iCloud Drive.</p>
  <div class="list"><button class="li" data-a="askReset"><span class="grow"><b class="red">Erase everything</b></span></button></div>`;
}

function unitSheet(id) {
  const u = UNIT[id], n = u.items.filter(i => S.items[i.id]).length;
  openSheet(`<h2>${esc(u.title)}</h2>
    <div class="tip"><b>Tip</b>${esc(u.tip)}</div>
    <div class="list">${u.items.map(it => `
      <div class="li static slim">${spk(it.da, 'sm')}<span class="grow"><b>${esc(it.da)}</b><small>${esc(it.en)}</small></span>${stDot(it.id)}</div>`).join('')}</div>
    <button class="btn primary block" data-a="studyUnit" data-u="${id}">${n < u.items.length ? 'Study this unit' : 'Review this unit'}</button>`);
}

// ═════════ Finding Danish texts ═════════
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termOf = da => da.trim().toLowerCase().replace(/^(en|et|at)\s+/, '');
// Pattern for a word plus its common inflections (huset, huse, besluttede …). The ending list is
// deliberately closed so that look-alikes such as "hus" / "husk" are not treated as the same word.
const RX = {};
function rx(c) {
  if (RX[c.id] && RX[c.id].da === c.da) return RX[c.id].re;
  const term = termOf(c.da); let core;
  if (/\s/.test(term)) core = term.split(/\s+/).map(reEsc).join('\\s+');
  else {
    // A word ending in -e is matched on its stem, which then needs an ending: "mene" must not match "men".
    const cut = term.length > 3 && term.endsWith('e'), stem = cut ? term.slice(0, -1) : term, last = stem.slice(-1);
    core = reEsc(stem) + (/[bdfgklmnprst]/.test(last) ? last + '?' : '') + '(?:e|en|et|er|ene|erne|ne|r|te|t|ede|de|ende|ere|est|este)' + (cut ? '' : '?') + 's?';
  }
  const re = new RegExp('(^|[^\\p{L}])(' + core + ')(?=$|[^\\p{L}])', 'iu');
  RX[c.id] = { da: c.da, re };
  return re;
}

async function getJSON(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 9000);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}

const ABBR = new Set(['ca', 'bl.a', 'f.eks', 'fx', 'dvs', 'osv', 'nr', 'kl', 'mio', 'mia', 'jf', 'evt', 'inkl', 'ekskl', 'm.fl', 'o.l', 'pga', 'hhv', 'm.m', 'm.v', 'o.a', 'st', 'dr', 'hr', 'fr', 'ph.d', 'cand', 'mag', 'el', 'vs', 'etc', 'f', 'd', 'tlf', 'co', 'a/s']);
function sentences(text) {
  const out = [], re = /[.!?]+["”»)]*\s+(?=["“«(]?[A-ZÆØÅ0-9])/g; let start = 0, m;
  while ((m = re.exec(text))) {
    const before = text.slice(start, m.index).split(/\s/).pop().toLowerCase();
    if (m[0][0] === '.' && (ABBR.has(before) || /^\d+$/.test(before) || /^\p{L}$/u.test(before))) continue;
    out.push(text.slice(start, m.index + m[0].length).trim()); start = m.index + m[0].length;
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

// Finds where each candidate word first appears. Longer matches win overlaps, so an expression
// such as "at finde ud af" is one unit rather than several words.
function locate(text, cands) {
  const hits = [];
  cands.forEach(c => { const m = rx(c).exec(text); if (m) { const s = m.index + m[1].length; hits.push({ id: c.id, start: s, end: s + m[2].length, form: m[2] }); } });
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept = [];
  hits.forEach(h => { if (!kept.some(k => h.start < k.end && k.start < h.end)) kept.push(h); });
  return kept.sort((a, b) => a.start - b.start).slice(0, 30);
}

// Best stretch of at most five sentences: must contain the primary word, and scores higher the
// more of the wanted words it holds.
function bestWindow(text, cands, primary, wanted, used) {
  let best = null;
  for (const para of text.split(/\n+/)) {
    if (para.length < 60 || !rx(primary).test(para)) continue;
    const inPara = cands.filter(c => rx(c).test(para)), ss = sentences(para);
    for (let i = 0; i < ss.length; i++) for (let n = 1; n <= 5 && i + n <= ss.length; n++) {
      const seg = ss.slice(i, i + n).join(' ');
      if (seg.length > 480) break;
      if (seg.length < 70 || used.has(seg) || !rx(primary).test(seg)) continue;
      const targets = locate(seg, inPara); if (!targets.some(t => t.id === primary.id)) continue;
      const pend = targets.filter(t => wanted.has(t.id)).length, score = pend * 100 + targets.length * 10 + Math.min(n, 3) * 2 - seg.length / 1000;
      if (!best || score > best.score) best = { text: seg, targets, score, pend };
    }
  }
  return best;
}

const WIKI = 'https://da.wikipedia.org/w/api.php?format=json&origin=*&action=query';
let NEWS = null;
async function loadNews() {
  if (NEWS) return NEWS;
  try { NEWS = (await getJSON('news.json')).items || []; return NEWS; } catch (e) { return []; }
}
async function buildPassage(ids, eligible, used) {
  const words = ids.map(byId).filter(Boolean), primary = words[0];
  const cands = S.custom.filter(c => eligible(c.id)), wanted = new Set(ids);
  let best = null, newsHit = null;
  // 1. DR news snippets collected daily into news.json (no network search needed).
  const hits = [];
  (await loadNews()).forEach(it => {
    if (used.has(it.x) || !rx(primary).test(it.x)) return;
    const targets = locate(it.x, cands); if (!targets.some(t => t.id === primary.id)) return;
    hits.push({ text: it.x, targets, pend: targets.filter(t => wanted.has(t.id)).length, src: 'DR', title: it.t, url: it.u });
  });
  if (hits.length) {
    const top = Math.max(...hits.map(h => h.pend)); newsHit = shuffle(hits.filter(h => h.pend === top))[0];
    // A news snippet is short, so now and then look further for a text holding more of the words.
    if (top >= 2 || words.length === 1 || Math.random() < 0.7) best = newsHit;
  }
  // 2. Wikipedia: look for articles that contain several of the wanted words.
  if (!best) try {
    const others = shuffle(words.slice(1)), combos = [];
    if (others.length >= 2) combos.push([primary, others[0], others[1]]);
    if (others.length >= 1) combos.push([primary, others[others.length - 1]]);
    combos.push([primary]);
    let fetched = 0;
    for (const combo of combos) {
      const q = combo.map(c => '"' + termOf(c.da) + '"').join(' ');
      const j = await getJSON(`${WIKI}&list=search&srnamespace=0&srlimit=5&srsort=random&srprop=&srsearch=${encodeURIComponent(q)}`);
      for (const title of shuffle(((j.query && j.query.search) || []).map(s => s.title)).slice(0, 2)) {
        if (fetched++ >= 5) break;
        const p = Object.values((await getJSON(`${WIKI}&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(title)}`)).query.pages)[0];
        const w = bestWindow((p && p.extract) || '', cands, primary, wanted, used);
        if (w && (!best || w.score > best.score)) best = Object.assign(w, { src: 'Wikipedia', title, url: 'https://da.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')) });
      }
      if (best && best.pend >= Math.min(2, combo.length)) break;
    }
  } catch (e) { /* offline or blocked: fall through */ }
  if (newsHit && (!best || best.pend < 2)) best = newsHit;
  // 3. Tatoeba example sentences.
  if (!best) try {
    const term = termOf(primary.da);
    const j = await getJSON(`https://api.tatoeba.org/unstable/sentences?lang=dan&sort=random&limit=12&q=${encodeURIComponent(term)}`);
    const ss = [...new Set((j.data || []).map(s => s.text).filter(s => s && s.length >= 20 && rx(primary).test(s)))].slice(0, 3), text = ss.join(' ');
    if (ss.length && !used.has(text)) best = { text, targets: locate(text, cands), src: 'Tatoeba', title: 'Example sentences', url: 'https://tatoeba.org/da/sentences/search?from=dan&query=' + encodeURIComponent(term) };
  } catch (e) { /* fall through */ }
  // 4. A generated text, labelled as such.
  if (!best && hasAI()) try {
    const text = await aiPassage(words.slice(0, 5));
    if (text && rx(primary).test(text)) best = { text, targets: locate(text, cands), src: 'AI-generated', title: 'Written for this session, not a real source', url: '' };
  } catch (e) { aiFail(e); }
  if (!best || !best.targets.some(t => t.id === primary.id)) best = { text: primary.da, targets: [{ id: primary.id, start: 0, end: primary.da.length, form: primary.da }], src: 'none', title: '', url: '' };
  best.primary = primary.id;
  return best;
}

const srcLine = p => p.src === 'none' ? 'No text found for this word, so it is shown on its own'
  : p.src === 'AI-generated' ? 'AI-generated text · not a real source'
  : `${esc(p.src)} · <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>`;
function markup(p, cls) {
  let html = '', pos = 0;
  p.targets.forEach(t => { html += esc(p.text.slice(pos, t.start)) + `<mark class="${cls(t.id)}" data-a="qPick" data-id="${t.id}">${esc(p.text.slice(t.start, t.end))}</mark>`; pos = t.end; });
  return html + esc(p.text.slice(pos));
}

// ═════════ AI assistance (optional, with the user's own key) ═════════
let aiClient = null, aiWarned = false;
async function ai() {
  const key = localStorage.getItem(AI_KEY); if (!key) return null;
  if (!aiClient) {
    const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk');
    aiClient = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  return aiClient;
}
function aiFail(e) { if (!aiWarned) { aiWarned = true; toast('AI assistance is not available right now' + (e && e.status ? ` (${e.status})` : '')); } }
async function aiJSON(system, user, schema) {
  const client = await ai(); if (!client) return null;
  const r = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system, messages: [{ role: 'user', content: user }]
  });
  if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return null;
  const t = r.content.find(b => b.type === 'text');
  return t ? JSON.parse(t.text) : null;
}
const obj = (props, req) => ({ type: 'object', properties: props, required: req, additionalProperties: false });

async function aiGrade(c, form, passage, answer) {
  return aiJSON(
    'You grade an English translation given by an adult learner of Danish. Judge only whether the answer conveys the meaning the Danish word has in the passage. Accept synonyms, either tense or number, and small spelling mistakes. "partial" means the answer is related but misses or narrows the meaning. Reply with a verdict and one short sentence of explanation, in English.',
    `Danish word as the learner saved it: ${c.da}\nForm in the passage: ${form}\nThe learner's own translation: ${c.en}${c.notes ? '\nLearner notes: ' + c.notes : ''}\nPassage: ${passage}\n\nLearner's answer: ${answer}`,
    obj({ verdict: { type: 'string', enum: ['correct', 'partial', 'incorrect'] }, note: { type: 'string' } }, ['verdict', 'note']));
}
async function aiPassage(words) {
  const r = await aiJSON(
    'You write short Danish reading passages for an adult learner. Write natural, grammatically correct Danish as it appears in everyday news or public information, three to five sentences. Use each requested word where it fits naturally, in any inflected form; leave a word out rather than force it. No title, no translation.',
    'Words to include:\n' + words.map(w => `- ${w.da} (${w.en})`).join('\n'),
    obj({ passage: { type: 'string' } }, ['passage']));
  return r && r.passage ? sentences(r.passage.trim()).slice(0, 5).join(' ') : null;
}

// ═════════ Checking an answer without AI ═════════
const strip = s => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9æøå' -]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(to|a|an|the)\s+/, '');
const stemW = w => w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');
const stemAll = s => s.split(' ').map(stemW).join(' ');
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
function localMatch(answer, en) {
  const a = strip(answer); if (!a) return false;
  return en.split(/[;,\/]|\bor\b/).map(strip).filter(Boolean).some(alt =>
    a === alt || stemAll(a) === stemAll(alt) || lev(a, alt) <= (alt.length >= 9 ? 2 : alt.length >= 5 ? 1 : 0));
}

// ═════════ Vocabulary session ═════════
// Chooses what to test today: new words, then due words by urgency, aiming for about 70% from
// the last seven days and 30% older, and filling from either side when one runs short.
function vocabQueue(ahead) {
  const t = today(), cap = Math.max(6, Math.round(S.cfg.minutes * 60 / 40));
  const urgency = c => { const v = vs(c.id); return daysBetween(v.due, t) * 2 + v.bad * 3 - v.ok; };
  const pool = [...S.custom.filter(c => !vs(c.id).n), ...S.custom.filter(c => vs(c.id).n && vs(c.id).due <= t).sort((a, b) => urgency(b) - urgency(a))];
  const recent = c => c.added >= addDays(t, -7), rec = pool.filter(recent), old = pool.filter(c => !recent(c));
  const nRec = Math.min(rec.length, Math.max(Math.round(cap * 0.7), cap - old.length)), nOld = Math.min(old.length, cap - nRec);
  let pick = [...rec.slice(0, nRec), ...old.slice(0, nOld)];
  if (!pick.length && ahead) pick = S.custom.filter(c => vs(c.id).n).sort((a, b) => vs(a.id).due < vs(b.id).due ? -1 : 1).slice(0, Math.min(cap, 15));
  return { pick, left: pool.length - pick.length };
}

let vq = null;
function startVocab(ahead) {
  const { pick } = vocabQueue(ahead);
  if (!pick.length) { toast('Nothing to review right now'); return; }
  sess = null; drill = null; reader = null;
  const ids = pick.map(c => c.id);
  vq = { ids, pending: ids.slice(), retry: [], retried: new Set(), first: {}, phase2: false, intro: pick.filter(c => !vs(c.id).n), p: null, active: null, fb: null, done: {}, used: new Set(), next: null, loading: false, start: Date.now(), tick: 0, finished: false };
  closeSheet();
  if (vq.intro.length) paintIntro(); else nextPassage();
}

function paintIntro() {
  overlay.innerHTML = ohead(null, `${vq.intro.length} new`) + `<div class="stage top"><h2>New words</h2><p class="muted">Read them through once. They count as learned only after you recall them in a text.</p>
    <div class="list">${vq.intro.map(c => `<div class="li static slim">${spk(c.da, 'sm')}<span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}${posOf(c) ? ' · ' + posOf(c) : ''}${c.notes ? ' · ' + esc(c.notes) : ''}</small></span></div>`).join('')}</div></div>
    <div class="foot"><button class="btn primary block" data-a="vBegin">Start</button></div>`;
  overlay.hidden = false;
}

// A word can be highlighted in a passage if it has not been answered yet in this session.
const eligibleNow = q => id => q.phase2 ? q.pending.includes(id) : !(id in q.first);
async function nextPassage() {
  const q = vq, k = ++q.tick;
  if (!q.pending.length && q.retry.length) { q.pending = q.retry; q.retry = []; q.phase2 = true; q.next = null; }
  if (!q.pending.length) return finishVocab();
  q.loading = true; q.p = null; q.fb = null; q.active = null; paintQuiz();
  let p = null;
  if (q.next) {
    const n = q.next; q.next = null;
    try { p = await n; } catch (e) { p = null; }
    if (vq !== q || q.tick !== k) return;
    if (p) { const ok = eligibleNow(q); p.targets = p.targets.filter(t => ok(t.id)); if (!q.pending.includes(p.primary) || !p.targets.some(t => t.id === p.primary)) p = null; }
  }
  if (!p) p = await buildPassage(q.pending, eligibleNow(q), q.used);
  if (vq !== q || q.tick !== k) return;
  q.p = p; q.used.add(p.text); q.done = {}; q.loading = false; q.active = p.targets[0].id;
  paintQuiz();
  // Fetch the following text while this one is being answered.
  const shown = new Set(p.targets.map(t => t.id)), rest = q.pending.filter(id => !shown.has(id));
  if (rest.length) { const ok = id => eligibleNow(q)(id) && !shown.has(id); q.next = buildPassage(rest, ok, q.used); q.next.catch(() => {}); }
}

function paintQuiz() {
  const q = vq, p = q.p, doneN = Object.keys(q.first).length, total = q.ids.length;
  let body;
  if (q.loading || !p) body = `<div class="stage"><div class="spinner"></div><p class="muted">Finding a Danish text</p></div>`;
  else {
    const c = byId(q.active), t = p.targets.find(x => x.id === q.active), fb = q.fb;
    const left = p.targets.filter(x => !q.done[x.id]).length;
    let panel;
    if (fb && fb.checking) panel = `<div class="ans"><p class="muted">Checking your answer</p></div>`;
    else if (fb) {
      const label = { ok: 'Correct', part: 'Partly right', bad: 'Not quite' }[fb.kind];
      panel = `<div class="ans"><p class="verdict k-${fb.kind}">${label}</p>
        <p><b>${esc(c.da)}</b> — ${esc(c.en)}</p>
        ${fb.ans ? `<p class="muted small">You wrote “${esc(fb.ans)}”.${fb.note ? ' ' + esc(fb.note) : ''}</p>` : ''}
        ${c.notes ? `<p class="muted small">${esc(c.notes)}</p>` : ''}
        <button class="btn primary block" data-a="qNext">${left ? 'Next word' : 'Continue'}</button>
        ${fb.kind !== 'ok' && fb.ans ? `<button class="btn ghost block" data-a="qOver">My answer was right</button>` : ''}</div>`;
    } else panel = `<div class="ans"><label for="ans">What does <b>${esc(t.form)}</b> mean here?</label>
        <input id="ans" type="text" placeholder="English meaning" autocapitalize="none" autocomplete="off" enterkeyhint="send">
        <button class="btn primary block" data-a="qSubmit">Submit</button>
        <button class="btn ghost block" data-a="qSkip">I don't know</button></div>`;
    body = `<div class="stage top read"><p class="source">${srcLine(p)}${p.targets.length > 1 ? ` · ${p.targets.length} words to answer` : ''}</p>
      <div class="reading ${p.src === 'none' ? 'solo' : ''}" lang="da">${markup(p, id => q.done[id] ? 'm-' + q.done[id] : id === q.active ? 'm-active' : 'm-todo')}</div>${panel}</div>`;
  }
  overlay.innerHTML = ohead(Math.round(doneN / total * 100), q.phase2 ? 'second try' : `${doneN} of ${total}`) + body;
  overlay.hidden = false;
  const inp = $('#ans'); if (inp) inp.focus({ preventScroll: false });
}

async function submitAns(giveUp) {
  const q = vq, id = q.active, c = byId(id); if (!c || q.fb) return;
  const inp = $('#ans'), ans = giveUp ? '' : inp.value.trim();
  if (!giveUp && !ans) { inp.focus(); return; }
  const t = q.p.targets.find(x => x.id === id);
  let kind = ans && localMatch(ans, c.en) ? 'ok' : 'bad', note = '';
  if (kind === 'bad' && ans && hasAI()) {
    q.fb = { id, ans, checking: true }; paintQuiz();
    try { const r = await aiGrade(c, t.form, q.p.text, ans); if (r) { kind = r.verdict === 'correct' ? 'ok' : r.verdict === 'partial' ? 'part' : 'bad'; note = r.note || ''; } } catch (e) { aiFail(e); }
    if (vq !== q || q.active !== id) return;
  }
  q.fb = { id, ans, kind, note }; q.done[id] = kind; paintQuiz();
}

// Writes the answer on screen into the learning history. Runs when moving on, so that
// "My answer was right" can still correct a wrong automatic verdict first.
function commitFb() {
  const q = vq, fb = q && q.fb; if (!fb || fb.checking) return;
  const c = byId(fb.id), secondTry = fb.id in q.first;
  if (c) record(c, fb.kind, fb.ans, q.p.src === 'none' ? 'no text' : q.p.src + (q.p.url ? ': ' + q.p.title : ''), secondTry);
  if (!secondTry) q.first[fb.id] = fb.kind;
  q.pending = q.pending.filter(x => x !== fb.id);
  if (fb.kind !== 'ok' && !q.retried.has(fb.id) && c) { q.retried.add(fb.id); q.retry.push(fb.id); }
  q.fb = null; save();
}

function qNext() {
  const q = vq; commitFb();
  const nxt = q.p.targets.find(x => !q.done[x.id]);
  if (nxt) { q.active = nxt.id; paintQuiz(); } else nextPassage();
}

function finishVocab() {
  const q = vq; commitFb(); q.finished = true; q.tick++;
  const ids = Object.keys(q.first), n = ids.length, ok = ids.filter(id => q.first[id] === 'ok').length;
  const missed = ids.filter(id => q.first[id] !== 'ok').map(byId).filter(Boolean);
  const sec = Math.min(3600, Math.round((Date.now() - q.start) / 1000)), still = S.custom.filter(isDueV).length;
  if (n) { S.sessions.unshift({ d: today(), n, ok, sec }); S.sessions = S.sessions.slice(0, 30); save(); }
  vq = null;
  overlay.innerHTML = ohead(null, '') + `<div class="stage top"><h1>Session summary</h1>
    <div class="stats three"><div class="stat"><b>${n}</b><small>tested</small></div><div class="stat"><b class="k-ok">${ok}</b><small>correct</small></div><div class="stat"><b class="${n - ok ? 'k-bad' : ''}">${n - ok}</b><small>incorrect</small></div></div>
    <p class="muted">${n ? Math.round(ok / n * 100) + '% accuracy · ' : ''}${Math.max(1, Math.round(sec / 60))} min${still ? ` · ${still} ${still === 1 ? 'word is' : 'words are'} still due` : ''}</p>
    ${missed.length ? `<h3 class="left">Needs more practice</h3><div class="list">${missed.map(c => `<div class="li static slim"><span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}</small></span></div>`).join('')}</div>` : ''}</div>
    <div class="foot"><button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
  overlay.hidden = false;
}

// ───────── Free reading (no testing, nothing recorded) ─────────
let reader = null;
function startReader(id) {
  const c = byId(id); if (!c) return;
  sess = null; drill = null; vq = null;
  reader = { id, p: null, loading: true, shown: false, used: new Set(), tick: 0 };
  closeSheet(); loadReader();
}
async function loadReader() {
  const r = reader, k = ++r.tick; r.loading = true; r.shown = false; paintReader();
  const p = await buildPassage([r.id], x => x === r.id, r.used);
  if (reader !== r || r.tick !== k) return;
  r.p = p; r.used.add(p.text); r.loading = false; paintReader();
}
function paintReader() {
  const r = reader, c = byId(r.id), p = r.p;
  const body = r.loading ? `<div class="stage"><div class="spinner"></div><p class="muted">Finding a Danish text</p></div>`
    : `<div class="stage top read"><p class="source">${srcLine(p)}</p><div class="reading ${p.src === 'none' ? 'solo' : ''}" lang="da">${markup(p, () => 'm-active')}</div>
      ${r.shown ? `<div class="ans"><p><b>${esc(c.da)}</b> — ${esc(c.en)}</p></div>` : `<button class="btn ghost block" data-a="rShow">Show meaning</button>`}</div>`;
  overlay.innerHTML = ohead(null, 'Reading') + body + `<div class="foot">${r.loading ? '' : `<div class="two"><button class="btn tint" data-a="say" data-t="${esc(p.text)}">Listen</button><button class="btn primary" data-a="rAgain">Another text</button></div>`}</div>`;
  overlay.hidden = false;
}

// ═════════ Course session (flashcard-style spaced repetition) ═════════
let sess = null;

function nextIv(st, g, relearn) {
  if (!st || relearn) return g === 'easy' && !relearn ? 3 : 1;
  if (g === 'easy') return Math.max(4, Math.round(Math.max(st.iv, 1) * st.ef * 1.3));
  return st.iv < 1 ? 1 : st.iv < 3 ? 3 : Math.round(st.iv * st.ef);
}

function startSession(o = {}) {
  let due = dueIds(), pool, nNew, practice = false;
  if (o.unit) { pool = UNIT[o.unit].items; due = due.filter(id => ITEM[id].unit === o.unit); nNew = 6; }
  else { pool = modItems(S.module); nNew = o.extra || Math.max(0, S.newPerDay - day().new); }
  due = due.sort((a, b) => S.items[a].due < S.items[b].due ? -1 : 1).slice(0, 60);
  const fr = pool.filter(it => !S.items[it.id]).slice(0, nNew);
  if (o.unit && !due.length && !fr.length) { practice = true; due = shuffle(pool.map(i => i.id)); }
  if (!due.length && !fr.length) { toast('Nothing to study right now'); return; }

  // New words arrive four at a time: meet them, recognise them, then recall them at the end.
  const q = [], rev = due.map(id => ({ t: 'card', id }));
  for (let i = 0; i < fr.length; i += 4) {
    const b = fr.slice(i, i + 4);
    b.forEach(it => q.push({ t: 'intro', id: it.id }));
    shuffle(b).forEach(it => q.push({ t: 'mcq', id: it.id }));
    q.push(...rev.splice(0, 4));
  }
  q.push(...rev);
  fr.forEach(it => q.push({ t: 'card', id: it.id, isNew: true }));
  reader = null; drill = null; vq = null;
  sess = { q, i: 0, start: Date.now(), st: { rev: 0, ok: 0, new: 0 }, practice, revealed: false, picked: null, tick: 0 };
  closeSheet(); paintSess(true);
}

const requeue = c => sess.q.splice(Math.min(sess.q.length, sess.i + 4), 0, c);
function nextCard() { sess.i++; sess.revealed = false; sess.picked = null; sess.tick++; paintSess(true); }
const ohead = (pct, right) => `<div class="ohead"><button class="x" data-a="closeOverlay" aria-label="Close">✕</button>${pct === null ? '<span class="grow"></span>' : `<div class="prog"><i style="width:${pct}%"></i></div>`}<span class="count">${right}</span></div>`;
const exBlock = it => it.ex ? `<div class="ex">${spk(it.ex, 'sm')}<span class="grow"><b>${esc(it.ex)}</b><small>${esc(it.exEn)}</small></span></div>` : '';
const play = t => `<div class="play">${spk(t, 'big')}</div>${slowBtn(t)}`;

function paintSess(auto) {
  const c = sess.q[sess.i];
  if (!c) return finishSess();
  const it = ITEM[c.id], st = S.items[c.id], voice = hasVoice();
  let body = '', foot = '', say = '';
  if (c.t === 'intro') {
    body = `<span class="badge">New word</span><div class="word">${esc(it.da)}</div>${play(it.da)}<div class="gloss">${esc(it.en)}</div>${exBlock(it)}`;
    foot = `<button class="btn primary block" data-a="next">Continue</button><button class="btn ghost block" data-a="knowIt">I already know this</button>`;
    say = it.da;
  } else if (c.t === 'mcq') {
    if (!c.opts) c.opts = shuffle([it, ...shuffle(modItems(it.m).filter(x => x.en !== it.en)).slice(0, 3)]).map(x => x.id);
    const ans = sess.picked !== null;
    body = `<span class="badge">What does it mean?</span>${play(it.da)}
      <div class="word ${voice && !ans ? 'veil' : ''}">${esc(it.da)}</div>
      <div class="opts">${c.opts.map(id => `<button class="opt ${ans ? (id === c.id ? 'ok' : id === sess.picked ? 'bad' : 'dim') : ''}" data-a="pick" data-id="${id}" ${ans ? 'disabled' : ''}>${esc(ITEM[id].en)}</button>`).join('')}</div>`;
    if (ans && sess.picked !== c.id) foot = `<button class="btn primary block" data-a="next">Continue</button>`;
    say = it.da;
  } else {
    const listen = !c.isNew && st && st.reps % 2 === 1;
    if (!sess.revealed) {
      body = listen
        ? `<span class="badge">Listen. What does it mean?</span>${play(it.da)}${voice ? '' : `<div class="word">${esc(it.da)}</div>`}`
        : `<span class="badge">Say it in Danish</span><div class="word en">${esc(it.en)}</div>`;
      foot = `<button class="btn primary block" data-a="reveal">Show answer</button>`;
      if (listen) say = it.da;
    } else {
      body = `<div class="word">${esc(it.da)}</div>${play(it.da)}<div class="gloss">${esc(it.en)}</div>${exBlock(it)}`;
      const lbl = g => sess.practice ? '' : `<small>${g === 'again' ? 'soon' : fmtIv(nextIv(st, g, c.relearn))}</small>`;
      foot = `<div class="grades"><button class="g again" data-a="grade" data-g="again">Forgot${lbl('again')}</button><button class="g good" data-a="grade" data-g="good">Got it${lbl('good')}</button><button class="g easy" data-a="grade" data-g="easy">Easy${lbl('easy')}</button></div>`;
      if (auto) say = it.da;
    }
  }
  overlay.innerHTML = ohead(Math.round(sess.i / sess.q.length * 100), sess.q.length - sess.i) + `<div class="stage">${body}</div><div class="foot">${foot}</div>`;
  overlay.hidden = false;
  if (auto && say) speak(say);
}

function pickOpt(id) {
  const c = sess.q[sess.i]; if (sess.picked !== null) return;
  sess.picked = id; paintSess(false);
  if (id === c.id) { const k = sess.tick; setTimeout(() => { if (sess && sess.tick === k) nextCard(); }, 700); }
  else { requeue({ t: 'mcq', id: c.id }); speak(ITEM[c.id].da); }
}

function knowIt() {
  const id = sess.q[sess.i].id, t = today();
  S.items[id] = { iv: 30, ef: 2.5, due: addDays(t, 30), reps: 2, lapses: 0, first: t };
  sess.q = sess.q.filter((c, i) => i <= sess.i || c.id !== id);
  save(); nextCard();
}

function grade(g) {
  const c = sess.q[sess.i], id = c.id, st = S.items[id], t = today();
  if (sess.practice) { if (g === 'again') requeue({ t: 'card', id }); return nextCard(); }
  if (!c.relearn && !c.isNew) { sess.st.rev++; day().rev++; if (g !== 'again') { sess.st.ok++; day().ok++; } }
  if (g === 'again') {
    if (st && !c.relearn) { st.lapses++; st.ef = Math.max(1.3, st.ef - 0.2); st.iv = 0; st.due = t; }
    requeue({ t: 'card', id, isNew: c.isNew, relearn: true });
  } else {
    const iv = nextIv(st, g, c.relearn);
    if (!st) { S.items[id] = { iv, ef: 2.5, due: addDays(t, iv), reps: 1, lapses: 0, first: t }; day().new++; sess.st.new++; }
    else { st.iv = iv; if (g === 'easy' && !c.relearn) st.ef = Math.min(3, st.ef + 0.1); st.reps++; st.due = addDays(t, iv); }
  }
  save(); nextCard();
}

function logTime(start) { day().sec += Math.min(1800, Math.round((Date.now() - start) / 1000)); save(); }

function finishSess() {
  const s = sess.st, mins = Math.max(1, Math.round((Date.now() - sess.start) / 60000));
  logTime(sess.start); sess = null;
  overlay.innerHTML = `<div class="stage done">${CHECK}<h1>Godt klaret</h1><p class="muted">That course session is complete.</p>
    <div class="stats three"><div class="stat"><b>${s.new}</b><small>new words</small></div><div class="stat"><b>${s.rev}</b><small>reviewed</small></div><div class="stat"><b>${mins}</b><small>min</small></div></div></div>
    <div class="foot"><button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
}

function closeOverlay() {
  // Leaving a vocabulary session early still shows what was answered.
  if (vq && !vq.finished && (Object.keys(vq.first).length || (vq.fb && !vq.fb.checking))) return finishVocab();
  vq = null;
  if (sess) { logTime(sess.start); sess = null; }
  if (drill) { logTime(drill.start); drill = null; }
  reader = null;
  if (canSpeak) speechSynthesis.cancel();
  overlay.hidden = true; overlay.innerHTML = ''; render();
}

// ═════════ Drills ═════════
let drill = null;
const ONES = ['nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni', 'ti', 'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'];
const TENS = { 20: 'tyve', 30: 'tredive', 40: 'fyrre', 50: 'halvtreds', 60: 'tres', 70: 'halvfjerds', 80: 'firs', 90: 'halvfems' };
function daNum(n) {
  if (n < 20) return ONES[n];
  if (n < 100) { const o = n % 10; return o ? ONES[o] + 'og' + TENS[n - o] : TENS[n]; }
  const h = Math.floor(n / 100), r = n % 100, hs = (h === 1 ? 'et' : ONES[h]) + ' hundrede';
  return r ? hs + ' og ' + daNum(r) : hs;
}
const norm = s => s.toLowerCase().replace(/[.,!?]/g, '').replace(/\s+/g, ' ').trim();
const PROPER = /^(Danmark|Anna|Peter|Aarhus|København|Jylland|Odense|Skagen)/;

function startDrill(kind) {
  if ((kind === 'pairs') && !hasVoice()) { toast('This drill needs a Danish voice on the device'); return; }
  const known = Object.keys(S.items).map(id => ITEM[id]).filter(Boolean);
  let pool = [...new Set([...known, ...modItems(S.module)])], qs;
  if (kind === 'pairs') qs = shuffle(PAIRS).slice(0, 10).map(p => ({ p, target: rnd(0, 1) }));
  else if (kind === 'numbers') qs = shuffle([rnd(20, 49), rnd(20, 49), rnd(50, 99), rnd(50, 99), rnd(50, 99), rnd(50, 99), rnd(50, 99), rnd(100, 999), rnd(100, 999), rnd(100, 999)]).map(n => ({ n }));
  else if (kind === 'gender') {
    const noun = x => /^(en|et) \S+$/.test(x.da);
    let ns = pool.filter(noun); if (ns.length < 10) ns = [...new Set([...ns, ...modItems(1).filter(noun)])];
    qs = shuffle(ns).slice(0, 10).map(it => ({ it }));
  } else {
    const fits = x => { const n = x.ex.split(' ').length; return n >= 4 && n <= 8; };
    let ss = pool.filter(fits); if (ss.length < 6) ss = [...new Set([...ss, ...modItems(1).filter(fits)])];
    qs = shuffle(ss).slice(0, 6).map(it => {
      const w = it.ex.replace(/[.!?]$/, '').split(' ');
      if (!PROPER.test(w[0])) w[0] = w[0].toLowerCase();
      return { it, toks: shuffle(w.map((t, i) => ({ t, i }))), picked: [] };
    });
  }
  sess = null; reader = null; vq = null;
  drill = { kind, qs, i: 0, ok: 0, fb: null, input: '', start: Date.now(), tick: 0 };
  closeSheet(); paintDrill(true);
}

function paintDrill(auto) {
  const q = drill.qs[drill.i];
  if (!q) return finishDrill();
  const k = drill.kind, fb = drill.fb, voice = hasVoice();
  let body = '', foot = '', say = '';
  if (k === 'pairs') {
    const [a, ae, b, be, tag] = q.p, w = [[a, ae], [b, be]];
    body = `<span class="badge">${esc(tag)} · which word did you hear?</span>${play(w[q.target][0])}
      <div class="choices">${w.map((x, i) => `<button class="choice ${fb ? (i === q.target ? 'ok' : i === fb.pick ? 'bad' : '') : ''}" data-a="${fb ? 'say' : 'dPick'}" data-i="${i}" data-t="${esc(x[0])}"><b>${esc(x[0])}</b><small>${esc(x[1])}</small></button>`).join('')}</div>
      ${fb ? '<p class="muted center">Tap either word to hear it again.</p>' : ''}`;
    say = w[q.target][0];
  } else if (k === 'numbers') {
    const word = daNum(q.n);
    body = `<span class="badge">Type the number you hear</span>${play(word)}
      ${voice ? '' : `<div class="gloss">${esc(word)}</div>`}
      <div class="digits ${fb ? (fb.ok ? 'ok' : 'bad') : ''}">${esc(drill.input) || '&nbsp;'}</div>
      ${fb ? `<div class="gloss"><b>${q.n}</b> · ${esc(word)}</div>` : `<div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, 'OK'].map(x => `<button data-a="key" data-k="${x}" class="${x === 'OK' ? 'go' : ''}">${x}</button>`).join('')}</div>`}`;
    say = word;
  } else if (k === 'gender') {
    const [art, noun] = q.it.da.split(' ');
    body = `<span class="badge">En or et?</span><div class="word">${fb ? esc(q.it.da) : '<span class="blank">__</span> ' + esc(noun)}</div><div class="gloss">${esc(q.it.en)}</div>
      <div class="choices">${['en', 'et'].map(x => `<button class="choice ${fb ? (x === art ? 'ok' : x === fb.pick ? 'bad' : '') : ''}" data-a="dPick" data-i="${x}" ${fb ? 'disabled' : ''}><b>${x}</b></button>`).join('')}</div>`;
  } else {
    const used = new Set(q.picked);
    body = `<span class="badge">Build the sentence</span><div class="gloss lead">${esc(q.it.exEn)}</div>
      <div class="answer ${fb ? (fb.ok ? 'ok' : 'bad') : ''}">${q.picked.map(i => `<button class="tok" data-a="unTok" data-i="${i}" ${fb ? 'disabled' : ''}>${esc(q.toks.find(t => t.i === i).t)}</button>`).join('') || '<span class="hint">Tap the words in order</span>'}</div>
      ${fb ? `<div class="ex">${spk(q.it.ex, 'sm')}<span class="grow"><b>${esc(q.it.ex)}</b></span></div>` : `<div class="tokens">${q.toks.map(t => `<button class="tok ${used.has(t.i) ? 'used' : ''}" data-a="tok" data-i="${t.i}" ${used.has(t.i) ? 'disabled' : ''}>${esc(t.t)}</button>`).join('')}</div>`}`;
    if (!fb) foot = `<button class="btn primary block" data-a="dCheck" ${q.picked.length === q.toks.length ? '' : 'disabled'}>Check</button>`;
  }
  if (fb && !(fb.ok && k !== 'build')) foot = `<div class="fb ${fb.ok ? 'ok' : 'bad'}">${fb.ok ? 'Rigtigt' : 'Not quite'}</div><button class="btn primary block" data-a="dNext">Continue</button>`;
  else if (fb) foot = `<div class="fb ok">Rigtigt</div>`;
  overlay.innerHTML = ohead(Math.round(drill.i / drill.qs.length * 100), drill.qs.length - drill.i) + `<div class="stage">${body}</div><div class="foot">${foot}</div>`;
  overlay.hidden = false;
  if (auto && say && !fb) speak(say);
}

function drillAnswer(ok, picked) {
  const k = drill.kind, d = day(), s = S.drills[k] = S.drills[k] || { n: 0, ok: 0 };
  drill.fb = { ok, pick: picked }; if (ok) { drill.ok++; d.dok++; s.ok++; } d.drill++; s.n++; save();
  paintDrill(false);
  const q = drill.qs[drill.i];
  if (k === 'gender') speak(q.it.da); else if (k === 'build') speak(q.it.ex);
  if (ok && k !== 'build') { const t = drill.tick; setTimeout(() => { if (drill && drill.tick === t) drillNext(); }, 900); }
}
function drillNext() { drill.i++; drill.fb = null; drill.input = ''; drill.tick++; paintDrill(true); }
function finishDrill() {
  const d = drill, pct = Math.round(d.ok / d.qs.length * 100);
  logTime(d.start); drill = null;
  overlay.innerHTML = `<div class="stage done">${CHECK}<h1>${d.ok} / ${d.qs.length}</h1><p class="muted">${DRILLS[d.kind].name} · ${pct}% correct</p></div>
    <div class="foot"><button class="btn tint block" data-a="drill" data-k="${d.kind}">Go again</button><button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
}

// ═════════ Adding and editing words ═════════
function addWord() {
  const a = $('#wDa'), b = $('#wEn'), n = $('#wNo'), da = a.value.trim(), en = b.value.trim();
  if (!da) { a.focus(); return; }
  if (!en) { b.focus(); return; }
  if (S.custom.some(c => c.da.toLowerCase() === da.toLowerCase())) { toast('That word is already in your list'); return; }
  S.custom.push({ id: newId(), da, en, notes: n.value.trim(), added: today() });
  save(); render(); $('#wDa').focus();
}
function saveWord(id) {
  const c = byId(id), da = $('#eDa').value.trim(), en = $('#eEn').value.trim();
  if (!c || !da || !en) { toast('A word needs both Danish and English'); return; }
  if (S.custom.some(x => x.id !== id && x.da.toLowerCase() === da.toLowerCase())) { toast('Another word already has that Danish text'); return; }
  c.da = da; c.en = en; c.notes = $('#eNo').value.trim();   // learning history is kept
  save(); closeSheet(); render(); toast('Saved');
}

// ═════════ Backup and export ═════════
async function shareFile(name, data, type) {
  try {
    const file = new File([data], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; /* otherwise fall back to a plain download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
async function exportBackup() {
  const ok = await shareFile(`dansk-backup-${today()}.json`, JSON.stringify({ app: 'dansk', v: 2, exported: new Date().toISOString(), state: S }), 'application/json');
  if (ok) { S.lastBackup = today(); save(); if (overlay.hidden) render(); toast('Backup saved'); }
}
function exportCSV() {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['danish', 'english', 'notes', 'part_of_speech', 'added', 'status', 'times_tested', 'correct', 'incorrect', 'interval_days', 'next_review']];
  S.custom.forEach(c => { const v = vs(c.id); rows.push([c.da, c.en, c.notes || '', posOf(c), c.added, statusOf(c), v.n, v.ok, v.bad, v.iv, v.due]); });
  shareFile(`dansk-vocabulary-${today()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
}

let pendingImport = null, pendingId = null;
function readImport(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const b = JSON.parse(r.result), st = b && b.state;
      if (!b || b.app !== 'dansk' || !st || typeof st.items !== 'object' || typeof st.days !== 'object') throw 0;
      pendingImport = st;
      confirmSheet('Restore this backup?', `Backup from <b>${esc((b.exported || '').slice(0, 10) || 'unknown date')}</b> with <b>${(st.custom || []).length}</b> vocabulary words and <b>${Object.keys(st.items).length}</b> course words.<br>This phone currently has <b>${S.custom.length}</b> and <b>${Object.keys(S.items).length}</b>. Restoring replaces what is on this phone.`, 'Replace and restore', 'doImport', true);
    } catch (e) { toast('That file is not a Dansk backup'); }
  };
  r.readAsText(file);
}

// ═════════ Events ═════════
const A = {
  tab: el => { tab = el.dataset.tab; if (tab === 'course') viewMod = S.module; render(); window.scrollTo(0, 0); },
  say: el => speak(el.dataset.t, !!el.dataset.slow),
  closeSheet, closeOverlay,
  obNext: () => { obStep = 1; render(); },
  obPick: el => { const m = Number(el.dataset.m); S.module = viewMod = m; for (let i = 1; i < m; i++) markKnown(i); S.onboarded = true; save(); render(); },
  hintOff: () => { S.hintOff = true; save(); render(); },
  // vocabulary
  vStart: () => startVocab(false),
  vAhead: () => startVocab(true),
  vBegin: () => nextPassage(),
  qPick: el => { const q = vq; if (!q || !q.p) { if (reader && !reader.shown) { reader.shown = true; paintReader(); } return; } const id = el.dataset.id; if (q.done[id] && !(q.fb && q.fb.id === id)) return; if (q.fb && q.fb.checking) return; if (q.fb && q.fb.id !== id) commitFb(); if (!q.done[id]) { q.active = id; paintQuiz(); } },
  qSubmit: () => submitAns(false),
  qSkip: () => submitAns(true),
  qOver: () => { const q = vq; if (!q.fb) return; q.fb.kind = 'ok'; q.fb.note = ''; q.done[q.fb.id] = 'ok'; paintQuiz(); },
  qNext,
  addWord,
  word: el => wordSheet(el.dataset.id),
  saveWord: el => saveWord(el.dataset.id),
  bulk: () => bulkSheet(''),
  bulkReview,
  bulkBack: () => bulkSheet(bulkSheet.text),
  bulkSave: () => { const add = bulkParsed.filter(p => !p.dup); add.forEach(p => S.custom.push({ id: newId(), da: p.da, en: p.en, notes: '', added: today() })); bulkParsed = []; save(); closeSheet(); render(); toast(`${add.length} ${add.length === 1 ? 'word' : 'words'} added`); },
  read: el => startReader(el.dataset.id),
  rShow: () => { if (reader && !reader.shown) { reader.shown = true; paintReader(); } },
  rAgain: () => loadReader(),
  askDelWord: el => { pendingId = el.dataset.id; confirmSheet('Delete this word?', 'The word and its learning history are removed from this phone.', 'Delete word', 'doDelWord', true); },
  doDelWord: () => { S.custom = S.custom.filter(c => c.id !== pendingId); delete S.vs[pendingId]; save(); closeSheet(); render(); },
  // course
  start: () => startSession(),
  more: () => startSession({ extra: 5 }),
  viewMod: el => { viewMod = Number(el.dataset.m); render(); },
  setMod: () => { S.module = viewMod; save(); render(); toast(`${MOD(viewMod).name} is now your current module`); },
  askKnown: () => confirmSheet(`Mark ${MOD(viewMod).name} as known?`, 'Every word in this module you have not studied yet is marked as known. They will still come back for an occasional review, a few per day.', 'Mark as known', 'doKnown'),
  doKnown: () => { markKnown(viewMod); save(); closeSheet(); render(); toast(`${MOD(viewMod).name} marked as known`); },
  unit: el => unitSheet(el.dataset.u),
  studyUnit: el => startSession({ unit: el.dataset.u }),
  next: () => nextCard(),
  knowIt,
  reveal: () => { sess.revealed = true; paintSess(true); },
  pick: el => pickOpt(el.dataset.id),
  grade: el => grade(el.dataset.g),
  drill: el => startDrill(el.dataset.k),
  dPick: el => { const q = drill.qs[drill.i]; if (drill.fb) return; if (drill.kind === 'pairs') { const i = Number(el.dataset.i); drillAnswer(i === q.target, i); } else { const x = el.dataset.i; drillAnswer(x === q.it.da.split(' ')[0], x); } },
  key: el => { const k = el.dataset.k, q = drill.qs[drill.i]; if (k === '⌫') drill.input = drill.input.slice(0, -1); else if (k === 'OK') { if (drill.input) return drillAnswer(Number(drill.input) === q.n); } else if (drill.input.length < 4) drill.input += k; paintDrill(false); },
  tok: el => { drill.qs[drill.i].picked.push(Number(el.dataset.i)); paintDrill(false); },
  unTok: el => { const q = drill.qs[drill.i]; q.picked = q.picked.filter(i => i !== Number(el.dataset.i)); paintDrill(false); },
  dCheck: () => { const q = drill.qs[drill.i]; drillAnswer(norm(q.picked.map(i => q.toks.find(t => t.i === i).t).join(' ')) === norm(q.it.ex)); },
  dNext: () => drillNext(),
  // settings
  mins: el => { S.cfg.minutes = Math.min(45, Math.max(5, S.cfg.minutes + Number(el.dataset.d))); save(); render(); },
  npd: el => { S.newPerDay = Math.min(20, Math.max(2, S.newPerDay + Number(el.dataset.d))); save(); render(); },
  slow: () => { S.slow = !S.slow; save(); render(); speak('Hej, hvordan går det?'); },
  aiSave: () => { const k = $('#aiKey').value.trim(); if (!k) { $('#aiKey').focus(); return; } try { localStorage.setItem(AI_KEY, k); } catch (e) { toast('Could not save the key'); return; } aiClient = null; aiWarned = false; render(); toast('Key saved on this phone'); },
  aiRemove: () => { localStorage.removeItem(AI_KEY); aiClient = null; render(); toast('Key removed'); },
  aiTest: async () => { toast('Testing'); try { const r = await aiJSON('Reply with ok set to true.', 'Connection test.', obj({ ok: { type: 'boolean' } }, ['ok'])); toast(r ? 'AI assistance is working' : 'No usable reply came back'); } catch (e) { toast('Test failed' + (e && e.status ? ` (${e.status})` : '') + ': ' + String((e && e.message) || e).slice(0, 80)); } },
  export: () => exportBackup(),
  csv: () => exportCSV(),
  import: () => { const f = $('#file'); f.value = ''; f.click(); },
  doImport: () => { if (!pendingImport) return; S = migrate(Object.assign(fresh(), pendingImport, { onboarded: true })); pendingImport = null; viewMod = S.module; save(); closeSheet(); render(); toast('Backup restored'); },
  askReset: () => confirmSheet('Erase everything?', 'Your vocabulary, all learning history and your settings will be removed from this phone. This cannot be undone unless you have a backup file.', 'Erase everything', 'doReset', true),
  doReset: () => { S = fresh(); save(); obStep = 0; tab = 'today'; closeSheet(); render(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled && A[el.dataset.a]) A[el.dataset.a](el);
});
document.addEventListener('change', e => {
  const t = e.target, c = t.dataset.c;
  if (t.id === 'file' && t.files[0]) readImport(t.files[0]);
  if (c === 'voice') { S.voice = t.value; save(); speak('Hej, hvordan går det?'); }
  if (c === 'vsort') { S.vsort = t.value; save(); render(); }
  if (c === 'intervals') {
    const a = t.value.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (a.length >= 3 && a.every((x, i) => x > 0 && (!i || x > a[i - 1]))) { S.cfg.intervals = a; save(); toast('Intervals saved'); }
    else { toast('Enter at least three rising numbers of days'); t.value = S.cfg.intervals.join(', '); }
  }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'vSearch') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#vList .li').forEach(r => { r.hidden = !!q && !r.dataset.s.includes(q); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target.id;
  if (id === 'wDa') { e.preventDefault(); $('#wEn').focus(); }
  else if (id === 'wEn') { e.preventDefault(); $('#wNo').focus(); }
  else if (id === 'wNo') { e.preventDefault(); addWord(); }
  else if (id === 'ans') { e.preventDefault(); submitAns(false); }
  else if (vq && vq.fb && !vq.fb.checking && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') { e.preventDefault(); qNext(); }
});
// A new day may have started while the app sat in the background. Leave the screen alone while typing.
document.addEventListener('visibilitychange', () => { if (!document.hidden && overlay.hidden && sheet.hidden && !typing()) render(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(p => { persisted = p; }).catch(() => {});
if ('serviceWorker' in navigator && !/^(localhost|127\.)/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
})();
