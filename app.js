(() => {
'use strict';

const KEY = 'dansk.state.v1';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), overlay = $('#overlay'), sheet = $('#sheet'), tabbar = $('#tabbar'), toastEl = $('#toast');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

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
const grad = m => `--c1:${m.c1};--c2:${m.c2}`;

// ───────── State ─────────
const fresh = () => ({ app: 'dansk', v: 1, created: today(), onboarded: false, module: 1, newPerDay: 8, slow: false, voice: '', hintOff: false, items: {}, days: {}, drills: {}, lastBackup: '' });
function load() {
  try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.items) return Object.assign(fresh(), r); } catch (e) { /* fall through to a fresh state */ }
  return fresh();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save progress on this device'); } }
const day = () => (S.days[today()] = S.days[today()] || { rev: 0, ok: 0, new: 0, drill: 0, dok: 0, sec: 0 });

const learned = m => modItems(m).filter(it => S.items[it.id]).length;
const totalLearned = () => Object.keys(S.items).filter(id => ITEM[id]).length;
const mature = () => Object.keys(S.items).filter(id => ITEM[id] && S.items[id].iv >= 21).length;
const dueIds = () => { const t = today(); return Object.keys(S.items).filter(id => ITEM[id] && S.items[id].due <= t); };
const newLeft = () => Math.min(Math.max(0, S.newPerDay - day().new), modItems(S.module).length - learned(S.module));
const active = d => { const y = S.days[d]; return !!y && (y.rev + y.new + y.drill) > 0; };
function streak() { let n = 0, d = today(); if (!active(d)) d = addDays(d, -1); while (active(d)) { n++; d = addDays(d, -1); } return n; }
function level() { let l = ''; MODULES.forEach(m => { if (learned(m.id) / modItems(m.id).length >= 0.8) l = m.level; }); return l; }

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
const spk = (t, cls = '') => `<button class="spk ${cls}" data-a="say" data-t="${esc(t)}" aria-label="Play">${SPK}</button>`;
const slowBtn = t => `<button class="spk slow" data-a="say" data-slow="1" data-t="${esc(t)}" aria-label="Play slowly">🐢</button>`;
const bar = (n, d) => `<div class="prog"><i style="width:${d ? Math.round(n / d * 100) : 0}%"></i></div>`;
const fmtIv = d => d < 30 ? d + 'd' : d < 365 ? Math.round(d / 30) + 'mo' : (d / 365).toFixed(1) + 'y';

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
  view.innerHTML = ({ today: vToday, learn: vLearn, practice: vPractice, progress: vProgress })[tab]();
}

function onboarding() {
  if (obStep === 0) return `<div class="ob">
    <div class="ob-icon">🇩🇰</div>
    <h1>Velkommen</h1>
    <p class="lead">Learn Danish in a few minutes a day. You hear every word before you see it, because in Danish the sound is the hard part.</p>
    <ul class="ob-list">
      <li><b>Daily session</b><span>New words plus reviews timed so you remember them</span></li>
      <li><b>Ear training</b><span>Sound pairs, numbers and word order drills</span></li>
      <li><b>Yours to keep</b><span>Progress stays on this phone, with a backup file you control</span></li>
    </ul>
    <button class="btn primary block" data-a="obNext">Get started</button>
  </div>`;
  return `<div class="ob">
    <h1>Where do you start?</h1>
    <p class="lead">Modules follow Danskuddannelse 3, the course most international adults take in Denmark. You can switch at any time and keep everything you have learned.</p>
    <div class="ob-mods">${MODULES.map(m => `
      <button class="modpick" style="${grad(m)}" data-a="obPick" data-m="${m.id}">
        <span class="lvl">${m.level}</span>
        <span><b>${m.name} · ${m.tag}</b><small>${m.desc}</small></span>
      </button>`).join('')}</div>
  </div>`;
}

