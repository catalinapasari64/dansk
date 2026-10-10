(() => {
'use strict';

const KEY = 'dansk.state.v1', SNIP_KEY = 'dansk.snips.v1';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), overlay = $('#overlay'), sheet = $('#sheet'), tabbar = $('#tabbar'), toastEl = $('#toast');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = a => a[rnd(0, a.length - 1)];

// ───────── Dates (local calendar days as YYYY-MM-DD, which sort correctly as strings) ─────────
const dstr = (d = new Date()) => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dstr(new Date(y, m - 1, d + n)); };
const today = () => dstr();

// ───────── Content index ─────────
const ITEM = {}, UNIT = {};
UNITS.forEach(u => {
  UNIT[u.id] = u;
  u.items = u.items.map((r, i) => (ITEM[u.id + ':' + i] = { id: u.id + ':' + i, unit: u.id, m: u.m, da: r[0], en: r[1], ex: r[2] || '', exEn: r[3] || '' }));
});
const MOD = id => MODULES.find(m => m.id === id);
const modItems = m => UNITS.filter(u => u.m === m).flatMap(u => u.items);

// ───────── State ─────────
const fresh = () => ({ app: 'dansk', v: 1, created: today(), onboarded: false, module: 1, newPerDay: 8, slow: false, voice: '', hintOff: false, items: {}, days: {}, drills: {}, custom: [], lastBackup: '' });
function load() {
  try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.items) return Object.assign(fresh(), r); } catch (e) { /* fall through to a fresh state */ }
  return fresh();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save progress on this device'); } }
const day = () => (S.days[today()] = S.days[today()] || { rev: 0, ok: 0, new: 0, drill: 0, dok: 0, sec: 0, read: 0 });

// The user's own words live in the same item table as course words, under ids "c:<id>".
const cid = c => 'c:' + c.id;
function syncCustom() {
  Object.keys(ITEM).forEach(k => { if (k.startsWith('c:')) delete ITEM[k]; });
  S.custom.forEach(c => { ITEM[cid(c)] = { id: cid(c), unit: 'custom', m: 0, da: c.da, en: c.en, ex: '', exEn: '' }; });
}
syncCustom();
const customItems = () => S.custom.map(c => ITEM[cid(c)]);

const learned = m => modItems(m).filter(it => S.items[it.id]).length;
const totalLearned = () => Object.keys(S.items).filter(id => ITEM[id]).length;
const mature = () => Object.keys(S.items).filter(id => ITEM[id] && S.items[id].iv >= 21).length;
const dueIds = () => { const t = today(); return Object.keys(S.items).filter(id => ITEM[id] && S.items[id].due <= t); };
const freshPool = () => [...customItems(), ...modItems(S.module)].filter(it => !S.items[it.id]);
const newLeft = () => Math.min(Math.max(0, S.newPerDay - day().new), freshPool().length);
const active = d => { const y = S.days[d]; return !!y && (y.rev + y.new + y.drill + (y.read || 0)) > 0; };
function streak() { let n = 0, d = today(); if (!active(d)) d = addDays(d, -1); while (active(d)) { n++; d = addDays(d, -1); } return n; }
function level() { let l = ''; MODULES.forEach(m => { if (learned(m.id) / modItems(m.id).length >= 0.8) l = m.level; }); return l; }
// Marks a whole module as already known; reviews are spread out so they trickle back a few per day.
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
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { loadVoices(); if (tab === 'progress' && overlay.hidden) render(); });
}

// ───────── Small UI pieces ─────────
const SPK = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const CHECK = '<svg class="bigcheck" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg>';
const spk = (t, cls = '') => `<button class="spk ${cls}" data-a="say" data-t="${esc(t)}" aria-label="Play">${SPK}</button>`;
const slowBtn = t => `<button class="slowbtn" data-a="say" data-slow="1" data-t="${esc(t)}">Slow</button>`;
const bar = (n, d) => `<div class="prog"><i style="width:${d ? Math.round(n / d * 100) : 0}%"></i></div>`;
const fmtIv = d => d < 30 ? d + 'd' : d < 365 ? Math.round(d / 30) + 'mo' : (d / 365).toFixed(1) + 'y';
const stDot = id => { const st = S.items[id]; return `<span class="st ${st ? (st.iv >= 21 ? 'known' : 'learning') : ''}"></span>`; };

