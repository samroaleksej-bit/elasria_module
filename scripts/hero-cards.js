/* ════════════════════════════════════════════════════════════════════
   Карточки героев
   Мастер показывает карточку героя всем игрокам: она вылетает,
   переворачивается и листается как книжка (лист, умения, заклинания,
   снаряжение). Состояние лежит в скрытой настройке мира, поэтому
   игроки видят всё сразу, а опоздавшие попадают в текущий момент.
   Вынесено из «Сцены» Кодекса Эластрии.
   ════════════════════════════════════════════════════════════════════ */

const MID = "hero-cards";
const CARD_ID = "hc-card";
const SPIN_MS = 1500;
const LEAVE_MS = 700;
const TURN_MS = 600;
const COL_UNITS = 13;          // высота колонки страницы в условных строках

const ACCENTS = ["#d9b46a", "#8fd3f0", "#e89650", "#e2788c", "#a98cf0", "#7fd6a0", "#f0d27a", "#e06a5a"];
const PARTICLES = { snow: "Снег", ash: "Пепел", sparks: "Искры", petals: "Лепестки", stars: "Звёзды", none: "Без частиц" };

const ABIL = [["str", "СИЛ"], ["dex", "ЛОВ"], ["con", "ТЕЛ"], ["int", "ИНТ"], ["wis", "МДР"], ["cha", "ХАР"]];
const ACTIVATION = { action: "Действие", bonus: "Бонус", reaction: "Реакция", special: "Особое", minute: "Минуты", hour: "Часы", legendary: "Легендарное" };
const RECOVERY = { sr: "кор. отдых", lr: "дл. отдых", day: "в день", dawn: "на рассвете", dusk: "на закате", recharge: "перезарядка", turn: "в ход", round: "в раунд" };
const SKIP_FEATURE = /увеличение характеристик|ability score|боев(ой|ые) стил|fighting style|владени|proficien|язык|language|хиты|hit points|подкласс|subclass|^особенност/i;
const FEAT_GROUPS = [["class", "Класс"], ["race", "Вид"], ["background", "Предыстория"], ["feat", "Черты"], ["other", "Прочее"]];
const GEAR_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];
const GEAR_LABEL = { weapon: "Оружие", equipment: "Снаряжение", consumable: "Расходник", tool: "Инструмент", loot: "Добыча", container: "Сумка", backpack: "Сумка" };
const COINS = [["pp", "пм"], ["gp", "зм"], ["ep", "эм"], ["sp", "см"], ["cp", "мм"]];

/* ───────────── утилиты ───────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssUrl = (s) => encodeURI(String(s ?? "")).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const isGM = () => !!game.user?.isGM;
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const itemsOf = (actor) => actor?.items?.contents ?? Array.from(actor?.items ?? []);
const has = (set, key) => !!set && (typeof set.has === "function" ? set.has(key) : Array.isArray(set) ? set.includes(key) : !!set[key]);

function plainText(html, max = 150) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  let t = (div.textContent || "").replace(/\s+/g, " ").trim();
  const dot = t.search(/[.!?](\s|$)/);
  if (dot > 20 && dot < max) t = t.slice(0, dot + 1);
  else if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return t;
}
function activitiesOf(item) {
  const a = item?.system?.activities;
  if (!a) return [];
  if (Array.isArray(a)) return a;
  if (Array.isArray(a.contents)) return a.contents;
  if (typeof a.values === "function") return Array.from(a.values());
  return Object.values(a);
}
function caption() {
  const own = String(game.settings.get(MID, "caption") ?? "").trim();
  return own || game.world?.title || "";
}

/* ───────────── состояние (настройка мира) ───────────── */
function S() { return clone(game.settings.get(MID, "state")) ?? {}; }
async function setS(mut) {
  if (!isGM()) return;
  const s = S(); mut(s);
  await game.settings.set(MID, "state", s);
}
let PREV = {};

function onState(next) {
  next = clone(next) ?? {};
  const prev = PREV; PREV = clone(next);
  const c = next.card, p = prev.card;
  if (!c) removeCard();
  else if (c.t !== p?.t) renderCard(c.payload, c.flipped, c.page ?? 0);
  else {
    if (!!c.flipped !== !!p?.flipped) setFlipped(c.flipped);
    if ((c.page ?? 0) !== (p?.page ?? 0)) setPage(c.page ?? 0, true);
  }
  panel?.rendered && panel.render();
}

