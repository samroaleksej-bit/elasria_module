// Сборка data/events.json: имена существ превращаются в ссылки на компендиум Grim Hollow.
// node .build/build-events.mjs <список существ Grim Hollow.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from './events-src.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const gh = JSON.parse(fs.readFileSync(process.argv[2]));
const PACK = 'grim-hollow-2024-ru.creatures';
const cr = (x) => (x === 0.125 ? '1/8' : x === 0.25 ? '1/4' : x === 0.5 ? '1/2' : String(x));
let bad = 0;
const out = tables.map((t) => {
  const seen = new Set();
  const rows = t.rows.map((row) => {
    if (seen.has(row.r)) { console.log('!! повтор значения', t.kind, row.r); bad++; }
    seen.add(row.r);
    const mobs = row.mobs.map(([name, count]) => {
      const hits = gh.filter((a) => a.n === name || a.n.startsWith(name + ' ['));
      if (hits.length !== 1) { console.log('!! существо не найдено однозначно:', name, hits.map((h) => h.n)); bad++; return null; }
      return { name, count, uuid: `Compendium.${PACK}.Actor.${hits[0].id}`, cr: cr(hits[0].cr) };
    }).filter(Boolean);
    return { r: row.r, n: row.n, text: row.text, mobs };
  });
  for (let r = 2; r <= 12; r++) if (!seen.has(r)) { console.log('!! нет значения', t.kind, r); bad++; }
  console.log(`${t.name}: ` + rows.map((x) => `${x.r} ${x.n}${x.mobs.length ? ' [' + x.mobs.map((m) => `${m.count}× ПО ${m.cr}`).join(', ') + ']' : ''}`).join(' | '));
  return { kind: t.kind, name: t.name, formula: t.formula, intro: t.intro, rows };
});
if (/[—–]/.test(JSON.stringify(out))) { console.log('!! длинное тире в текстах'); bad++; }
fs.writeFileSync(path.join(here, '../data/events.json'), JSON.stringify({ version: 1, tables: out }, null, 2) + '\n');
console.log('проблем:', bad);
process.exit(bad ? 1 : 0);
