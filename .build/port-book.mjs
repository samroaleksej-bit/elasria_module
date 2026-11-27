// Разовый перенос кода книги из borderlands-book в этот модуль с правками под Нахтмарк.
// node .build/port-book.mjs <папка borderlands-book>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const dst = path.join(here, '..');
const rd = (p) => fs.readFileSync(path.join(src, p), 'utf8');
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(dst, p)), { recursive: true }); fs.writeFileSync(path.join(dst, p), s); };
const must = (s, a, b, what) => { if (!s.includes(a)) throw new Error('не найдено: ' + what); return s.split(a).join(b); };

/* ---------- render.js ---------- */
let r = rd('scripts/render.js');
r = r.replace(/const CREST = `[^`]*`;/, 'const CREST = `<svg class="bb-crest" viewBox="0 0 64 72" aria-hidden="true"><path d="M4 4h56v30c0 18-12 28-28 34C16 62 4 52 4 34z" fill="currentColor" opacity=".14"/><path d="M4 4h56v30c0 18-12 28-28 34C16 62 4 52 4 34z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 52l11-20 6 9 7-15 16 26z" fill="currentColor"/><path d="M46 12a9 9 0 1 0 6 15a7 7 0 0 1-6-15z" fill="currentColor"/></svg>`;');
r = must(r, '<span>Книга Пограничья</span>', '<span>Книга Нахтмарка</span>', 'заголовок');
r = must(r, 'p.num ?? (p.g === "Крепость" ? "♜" : p.g === "Пещеры Хаоса" ? "▲" : "✦")', 'p.num ?? "✦"', 'symOf');
r = must(r, '` : ""}${p ? ` · ${seen("places", p.id) ? link("places", p.id, p.n) : esc(p.n)}` : ""}</div>\n        <div class="bb-rule"></div>\n        ${photo(C, sel.art, sel.n, "spot")}',
  '` : esc(sel.giverName ?? "")}${p ? ` · ${seen("places", p.id) ? link("places", p.id, p.n) : esc(p.n)}` : ""}</div>\n        <div class="bb-rule"></div>\n        ${photo(C, sel.art, sel.n, "spot")}', 'заказчик без досье');
r = must(r, '${sel.reward ? `<p class="bb-reward"><b>Награда.</b> ${esc(sel.reward)}</p>` : ""}',
  '${sel.reward ? `<p class="bb-reward"><b>Награда.</b> ${esc(sel.reward)}</p>` : ""}\n        ${sel.letter && seen("letters", sel.letter) ? `<p class="bb-text"><b>Бумаги.</b> ${link("letters", sel.letter, byId("letters", sel.letter).n)}</p>` : ""}', 'письмо у задания');
r = must(r, 'Пока никто в крепости не доверил вам дел. Пройдитесь по дворам — работа найдётся.', 'Пока никто в Нахтмарке не доверил вам своих бед.', 'пустые задания');
r = must(r, 'Она появится, когда вы доберётесь до крепости.', 'Она появится, когда вы войдёте в Нахтмарк.', 'пустая карта');
r = must(r, '<ul>${pins.map((p) => `<li data-travel=', '<ul>${pins.filter((p, i, a) => a.findIndex((q) => q.place === p.place) === i).map((p) => `<li data-travel=', 'список меток без повторов');
r = must(r, '${sel.html ? `<div class="bb-paper ${esc(sel.kind ?? "")}">', '${sel.own ? `<figure class="bb-photo sheet"><img src="modules/nachtmark/art/handouts/${sel.own}" data-zoom="${esc(sel.n)}" draggable="false"></figure>` : sel.html ? `<div class="bb-paper ${esc(sel.kind ?? "")}">', 'свои картинки в письмах');
r = r.replace(/ — /g, ' - ');
wr('scripts/render.js', r);

/* ---------- book.js ---------- */
let b = rd('scripts/book.js');
b = must(b, 'from "./const.js";', 'from "./book-const.js";', 'импорт const');
b = must(b, 'id: "borderlands-book"', 'id: "nachtmark-book"', 'id окна');
b = b.replace(/async function openMasterPage\(ref\) \{[\s\S]*?\n\}/, `async function openMasterPage(ref) {
  const page = await fromUuid(ref);
  if (!page) return ui.notifications.warn("Страница не найдена: импортируйте приключение в этот мир.");
  page.parent.sheet.render(true, { pageId: page.id });
}`);
if (!b.includes('const page = await fromUuid(ref);')) throw new Error('не заменена openMasterPage');
b = must(b, 'Сцена не найдена: импортируйте приключение «Герои Пограничья» в этот мир.', 'Сцена не найдена: импортируйте приключение в этот мир.', 'текст про сцену');
b = b.replace(/Книга Пограничья/g, 'Книга Нахтмарка').replace(/ — /g, ' - ');
wr('scripts/book.js', b);