/* ───────────── данные актёра ───────────── */
function featBrief(i) {
  const act = activitiesOf(i).find((a) => a?.activation?.type && a.activation.type !== "none");
  const max = num(i.system?.uses?.max);
  const per = i.system?.uses?.recovery?.[0]?.period;
  return { name: i.name, tag: ACTIVATION[act?.activation?.type] ?? "Пассивно", uses: max ? `${max}× ${RECOVERY[per] ?? ""}`.trim() : "", text: plainText(i.system?.description?.value) };
}
function pickFeatures(actor) {
  const feats = itemsOf(actor).filter((i) => i.type === "feat");
  const scored = feats.filter((i) => !SKIP_FEATURE.test(i.name)).map((i, idx) => {
    const acts = activitiesOf(i);
    const active = acts.some((a) => ["action", "bonus", "reaction"].includes(a?.activation?.type));
    const limited = !!num(i.system?.uses?.max);
    const fromClass = ["class", "subclass"].includes(i.system?.type?.value);
    return { i, idx, score: (active ? 3 : 0) + (limited ? 2 : 0) + (fromClass ? 1 : 0) };
  }).sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, 6).map(({ i }) => featBrief(i));
}
function pickWeapons(actor) {
  return itemsOf(actor).filter((i) => i.type === "weapon" && i.system?.equipped !== false).slice(0, 2).map((i) => {
    let hit = "", dmg = "";
    try {
      const atk = activitiesOf(i).find((a) => a?.type === "attack");
      hit = atk?.labels?.toHit ?? i.labels?.toHit ?? "";
      const d = atk?.labels?.damage ?? atk?.labels?.damages ?? i.labels?.damages ?? i.labels?.damage;
      dmg = Array.isArray(d) ? d.map((x) => x?.formula ?? x?.label ?? "").filter(Boolean).join(" + ") : (d ?? "");
    } catch (e) { /* подписи оружия необязательны */ }
    return { name: i.name, hit: String(hit), dmg: String(dmg) };
  });
}
function buildStats(actor) {
  if (!actor) return null;
  const sys = actor.system ?? {}, attr = sys.attributes ?? {};
  const items = itemsOf(actor);
  const clsItems = actor.classes ? Object.values(actor.classes) : items.filter((i) => i.type === "class");
  const classes = clsItems.map((c) => ({ name: c.name, level: num(c.system?.levels) ?? "", sub: c.subclass?.name ?? items.find((i) => i.type === "subclass" && i.system?.classIdentifier === c.system?.identifier)?.name ?? "" }));
  const race = items.find((i) => i.type === "race")?.name ?? (typeof sys.details?.race === "string" ? sys.details.race : sys.details?.race?.name) ?? "";
  const spellDC = items.some((i) => i.type === "spell") ? num(attr.spell?.dc ?? attr.spelldc) : null;
  const walk = num(attr.movement?.walk);
  return {
    name: actor.name, race, classes,
    ac: num(attr.ac?.value) ?? "—", hp: num(attr.hp?.max) ?? "—",
    speed: walk != null ? `${walk} ${attr.movement?.units === "m" ? "м" : "фт"}` : "—",
    prof: num(attr.prof) != null ? sign(num(attr.prof)) : "—", spellDC,
    abilities: ABIL.map(([k, label]) => { const a = sys.abilities?.[k] ?? {}; const score = num(a.value) ?? 10; return { label, score, mod: sign(num(a.mod) ?? Math.floor((score - 10) / 2)), save: !!a.proficient }; }),
    weapons: pickWeapons(actor), features: pickFeatures(actor)
  };
}

/* ───────────── страницы книжки ─────────────
   Блоки: { t: "h", text, note }  заголовок группы (1 строка)
          { t: "i", name, tag, uses, marks, text, dim }  запись (2 строки с текстом, 1 без)
          { t: "p", text }  абзац
   Разбивку по страницам делает мастерский клиент: размеры заданы в cqw,
   поэтому у всех игроков страницы выглядят одинаково.                  */
const unitsOf = (b) => b.t === "h" ? 1 : b.t === "i" ? (b.text ? 2 : 1) : Math.max(1, Math.ceil(Math.ceil(b.text.length / 70) * 0.52 + 0.3));

function paginate(title, sub, blocks) {
  const pages = [];
  let cols = [[]], used = 0;
  const newCol = () => {
    if (cols.length === 2) { pages.push(cols); cols = [[]]; } else cols.push([]);
    used = 0;
  };
  blocks.forEach((b, idx) => {
    let need = unitsOf(b);
    if (b.t === "h" && blocks[idx + 1]) need += unitsOf(blocks[idx + 1]);   // заголовок не оставляем внизу колонки одного
    if (used > 0 && used + need > COL_UNITS) newCol();
    cols[cols.length - 1].push(b);
    used += unitsOf(b);
  });
  if (cols.some((c) => c.length)) pages.push(cols);
  return pages.map((c, i) => ({ kind: "list", title: pages.length > 1 ? `${title} · ${i + 1}/${pages.length}` : title, sub, cols: c }));
}