let toastT;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2600); }

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
  view.innerHTML = ({ today: vToday, learn: vLearn, words: vWords, practice: vPractice, progress: vProgress })[tab]();
}

function onboarding() {
  if (obStep === 0) return `<div class="ob">
    <h1>Dansk</h1>
    <p class="lead">A few minutes of Danish a day. You hear every word before you see it, because in Danish the sound is the hard part.</p>
    <div class="list">
      <div class="li static"><span class="grow"><b>Daily session</b><small>New words plus reviews timed so you remember them</small></span></div>
      <div class="li static"><span class="grow"><b>Your own words</b><small>Add words you meet and read them in real Danish texts</small></span></div>
      <div class="li static"><span class="grow"><b>Yours to keep</b><small>Progress stays on this phone, with a backup file you control</small></span></div>
    </div>
    <button class="btn primary block" data-a="obNext">Get started</button>
  </div>`;
  return `<div class="ob">
    <h1>Where are you now?</h1>
    <p class="lead">Modules follow Danskuddannelse 3. Pick the one you are studying. Earlier modules are marked as known, and you can switch at any time.</p>
    <div class="list">${MODULES.map(m => `
      <button class="li" data-a="obPick" data-m="${m.id}"><span class="dot">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b><small>${m.desc}</small></span><span class="chev">›</span></button>`).join('')}</div>
  </div>`;
}

function vToday() {
  const d = day(), due = dueIds().length, nl = newLeft(), done = d.rev + d.new, left = due + nl;
  const m = MOD(S.module), h = new Date().getHours(), sk = streak();
  const greet = h < 10 ? 'Godmorgen' : h < 18 ? 'Goddag' : 'Godaften';
  const date = new Date().toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
  const pct = done + left ? done / (done + left) : 0, R = 46, C = 2 * Math.PI * R;
  const stale = totalLearned() >= 10 && (!S.lastBackup || S.lastBackup < addDays(today(), -14));
  const sugg = ['pairs', 'numbers', 'gender', 'build'][new Date().getDate() % 4], dr = DRILLS[sugg];
  return `
  <header class="top"><div><p class="eyebrow">${esc(date)}</p><h1>${greet}</h1></div>${sk ? `<span class="chip">${sk}-day streak</span>` : ''}</header>
  <section class="card">
    <div class="hero-row">
      <svg class="ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R}" class="track"/><circle cx="55" cy="55" r="${R}" class="fill" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/><text x="55" y="52" class="ring-n">${left ? left : '✓'}</text><text x="55" y="70" class="ring-l">${left ? 'to go' : 'done'}</text></svg>
      <div>${left
        ? `<h2>${done ? 'Keep going' : "Today's session"}</h2><p class="muted">${due} to review · ${nl} new</p>`
        : `<h2>Færdig for i dag</h2><p class="muted">All done. Come back tomorrow for your reviews.</p>`}</div>
    </div>
    ${left ? `<button class="btn primary block" data-a="start">${done ? 'Continue' : 'Start session'}</button>`
      : freshPool().length ? `<button class="btn tint block" data-a="more">Learn 5 more words</button>` : ''}
  </section>
  ${!standalone() && !S.hintOff ? `<section class="note"><b>Add to Home Screen first</b><p>In Safari tap Share, then “Add to Home Screen”, and always open Dansk from that icon. Progress made in a browser tab is stored separately.</p><button class="link" data-a="hintOff">Got it</button></section>` : ''}
  ${stale ? `<section class="note"><b>Time for a backup</b><p>${S.lastBackup ? 'Your last backup is more than two weeks old.' : 'You have not saved a backup yet.'}</p><button class="link" data-a="export">Save backup file</button></section>` : ''}
  <div class="list">
    <button class="li" data-a="tab" data-tab="learn"><span class="dot">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b><small>${learned(m.id)} of ${modItems(m.id).length} words learned</small></span><span class="chev">›</span></button>
    <button class="li" data-a="tab" data-tab="words"><span class="grow"><b>My words</b><small>${S.custom.length ? S.custom.length + ' saved' : 'Add words you want to remember'}</small></span><span class="chev">›</span></button>
    ${S.custom.length ? `<button class="li" data-a="read"><span class="grow"><b>Read in context</b><small>See your words in real Danish texts</small></span><span class="chev">›</span></button>` : ''}
    <button class="li" data-a="drill" data-k="${sugg}"><span class="grow"><b>${dr.name}</b><small>${dr.desc}</small></span><span class="chev">›</span></button>
  </div>`;
}

