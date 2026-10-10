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

// ───────── State ─────────
// custom = the user's vocabulary bank: [{id, da, en, notes, added}]
// vs     = learning record per word: {n, ok, bad, step, iv, due, last, hist}
const DEF_INTERVALS = [2, 4, 10, 20, 40, 80, 160];
const MODES = {
  context: ['Meaning in a text', 'A Danish text with your word highlighted; you write what it means'],
  cloze: ['Fill the gap', 'A Danish text with your word missing; you write the Danish word'],
  da2en: ['Danish to English', 'The Danish word on its own; you write what it means'],
  en2da: ['English to Danish', 'Your translation on its own; you write the Danish word']
};
const defCfg = () => ({ minutes: 20, intervals: DEF_INTERVALS.slice(), modes: { context: true, cloze: true, da2en: true, en2da: true } });
const fresh = () => ({ app: 'dansk', v: 3, created: today(), onboarded: false, slow: false, voice: '', hintOff: false, custom: [], vs: {}, sessions: [], cfg: defCfg(), vsort: 'new', lastBackup: '' });
function migrate(s) {
  s.cfg = Object.assign(defCfg(), s.cfg); s.cfg.modes = Object.assign(defCfg().modes, s.cfg.modes);
  s.custom = s.custom || []; s.vs = s.vs || {}; s.sessions = s.sessions || [];
  // Versions 1 and 2 had a built-in course; the very first scheduled the user's words alongside it.
  if (s.items) s.custom.forEach(c => {
    const old = s.items['c:' + c.id];
    if (old && !s.vs[c.id]) s.vs[c.id] = { n: old.reps, ok: old.reps, bad: old.lapses || 0, step: Math.min(old.reps, 2), iv: old.iv, due: old.due, last: old.first, hist: [] };
  });
  ['items', 'days', 'drills', 'module', 'newPerDay'].forEach(k => delete s[k]);
  s.v = 3;
  return s;
}
function load() {
  try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.app === 'dansk') return migrate(Object.assign(fresh(), r)); } catch (e) { /* fall through to a fresh state */ }
  return fresh();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save progress on this device'); } }

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
function record(c, kind, answer, src, mode, noAdvance) {
  const v = vsW(c.id), t = today(), early = v.n > 0 && v.due > t;
  v.n++; v.last = t;
  v.hist.unshift({ d: t, k: kind, a: answer, s: src, m: mode }); v.hist = v.hist.slice(0, 12);
  if (kind === 'ok') {
    v.ok++;
    if (!noAdvance && !early) {
      v.step++; v.iv = intervalFor(v.step);
      // A word missed twice or more in its last six answers keeps coming back at half the interval.
      if (v.hist.slice(0, 6).filter(h => h.k !== 'ok').length >= 2) v.iv = Math.max(1, Math.round(v.iv / 2));
      v.due = addDays(t, v.iv);
    }
  } else {
    v.bad++; v.step = kind === 'part' ? Math.max(0, v.step - 1) : 0; v.iv = 1; v.due = addDays(t, 1);
  }
}

// Exercise types rotate with each test of a word, so it is met from every direction.
function modeFor(c) {
  const on = Object.keys(MODES).filter(m => S.cfg.modes[m]); if (!on.length) return 'context';
  const n = vs(c.id).n;
  return !n && on.includes('context') ? 'context' : on[n % on.length];
}

// ───────── Speech ─────────
let voices = [];
const canSpeak = 'speechSynthesis' in window;
function loadVoices() { if (canSpeak) voices = speechSynthesis.getVoices().filter(v => /^da([-_]|$)/i.test(v.lang)); }
const pickVoice = () => voices.find(v => v.name === S.voice) || voices.find(v => /premium|enhanced|natural/i.test(v.name)) || voices[0];
function speak(text) {
  if (!canSpeak || !text) return;
  if (!voices.length) loadVoices();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = 'da-DK';
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = S.slow ? 0.75 : 0.95;
  speechSynthesis.speak(u);
}
if (canSpeak) {
  loadVoices();
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { loadVoices(); if (tab === 'settings' && overlay.hidden && !typing()) render(); });
}

// ───────── Small UI pieces ─────────
const SPK = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const spk = (t, cls = '') => `<button class="spk ${cls}" data-a="say" data-t="${esc(t)}" aria-label="Play">${SPK}</button>`;
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
const ohead = (pct, right) => `<div class="ohead"><button class="x" data-a="closeOverlay" aria-label="Close">✕</button>${pct === null ? '<span class="grow"></span>' : `<div class="prog"><i style="width:${pct}%"></i></div>`}<span class="count">${right}</span></div>`;

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
let tab = 'today';
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function render() {
  if (!S.onboarded) { tabbar.hidden = true; view.innerHTML = onboarding(); return; }
  tabbar.hidden = false;
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  view.innerHTML = ({ today: vToday, vocab: vVocab, progress: vProgress, settings: vSettings })[tab]();
}

