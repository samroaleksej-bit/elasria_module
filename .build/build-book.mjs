// Сборка data/book.json из book-src.mjs: координаты меток из заметок приключения и проверка всех ссылок.
// node .build/build-book.mjs <выгрузка приключения.json> <список файлов архива.txt>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { places, npcs, quests, letters, maps } from './book-src.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , dumpFile, zipList] = process.argv;
const adv = Object.entries(JSON.parse(fs.readFileSync(dumpFile))).find(([k]) => k.startsWith('!adventures!'))[1];
const files = zipList ? new Set(fs.readFileSync(zipList, 'utf8').split(/\r?\n/).filter(Boolean)) : null;
let bad = 0;
const err = (...a) => { console.log('!!', ...a); bad++; };

const scenes = new Map(adv.scenes.map((s) => [s._id, s]));
const pages = new Set(adv.journal.flatMap((j) => j.pages.map((p) => `JournalEntry.${j._id}.JournalEntryPage.${p._id}`)));
const enc = (p) => p.split('/').map((s) => (/%[0-9A-Fa-f]{2}/.test(s) ? s : encodeURIComponent(s))).join('/');
const checkArt = (p, who) => { if (!p) return p; const e = enc(p); if (files && !files.has('assets/' + decodeURIComponent(e))) err('нет картинки', who, p); return e; };

const P = new Map(places.map((p) => [p.id, p]));
const N = new Map(npcs.map((n) => [n.id, n]));
const ids = new Set();
for (const x of [...places, ...npcs, ...quests, ...letters]) { if (ids.has(x.id)) err('повтор id', x.id); ids.add(x.id); if (x.gm && !pages.has(x.gm)) err('нет страницы мастера', x.id, x.gm); }
for (const p of places) { if (!scenes.has(p.scene)) err('нет сцены', p.id, p.scene); p.img = checkArt(p.img, p.id); for (const w of p.who ?? []) if (!N.has(w)) err('нет жителя', p.id, w); }
for (const n of npcs) { if (!P.has(n.place)) err('нет места у жителя', n.id); n.img = checkArt(n.img, n.id); }
for (const q of quests) { if (q.giver && !N.has(q.giver)) err('нет заказчика', q.id); if (!P.has(q.place)) err('нет места у задания', q.id); q.art = checkArt(q.art, q.id); if (q.letter && !letters.some((l) => l.id === q.letter)) err('нет письма', q.id); }

const outMaps = maps.map((m) => {
  const s = scenes.get(m.scene);
  if (!s) { err('нет сцены карты', m.id); return null; }
  const g = s.grid.size;
  const ox = Math.ceil(s.width * s.padding / g) * g, oy = Math.ceil(s.height * s.padding / g) * g;
  const seen = new Set();
  const pins = [];
  for (const note of s.notes) {
    const place = m.pins[m.by === 'page' ? note.pageId : note.entryId];
    if (!place) continue;
    if (!P.has(place)) { err('метка без места', m.id, place); continue; }
    if (m.once?.includes(place) && seen.has(place)) continue;
    seen.add(place);
    const x = +((note.x - ox) / s.width).toFixed(3), y = +((note.y - oy) / s.height).toFixed(3);
    if (!(x > 0 && x < 1 && y > 0 && y < 1)) err('метка вне карты', m.id, place, x, y);
    pins.push({ place, x, y });
  }
  for (const place of new Set(Object.values(m.pins))) if (!seen.has(place)) err('место без метки', m.id, place);
  const order = places.map((p) => p.id);
  pins.sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place));
  return { id: m.id, n: m.n, place: m.place, img: checkArt(m.img, m.id), ratio: +(s.width / s.height).toFixed(3), pins };
}).filter(Boolean);

const book = { art: 'modules/kadzoki-proklyatie-strada/assets/', quests, npcs, places, letters, maps: outMaps };
let json = JSON.stringify(book, null, 2).replace(/\{\n\s+"place": "([\w-]+)",\n\s+"x": ([\d.]+),\n\s+"y": ([\d.]+)\n\s+\}/g, '{ "place": "$1", "x": $2, "y": $3 }');
fs.mkdirSync(path.join(here, '../data'), { recursive: true });
fs.writeFileSync(path.join(here, '../data/book.json'), json + '\n');
console.log(`мест ${places.length}, жителей ${npcs.length}, заданий ${quests.length}, писем ${letters.length}, карт ${outMaps.length} (меток: ${outMaps.map((m) => m.pins.length).join(', ')}), проблем: ${bad}`);
if (/[—–]/.test(JSON.stringify([places, npcs, quests, letters]))) console.log('!! в текстах есть длинное тире');
process.exit(bad ? 1 : 0);
