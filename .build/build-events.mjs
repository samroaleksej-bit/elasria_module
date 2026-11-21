// Сборка data/events.json: имена существ превращаются в ссылки на компендиумы.
// node .build/build-events.mjs <существа Grim Hollow.json> <существа The Crooked Moon.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables, version } from './events-src.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = {
  gh: { pack: 'grim-hollow-2024-ru.creatures', list: JSON.parse(fs.readFileSync(process.argv[2])), book: 'Grim Hollow' },
  tcm: { pack: 'ag-fifthpendium-tcm.actors', list: JSON.parse(fs.readFileSync(process.argv[3])), book: 'The Crooked Moon' }
};
const cr = (x) => (x === 0.125 ? '1/8' : x === 0.25 ? '1/4' : x === 0.5 ? '1/2' : String(x));
let bad = 0;
const count = { gh: 0, tcm: 0 };
const out = tables.map((t) => {
  const seen = new Set();
  const rows = t.rows.map((row) => {
    if (seen.has(row.r)) { console.log('!! повтор значения', t.kind, row.r); bad++; }
    seen.add(row.r);
    const mobs = row.mobs.map(([name, n, from = 'gh']) => {
      const s = SRC[from];
      const hits = s.list.filter((a) => a.n === name || a.n.startsWith(name + ' ['));
      if (hits.length !== 1) { console.log('!! существо не найдено однозначно:', from, name, hits.map((h) => h.n)); bad++; return null; }
      count[from]++;
      return { name, count: n, uuid: `Compendium.${s.pack}.Actor.${hits[0].id}`, cr: cr(hits[0].cr), book: s.book };
    }).filter(Boolean);
    return { r: row.r, n: row.n, text: row.text, mobs };
  });
  for (let r = t.min; r <= t.max; r++) if (!seen.has(r)) { console.log('!! нет значения', t.kind, r); bad++; }
  for (const r of seen) if (r < t.min || r > t.max) { console.log('!! значение вне броска', t.kind, r); bad++; }
  console.log(`${t.name} [${t.formula}]: ` + rows.map((x) => `${x.r} ${x.n}${x.mobs.length ? ' [' + x.mobs.map((m) => `${m.count}× ПО ${m.cr}${m.book === 'The Crooked Moon' ? ' Луна' : ''}`).join(', ') + ']' : ''}`).join(' | '));
  return { kind: t.kind, name: t.name, formula: t.formula, intro: t.intro, rows };
});
if (/[—–]/.test(JSON.stringify(out))) { console.log('!! длинное тире в текстах'); bad++; }
fs.writeFileSync(path.join(here, '../data/events.json'), JSON.stringify({ version, tables: out }, null, 2) + '\n');
console.log(`существ из Grim Hollow: ${count.gh}, из The Crooked Moon: ${count.tcm}, проблем: ${bad}`);
process.exit(bad ? 1 : 0);