function vLearn() {
  const m = MOD(viewMod), units = UNITS.filter(u => u.m === viewMod), tot = modItems(viewMod).length, l = learned(viewMod);
  return `
  <header class="top"><div><h1>Learn</h1></div></header>
  <div class="seg">${MODULES.map(x => `<button class="${x.id === viewMod ? 'on' : ''}" data-a="viewMod" data-m="${x.id}">${x.id}</button>`).join('')}</div>
  <section class="card">
    <p class="eyebrow">${m.tag} · about ${m.level}${viewMod === S.module ? ' · current' : ''}</p><h2>${m.name}</h2><p class="muted">${m.desc}</p>
    ${bar(l, tot)}<small class="under">${l} of ${tot} words learned</small>
    ${viewMod === S.module ? '' : `<button class="btn primary block" data-a="setMod">Study this module</button>`}
    ${l < tot ? `<button class="btn ghost block" data-a="askKnown">I already know this module</button>` : ''}
  </section>
  <div class="list">${units.map((u, i) => { const n = u.items.filter(x => S.items[x.id]).length; return `
    <button class="li" data-a="unit" data-u="${u.id}"><span class="idx">${i + 1}</span><span class="grow"><b>${u.title}</b><small>${n} of ${u.items.length}</small></span>${n === u.items.length ? '<span class="tick">✓</span>' : ''}<span class="chev">›</span></button>`; }).join('')}</div>`;
}

function vWords() {
  const ws = S.custom.slice().reverse();
  return `
  <header class="top"><div><h1>My words</h1><p class="sub">Add words you meet. They join your daily session, and you can read them in real Danish texts.</p></div></header>
  <section class="card form">
    <input id="wDa" type="text" placeholder="Danish word or phrase" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" lang="da" enterkeyhint="next">
    <input id="wEn" type="text" placeholder="Your translation" autocapitalize="none" autocomplete="off" enterkeyhint="done">
    <button class="btn primary block" data-a="addWord">Add word</button>
  </section>
  ${ws.length ? `<button class="btn tint block gap" data-a="read">Read in context</button>
  <div class="list">${ws.map(c => `
    <button class="li" data-a="word" data-id="${c.id}"><span class="grow"><b>${esc(c.da)}</b><small>${esc(c.en)}</small></span>${stDot(cid(c))}<span class="chev">›</span></button>`).join('')}</div>`
    : `<p class="empty">No words yet. Add one above, with the translation in your own words.</p>`}`;
}

function wordSheet(id) {
  const c = S.custom.find(x => x.id === id); if (!c) return;
  const st = S.items[cid(c)];
  openSheet(`<div class="row">${spk(c.da)}<div class="grow"><h2>${esc(c.da)}</h2><p class="muted tight">${esc(c.en)}</p></div></div>
    <p class="muted">${st ? (st.due <= today() ? 'Due for review now.' : 'Next review ' + st.due + '.') : 'Not studied yet. It will come up in your next session.'}</p>
    <button class="btn primary block" data-a="read" data-id="${c.id}">Read this word in context</button>
    <button class="btn ghost block red" data-a="askDelWord" data-id="${c.id}">Delete word</button>`);
}