function featurePages(actor) {
  const feats = itemsOf(actor).filter((i) => i.type === "feat" && !SKIP_FEATURE.test(i.name));
  if (!feats.length) return [];
  const groupOf = (i) => { const v = i.system?.type?.value; return v === "subclass" ? "class" : FEAT_GROUPS.some(([k]) => k === v) ? v : "other"; };
  const blocks = [];
  for (const [key, label] of FEAT_GROUPS) {
    const list = feats.filter((i) => groupOf(i) === key);
    if (!list.length) continue;
    blocks.push({ t: "h", text: label, note: String(list.length) });
    for (const i of list) blocks.push({ t: "i", ...featBrief(i) });
  }
  return paginate("Все умения", "", blocks);
}

function castTime(sys) {
  const a = sys?.activation ?? {};
  const v = num(a.value);
  if (a.type === "minute") return `${v ?? 1} мин`;
  if (a.type === "hour") return `${v ?? 1} ч`;
  return ACTIVATION[a.type] ?? "";
}
function spellReady(sys) {
  if ((num(sys?.level) ?? 0) === 0) return true;
  const mode = sys?.method ?? sys?.preparation?.mode;          // dnd5e 5.x / 4.x
  const p = sys?.prepared ?? sys?.preparation?.prepared;
  if (mode && !["prepared", "spell"].includes(mode)) return true;   // всегда, врождённые, договор, по желанию
  if (p === undefined || p === null) return true;
  return p === true || Number(p) >= 1;
}
function spellPages(actor) {
  const spells = itemsOf(actor).filter((i) => i.type === "spell");
  if (!spells.length) return [];
  const sys = actor.system ?? {}, slots = sys.spells ?? {};
  const blocks = [];
  let anyDim = false;
  for (let lvl = 0; lvl <= 9; lvl++) {
    const list = spells.filter((i) => (num(i.system?.level) ?? 0) === lvl).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!list.length) continue;
    const max = num(slots[`spell${lvl}`]?.max);
    const pact = num(slots.pact?.level) === lvl ? num(slots.pact?.max) : null;
    const note = [max ? `ячеек: ${max}` : "", pact ? `договор: ${pact}` : ""].filter(Boolean).join(" · ");
    blocks.push({ t: "h", text: lvl === 0 ? "Заговоры" : `${lvl} круг`, note });
    for (const i of list) {
      const s = i.system ?? {};
      const marks = [];
      if (has(s.properties, "concentration") || s.components?.concentration) marks.push("К");
      if (has(s.properties, "ritual") || s.components?.ritual) marks.push("Р");
      const dim = !spellReady(s);
      anyDim ||= dim;
      blocks.push({ t: "i", name: i.name, tag: castTime(s), uses: "", marks, text: plainText(s.description?.value, 140), dim });
    }
  }
  const attr = sys.attributes ?? {};
  const dc = num(attr.spell?.dc ?? attr.spelldc), atk = num(attr.spell?.attack);
  const sub = [dc ? `СЛ ${dc}` : "", atk != null && atk !== 0 ? `атака ${sign(atk)}` : "", "К: концентрация", "Р: ритуал", anyDim ? "тусклые: не подготовлены" : ""].filter(Boolean).join(" · ");
  return paginate("Заклинания", sub, blocks);
}