function vToday() {
  const d = day(), due = dueIds().length, nl = newLeft(), done = d.rev + d.new, left = due + nl;
  const m = MOD(S.module), h = new Date().getHours();
  const greet = h < 10 ? 'Godmorgen' : h < 18 ? 'Goddag' : 'Godaften';
  const date = new Date().toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
  const pct = done + left ? done / (done + left) : 0, R = 46, C = 2 * Math.PI * R;
  const more = modItems(S.module).length - learned(S.module) > 0;
  const stale = totalLearned() >= 10 && (!S.lastBackup || S.lastBackup < addDays(today(), -14));
  const sugg = ['pairs', 'numbers', 'gender', 'build'][new Date().getDate() % 4], dr = DRILLS[sugg];
  return `
  <header class="top"><div><p class="eyebrow">${esc(date)}</p><h1>${greet}</h1></div><div class="chip">🔥 ${streak()}</div></header>
  <section class="hero" style="${grad(m)}">
    <div class="hero-row">
      <svg class="ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R}" class="track"/><circle cx="55" cy="55" r="${R}" class="fill" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/><text x="55" y="52" class="ring-n">${left ? left : '✓'}</text><text x="55" y="70" class="ring-l">${left ? 'to go' : 'done'}</text></svg>
      <div>${left
        ? `<h2>${done ? 'Keep going' : "Today's session"}</h2><p>${due} to review · ${nl} new</p>`
        : `<h2>Færdig for i dag!</h2><p>All done for today. Come back tomorrow for your reviews.</p>`}</div>
    </div>
    ${left ? `<button class="btn white block" data-a="start">${done ? 'Continue' : 'Start session'}</button>`
      : more ? `<button class="btn white block" data-a="more">Learn 5 more words</button>` : ''}
  </section>
  ${!standalone() && !S.hintOff ? `<section class="note"><b>Add to Home Screen first</b><p>In Safari tap Share, then “Add to Home Screen”, and always open Dansk from that icon. Progress made in a browser tab is stored separately.</p><button class="link" data-a="hintOff">Got it</button></section>` : ''}
  ${stale ? `<section class="note"><b>Time for a backup</b><p>${S.lastBackup ? 'Your last backup is more than two weeks old.' : 'You have not saved a backup yet.'}</p><button class="link" data-a="export">Save backup file</button></section>` : ''}
  <section class="card tap" data-a="tab" data-tab="learn">
    <div class="row"><span class="dot" style="${grad(m)}">${m.level}</span><div class="grow"><b>${m.name} · ${m.tag}</b><small>${learned(m.id)} of ${modItems(m.id).length} words learned</small></div><span class="chev">›</span></div>
    ${bar(learned(m.id), modItems(m.id).length)}
  </section>
  <h3>Quick practice</h3>
  <section class="card tap" data-a="drill" data-k="${sugg}"><div class="row"><span class="emoji">${dr.icon}</span><div class="grow"><b>${dr.name}</b><small>${dr.desc}</small></div><span class="chev">›</span></div></section>`;
}

function vLearn() {
  const m = MOD(viewMod), units = UNITS.filter(u => u.m === viewMod), tot = modItems(viewMod).length, l = learned(viewMod);
  return `
  <header class="top"><div><h1>Learn</h1></div></header>
  <div class="mods">${MODULES.map(x => `<button class="modchip ${x.id === viewMod ? 'on' : ''}" style="${grad(x)}" data-a="viewMod" data-m="${x.id}">${x.name}${x.id === S.module ? ' •' : ''}</button>`).join('')}</div>
  <section class="hero slim" style="${grad(m)}">
    <div class="row"><div class="grow"><p class="eyebrow light">${m.tag} · about ${m.level}</p><h2>${m.name}</h2><p>${m.desc}</p></div></div>
    ${bar(l, tot)}<p class="small">${l} of ${tot} words learned</p>
    ${viewMod === S.module ? `<span class="pill">Your current module</span>` : `<button class="btn white block" data-a="setMod">Study this module</button>`}
  </section>
  <div class="list">${units.map(u => { const n = u.items.filter(i => S.items[i.id]).length; return `
    <button class="li" data-a="unit" data-u="${u.id}"><span class="emoji">${u.icon}</span><span class="grow"><b>${u.title}</b><small>${n} / ${u.items.length}</small></span>${n === u.items.length ? '<span class="tick">✓</span>' : ''}<span class="chev">›</span></button>`; }).join('')}</div>`;
}