const DRILLS = {
  pairs: { name: 'Sound pairs', desc: 'Hear a word and pick which one it was' },
  numbers: { name: 'Numbers', desc: 'Hear a number and type the digits' },
  gender: { name: 'En or et?', desc: 'Pick the right article for each noun' },
  build: { name: 'Word order', desc: 'Put the sentence together' }
};

function vPractice() {
  return `
  <header class="top"><div><h1>Practice</h1><p class="sub">Short drills for the things Danish makes hard.</p></div></header>
  ${!hasVoice() ? `<section class="note"><b>No Danish voice found</b><p>Listening drills need one. On iPhone: Settings → Accessibility → Read &amp; Speak → Voices → Danish.</p></section>` : ''}
  <div class="list">${Object.keys(DRILLS).map(k => { const d = DRILLS[k], s = S.drills[k]; return `
    <button class="li" data-a="drill" data-k="${k}"><span class="grow"><b>${d.name}</b><small>${d.desc}</small></span><small>${s && s.n ? Math.round(s.ok / s.n * 100) + '%' : ''}</small><span class="chev">›</span></button>`; }).join('')}
    ${S.custom.length ? `<button class="li" data-a="read"><span class="grow"><b>Read in context</b><small>Your own words in real Danish texts</small></span><span class="chev">›</span></button>` : ''}
  </div>`;
}