function gearPages(actor) {
  const gear = itemsOf(actor).filter((i) => GEAR_TYPES.includes(i.type));
  const sys = actor.system ?? {};
  const coins = COINS.map(([k, l]) => [num(sys.currency?.[k]), l]).filter(([v]) => v).map(([v, l]) => `${v} ${l}`).join(" · ");
  if (!gear.length && !coins) return [];
  const isMagic = (i) => has(i.system?.properties, "mgc") || !!i.system?.rarity;
  const qty = (i) => { const q = num(i.system?.quantity); return q != null && q !== 1 ? ` ×${q}` : ""; };
  const magic = gear.filter(isMagic);
  const worn = gear.filter((i) => !isMagic(i) && i.system?.equipped === true && ["weapon", "equipment"].includes(i.type));
  const rest = gear.filter((i) => !magic.includes(i) && !worn.includes(i));
  const blocks = [];
  if (magic.length) {
    blocks.push({ t: "h", text: "Магические предметы", note: String(magic.length) });
    for (const i of magic) {
      const marks = [];
      if (i.system?.attuned === true) marks.push("настроен");
      if (i.system?.equipped === true) marks.push("надето");
      blocks.push({ t: "i", name: i.name + qty(i), tag: GEAR_LABEL[i.type] ?? "", uses: "", marks, text: plainText(i.system?.description?.value, 140) });
    }
  }
  if (worn.length) {
    blocks.push({ t: "h", text: "Надето и в руках", note: "" });
    for (const i of worn) blocks.push({ t: "i", name: i.name + qty(i), tag: GEAR_LABEL[i.type] ?? "", uses: "", marks: [], text: "" });
  }
  if (rest.length) {
    blocks.push({ t: "h", text: "В сумке", note: String(rest.length) });
    const names = rest.map((i) => i.name + qty(i));
    let text = "", shown = 0;
    for (const n of names) { if (text.length + n.length > 620) break; text += (text ? ", " : "") + n; shown++; }
    if (shown < names.length) text += ` и ещё ${names.length - shown}`;
    blocks.push({ t: "p", text });
  }
  if (coins) { blocks.push({ t: "h", text: "Монеты", note: "" }); blocks.push({ t: "p", text: coins }); }
  return paginate("Снаряжение", "", blocks);
}

function buildPages(actor, stats) {
  if (!stats) return [{ kind: "sheet" }];
  const safe = (fn) => { try { return fn(actor); } catch (e) { console.warn(`${MID} | страница не собралась`, e); return []; } };
  return [{ kind: "sheet" }, ...safe(featurePages), ...safe(spellPages), ...safe(gearPages)];
}

/* герои: персонажи игроков */
function heroes() {
  const all = game.actors?.contents ?? Array.from(game.actors ?? []);
  const owned = all.filter((a) => a.type === "character" && a.hasPlayerOwner);
  const list = owned.length ? owned : all.filter((a) => a.type === "character");
  return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
function cardMeta(actor) {
  const m = game.settings.get(MID, "cards")?.[actor.id] ?? {};
  const i = heroes().findIndex((a) => a.id === actor.id);
  return { art: m.art || "", accent: m.accent || ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length] };
}

/* ───────────── вёрстка карточки ───────────── */
function sheetHTML(st, cap) {
  if (!st) return `<div class="hc-stats-empty"><div class="hc-back-ring"><span>✦</span></div><p>Это не персонаж: листа нет.</p></div>`;
  const cls = st.classes.map((c) => `${esc(c.name)} ${esc(c.level)}${c.sub ? ` · ${esc(c.sub)}` : ""}`).join(" / ");
  const tiles = [["КД", st.ac], ["Хиты", st.hp], ["Скорость", st.speed], ["Мастерство", st.prof]];
  if (st.spellDC) tiles.push(["СЛ заклинаний", st.spellDC]);
  return `<div class="hc-stats">
    <div class="hc-col hc-col-left">
      <div class="hc-eyebrow">${cap ? `${esc(cap)} · ` : ""}лист персонажа</div>
      <div class="hc-st-name">${esc(st.name)}</div>
      ${cls ? `<div class="hc-st-class">${cls}</div>` : ""}
      ${st.race ? `<div class="hc-st-race">${esc(st.race)}</div>` : ""}
      <div class="hc-tiles">${tiles.map(([l, v]) => `<div class="hc-tile"><div class="hc-tile-v">${esc(v)}</div><div class="hc-tile-l">${esc(l)}</div></div>`).join("")}</div>
      <div class="hc-abils">${st.abilities.map((a) => `<div class="hc-abil${a.save ? " hc-save" : ""}"><div class="hc-abil-l">${a.label}</div><div class="hc-abil-m">${esc(a.mod)}</div><div class="hc-abil-s">${esc(a.score)}</div></div>`).join("")}</div>
      ${st.weapons.length ? `<div class="hc-weapons">${st.weapons.map((w) => `<div class="hc-weapon"><span class="hc-w-name">${esc(w.name)}</span>${w.hit ? `<span class="hc-w-hit">${esc(w.hit)}</span>` : ""}${w.dmg ? `<span class="hc-w-dmg">${esc(w.dmg)}</span>` : ""}</div>`).join("")}</div>` : ""}
    </div>
    <div class="hc-col hc-col-right">
      <div class="hc-eyebrow">Ключевые умения</div>
      <div class="hc-feats">${st.features.length ? st.features.map((f) => `<div class="hc-feat"><div class="hc-feat-head"><span class="hc-feat-name">${esc(f.name)}</span><span class="hc-feat-tag">${esc(f.tag)}</span>${f.uses ? `<span class="hc-feat-uses">${esc(f.uses)}</span>` : ""}</div>${f.text ? `<div class="hc-feat-text">${esc(f.text)}</div>` : ""}</div>`).join("") : `<div class="hc-feat-text">Умения не найдены в листе.</div>`}</div>
    </div></div>`;
}
function blockHTML(b) {
  if (b.t === "h") return `<div class="hc-b-h"><span>${esc(b.text)}</span>${b.note ? `<em>${esc(b.note)}</em>` : ""}</div>`;
  if (b.t === "p") return `<div class="hc-b-p">${esc(b.text)}</div>`;
  return `<div class="hc-b-i${b.dim ? " hc-dim" : ""}${b.text ? "" : " hc-b-short"}"><div class="hc-b-head"><span class="hc-b-name">${esc(b.name)}</span>${(b.marks ?? []).map((m) => `<span class="hc-b-mark">${esc(m)}</span>`).join("")}${b.tag ? `<span class="hc-feat-tag">${esc(b.tag)}</span>` : ""}${b.uses ? `<span class="hc-feat-uses">${esc(b.uses)}</span>` : ""}</div>${b.text ? `<div class="hc-b-text">${esc(b.text)}</div>` : ""}</div>`;
}
function listHTML(pg, name) {
  return `<div class="hc-list">
    <div class="hc-list-head"><div class="hc-eyebrow">${esc(name)}</div><div class="hc-list-title">${esc(pg.title)}</div>${pg.sub ? `<div class="hc-list-sub">${esc(pg.sub)}</div>` : ""}</div>
    <div class="hc-list-cols">${[0, 1].map((c) => `<div class="hc-list-col">${(pg.cols[c] ?? []).map(blockHTML).join("")}</div>`).join("")}</div>
  </div>`;
}
function bookHTML(payload) {
  const pages = payload.pages?.length ? payload.pages : [{ kind: "sheet" }];
  const n = pages.length;
  return `<div class="hc-book">${pages.map((pg, i) => `<div class="hc-page" data-page="${i}">
      ${pg.kind === "sheet" ? sheetHTML(payload.stats, payload.caption) : listHTML(pg, payload.card.name)}
      ${n > 1 ? `<div class="hc-pageno">${i + 1} / ${n}</div>` : ""}
    </div>`).join("")}<div class="hc-glint"></div></div>`;
}
function decorBack(cap) { return `<div class="hc-decor"><div class="hc-back-ring"><span>✦</span></div>${cap ? `<div class="hc-back-title">${esc(cap)}</div>` : ""}</div>`; }