const DRILLS = {
  pairs: { name: 'Sound pairs', icon: '👂', desc: 'Hear a word and pick which one it was', c1: '#FF8A5B', c2: '#FF2D55' },
  numbers: { name: 'Numbers', icon: '🔢', desc: 'Hear a number and type the digits', c1: '#FFC044', c2: '#FF7A00' },
  gender: { name: 'En or et?', icon: '🏷️', desc: 'Pick the right article for each noun', c1: '#4CD964', c2: '#00A88F' },
  build: { name: 'Word order', icon: '🧱', desc: 'Put the sentence together', c1: '#40C8F4', c2: '#3A5BFF' }
};

function vPractice() {
  return `
  <header class="top"><div><h1>Practice</h1><p class="sub">Short drills for the things Danish makes hard.</p></div></header>
  ${!hasVoice() ? `<section class="note"><b>No Danish voice found</b><p>Listening drills need one. On iPhone: Settings → Accessibility → Read &amp; Speak → Voices → Danish.</p></section>` : ''}
  <div class="tiles">${Object.keys(DRILLS).map(k => { const d = DRILLS[k], s = S.drills[k]; return `
    <button class="tile" style="${grad(d)}" data-a="drill" data-k="${k}"><span class="emoji">${d.icon}</span><b>${d.name}</b><small>${d.desc}</small><i>${s && s.n ? Math.round(s.ok / s.n * 100) + '% correct' : 'Not tried yet'}</i></button>`; }).join('')}</div>`;
}

let persisted = null;
function vProgress() {
  const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const vals = days.map(d => { const y = S.days[d]; return y ? y.rev + y.new + y.drill : 0; }), max = Math.max(1, ...vals);
  let rev = 0, ok = 0; for (let i = 0; i < 30; i++) { const y = S.days[addDays(today(), -i)]; if (y) { rev += y.rev; ok += y.ok; } }
  const lv = level();
  return `
  <header class="top"><div><h1>Progress</h1></div></header>
  <section class="card"><p class="eyebrow">Estimated level</p><div class="row"><span class="biglvl">${lv || 'Starter'}</span><p class="grow muted">${lv ? 'You have learned most of the words up to this level.' : 'Finish most of Modul 1 to reach A1.'} A rough guide, not an exam result.</p></div></section>
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
    <div class="li static"><span class="dot" style="${grad(m)}">${m.level}</span><span class="grow"><b>${m.name} · ${m.tag}</b>${bar(l, t)}</span><small>${l}/${t}</small></div>`; }).join('')}</div>
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
  <p class="foot-note">Progress is stored on this phone only${persisted === true ? ' and is marked as protected storage' : ''}. Deleting the Home Screen icon deletes it, so keep a backup file in Files or iCloud Drive.</p>
  <div class="list"><button class="li" data-a="askReset"><span class="grow"><b class="red">Erase all progress</b></span></button></div>`;
}

function unitSheet(id) {
  const u = UNIT[id], n = u.items.filter(i => S.items[i.id]).length;
  openSheet(`<h2>${u.icon} ${esc(u.title)}</h2>
    <div class="tip"><b>Tip</b>${esc(u.tip)}</div>
    <div class="words">${u.items.map(it => { const st = S.items[it.id]; return `
      <div class="w">${spk(it.da, 'sm')}<span class="grow"><b>${esc(it.da)}</b><small>${esc(it.en)}</small></span><span class="st ${st ? (st.iv >= 21 ? 'known' : 'learning') : ''}"></span></div>`; }).join('')}</div>
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
  const t = today();
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
  sess = { q, i: 0, start: Date.now(), st: { rev: 0, ok: 0, new: 0 }, practice, revealed: false, picked: null, tick: 0 };
  closeSheet(); paintSess(true);
}