let persisted = null;
function vProgress() {
  const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const vals = days.map(d => { const y = S.days[d]; return y ? y.rev + y.new + y.drill + (y.read || 0) : 0; }), max = Math.max(1, ...vals);
  let rev = 0, ok = 0; for (let i = 0; i < 30; i++) { const y = S.days[addDays(today(), -i)]; if (y) { rev += y.rev; ok += y.ok; } }
  const lv = level();
  return `
  <header class="top"><div><h1>Progress</h1></div></header>
  <section class="card"><p class="eyebrow">Estimated level</p><div class="row"><span class="biglvl">${lv || 'Starter'}</span><p class="grow muted small">${lv ? 'You know most of the words up to this level.' : 'Finish most of Modul 1 to reach A1.'} A rough guide, not an exam result.</p></div></section>
  <div class="stats">
    <div class="stat"><b>${streak()}</b><small>day streak</small></div>
    <div class="stat"><b>${totalLearned()}</b><small>words learned</small></div>
    <div class="stat"><b>${mature()}</b><small>known well</small></div>
    <div class="stat"><b>${rev ? Math.round(ok / rev * 100) + '%' : '–'}</b><small>recall, 30 days</small></div>
  </div>
  <section class="card"><p class="eyebrow">Last 14 days</p>
    <div class="chart">${vals.map((v, i) => `<div class="col"><i style="height:${Math.round(v / max * 100)}%" class="${v ? '' : 'zero'}"></i><span>${Number(days[i].slice(8))}</span></div>`).join('')}</div>
  </section>
  <h3>Modules</h3>
  <div class="list">${MODULES.map(m => { const t = modItems(m.id).length, l = learned(m.id); return `
    <div class="li static"><span class="dot">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b>${bar(l, t)}</span><small>${l}/${t}</small></div>`; }).join('')}</div>
  <h3>Settings</h3>
  <div class="list">
    <div class="li static"><span class="grow"><b>New words per day</b></span><div class="stepper"><button data-a="npd" data-d="-2">−</button><span>${S.newPerDay}</span><button data-a="npd" data-d="2">+</button></div></div>
    <div class="li static"><span class="grow"><b>Slower speech</b></span><button class="switch ${S.slow ? 'on' : ''}" data-a="slow" aria-label="Slower speech"><i></i></button></div>
    <div class="li static"><span class="grow"><b>Voice</b></span>${voices.length ? `<select data-c="voice">${voices.map(v => `<option ${v.name === (pickVoice() || {}).name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<small>No Danish voice</small>'}</div>
  </div>
  <h3>Backup</h3>
  <div class="list">
    <button class="li" data-a="export"><span class="grow"><b>Save backup file</b><small>${S.lastBackup ? 'Last saved ' + S.lastBackup : 'Never saved'}</small></span><span class="chev">›</span></button>
    <button class="li" data-a="import"><span class="grow"><b>Restore from backup file</b><small>Replaces the progress on this phone</small></span><span class="chev">›</span></button>
  </div>
  <p class="foot-note">Progress and your own words are stored on this phone only${persisted === true ? ', in protected storage' : ''}. Deleting the Home Screen icon deletes them, so keep a backup file in Files or iCloud Drive.</p>
  <div class="list"><button class="li" data-a="askReset"><span class="grow"><b class="red">Erase all progress</b></span></button></div>`;
}

function unitSheet(id) {
  const u = UNIT[id], n = u.items.filter(i => S.items[i.id]).length;
  openSheet(`<h2>${esc(u.title)}</h2>
    <div class="tip"><b>Tip</b>${esc(u.tip)}</div>
    <div class="list">${u.items.map(it => `
      <div class="li static slim">${spk(it.da, 'sm')}<span class="grow"><b>${esc(it.da)}</b><small>${esc(it.en)}</small></span>${stDot(it.id)}</div>`).join('')}</div>
    <button class="btn primary block" data-a="studyUnit" data-u="${id}">${n < u.items.length ? 'Study this unit' : 'Review this unit'}</button>`);
}

// ───────── Daily session (spaced repetition) ─────────
let sess = null;

function nextIv(st, g, relearn) {
  if (!st || relearn) return g === 'easy' && !relearn ? 3 : 1;
  if (g === 'easy') return Math.max(4, Math.round(Math.max(st.iv, 1) * st.ef * 1.3));
  return st.iv < 1 ? 1 : st.iv < 3 ? 3 : Math.round(st.iv * st.ef);
}

function startSession(o = {}) {
  let due = dueIds(), pool, nNew, practice = false;
  if (o.unit) { pool = UNIT[o.unit].items; due = due.filter(id => ITEM[id].unit === o.unit); nNew = 6; }
  else { pool = [...customItems(), ...modItems(S.module)]; nNew = o.extra || Math.max(0, S.newPerDay - day().new); }
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
  reader = null; drill = null;
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
    body = `<span class="badge">${it.m ? 'New word' : 'Your word'}</span><div class="word">${esc(it.da)}</div>${play(it.da)}<div class="gloss">${esc(it.en)}</div>${exBlock(it)}`;
    foot = `<button class="btn primary block" data-a="next">Continue</button><button class="btn ghost block" data-a="knowIt">I already know this</button>`;
    say = it.da;
  } else if (c.t === 'mcq') {
    if (!c.opts) {
      const others = (it.m ? modItems(it.m) : [...customItems(), ...modItems(S.module)]).filter(x => x.en !== it.en);
      c.opts = shuffle([it, ...shuffle(others).slice(0, 3)]).map(x => x.id);
    }
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
  overlay.innerHTML = `<div class="stage done">${CHECK}<h1>Godt klaret</h1><p class="muted">Well done. That session is complete.</p>
    <div class="stats three"><div class="stat"><b>${s.new}</b><small>new words</small></div><div class="stat"><b>${s.rev}</b><small>reviewed</small></div><div class="stat"><b>${mins}</b><small>min</small></div></div>
    <p class="muted">${streak()}-day streak</p></div>
    <div class="foot">${S.custom.length ? `<button class="btn tint block" data-a="read">Read in context</button>` : ''}<button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
}

function closeOverlay() {
  if (sess) { logTime(sess.start); sess = null; }
  if (drill) { logTime(drill.start); drill = null; }
  reader = null;
  if (canSpeak) speechSynthesis.cancel();
  overlay.hidden = true; overlay.innerHTML = ''; render();
}

// ───────── Drills ─────────
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
  sess = null; reader = null;
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

// ───────── My words: reading in context ─────────
// Texts come live from Danish Wikipedia and Tatoeba. The last few per word are kept on the
// phone (outside the backup file) so reading still works offline.
let snips = {};
try { snips = JSON.parse(localStorage.getItem(SNIP_KEY)) || {}; } catch (e) { snips = {}; }
const saveSnips = () => { try { localStorage.setItem(SNIP_KEY, JSON.stringify(snips)); } catch (e) { /* cache only */ } };
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Search term plus a pattern that also catches common inflections (huset, huse, spiser, spiste …).
function wordMatch(da) {
  const term = da.trim().toLowerCase().replace(/^(en|et|at)\s+/, '');
  let core;
  if (/\s/.test(term)) core = term.split(/\s+/).map(reEsc).join('\\s+');
  else {
    const stem = term.length > 3 && term.endsWith('e') ? term.slice(0, -1) : term, last = stem.slice(-1);
    core = reEsc(stem) + (/[bdfgklmnprst]/.test(last) ? last + '?' : '') + '(?:e|en|et|er|ene|erne|ne|r|te|t|ede|de|ende|ere|est|este)?s?';
  }
  return { term, re: () => new RegExp('(^|[^\\p{L}])(' + core + ')(?=$|[^\\p{L}])', 'giu') };
}

async function getJSON(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 9000);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}

// Long paragraphs are cut down to the few sentences around the word.
function trimAround(text, re) {
  if (text.length <= 480) return text;
  const ss = text.match(/[^.!?]+[.!?]+["”»)]*\s*|[^.!?]+$/g) || [text];
  let a = ss.findIndex(s => re().test(s)); if (a < 0) a = 0;
  let b = a, len = ss[a].length;
  while (len < 380 && (a > 0 || b < ss.length - 1)) {
    if (b < ss.length - 1) { b++; len += ss[b].length; }
    if (len < 380 && a > 0) { a--; len += ss[a].length; }
  }
  return ss.slice(a, b + 1).join('').trim();
}

async function fetchWiki(w) {
  const { term, re } = wordMatch(w.da), api = 'https://da.wikipedia.org/w/api.php?format=json&origin=*&action=query';
  const j = await getJSON(`${api}&list=search&srnamespace=0&srlimit=8&srsort=random&srprop=&srsearch=${encodeURIComponent('"' + term + '"')}`);
  const titles = shuffle(((j.query && j.query.search) || []).map(s => s.title)).slice(0, 4);
  for (const title of titles) {
    const p = Object.values((await getJSON(`${api}&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(title)}`)).query.pages)[0];
    const paras = ((p && p.extract) || '').split(/\n+/).map(s => s.trim()).filter(s => s.length >= 90 && re().test(s));
    if (paras.length) return { src: 'Wikipedia', title, url: 'https://da.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), text: trimAround(pick(paras), re) };
  }
  return null;
}

async function fetchTatoeba(w) {
  const { term, re } = wordMatch(w.da);
  const j = await getJSON(`https://api.tatoeba.org/unstable/sentences?lang=dan&sort=random&limit=12&q=${encodeURIComponent(term)}`);
  const ss = [...new Set((j.data || []).map(s => s.text).filter(s => s && s.length >= 20 && re().test(s)))].slice(0, 3);
  return ss.length ? { src: 'Tatoeba', title: 'Example sentences', url: 'https://tatoeba.org/da/sentences/search?from=dan&query=' + encodeURIComponent(term), text: ss.join('\n') } : null;
}

async function fetchSnippet(w) {
  for (const f of Math.random() < 0.65 ? [fetchWiki, fetchTatoeba] : [fetchTatoeba, fetchWiki]) {
    try { const s = await f(w); if (s) return s; } catch (e) { /* try the other source */ }
  }
  return null;
}

let reader = null;
function startReader(firstId) {
  if (!S.custom.length) { toast('Add a word first'); return; }
  let ids = shuffle(S.custom.map(c => c.id));
  if (firstId) ids = [firstId, ...ids.filter(x => x !== firstId)];
  if (sess) logTime(sess.start);
  sess = null; drill = null;
  reader = { ids, i: 0, snip: null, loading: true, shown: false, cached: false, tick: 0 };
  closeSheet(); loadSnip();
}

async function loadSnip() {
  const r = reader, k = ++r.tick, w = S.custom.find(c => c.id === r.ids[r.i]);
  if (!w) return;
  const prev = r.snip && r.snip.text;
  r.loading = true; r.shown = false; paintReader();
  let s = await fetchSnippet(w), cached = false;
  if (reader !== r || r.tick !== k) return;
  const kept = snips[w.id] || [];
  if (s) { snips[w.id] = [s, ...kept.filter(x => x.text !== s.text)].slice(0, 8); saveSnips(); }
  else if (kept.length) { const other = kept.filter(x => x.text !== prev); s = pick(other.length ? other : kept); cached = true; }
  r.snip = s; r.cached = cached; r.loading = false;
  if (s) { day().read = (day().read || 0) + 1; save(); }
  paintReader();
}

function paintReader() {
  const r = reader, w = S.custom.find(c => c.id === r.ids[r.i]), s = r.snip;
  let body, foot = '';
  if (r.loading) body = `<div class="spinner"></div><p class="muted">Finding a text with “${esc(w.da)}”</p>`;
  else if (!s) {
    body = `<h2>No text found</h2><p class="muted">Nothing came back for “${esc(w.da)}”. Check the connection, or the spelling of the word.</p>`;
    foot = `<div class="two"><button class="btn tint" data-a="rAgain">Try again</button><button class="btn primary" data-a="rNext">Next word</button></div>`;
  } else {
    const html = esc(s.text.replace(wordMatch(w.da).re(), (m, pre, hit) => `${pre}\u0001${hit}\u0002`))
      .replace(/\u0001/g, '<mark data-a="rShow">').replace(/\u0002/g, '</mark>').replace(/\n/g, '<br><br>');
    body = `<p class="source">${esc(s.src)} · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${r.cached ? ' · saved copy' : ''}</p>
      <div class="reading" lang="da">${html}</div>
      ${r.shown ? `<div class="meaning"><b>${esc(w.da)}</b><span>${esc(w.en)}</span></div>` : `<button class="btn ghost block" data-a="rShow">Show meaning</button>`}`;
    foot = `<div class="three"><button class="btn tint" data-a="say" data-t="${esc(s.text)}">Listen</button><button class="btn tint" data-a="rAgain">New text</button><button class="btn primary" data-a="rNext">Next word</button></div>`;
  }
  overlay.innerHTML = ohead(null, `${r.i + 1} of ${r.ids.length}`) + `<div class="stage ${s && !r.loading ? 'read' : ''}">${body}</div><div class="foot">${foot}</div>`;
  overlay.hidden = false;
}

function addWord() {
  const a = $('#wDa'), b = $('#wEn'), da = a.value.trim(), en = b.value.trim();
  if (!da) { a.focus(); return; }
  if (!en) { b.focus(); return; }
  if (S.custom.some(c => c.da.toLowerCase() === da.toLowerCase())) { toast('That word is already in your list'); return; }
  S.custom.push({ id: Date.now().toString(36) + rnd(10, 99), da, en, added: today() });
  syncCustom(); save(); render(); $('#wDa').focus();
}

// ───────── Backup ─────────
async function exportBackup() {
  const name = `dansk-backup-${today()}.json`;
  const data = JSON.stringify({ app: 'dansk', v: 1, exported: new Date().toISOString(), state: S });
  const done = () => { S.lastBackup = today(); save(); closeSheet(); if (overlay.hidden) render(); toast('Backup saved'); };
  try {
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Dansk backup' }); return done(); }
  } catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall back to a plain download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  done();
}

let pendingImport = null, pendingId = null;
function readImport(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const b = JSON.parse(r.result), st = b && b.state;
      if (!b || b.app !== 'dansk' || !st || typeof st.items !== 'object' || typeof st.days !== 'object') throw 0;
      pendingImport = st;
      const n = Object.keys(st.items).length, cw = (st.custom || []).length;
      confirmSheet('Restore this backup?', `Backup from <b>${esc((b.exported || '').slice(0, 10) || 'unknown date')}</b> with <b>${n}</b> words learned and <b>${cw}</b> of your own words.<br>This phone currently has <b>${totalLearned()}</b> learned and <b>${S.custom.length}</b> of your own. Restoring replaces what is on this phone.`, 'Replace and restore', 'doImport', true);
    } catch (e) { toast('That file is not a Dansk backup'); }
  };
  r.readAsText(file);
}