function frontHTML(card) {
  if (card.art) return `<img src="${esc(card.art)}" alt="${esc(card.name)}"><div class="hc-shine"></div>`;
  // своей картинки нет: арт актёра целиком по центру, по краям он же, размытый
  return `<div class="hc-pf">
      <div class="hc-pf-bg" style="background-image:url('${cssUrl(card.img)}')"></div>
      <div class="hc-pf-img"><img src="${esc(card.img)}" alt="${esc(card.name)}"></div>
    </div><div class="hc-shine"></div>`;
}

function makeParticles(box, kind = "snow", count = 42) {
  if (kind === "none") return;
  box.dataset.kind = kind;
  for (let i = 0; i < count; i++) {
    const f = document.createElement("span");
    f.className = "hc-flake";
    const size = (kind === "petals" ? 6 : 2) + Math.random() * (kind === "petals" ? 8 : 5);
    f.style.width = `${size}px`; f.style.height = `${kind === "petals" ? size * 0.7 : size}px`;
    f.style.left = `${Math.random() * 100}%`;
    f.style.opacity = (0.35 + Math.random() * 0.55).toFixed(2);
    f.style.setProperty("--dx", `${(Math.random() * 140 - 70).toFixed(0)}px`);
    f.style.animationDuration = `${(kind === "sparks" ? 3 + Math.random() * 4 : 6 + Math.random() * 8).toFixed(1)}s`;
    f.style.animationDelay = `${(-Math.random() * 12).toFixed(1)}s`;
    box.appendChild(f);
  }
}

/* ───────────── показ ───────────── */
function removeCard(immediate = false) {
  const el = document.getElementById(CARD_ID);
  if (!el) return;
  clearTimeout(el._ready);
  if (immediate) return el.remove();
  if (el.classList.contains("hc-leaving")) return;
  el.classList.add("hc-leaving");
  setTimeout(() => el.remove(), LEAVE_MS);
}