/* ---------- служебные ---------- */
wr('scripts/book-const.js', `export const MOD = "nachtmark";

let content = null;
export async function getContent() {
  content ??= await (await fetch(\`modules/\${MOD}/data/book.json\`)).json();
  return content;
}
export function getState() {
  const st = foundry.utils.deepClone(game.settings.get(MOD, "book") ?? {});
  st.q ??= {}; st.o ??= {}; st.e ??= {};
  return st;
}
export async function saveState(st) {
  if (!game.user.isGM) return;
  await game.settings.set(MOD, "book", st);
}
`);
wr('scripts/sfx.js', must(rd('scripts/sfx.js'), 'from "./const.js";', 'from "./book-const.js";', 'импорт в sfx'));

/* ---------- стили: та же книга, другая кожа ---------- */
let c = rd('styles/book.css');
const swap = [
  ['#34497a 0%, #1f2f52 50%, #111a30 100%', '#4d1a20 0%, #2b0f13 52%, #120607 100%'], // кожа обложки
  ['inset 0 0 0 2px #0b1122, inset 0 0 0 6px #26375e', 'inset 0 0 0 2px #0a0405, inset 0 0 0 6px #3c1519'],
  ['--bb-blue: #2f4a78', '--bb-blue: #6a2229'], ['--bb-blue2: #1b2a47', '--bb-blue2: #2b1114'], ['--bb-red: #8c2a22', '--bb-red: #8a6a2a'],
  ['--bb-pen: #23355c', '--bb-pen: #37263b'], ['--bb-ink: #2b2620', '--bb-ink: #26201c'],
  ['#f4eeda 0%, #e6dcc0 60%, #c9bd9b 100%', '#e8e1ce 0%, #d5ccb5 60%, #ada28a 100%'], // пергамент
  ['linear-gradient(transparent, #e6dcc0 35%)', 'linear-gradient(transparent, #d5ccb5 35%)'],
  ['linear-gradient(#f4eeda, #e2d7b6)', 'linear-gradient(#e8e1ce, #d2c8ae)'],
  ['linear-gradient(#3a5489, #24365d)', 'linear-gradient(#6f262d, #3f1418)'], ['linear-gradient(#4665a3, #2c426f)', 'linear-gradient(#8a323b, #541c21)'],
  ['border: 1px solid #111a30', 'border: 1px solid #150809'],
  ['linear-gradient(#41609c, #1f3157)', 'linear-gradient(#7d2b33, #3a1216)'], ['linear-gradient(#b5352b, #6e1d18)', 'linear-gradient(#b89242, #6b5120)'],
  ['background: #1b2a47;', 'background: #2b1114;'], ['radial-gradient(circle at 50% 35%, #33435f, #131b2d)', 'radial-gradient(circle at 50% 35%, #4c2b30, #1a0c0e)'],
  ['border: 2px solid #b5352b', 'border: 2px solid #b89242'], ['color: #1b2a47; }', 'color: #2b1114; }'], ['border: 1px solid #1b2a47', 'border: 1px solid #2b1114'],
  ['rgba(160,190,235,.4)', 'rgba(210,150,120,.35)'], ['rgba(160,190,235,.6)', 'rgba(220,170,120,.55)'],
  ['#3a5489, #24365d', '#6f262d, #3f1418']
];
for (const [a, bb] of swap) c = c.split(a).join(bb);
c = c.replace(/rgba\(47,74,120,/g, 'rgba(106,34,41,').replace(/rgba\(140,42,34,/g, 'rgba(138,106,42,').replace(/rgba\(27,42,71,/g, 'rgba(43,17,20,');
c += `
/* ===== Нахтмарк: закладки и мелочи ===== */
.bb-rib.r0 { --rib: linear-gradient(90deg, #3a1216, #7d2b33 50%, #3a1216); }
.bb-rib.r1 { --rib: linear-gradient(90deg, #5a4416, #9a7a30 50%, #5a4416); }
.bb-rib.r2 { --rib: linear-gradient(90deg, #4a4f57, #868d97 50%, #4a4f57); }
.bb-rib.r3 { --rib: linear-gradient(90deg, #232f1c, #47603a 50%, #232f1c); }
.bb-rib.r4 { --rib: linear-gradient(90deg, #5f5848, #a59b84 50%, #5f5848); }
.bb-stamp.done { color: #3f5a2e; } .bb-stamp.failed { color: #7a1a1f; }
.bb-grp li.done { color: #3f5a2e; } .bb-grp li.failed { color: #7a1a1f; }
.bb-photo.plan::after { content: "вид"; }
.bb-paper.scrawl.blood { color: #6d120f; }
.bb-toast.done .bb-seal { background: radial-gradient(circle at 35% 30%, #7a9a64, #3f5a2e 50%, #1d2c15); }
`;
wr('styles/book.css', c);

/* ---------- шрифты и звуки ---------- */
for (const dir of ['fonts', 'sounds']) { fs.mkdirSync(path.join(dst, dir), { recursive: true }); for (const f of fs.readdirSync(path.join(src, dir))) fs.copyFileSync(path.join(src, dir, f), path.join(dst, dir, f)); }
console.log('перенесено: render.js, book.js, book-const.js, sfx.js, book.css, шрифтов', fs.readdirSync(path.join(dst, 'fonts')).length, 'звуков', fs.readdirSync(path.join(dst, 'sounds')).length);