const requeue = c => sess.q.splice(Math.min(sess.q.length, sess.i + 4), 0, c);
function nextCard() { sess.i++; sess.revealed = false; sess.picked = null; sess.tick++; paintSess(true); }
const ohead = (pct, left) => `<div class="ohead"><button class="x" data-a="closeOverlay" aria-label="Close">✕</button><div class="prog"><i style="width:${pct}%"></i></div><span class="count">${left}</span></div>`;
const exBlock = it => it.ex ? `<div class="ex">${spk(it.ex, 'sm')}<span class="grow"><b>${esc(it.ex)}</b><small>${esc(it.exEn)}</small></span></div>` : '';

function paintSess(auto) {
  const c = sess.q[sess.i];
  if (!c) return finishSess();
  const it = ITEM[c.id], st = S.items[c.id], voice = hasVoice();
  let body = '', foot = '', say = '';
  if (c.t === 'intro') {
    body = `<span class="badge new">New word</span><div class="word">${esc(it.da)}</div><div class="play">${spk(it.da, 'big')}${slowBtn(it.da)}</div><div class="gloss">${esc(it.en)}</div>${exBlock(it)}`;
    foot = `<button class="btn primary block" data-a="next">Continue</button>`;
    say = it.da;
  } else if (c.t === 'mcq') {
    if (!c.opts) c.opts = shuffle([it, ...shuffle(modItems(it.m).filter(x => x.en !== it.en)).slice(0, 3)]).map(x => x.id);
    const ans = sess.picked !== null;
    body = `<span class="badge">What does it mean?</span><div class="play">${spk(it.da, 'big')}${slowBtn(it.da)}</div>
      <div class="word ${voice && !ans ? 'veil' : ''}">${esc(it.da)}</div>
      <div class="opts">${c.opts.map(id => `<button class="opt ${ans ? (id === c.id ? 'ok' : id === sess.picked ? 'bad' : 'dim') : ''}" data-a="pick" data-id="${id}" ${ans ? 'disabled' : ''}>${esc(ITEM[id].en)}</button>`).join('')}</div>`;
    if (ans && sess.picked !== c.id) foot = `<button class="btn primary block" data-a="next">Continue</button>`;
    say = it.da;
  } else {
    const listen = !c.isNew && st && st.reps % 2 === 1;
    if (!sess.revealed) {
      body = listen
        ? `<span class="badge">Listen. What does it mean?</span><div class="play">${spk(it.da, 'big')}${slowBtn(it.da)}</div>${voice ? '' : `<div class="word">${esc(it.da)}</div>`}`
        : `<span class="badge">Say it in Danish</span><div class="word en">${esc(it.en)}</div>`;
      foot = `<button class="btn primary block" data-a="reveal">Show answer</button>`;
      if (listen) say = it.da;
    } else {
      body = `<div class="word">${esc(it.da)}</div><div class="play">${spk(it.da, 'big')}${slowBtn(it.da)}</div><div class="gloss">${esc(it.en)}</div>${exBlock(it)}`;
      const lbl = g => sess.practice ? '' : `<small>${g === 'again' ? 'soon' : fmtIv(nextIv(st, g, c.relearn))}</small>`;
      foot = `<div class="grades"><button class="g again" data-a="grade" data-g="again">Forgot${lbl('again')}</button><button class="g good" data-a="grade" data-g="good">Got it${lbl('good')}</button><button class="g easy" data-a="grade" data-g="easy">Easy${lbl('easy')}</button></div>`;
      if (auto) say = it.da;
    }
  }
  overlay.innerHTML = ohead(Math.round(sess.i / sess.q.length * 100), sess.q.length - sess.i) + `<div class="stage">${body}</div><div class="foot">${foot}</div>`;
  overlay.hidden = false;
  if (auto && say) speak(say);
}