function syncNav(root) {
  if (!root) return;
  const flipped = !!root._flipped, n = root._count ?? 1, p = root._page ?? 0;
  root.classList.toggle("hc-is-flipped", flipped);
  root.classList.toggle("hc-has-pages", n > 1);
  const prev = root.querySelector(".hc-prev"), next = root.querySelector(".hc-next");
  if (prev) prev.disabled = p <= 0;
  if (next) next.disabled = p >= n - 1;
}

function setFlipped(f) {
  const root = document.getElementById(CARD_ID);
  if (!root) return;
  root._flipped = !!f;
  root.querySelector(".hc-card")?.classList.toggle("hc-flipped", !!f);
  syncNav(root);
}

/** Открыть страницу книжки. animate: сменить страницу с бликом. */
function setPage(n, animate = false) {
  const root = document.getElementById(CARD_ID);
  if (!root) return;
  const pages = Array.from(root.querySelectorAll(".hc-page"));
  const from = root._page ?? 0;
  n = Math.max(0, Math.min((root._count ?? 1) - 1, n));
  root._page = n;
  syncNav(root);
  if (!pages.length) return;            // карточка ещё вылетает: страница применится после вылета
  clearTimeout(root._turn);
  const book = root.querySelector(".hc-book");
  const clear = () => { pages.forEach((el) => el.classList.remove("hc-turn-out")); book?.classList.remove("hc-glint-next", "hc-glint-prev"); };
  clear();
  pages.forEach((el, i) => el.classList.toggle("hc-on", i === n));
  if (!animate || from === n || !pages[from] || !root._flipped) return;
  void book?.offsetWidth;                                   // перезапуск блика при быстром листании
  pages[from].classList.add("hc-turn-out");                 // старая страница гаснет
  book?.classList.add(n > from ? "hc-glint-next" : "hc-glint-prev");
  root._turn = setTimeout(clear, TURN_MS + 40);
}

function renderCard(payload, flipped = false, page = 0) {
  const { card, stats, opts = {} } = payload;
  removeCard(true);
  const root = document.createElement("div");
  root.id = CARD_ID;
  root.style.setProperty("--hc-accent", card.accent);
  root._count = payload.pages?.length || 1;
  root._page = page;
  root._flipped = false;
  root.innerHTML = `
    <div class="hc-backdrop"></div><div class="hc-snow"></div>
    <div class="hc-stage"><div class="hc-card">
      <div class="hc-face hc-front">${frontHTML(card)}</div>
      <div class="hc-face hc-back">${decorBack(payload.caption)}</div>
    </div></div>
    ${isGM() ? `<button type="button" class="hc-close" title="Закрыть у всех (Esc)">✕</button>
      <button type="button" class="hc-nav hc-prev" title="Предыдущая страница (←)">‹</button>
      <button type="button" class="hc-nav hc-next" title="Следующая страница (→)">›</button>
      <div class="hc-hint"><span class="hc-hint-flip">клик по карточке: перевернуть</span><span class="hc-hint-pages"> · ← → листать</span></div>` : ""}`;
  makeParticles(root.querySelector(".hc-snow"), opts.particles ?? "snow");
  const cardEl = root.querySelector(".hc-card"), back = root.querySelector(".hc-back");
  root._ready = setTimeout(() => {
    cardEl.classList.add("hc-ready");
    back.innerHTML = bookHTML(payload);
    back.classList.add("hc-back-stats");
    setPage(root._page, false);
    // опоздавший: сразу в текущем состоянии, без анимации переворота
    const cur = S().card;
    if (cur?.flipped ?? flipped) setFlipped(true);
  }, SPIN_MS + 50);
  cardEl.addEventListener("click", (ev) => { ev.stopPropagation(); if (isGM() && cardEl.classList.contains("hc-ready")) api.flip(!cardEl.classList.contains("hc-flipped")); });
  root.querySelector(".hc-close")?.addEventListener("click", (ev) => { ev.stopPropagation(); api.hide(); });
  root.querySelector(".hc-prev")?.addEventListener("click", (ev) => { ev.stopPropagation(); api.prevPage(); });
  root.querySelector(".hc-next")?.addEventListener("click", (ev) => { ev.stopPropagation(); api.nextPage(); });
  document.body.appendChild(root);
}