// ───────── Events ─────────
const A = {
  tab: el => { tab = el.dataset.tab; if (tab === 'learn') viewMod = S.module; render(); window.scrollTo(0, 0); },
  say: el => speak(el.dataset.t, !!el.dataset.slow),
  closeSheet, closeOverlay,
  obNext: () => { obStep = 1; render(); },
  obPick: el => { const m = Number(el.dataset.m); S.module = viewMod = m; for (let i = 1; i < m; i++) markKnown(i); S.onboarded = true; save(); render(); },
  hintOff: () => { S.hintOff = true; save(); render(); },
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
  addWord,
  word: el => wordSheet(el.dataset.id),
  read: el => startReader(el.dataset.id),
  rShow: () => { if (reader && !reader.shown) { reader.shown = true; paintReader(); } },
  rAgain: () => loadSnip(),
  rNext: () => { reader.i = (reader.i + 1) % reader.ids.length; reader.snip = null; loadSnip(); },
  askDelWord: el => { pendingId = el.dataset.id; confirmSheet('Delete this word?', 'The word and its review history are removed from this phone.', 'Delete word', 'doDelWord', true); },
  doDelWord: () => { S.custom = S.custom.filter(c => c.id !== pendingId); delete S.items['c:' + pendingId]; delete snips[pendingId]; saveSnips(); syncCustom(); save(); closeSheet(); render(); },
  npd: el => { S.newPerDay = Math.min(20, Math.max(2, S.newPerDay + Number(el.dataset.d))); save(); render(); },
  slow: () => { S.slow = !S.slow; save(); render(); speak('Hej, hvordan går det?'); },
  export: () => exportBackup(),
  import: () => { const f = $('#file'); f.value = ''; f.click(); },
  doImport: () => { if (!pendingImport) return; S = Object.assign(fresh(), pendingImport, { onboarded: true }); pendingImport = null; viewMod = S.module; syncCustom(); save(); closeSheet(); render(); toast('Backup restored'); },
  askReset: () => confirmSheet('Erase all progress?', 'Every learned word, your own words, your streak and your settings will be removed from this phone. This cannot be undone unless you have a backup file.', 'Erase everything', 'doReset', true),
  doReset: () => { S = fresh(); snips = {}; saveSnips(); syncCustom(); save(); obStep = 0; tab = 'today'; closeSheet(); render(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled && A[el.dataset.a]) A[el.dataset.a](el);
});
document.addEventListener('change', e => {
  if (e.target.id === 'file' && e.target.files[0]) readImport(e.target.files[0]);
  if (e.target.dataset.c === 'voice') { S.voice = e.target.value; save(); speak('Hej, hvordan går det?'); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'wDa') { e.preventDefault(); $('#wEn').focus(); }
  if (e.target.id === 'wEn') { e.preventDefault(); addWord(); }
});
// A new day may have started while the app sat in the background. Leave the screen alone while typing.
document.addEventListener('visibilitychange', () => {
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (!document.hidden && overlay.hidden && sheet.hidden && !typing) render();
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(p => { persisted = p; }).catch(() => {});
if ('serviceWorker' in navigator && !/^(localhost|127\.)/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
})();