function pick(id) {
  const c = sess.q[sess.i]; if (sess.picked !== null) return;
  sess.picked = id; paintSess(false);
  if (id === c.id) { const k = sess.tick; setTimeout(() => { if (sess && sess.tick === k) nextCard(); }, 700); }
  else { requeue({ t: 'mcq', id: c.id }); speak(ITEM[c.id].da); }
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
  overlay.innerHTML = `<div class="stage done"><div class="confetti">🎉</div><h1>Godt klaret!</h1><p class="muted">Well done. That session is complete.</p>
    <div class="stats three"><div class="stat"><b>${s.new}</b><small>new words</small></div><div class="stat"><b>${s.rev}</b><small>reviewed</small></div><div class="stat"><b>${mins}</b><small>min</small></div></div>
    <p class="chip big">🔥 ${streak()} day streak</p></div>
    <div class="foot"><button class="btn tint block" data-a="drill" data-k="pairs">2-minute ear training</button><button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
}

function closeOverlay() {
  if (sess) { logTime(sess.start); sess = null; }
  if (drill) { logTime(drill.start); drill = null; }
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
  else if (kind === 'numbers') qs = shuffle([rnd(0, 20), rnd(0, 20), rnd(21, 99), rnd(21, 99), rnd(21, 99), rnd(50, 99), rnd(50, 99), rnd(50, 99), rnd(100, 999), rnd(100, 999)]).map(n => ({ n }));
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
  sess = null;
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
    body = `<span class="badge">${esc(tag)} · which word did you hear?</span><div class="play">${spk(w[q.target][0], 'big')}${slowBtn(w[q.target][0])}</div>
      <div class="choices">${w.map((x, i) => `<button class="choice ${fb ? (i === q.target ? 'ok' : i === fb.pick ? 'bad' : '') : ''}" data-a="${fb ? 'say' : 'dPick'}" data-i="${i}" data-t="${esc(x[0])}"><b>${esc(x[0])}</b><small>${esc(x[1])}</small></button>`).join('')}</div>
      ${fb ? '<p class="muted center">Tap either word to hear it again.</p>' : ''}`;
    say = w[q.target][0];
  } else if (k === 'numbers') {
    const word = daNum(q.n);
    body = `<span class="badge">Type the number you hear</span><div class="play">${spk(word, 'big')}${slowBtn(word)}</div>
      ${voice ? '' : `<div class="gloss">${esc(word)}</div>`}
      <div class="digits ${fb ? (fb.ok ? 'ok' : 'bad') : ''}">${esc(drill.input) || '&nbsp;'}</div>
      ${fb ? `<div class="gloss"><b>${q.n}</b> · ${esc(word)}</div>` : `<div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(x => `<button data-a="key" data-k="${x}" class="${x === '✓' ? 'go' : ''}">${x}</button>`).join('')}</div>`}`;
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
  if (fb && !(fb.ok && k !== 'build')) foot = `<div class="fb ${fb.ok ? 'ok' : 'bad'}">${fb.ok ? 'Rigtigt!' : 'Not quite'}</div><button class="btn primary block" data-a="dNext">Continue</button>`;
  else if (fb) foot = `<div class="fb ok">Rigtigt!</div>`;
  overlay.innerHTML = ohead(Math.round(drill.i / drill.qs.length * 100), drill.qs.length - drill.i) + `<div class="stage">${body}</div><div class="foot">${foot}</div>`;
  overlay.hidden = false;
  if (auto && say && !fb) speak(say);
}

function drillAnswer(ok, pick) {
  const k = drill.kind, d = day(), s = S.drills[k] = S.drills[k] || { n: 0, ok: 0 };
  drill.fb = { ok, pick }; if (ok) { drill.ok++; d.dok++; s.ok++; } d.drill++; s.n++; save();
  paintDrill(false);
  const q = drill.qs[drill.i];
  if (k === 'gender') speak(q.it.da); else if (k === 'build') speak(q.it.ex);
  if (ok && k !== 'build') { const t = drill.tick; setTimeout(() => { if (drill && drill.tick === t) drillNext(); }, 900); }
}
function drillNext() { drill.i++; drill.fb = null; drill.input = ''; drill.tick++; paintDrill(true); }
function finishDrill() {
  const d = drill, pct = Math.round(d.ok / d.qs.length * 100);
  logTime(d.start); drill = null;
  overlay.innerHTML = `<div class="stage done"><div class="confetti">${pct >= 80 ? '🌟' : '💪'}</div><h1>${d.ok} / ${d.qs.length}</h1><p class="muted">${DRILLS[d.kind].name} · ${pct}% correct</p></div>
    <div class="foot"><button class="btn tint block" data-a="drill" data-k="${d.kind}">Go again</button><button class="btn primary block" data-a="closeOverlay">Done</button></div>`;
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

let pendingImport = null;
function readImport(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const b = JSON.parse(r.result), st = b && b.state;
      if (!b || b.app !== 'dansk' || !st || typeof st.items !== 'object' || typeof st.days !== 'object') throw 0;
      pendingImport = st;
      const n = Object.keys(st.items).length;
      confirmSheet('Restore this backup?', `Backup from <b>${esc((b.exported || '').slice(0, 10) || 'unknown date')}</b> with <b>${n}</b> words learned.<br>This phone currently has <b>${totalLearned()}</b>. Restoring replaces what is on this phone.`, 'Replace and restore', 'doImport', true);
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
  obPick: el => { S.module = viewMod = Number(el.dataset.m); S.onboarded = true; save(); render(); },
  hintOff: () => { S.hintOff = true; save(); render(); },
  start: () => startSession(),
  more: () => startSession({ extra: 5 }),
  viewMod: el => { viewMod = Number(el.dataset.m); render(); },
  setMod: () => { S.module = viewMod; save(); render(); toast(`${MOD(viewMod).name} is now your current module`); },
  unit: el => unitSheet(el.dataset.u),
  studyUnit: el => startSession({ unit: el.dataset.u }),
  next: () => nextCard(),
  reveal: () => { sess.revealed = true; paintSess(true); },
  pick: el => pick(el.dataset.id),
  grade: el => grade(el.dataset.g),
  drill: el => startDrill(el.dataset.k),
  dPick: el => { const q = drill.qs[drill.i]; if (drill.fb) return; if (drill.kind === 'pairs') { const i = Number(el.dataset.i); drillAnswer(i === q.target, i); } else { const x = el.dataset.i; drillAnswer(x === q.it.da.split(' ')[0], x); } },
  key: el => { const k = el.dataset.k, q = drill.qs[drill.i]; if (k === '⌫') drill.input = drill.input.slice(0, -1); else if (k === '✓') { if (drill.input) return drillAnswer(Number(drill.input) === q.n); } else if (drill.input.length < 4) drill.input += k; paintDrill(false); },
  tok: el => { drill.qs[drill.i].picked.push(Number(el.dataset.i)); paintDrill(false); },
  unTok: el => { const q = drill.qs[drill.i]; q.picked = q.picked.filter(i => i !== Number(el.dataset.i)); paintDrill(false); },
  dCheck: () => { const q = drill.qs[drill.i]; drillAnswer(norm(q.picked.map(i => q.toks.find(t => t.i === i).t).join(' ')) === norm(q.it.ex)); },
  dNext: () => drillNext(),
  npd: el => { S.newPerDay = Math.min(20, Math.max(2, S.newPerDay + Number(el.dataset.d))); save(); render(); },
  slow: () => { S.slow = !S.slow; save(); render(); speak('Hej, hvordan går det?'); },
  export: () => exportBackup(),
  import: () => { const f = $('#file'); f.value = ''; f.click(); },
  doImport: () => { if (!pendingImport) return; S = Object.assign(fresh(), pendingImport, { onboarded: true }); pendingImport = null; viewMod = S.module; save(); closeSheet(); render(); toast('Backup restored'); },
  askReset: () => confirmSheet('Erase all progress?', 'Every learned word, your streak and your settings will be removed from this phone. This cannot be undone unless you have a backup file.', 'Erase everything', 'doReset', true),
  doReset: () => { S = fresh(); save(); obStep = 0; tab = 'today'; closeSheet(); render(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled && A[el.dataset.a]) A[el.dataset.a](el);
});
document.addEventListener('change', e => {
  if (e.target.id === 'file' && e.target.files[0]) readImport(e.target.files[0]);
  if (e.target.dataset.c === 'voice') { S.voice = e.target.value; save(); speak('Hej, hvordan går det?'); }
});
// A new day may have started while the app sat in the background.
document.addEventListener('visibilitychange', () => { if (!document.hidden && overlay.hidden && sheet.hidden) render(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(p => { persisted = p; }).catch(() => {});
if ('serviceWorker' in navigator && !/^(localhost|127\.)/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
})();