/* ───────────── API ───────────── */
let order = 0;
const api = {
  /** Показать карточку: актёр или его id. opts: { art, accent, particles } */
  async show(actorOrId, opts = {}) {
    if (!isGM()) return ui.notifications.warn("Показывать карточки может только мастер.");
    const actor = typeof actorOrId === "string" ? game.actors.get(actorOrId) : actorOrId;
    if (!actor) return ui.notifications.warn("Персонаж не найден. Выдели токен или выбери героя в пульте.");
    const meta = cardMeta(actor);
    const card = { name: actor.name, img: actor.img, art: opts.art ?? meta.art, accent: opts.accent ?? meta.accent };
    const stats = game.system?.id === "dnd5e" && actor.system?.abilities ? buildStats(actor) : null;
    const payload = { card, stats, pages: buildPages(actor, stats), caption: caption(), opts: { particles: opts.particles ?? game.settings.get(MID, "particles") } };
    await setS((s) => { s.card = { payload, flipped: false, page: 0, t: Date.now() }; });
  },
  showToken() { return api.show(canvas?.tokens?.controlled?.[0]?.actor ?? null); },
  next() { const h = heroes(); if (!h.length) return; return api.show(h[order++ % h.length]); },
  flip(f) { return setS((s) => { if (s.card) s.card.flipped = f ?? !s.card.flipped; }); },
  toggleFlip() { return api.flip(); },
  /** Открыть страницу оборота (с нуля). Карточка при этом переворачивается на оборот. */
  page(n) {
    return setS((s) => {
      if (!s.card) return;
      const count = s.card.payload.pages?.length || 1;
      s.card.page = Math.max(0, Math.min(count - 1, Number(n) || 0));
      s.card.flipped = true;
    });
  },
  nextPage() { const c = S().card; if (c) return api.page((c.page ?? 0) + (c.flipped ? 1 : 0)); },
  prevPage() { const c = S().card; if (c) return api.page((c.page ?? 0) - 1); },
  hide() { return setS((s) => { s.card = null; }); },
  panel() { return togglePanel(); },
  heroes,
  /** Что модуль возьмёт из листа: { stats, pages } */
  debug(a) { const actor = typeof a === "string" ? game.actors.get(a) : a; const stats = buildStats(actor); return { stats, pages: buildPages(actor, stats) }; }
};

