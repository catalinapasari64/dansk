// Collects headlines and summaries from DR's public RSS feeds into news.json, which the app
// searches for the user's vocabulary. Run daily by .github/workflows/news.yml.
// DR describes these feeds as free to use: https://www.dr.dk/nyheder/dr-nyheder-som-rss-feed
import { readFile, writeFile } from 'node:fs/promises';

const FEEDS = ['senestenyt', 'indland', 'udland', 'penge', 'politik', 'viden', 'kultur', 'sporten', 'regionale'];
const BASE = 'https://www.dr.dk/nyheder/service/feeds/';
const FILE = new URL('../news.json', import.meta.url);
const KEEP = 1500;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)
  .replace(/\s+/g, ' ').trim();
const tag = (xml, name) => clean((xml.match(new RegExp(String.raw`<${name}[^>]*>([\s\S]*?)</${name}>`)) || [])[1]);

async function readFeed(name) {
  const res = await fetch(BASE + name, { headers: { 'user-agent': 'dansk-vocabulary-app (personal study tool)' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const title = tag(m[1], 'title'), desc = tag(m[1], 'description'), url = tag(m[1], 'link'), date = new Date(tag(m[1], 'pubDate'));
    // The passage is the headline and, on a new line, the summary, both exactly as DR published them.
    const text = desc ? [title, desc].join('\n') : '';
    return { t: title, x: text, u: url, d: isNaN(date) ? '' : date.toISOString().slice(0, 10) };
  }).filter(i => i.u && i.x.length >= 60 && i.x.length <= 600);
}

let old = [];
try { old = JSON.parse(await readFile(FILE, 'utf8')).items || []; } catch { /* first run */ }

const fetched = [];
for (const f of FEEDS) {
  try { fetched.push(...await readFeed(f)); } catch (e) { console.warn('skipped', e.message); }
}
const seen = new Set(), items = [];
for (const i of [...fetched, ...old]) { if (!seen.has(i.u)) { seen.add(i.u); items.push(i); } }
items.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
const added = items.length - old.length;
if (!fetched.length) { console.error('No feed could be read; leaving news.json untouched'); process.exit(1); }
if (added > 0 || !old.length) {
  await writeFile(FILE, JSON.stringify({ source: 'DR Nyheder RSS', updated: new Date().toISOString(), items: items.slice(0, KEEP) }) + '\n');
}
console.log(`fetched ${fetched.length}, new ${Math.max(0, added)}, kept ${Math.min(items.length, KEEP)}`);