function onboarding() {
  return `<div class="ob">
    <h1>Dansk</h1>
    <p class="lead">Learn the Danish words you choose, by meeting them again and again in real Danish texts.</p>
    <div class="list">
      <div class="li static"><span class="grow"><b>Your words only</b><small>You add every word and write its translation</small></span></div>
      <div class="li static"><span class="grow"><b>Real texts</b><small>News from DR with your words highlighted or left out for you to fill in</small></span></div>
      <div class="li static"><span class="grow"><b>It adapts</b><small>Words you miss come back sooner and more often, words you know fade out</small></span></div>
    </div>
    <button class="btn primary block" data-a="obDone">Get started</button>
  </div>`;
}

function vToday() {
  const h = new Date().getHours(), greet = h < 10 ? 'Godmorgen' : h < 18 ? 'Goddag' : 'Godaften';
  const date = new Date().toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
  const news = S.custom.filter(c => !vs(c.id).n).length, due = S.custom.filter(c => vs(c.id).n && isDueV(c)).length;
  const { pick } = vocabQueue(false), mins = Math.max(1, Math.round(pick.length * 40 / 60));
  const upcoming = S.custom.map(c => vs(c.id)).filter(v => v.n && v.due > today()).map(v => v.due).sort()[0];
  const stale = S.custom.length >= 10 && (!S.lastBackup || S.lastBackup < addDays(today(), -14));
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
    <button class="li" data-a="tab" data-tab="progress"><span class="grow"><b>Progress</b><small>${S.custom.filter(c => statusOf(c) === 'mastered').length} mastered · ${S.custom.filter(overdueV).length} overdue</small></span><span class="chev">›</span></button>
  </div>`;
}

const SORTS = { new: 'Newest first', az: 'A to Z', due: 'Next review', hard: 'Most missed' };
function sortedVocab() {
  const a = S.custom.slice(), k = S.vsort;
  if (k === 'az') a.sort((x, y) => termOf(x.da).localeCompare(termOf(y.da), 'da'));
  else if (k === 'due') a.sort((x, y) => (vs(x.id).due || '0') < (vs(y.id).due || '0') ? -1 : 1);
  else if (k === 'hard') a.sort((x, y) => vs(y.id).bad - vs(x.id).bad);
  else a.reverse();
  return a;
}
const vocabRow = c => { const v = vs(c.id), st = statusOf(c); return `
  <button class="li" data-a="word" data-id="${c.id}" data-s="${esc((c.da + ' ' + c.en).toLowerCase())}"><span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}</small></span><span class="meta"><span class="pill ${st}">${st}</span><small>${!v.n ? '' : v.due <= today() ? 'due' : v.due.slice(5)}</small></span></button>`; };

// Word fields keep the iPhone keyboard's suggestions on; only automatic capitals are off.
function vVocab() {
  return `
  <header class="top"><div><h1>Vocabulary</h1></div></header>
  <section class="card form">
    <input id="wDa" type="text" placeholder="Danish word or expression" autocapitalize="none" lang="da" enterkeyhint="next">
    <input id="wEn" type="text" placeholder="English translation" autocapitalize="none" lang="en" enterkeyhint="next">
    <input id="wNo" type="text" placeholder="Notes (optional)" enterkeyhint="done">
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
      <input id="eDa" type="text" value="${esc(c.da)}" autocapitalize="none" lang="da">
      <input id="eEn" type="text" value="${esc(c.en)}" placeholder="English translation" autocapitalize="none" lang="en">
      <input id="eNo" type="text" value="${esc(c.notes || '')}" placeholder="Notes (optional)">
      <button class="btn tint block" data-a="saveWord" data-id="${id}">Save changes</button>
    </div>
    <div class="list">
      <div class="li static slim"><span class="grow">Tested</span><span>${v.n} times</span></div>
      <div class="li static slim"><span class="grow">Correct / incorrect</span><span>${v.ok} / ${v.bad}</span></div>
      <div class="li static slim"><span class="grow">Current interval</span><span>${v.n ? v.iv + ' days' : '–'}</span></div>
      <div class="li static slim"><span class="grow">Next review</span><span>${!v.n ? 'next session' : v.due <= today() ? 'due now' : v.due}</span></div>
    </div>
    ${v.hist.length ? `<h3>Recent answers</h3><div class="list">${v.hist.map(h => `
      <div class="li static slim"><span class="grow"><b class="k-${h.k}">${K[h.k]}</b><small>${h.a ? '“' + esc(h.a) + '”' : 'no answer'}${h.m && MODES[h.m] ? ' · ' + MODES[h.m][0] : ''}${h.s ? ' · ' + esc(h.s) : ''}</small></span><small>${h.d}</small></div>`).join('')}</div>` : ''}
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
let bulkParsed = [], bulkText = '';
function bulkSheet(text) {
  openSheet(`<h2>Paste a list</h2><p class="muted">One word per line with its translation after a tab, dash or equals sign. A table copied as alternating Danish and English lines also works.</p>
    <textarea id="bulkT" rows="9" placeholder="at beslutte - to decide&#10;en mulighed - an opportunity; a possibility" autocapitalize="none">${esc(text || '')}</textarea>
    <button class="btn primary block" data-a="bulkReview">Review</button>`);
}
function bulkReview() {
  bulkText = $('#bulkT').value; bulkParsed = parseBulk(bulkText);
  const ok = bulkParsed.filter(p => !p.dup);
  if (!bulkParsed.length) { toast('No word pairs found in that text'); return; }
  openSheet(`<h2>Review ${ok.length} ${ok.length === 1 ? 'word' : 'words'}</h2>
    <div class="list">${bulkParsed.map(p => `<div class="li static slim ${p.dup ? 'dim' : ''}"><span class="grow"><b>${esc(p.da)}</b><small>${esc(p.en)}${p.dup ? ' · already in your list, skipped' : ''}</small></span></div>`).join('')}</div>
    <button class="btn primary block" data-a="bulkSave" ${ok.length ? '' : 'disabled'}>Save ${ok.length} ${ok.length === 1 ? 'word' : 'words'}</button>
    <button class="btn ghost block" data-a="bulkBack">Back to edit</button>`);
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
  <div class="list"><button class="li" data-a="tab" data-tab="vocab"><span class="grow"><b>All words</b><small>Search the list and open any word for its history</small></span><span class="chev">›</span></button></div>`;
}

let persisted = null;
const hasAI = () => { try { return !!localStorage.getItem(AI_KEY); } catch (e) { return false; } };
function vSettings() {
  return `
  <header class="top"><div><h1>Settings</h1></div></header>
  <h3>Exercises</h3>
  <div class="list">${Object.keys(MODES).map(m => `
    <div class="li static"><span class="grow"><b>${MODES[m][0]}</b><small>${MODES[m][1]}</small></span><button class="switch ${S.cfg.modes[m] ? 'on' : ''}" data-a="mode" data-m="${m}" aria-label="${MODES[m][0]}"><i></i></button></div>`).join('')}</div>
  <p class="foot-note">Each word moves through the exercises you leave on, one per review. A new word always starts with its meaning in a text.</p>
  <h3>Sessions</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>Session length</b><small>About ${Math.round(S.cfg.minutes * 60 / 40)} words per session</small></span><div class="stepper"><button data-a="mins" data-d="-5">−</button><span>${S.cfg.minutes}</span><button data-a="mins" data-d="5">+</button></div></div>
    <div class="li static"><span class="grow"><b>Review intervals</b><small>Days after each correct answer in a row</small></span><input type="text" class="short" data-c="intervals" value="${S.cfg.intervals.join(', ')}" inputmode="numeric"></div>
  </div>
  <p class="foot-note">A missed word comes back the next day and starts the intervals again. A word you keep missing returns at half the usual interval until you get it right consistently.</p>
  <h3>AI assistance (optional)</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>${hasAI() ? 'Key saved on this phone' : 'No key'}</b><small>${hasAI() ? 'Used to judge your English answers and to write a text when none is found' : 'Without a key, answers are matched against your translations'}</small></span>${hasAI() ? `<button class="link" data-a="aiTest">Test</button>` : ''}</div>
    <div class="li static"><input type="password" id="aiKey" placeholder="Anthropic API key" autocomplete="off"><button class="link" data-a="aiSave">Save</button></div>
    ${hasAI() ? `<button class="li" data-a="aiRemove"><span class="grow"><b class="red">Remove key</b></span></button>` : ''}
  </div>
  <p class="foot-note">The key stays on this phone, is never part of a backup file, and is sent only to Anthropic. Usage is billed to your Anthropic account.</p>
  <h3>Speech</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>Slower speech</b></span><button class="switch ${S.slow ? 'on' : ''}" data-a="slow" aria-label="Slower speech"><i></i></button></div>
    <div class="li static"><span class="grow"><b>Voice</b></span>${voices.length ? `<select data-c="voice">${voices.map(v => `<option ${v.name === (pickVoice() || {}).name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<small>No Danish voice</small>'}</div>
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

const srcLine = p => p.src === 'AI-generated' ? 'AI-generated text · not a real source'
  : `${esc(p.src)} · <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>`;
// Renders a passage. `cls` gives each target its state; `gap` says whether a target is still a
// blank to fill, in which case every other occurrence of that word is blanked as well.
const GAP = '      ';
function markup(p, cls, gap) {
  const gaps = p.targets.filter(t => gap && gap(t.id)).map(t => byId(t.id)).filter(Boolean);
  const plain = s => { gaps.forEach(c => { s = s.replace(new RegExp(rx(c).source, 'giu'), (m, pre) => pre + '\u0001'); }); return esc(s).replace(/\u0001/g, `<span class="gapped">${GAP}</span>`); };
  let html = '', pos = 0;
  p.targets.forEach(t => {
    html += plain(p.text.slice(pos, t.start)) + `<mark class="${cls(t.id)}${gap && gap(t.id) ? ' gap' : ''}" data-a="qPick" data-id="${t.id}">${gap && gap(t.id) ? GAP : esc(p.text.slice(t.start, t.end))}</mark>`;
    pos = t.end;
  });
  return html + plain(p.text.slice(pos));
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
    'You grade an English translation given by an adult learner of Danish. Judge only whether the answer conveys the meaning of the Danish word' + (passage ? ' as it is used in the passage' : '') + '. Accept synonyms, either tense or number, and small spelling mistakes. "partial" means the answer is related but misses or narrows the meaning. Reply with a verdict and one short sentence of explanation, in English.',
    `Danish word as the learner saved it: ${c.da}${form ? '\nForm in the passage: ' + form : ''}\nThe learner's own translation: ${c.en}${c.notes ? '\nLearner notes: ' + c.notes : ''}${passage ? '\nPassage: ' + passage : ''}\n\nLearner's answer: ${answer}`,
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
// English answer against the user's translations: alternatives, small typos, other endings.
function enMatch(answer, en) {
  const a = strip(answer); if (!a) return false;
  return en.split(/[;,\/]|\bor\b/).map(strip).filter(Boolean).some(alt =>
    a === alt || stemAll(a) === stemAll(alt) || lev(a, alt) <= (alt.length >= 9 ? 2 : alt.length >= 5 ? 1 : 0));
}
// Danish answer: the saved word, the form in the text, or another inflection of it. Spelling
// counts here, so a one-letter slip or a wrong article is only "partly right".
function daMatch(answer, c, form) {
  const a = answer.trim().toLowerCase().replace(/\s+/g, ' '), term = termOf(c.da), full = c.da.trim().toLowerCase();
  const good = [term, full]; if (form) good.push(form.toLowerCase());
  if (!a) return { kind: 'bad' };
  if (good.includes(a)) return { kind: 'ok' };
  const m = rx(c).exec(a); if (m && m[2].length === a.length) return { kind: 'ok' };
  const art = a.match(/^(en|et|at)\s+(.+)$/);
  if (art && art[2] === term) return { kind: 'part', note: `Right word, but it is “${c.da}”.` };
  if (good.some(g => g.length >= 5 && lev(a, g) === 1)) return { kind: 'part', note: 'Nearly: check the spelling.' };
  return { kind: 'bad' };
}

// ═════════ The session ═════════
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

// vq.pending = words waiting for a text (meaning / gap); vq.quick = words waiting for a quick
// translation card. Texts and short runs of quick cards alternate.
let vq = null;
const inText = m => m === 'context' || m === 'cloze';
function startVocab(ahead) {
  const { pick } = vocabQueue(ahead);
  if (!pick.length) { toast('Nothing to review right now'); return; }
  reader = null;
  const ids = pick.map(c => c.id), mode = {}; pick.forEach(c => { mode[c.id] = modeFor(c); });
  vq = { ids, mode, pending: ids.filter(id => inText(mode[id])), quick: shuffle(ids.filter(id => !inText(mode[id]))), qrun: 0, retry: [], retried: new Set(), first: {}, phase2: false,
    intro: pick.filter(c => !vs(c.id).n), p: null, card: null, active: null, fb: null, done: {}, used: new Set(), next: null, loading: false, start: Date.now(), tick: 0, finished: false };
  closeSheet();
  if (vq.intro.length) paintIntro(); else advance();
}

function paintIntro() {
  overlay.innerHTML = ohead(null, `${vq.intro.length} new`) + `<div class="stage top"><h2>New words</h2><p class="muted">Read them through once. They count as learned only after you recall them.</p>
    <div class="list">${vq.intro.map(c => `<div class="li static slim">${spk(c.da, 'sm')}<span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}${posOf(c) ? ' · ' + posOf(c) : ''}${c.notes ? ' · ' + esc(c.notes) : ''}</small></span></div>`).join('')}</div></div>
    <div class="foot"><button class="btn primary block" data-a="vBegin">Start</button></div>`;
  overlay.hidden = false;
}

function advance() {
  const q = vq;
  if (q.qrun > 0 && q.quick.length) { q.qrun--; return showQuick(q.quick[0]); }
  if (q.pending.length) { q.qrun = 3; return nextPassage(); }
  if (q.quick.length) return showQuick(q.quick[0]);
  if (q.retry.length) {
    // Second chance for missed words, always as "meaning in a text" so they are seen in use.
    q.retry.forEach(id => { q.mode[id] = 'context'; });
    q.pending = q.retry; q.retry = []; q.phase2 = true; q.next = null; q.qrun = 0;
    return nextPassage();
  }
  finishVocab();
}

function showQuick(id, mode) {
  const q = vq; q.tick++;
  q.p = null; q.fb = null; q.hint = null; q.loading = false; q.card = { id, mode: mode || q.mode[id] }; q.active = id;
  paintQuiz();
}

// A word can be highlighted in a text if it has not been answered yet in this session and is
// not waiting for a quick card.
const eligibleNow = q => id => q.phase2 ? q.pending.includes(id) : !(id in q.first) && !q.quick.includes(id);
async function nextPassage() {
  const q = vq, k = ++q.tick;
  q.loading = true; q.p = null; q.card = null; q.fb = null; q.hint = null; q.active = null; paintQuiz();
  let p = null;
  if (q.next) {
    const n = q.next; q.next = null;
    try { p = await n; } catch (e) { p = null; }
    if (vq !== q || q.tick !== k) return;
    if (p) { const ok = eligibleNow(q); p.targets = p.targets.filter(t => ok(t.id)); if (!q.pending.includes(p.primary) || !p.targets.some(t => t.id === p.primary)) p = null; }
  }
  if (!p) p = await buildPassage(q.pending, eligibleNow(q), q.used);
  if (vq !== q || q.tick !== k) return;
  // No text anywhere for this word: ask it as a plain translation card instead.
  if (p.src === 'none') return showQuick(p.primary, q.mode[p.primary] === 'cloze' ? 'en2da' : 'da2en');
  const gaps = q.phase2 ? [] : p.targets.filter(t => q.mode[t.id] === 'cloze');
  p.gap = gaps.length ? (gaps.find(t => t.id === p.primary) || gaps[0]).id : null;
  q.p = p; q.used.add(p.text); q.done = {}; q.loading = false; q.active = p.targets[0].id;
  paintQuiz();
  // Fetch the following text while this one is being answered.
  const shown = new Set(p.targets.map(t => t.id)), rest = q.pending.filter(id => !shown.has(id));
  if (rest.length) { const ok = id => eligibleNow(q)(id) && !shown.has(id); q.next = buildPassage(rest, ok, q.used); q.next.catch(() => {}); }
}

// Only one word per text is blanked out, so the text stays readable; any other word in it,
// including ones that are not part of today's selection, is asked for its meaning.
const modeOf = (q, id) => q.card ? q.card.mode : (!q.phase2 && q.p && q.p.gap === id ? 'cloze' : 'context');
const wantsDanish = m => m === 'cloze' || m === 'en2da';

function paintQuiz() {
  const q = vq, p = q.p, doneN = Object.keys(q.first).length, total = q.ids.length;
  let body;
  if (q.loading) body = `<div class="stage"><div class="spinner"></div><p class="muted">Finding a Danish text</p></div>`;
  else {
    const c = byId(q.active), mode = modeOf(q, q.active), fb = q.fb, da = wantsDanish(mode);
    const t = p && p.targets.find(x => x.id === q.active), left = p ? p.targets.filter(x => !q.done[x.id]).length : 0;
    let panel;
    if (fb && fb.checking) panel = `<div class="ans"><p class="muted">Checking your answer</p></div>`;
    else if (fb) {
      const label = fb.hinted && fb.kind === 'part' ? 'Right, with a hint' : { ok: 'Correct', part: 'Partly right', bad: 'Not quite' }[fb.kind];
      panel = `<div class="ans"><p class="verdict k-${fb.kind}">${label}</p>
        <div class="row">${spk(c.da, 'sm')}<p class="grow"><b>${esc(c.da)}</b> — ${esc(c.en)}</p></div>
        ${fb.ans ? `<p class="muted small">You ${fb.picked ? 'chose' : 'wrote'} “${esc(fb.ans)}”.${fb.note ? ' ' + esc(fb.note) : ''}</p>` : ''}
        ${c.notes ? `<p class="muted small">${esc(c.notes)}</p>` : ''}
        <button class="btn primary block" data-a="qNext">${left ? 'Next word' : 'Continue'}</button>
        ${fb.kind !== 'ok' && fb.ans && !fb.hinted ? `<button class="btn ghost block" data-a="qOver">My answer was right</button>` : ''}</div>`;
    } else {
      const ask = mode === 'context' ? `What does <b>${esc(t.form)}</b> mean here?`
        : mode === 'cloze' ? `Which Danish word is missing? It means <b>${esc(c.en)}</b>.`
        : mode === 'da2en' ? 'What does it mean?' : 'Write it in Danish.';
      // Danish answers are typed without keyboard help, since suggestions would give the spelling away.
      panel = `<div class="ans"><label for="ans">${ask}</label>
        <input id="ans" type="text" placeholder="${da ? 'Danish word' : 'English meaning'}" autocapitalize="none" autocomplete="off" lang="${da ? 'da' : 'en'}" ${da ? 'autocorrect="off" spellcheck="false"' : ''} enterkeyhint="send">
        <button class="btn primary block" data-a="qSubmit">Submit</button>
        ${q.hint && q.hint.id === c.id
          ? `<p class="muted small hint-note">One of these is right. With a hint the word still comes back tomorrow.</p><div class="opts">${q.hint.opts.map(o => `<button class="opt" data-a="qOpt" data-id="${o.id}">${esc(da ? o.da : o.en)}</button>`).join('')}</div>`
          : `<button class="btn ghost block" data-a="qHint">Show a hint</button>`}
        <button class="btn ghost block" data-a="qSkip">I don't know</button></div>`;
    }
    if (p) body = `<div class="stage top read"><p class="source">${srcLine(p)}${p.targets.length > 1 ? ` · ${p.targets.length} words to answer` : ''}</p>
      <div class="reading" lang="da">${markup(p, id => q.done[id] ? 'm-' + q.done[id] : id === q.active ? 'm-active' : 'm-todo', id => modeOf(q, id) === 'cloze' && !q.done[id])}</div>${panel}</div>`;
    else body = `<div class="stage top read"><p class="source">${MODES[mode][0]}</p>
      <div class="reading solo" lang="${da ? 'en' : 'da'}">${da ? esc(c.en) : esc(c.da)}${!da && !fb ? `<div class="solo-spk">${spk(c.da, 'sm')}</div>` : ''}</div>${panel}</div>`;
  }
  overlay.innerHTML = ohead(Math.round(doneN / total * 100), q.phase2 ? 'second try' : `${doneN} of ${total}`) + body;
  overlay.hidden = false;
  const inp = $('#ans'); if (inp) inp.focus();
}

// A hint offers four of the user's own words, one of them the answer, in random order. An answer
// given after a hint never counts as a successful recall.
function showHint() {
  const q = vq, id = q.active, c = byId(id); if (!c || q.fb || q.loading) return;
  const inPassage = new Set(q.p ? q.p.targets.map(t => t.id) : []);
  let others = S.custom.filter(x => x.id !== id && x.en !== c.en && termOf(x.da) !== termOf(c.da));
  const outside = others.filter(x => !inPassage.has(x.id)); if (outside.length >= 3) others = outside;
  if (!others.length) { toast('Add more words to your vocabulary to get hints'); return; }
  q.hint = { id, opts: shuffle([c, ...shuffle(others).slice(0, 3)]).map(x => ({ id: x.id, da: x.da, en: x.en })) };
  paintQuiz();
}
function pickHint(optId) {
  const q = vq, id = q.active; if (!q.hint || q.hint.id !== id || q.fb) return;
  const o = q.hint.opts.find(x => x.id === optId), mode = modeOf(q, id), right = optId === id;
  q.fb = { id, ans: wantsDanish(mode) ? o.da : o.en, picked: true, kind: right ? 'part' : 'bad', note: right ? 'It comes back tomorrow because you used a hint.' : '', mode, hinted: true };
  q.done[id] = q.fb.kind; paintQuiz();
}

async function submitAns(giveUp) {
  const q = vq, id = q.active, c = byId(id); if (!c || q.fb || q.loading) return;
  const inp = $('#ans'), ans = giveUp ? '' : inp.value.trim();
  if (!giveUp && !ans) { inp.focus(); return; }
  const mode = modeOf(q, id), t = q.p && q.p.targets.find(x => x.id === id);
  let kind = 'bad', note = '';
  if (wantsDanish(mode)) { const r = daMatch(ans, c, mode === 'cloze' && t ? t.form : ''); kind = r.kind; note = r.note || ''; }
  else if (ans && enMatch(ans, c.en)) kind = 'ok';
  else if (ans && hasAI()) {
    q.fb = { id, ans, checking: true }; paintQuiz();
    try { const r = await aiGrade(c, t ? t.form : '', q.p ? q.p.text : '', ans); if (r) { kind = r.verdict === 'correct' ? 'ok' : r.verdict === 'partial' ? 'part' : 'bad'; note = r.note || ''; } } catch (e) { aiFail(e); }
    if (vq !== q || q.active !== id) return;
  }
  const hinted = !!(q.hint && q.hint.id === id);
  if (hinted && kind === 'ok') { kind = 'part'; note = 'It comes back tomorrow because you used a hint.'; }
  q.fb = { id, ans, kind, note, mode, hinted }; q.done[id] = kind; paintQuiz();
}

// Writes the answer on screen into the learning history. Runs when moving on, so that
// "My answer was right" can still correct a wrong automatic verdict first.
function commitFb() {
  const q = vq, fb = q && q.fb; if (!fb || fb.checking) return;
  const c = byId(fb.id), secondTry = fb.id in q.first;
  if (c) record(c, fb.kind, fb.ans + (fb.hinted && fb.ans ? ' (with a hint)' : ''), q.p ? q.p.src + (q.p.url ? ': ' + q.p.title : '') : '', fb.mode, secondTry);
  if (!secondTry) q.first[fb.id] = fb.kind;
  q.pending = q.pending.filter(x => x !== fb.id); q.quick = q.quick.filter(x => x !== fb.id);
  if (fb.kind !== 'ok' && !q.retried.has(fb.id) && c) { q.retried.add(fb.id); q.retry.push(fb.id); }
  q.fb = null; save();
}

function qNext() {
  const q = vq; commitFb();
  const nxt = q.p && q.p.targets.find(x => !q.done[x.id]);
  q.hint = null;
  if (nxt) { q.active = nxt.id; paintQuiz(); } else advance();
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
  vq = null;
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
    : p.src === 'none' ? `<div class="stage"><h2>No text found</h2><p class="muted">Nothing turned up for “${esc(c.da)}” right now. Check the connection or the spelling.</p></div>`
    : `<div class="stage top read"><p class="source">${srcLine(p)}</p><div class="reading" lang="da">${markup(p, () => 'm-active')}</div>
      ${r.shown ? `<div class="ans"><p><b>${esc(c.da)}</b> — ${esc(c.en)}</p></div>` : `<button class="btn ghost block" data-a="rShow">Show meaning</button>`}</div>`;
  overlay.innerHTML = ohead(null, 'Reading') + body + `<div class="foot">${r.loading ? '' : `<div class="two"><button class="btn tint" data-a="say" data-t="${esc(p.src === 'none' ? c.da : p.text)}">Listen</button><button class="btn primary" data-a="rAgain">Another text</button></div>`}</div>`;
  overlay.hidden = false;
}

function closeOverlay() {
  // Leaving a session early still shows what was answered.
  if (vq && !vq.finished && (Object.keys(vq.first).length || (vq.fb && !vq.fb.checking))) return finishVocab();
  vq = null; reader = null;
  if (canSpeak) speechSynthesis.cancel();
  overlay.hidden = true; overlay.innerHTML = ''; render();
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
  const ok = await shareFile(`dansk-backup-${today()}.json`, JSON.stringify({ app: 'dansk', v: 3, exported: new Date().toISOString(), state: S }), 'application/json');
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
      if (!b || b.app !== 'dansk' || !st || typeof st !== 'object') throw 0;
      pendingImport = st;
      confirmSheet('Restore this backup?', `Backup from <b>${esc((b.exported || '').slice(0, 10) || 'unknown date')}</b> with <b>${(st.custom || []).length}</b> words.<br>This phone currently has <b>${S.custom.length}</b>. Restoring replaces what is on this phone.`, 'Replace and restore', 'doImport', true);
    } catch (e) { toast('That file is not a Dansk backup'); }
  };
  r.readAsText(file);
}

// ═════════ Events ═════════
const A = {
  tab: el => { tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  say: el => speak(el.dataset.t),
  closeSheet, closeOverlay,
  obDone: () => { S.onboarded = true; save(); render(); },
  hintOff: () => { S.hintOff = true; save(); render(); },
  vStart: () => startVocab(false),
  vAhead: () => startVocab(true),
  vBegin: () => advance(),
  qPick: el => {
    const q = vq; if (!q || !q.p) { if (reader && !reader.shown) { reader.shown = true; paintReader(); } return; }
    const id = el.dataset.id; if (q.done[id] || (q.fb && q.fb.checking)) return;
    if (q.fb) commitFb();
    q.active = id; q.hint = null; paintQuiz();
  },
  qSubmit: () => submitAns(false),
  qSkip: () => submitAns(true),
  qHint: () => showHint(),
  qOpt: el => pickHint(el.dataset.id),
  qOver: () => { const q = vq; if (!q.fb) return; q.fb.kind = 'ok'; q.fb.note = ''; q.done[q.fb.id] = 'ok'; paintQuiz(); },
  qNext,
  addWord,
  word: el => wordSheet(el.dataset.id),
  saveWord: el => saveWord(el.dataset.id),
  bulk: () => bulkSheet(''),
  bulkReview,
  bulkBack: () => bulkSheet(bulkText),
  bulkSave: () => { const add = bulkParsed.filter(p => !p.dup); add.forEach(p => S.custom.push({ id: newId(), da: p.da, en: p.en, notes: '', added: today() })); bulkParsed = []; save(); closeSheet(); render(); toast(`${add.length} ${add.length === 1 ? 'word' : 'words'} added`); },
  read: el => startReader(el.dataset.id),
  rShow: () => { if (reader && !reader.shown) { reader.shown = true; paintReader(); } },
  rAgain: () => loadReader(),
  askDelWord: el => { pendingId = el.dataset.id; confirmSheet('Delete this word?', 'The word and its learning history are removed from this phone.', 'Delete word', 'doDelWord', true); },
  doDelWord: () => { S.custom = S.custom.filter(c => c.id !== pendingId); delete S.vs[pendingId]; save(); closeSheet(); render(); },
  mode: el => { const m = el.dataset.m, on = Object.keys(MODES).filter(k => S.cfg.modes[k]); if (S.cfg.modes[m] && on.length === 1) { toast('Keep at least one exercise on'); return; } S.cfg.modes[m] = !S.cfg.modes[m]; save(); render(); },
  mins: el => { S.cfg.minutes = Math.min(45, Math.max(5, S.cfg.minutes + Number(el.dataset.d))); save(); render(); },
  slow: () => { S.slow = !S.slow; save(); render(); speak('Hej, hvordan går det?'); },
  aiSave: () => { const k = $('#aiKey').value.trim(); if (!k) { $('#aiKey').focus(); return; } try { localStorage.setItem(AI_KEY, k); } catch (e) { toast('Could not save the key'); return; } aiClient = null; aiWarned = false; render(); toast('Key saved on this phone'); },
  aiRemove: () => { localStorage.removeItem(AI_KEY); aiClient = null; render(); toast('Key removed'); },
  aiTest: async () => { toast('Testing'); try { const r = await aiJSON('Reply with ok set to true.', 'Connection test.', obj({ ok: { type: 'boolean' } }, ['ok'])); toast(r ? 'AI assistance is working' : 'No usable reply came back'); } catch (e) { toast('Test failed' + (e && e.status ? ` (${e.status})` : '') + ': ' + String((e && e.message) || e).slice(0, 80)); } },
  export: () => exportBackup(),
  csv: () => exportCSV(),
  import: () => { const f = $('#file'); f.value = ''; f.click(); },
  doImport: () => { if (!pendingImport) return; S = migrate(Object.assign(fresh(), pendingImport, { onboarded: true })); pendingImport = null; save(); closeSheet(); render(); toast('Backup restored'); },
  askReset: () => confirmSheet('Erase everything?', 'Your vocabulary, all learning history and your settings will be removed from this phone. This cannot be undone unless you have a backup file.', 'Erase everything', 'doReset', true),
  doReset: () => { S = fresh(); save(); tab = 'today'; closeSheet(); render(); }
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