/* ───────────── пульт мастера ───────────── */
let panel = null;
const AppV2 = foundry.applications.api.ApplicationV2;
class HeroPanel extends AppV2 {
  static DEFAULT_OPTIONS = { id: "hc-panel", classes: ["hc-panel-win"], window: { title: "✦ Карточки героев", resizable: true, minimizable: true }, position: { width: 440, height: 620 } };
  constructor() {
    super({ position: { ...(game.settings.get(MID, "panelPos") || {}), width: 440, height: Math.min(620, innerHeight - 80) } });
  }
  async _renderHTML() { return this.html(); }
  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.classList.add("hc-pn");
    if (!this._bound) {
      content.addEventListener("click", (e) => this.onClick(e));
      content.addEventListener("change", (e) => this.onChange(e));
      this._bound = true;
    }
  }
  setPosition(pos) { const r = super.setPosition(pos); try { if (this.rendered) game.settings.set(MID, "panelPos", { left: this.position.left, top: this.position.top }); } catch (e) { /* ok */ } return r; }
  _onClose() { panel = null; }

  html() {
    const c = S().card;
    const hs = heroes();
    const cur = c?.payload?.card?.name;
    const count = c?.payload?.pages?.length || 1, page = c?.page ?? 0;
    const live = c ? `на экранах: <b>${esc(cur)}</b> · ${c.flipped ? `оборот, стр. ${page + 1} из ${count}` : "лицо"}` : "на экранах игроков пусто";
    return `<div class="hc-pn-live">${live}</div>
      <div class="hc-pn-body">
      <div class="hc-pn-row">
        <button data-a="token" title="Карточка выделенного токена (любой актёр, хоть NPC)">◎ Токен</button>
        <button data-a="next">Следующий</button><button data-a="flip" ${c ? "" : "disabled"}>Перевернуть</button><button data-a="hide" ${c ? "" : "disabled"}>Убрать</button>
      </div>
      <div class="hc-pn-row">
        <button data-a="pprev" ${c && c.flipped && page > 0 ? "" : "disabled"}>‹ Страница назад</button>
        <button data-a="pnext" ${c && count > 1 && !(c.flipped && page >= count - 1) ? "" : "disabled"}>Страница вперёд ›</button>
      </div>
      <label class="hc-pn-lbl">Частицы вокруг карточки</label>
      <select data-set="particles">${Object.entries(PARTICLES).map(([k, v]) => `<option value="${k}" ${game.settings.get(MID, "particles") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label class="hc-pn-lbl">Персонажи игроков</label>
      ${hs.length ? `<div class="hc-pn-heroes">${hs.map((a) => { const m = cardMeta(a); return `<div class="hc-pn-hero ${cur === a.name ? "on" : ""}" style="--acc:${esc(m.accent)}">
          <button class="hc-pn-face" data-a="show" data-id="${a.id}" title="Показать всем"><img src="${esc(m.art || a.img)}" alt=""></button>
          <div class="hc-pn-hn">${esc(a.name)}</div>
          <div class="hc-pn-hb"><button data-a="art" data-id="${a.id}" title="Своя картинка карточки (16:9)">🖼</button><input type="color" data-color="${a.id}" value="${esc(m.accent)}" title="Цвет подсветки">${m.art ? `<button data-a="unart" data-id="${a.id}" title="Убрать свою картинку">✕</button>` : ""}</div>
        </div>`; }).join("")}</div>` : `<p class="hc-pn-hint">В мире нет персонажей игроков. Карточку любого актёра можно показать через «Токен».</p>`}
      <p class="hc-pn-hint">Без своей картинки на лице арт актёра целиком. Своя картинка лучше всего 16:9. Оборот листается как книжка: лист, все умения, заклинания, снаряжение.</p>
      </div>`;
  }

  async onChange(ev) {
    const t = ev.target;
    if (t.dataset.set === "particles") return game.settings.set(MID, "particles", t.value);
    if (t.dataset.color) { const m = { ...(game.settings.get(MID, "cards") || {}) }; m[t.dataset.color] = { ...(m[t.dataset.color] || {}), accent: t.value }; await game.settings.set(MID, "cards", m); this.render(); }
  }

  async onClick(ev) {
    const b = ev.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id;
    switch (a) {
      case "show": return api.show(id);
      case "token": return api.showToken();
      case "next": return api.next();
      case "flip": return api.flip();
      case "hide": return api.hide();
      case "pprev": return api.prevPage();
      case "pnext": return api.nextPage();
      case "art": {
        const FP = foundry.applications.apps.FilePicker.implementation;
        return new FP({ type: "image", callback: async (path) => { const m = { ...(game.settings.get(MID, "cards") || {}) }; m[id] = { ...(m[id] || {}), art: path }; await game.settings.set(MID, "cards", m); this.render(); } }).render(true);
      }
      case "unart": { const m = { ...(game.settings.get(MID, "cards") || {}) }; if (m[id]) { m[id] = { ...m[id] }; delete m[id].art; } await game.settings.set(MID, "cards", m); return this.render(); }
    }
  }
}
function togglePanel() {
  if (!isGM()) return;
  if (panel?.rendered) return panel.close();
  panel = new HeroPanel();
  return panel.render(true);
}

/* ───────────── регистрация ───────────── */
Hooks.once("init", () => {
  game.settings.register(MID, "state", { scope: "world", config: false, type: Object, default: {}, onChange: (v) => onState(v) });
  game.settings.register(MID, "cards", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MID, "particles", { scope: "world", config: false, type: String, default: "snow" });
  game.settings.register(MID, "panelPos", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MID, "caption", { name: "Надпись на карточке", hint: "Стоит на рубашке и в шапке карточки. Пусто: название мира.", scope: "world", config: true, type: String, default: "" });
  game.settings.register(MID, "fab", { name: "Кнопка пульта (✦)", hint: "Круглая кнопка в правом нижнем углу, открывает пульт карточек. Видна только мастеру.", scope: "client", config: true, type: Boolean, default: true, requiresReload: true });
  game.keybindings.register(MID, "panel", { name: "Пульт карточек героев", editable: [{ key: "KeyH", modifiers: ["Shift"] }], restricted: true, onDown: () => { togglePanel(); return true; } });
});

Hooks.once("ready", () => {
  PREV = {};
  onState(game.settings.get(MID, "state"));   // опоздавшие сразу видят текущую карточку
  const mod = game.modules.get(MID);
  if (mod) mod.api = api;
  globalThis.HeroCards = api;
  if (isGM() && game.settings.get(MID, "fab")) {
    const b = document.createElement("button");
    b.id = "hc-fab"; b.type = "button"; b.title = "Карточки героев (Shift+H)"; b.textContent = "✦";
    if (document.getElementById("es-fab")) b.classList.add("hc-fab-shift");   // рядом с кнопкой «Сцены» Кодекса
    b.addEventListener("click", togglePanel);
    document.body.append(b);
  }
  document.addEventListener("keydown", (ev) => {
    if (!isGM() || !document.getElementById(CARD_ID)) return;
    if (ev.key === "Escape") { ev.stopPropagation(); return api.hide(); }
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    const t = ev.target;
    if (t?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const c = S().card;
    if (!c?.flipped) return;
    ev.stopPropagation(); ev.preventDefault();
    ev.key === "ArrowRight" ? api.nextPage() : api.prevPage();
  }, true);
});
