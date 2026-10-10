/* ════════════════════════════════════════════════════════════════════
   Кодекс Эластрии · Сцена
   Пульт мастера: карточки героев, тексты (рассказ / сон / видение),
   эффекты и мир духов. Всё рассылается через скрытую настройку мира,
   поэтому игроки видят сцену без перезапуска сервера, а опоздавшие
   сразу попадают в текущий момент.
   Перенос и обобщение модуля Intro Cards («Духи Тайги»).
   ════════════════════════════════════════════════════════════════════ */

const MID = "elastria-wiki";
const CARD_ID = "es-card";
const TEXT_ID = "es-text";
const SPIN_MS = 1500;
const LEAVE_MS = 700;
const SPIRIT_SOUND = "(3)%20DnD%20dread%20(%D0%B7%D0%BB%D0%BE%D0%B2%D0%B5%D1%89%D0%B5%D0%B5%20%D0%BF%D1%80%D0%B5%D0%B4%D1%87%D1%83%D0%B2%D1%81%D1%82%D0%B2%D0%B8%D0%B5)/9cc91c4f9137255.mp3";

const ACCENTS = ["#d9b46a", "#8fd3f0", "#e89650", "#e2788c", "#a98cf0", "#7fd6a0", "#f0d27a", "#e06a5a"];
const PARTICLES = { snow: "Снег", ash: "Пепел", sparks: "Искры", petals: "Лепестки", stars: "Звёзды", none: "Без частиц" };
const MODES = { tale: "Рассказ", dream: "Сон", vision: "Видение" };
const FX = {
  shake1: "〰 Тряска · слабая", shake2: "〰 Тряска · средняя", shake3: "〰 Тряска · сильная", tremor: "≋ Дрожь (долгая)",
  frost: "❄ Лёд трескается", frostStrong: "❄ Лёд ломается", quake: "⛰ Землетрясение",
  lightning: "⚡ Молния", scourge: "☠ Плеть Кишина", divine: "✦ Свет богов"
};
const TRANS = { fade: "Затемнение", mist: "Туман", ash: "Пепел и угли", none: "Без перехода" };
const LOC_SOUND = `modules/${MID}/assets/sounds/perehod.ogg`;

const ABIL = [["str", "СИЛ"], ["dex", "ЛОВ"], ["con", "ТЕЛ"], ["int", "ИНТ"], ["wis", "МДР"], ["cha", "ХАР"]];
const ACTIVATION = { action: "Действие", bonus: "Бонус", reaction: "Реакция", special: "Особое", minute: "Минуты", hour: "Часы", legendary: "Легендарное" };
const RECOVERY = { sr: "кор. отдых", lr: "дл. отдых", day: "в день", dawn: "на рассвете", dusk: "на закате", recharge: "перезарядка", turn: "в ход", round: "в раунд" };
const SKIP_FEATURE = /увеличение характеристик|ability score|боев(ой|ые) стил|fighting style|владени|proficien|язык|language|хиты|hit points|подкласс|subclass|^особенност/i;

/* ───────────── утилиты ───────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const isGM = () => !!game.user?.isGM;
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const uid = () => foundry.utils.randomID(10);

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
function fmt(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>"); }

/* ───────────── состояние сцены (настройка мира) ───────────── */
function S() { return clone(game.settings.get(MID, "stage")) ?? {}; }
async function setS(mut) {
  if (!isGM()) return;
  const s = S(); mut(s);
  await game.settings.set(MID, "stage", s);
}
let PREV = {};

function visibleTo(to, u = game.user.id) { return !to || to === "all" || (Array.isArray(to) && to.includes(u)); }

function onStage(next) {
  next = clone(next) ?? {};
  const prev = PREV; PREV = clone(next);
  // карточка
  if (!next.card) removeCard();
  else if (next.card.t !== prev.card?.t) renderCard(next.card.payload, next.card.flipped);
  else if (!!next.card.flipped !== !!prev.card?.flipped) setFlipped(next.card.flipped);
  // текст
  const tx = next.text;
  if (!tx || !(isGM() || visibleTo(tx.to))) removeText();
  else if (tx.t !== prev.text?.t) renderText(tx, true);
  else if (tx.i !== prev.text?.i) renderText(tx, false);
  // эффект
  if (next.fx && next.fx.t !== prev.fx?.t && Date.now() - next.fx.t < 8000 && (isGM() || visibleTo(next.fx.to))) playFx(next.fx);
  panel?.rendered && panel.render();
}

/* ───────────── данные актёра ───────────── */
function pickFeatures(actor) {
  const feats = (actor.items?.contents ?? Array.from(actor.items ?? [])).filter((i) => i.type === "feat");
  const scored = feats.filter((i) => !SKIP_FEATURE.test(i.name)).map((i, idx) => {
    const acts = activitiesOf(i);
    const active = acts.some((a) => ["action", "bonus", "reaction"].includes(a?.activation?.type));
    const limited = !!num(i.system?.uses?.max);
    const fromClass = ["class", "subclass"].includes(i.system?.type?.value);
    return { i, idx, score: (active ? 3 : 0) + (limited ? 2 : 0) + (fromClass ? 1 : 0) };
  }).sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, 6).map(({ i }) => {
    const act = activitiesOf(i).find((a) => a?.activation?.type && a.activation.type !== "none");
    const max = num(i.system?.uses?.max);
    const per = i.system?.uses?.recovery?.[0]?.period;
    return { name: i.name, tag: ACTIVATION[act?.activation?.type] ?? "Пассивно", uses: max ? `${max}× ${RECOVERY[per] ?? ""}`.trim() : "", text: plainText(i.system?.description?.value) };
  });
}
function pickWeapons(actor) {
  return (actor.items?.contents ?? Array.from(actor.items ?? [])).filter((i) => i.type === "weapon" && i.system?.equipped !== false).slice(0, 2).map((i) => {
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
  const items = actor.items?.contents ?? Array.from(actor.items ?? []);
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

/* герои: персонажи игроков */
function heroes() {
  const all = game.actors?.contents ?? Array.from(game.actors ?? []);
  const owned = all.filter((a) => a.type === "character" && a.hasPlayerOwner);
  const list = owned.length ? owned : all.filter((a) => a.type === "character");
  return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
function cardMeta(actor) {
  const m = game.settings.get(MID, "stageCards")?.[actor.id] ?? {};
  const i = heroes().findIndex((a) => a.id === actor.id);
  return { art: m.art || "", accent: m.accent || ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length] };
}

/* ───────────── карточка ───────────── */
function statsHTML(st) {
  if (!st) return `<div class="es-stats-empty"><div class="es-back-ring"><span>✦</span></div><p>Это не персонаж: листа нет.</p></div>`;
  const cls = st.classes.map((c) => `${esc(c.name)} ${esc(c.level)}${c.sub ? ` · ${esc(c.sub)}` : ""}`).join(" / ");
  const tiles = [["КД", st.ac], ["Хиты", st.hp], ["Скорость", st.speed], ["Мастерство", st.prof]];
  if (st.spellDC) tiles.push(["СЛ заклинаний", st.spellDC]);
  return `<div class="es-stats">
    <div class="es-col es-col-left">
      <div class="es-eyebrow">Эластрия · лист персонажа</div>
      <div class="es-st-name">${esc(st.name)}</div>
      ${cls ? `<div class="es-st-class">${cls}</div>` : ""}
      ${st.race ? `<div class="es-st-race">${esc(st.race)}</div>` : ""}
      <div class="es-tiles">${tiles.map(([l, v]) => `<div class="es-tile"><div class="es-tile-v">${esc(v)}</div><div class="es-tile-l">${esc(l)}</div></div>`).join("")}</div>
      <div class="es-abils">${st.abilities.map((a) => `<div class="es-abil${a.save ? " es-save" : ""}"><div class="es-abil-l">${a.label}</div><div class="es-abil-m">${esc(a.mod)}</div><div class="es-abil-s">${esc(a.score)}</div></div>`).join("")}</div>
      ${st.weapons.length ? `<div class="es-weapons">${st.weapons.map((w) => `<div class="es-weapon"><span class="es-w-name">${esc(w.name)}</span>${w.hit ? `<span class="es-w-hit">${esc(w.hit)}</span>` : ""}${w.dmg ? `<span class="es-w-dmg">${esc(w.dmg)}</span>` : ""}</div>`).join("")}</div>` : ""}
    </div>
    <div class="es-col es-col-right">
      <div class="es-eyebrow">Ключевые умения</div>
      <div class="es-feats">${st.features.length ? st.features.map((f) => `<div class="es-feat"><div class="es-feat-head"><span class="es-feat-name">${esc(f.name)}</span><span class="es-feat-tag">${esc(f.tag)}</span>${f.uses ? `<span class="es-feat-uses">${esc(f.uses)}</span>` : ""}</div>${f.text ? `<div class="es-feat-text">${esc(f.text)}</div>` : ""}</div>`).join("") : `<div class="es-feat-text">Умения не найдены в листе.</div>`}</div>
    </div></div>`;
}
const DECOR_BACK = `<div class="es-decor"><div class="es-back-ring"><span>✦</span></div><div class="es-back-title">Эластрия</div></div>`;

function frontHTML(card, st) {
  if (card.art) return `<img src="${esc(card.art)}" alt="${esc(card.name)}"><div class="es-shine"></div>`;
  // портрет актёра: собираем карточку сами, чтобы лицо не обрезалось
  const cls = st?.classes?.map((c) => `${c.name} ${c.level}`).join(" / ") ?? "";
  return `<div class="es-pf">
      <div class="es-pf-bg" style="background-image:url('${esc(card.img)}')"></div>
      <div class="es-pf-img"><img src="${esc(card.img)}" alt=""></div>
      <div class="es-pf-txt">
        <div class="es-pf-eyebrow">Эластрия</div>
        <div class="es-pf-name">${esc(card.name)}</div>
        ${cls ? `<div class="es-pf-cls">${esc(cls)}</div>` : ""}${st?.race ? `<div class="es-pf-race">${esc(st.race)}</div>` : ""}
        <div class="es-pf-line"></div>
      </div>
    </div><div class="es-shine"></div>`;
}

function makeParticles(box, kind = "snow", count = 42) {
  if (kind === "none") return;
  box.dataset.kind = kind;
  for (let i = 0; i < count; i++) {
    const f = document.createElement("span");
    f.className = "es-flake";
    const size = (kind === "petals" ? 6 : kind === "sparks" ? 2 : 2) + Math.random() * (kind === "petals" ? 8 : 5);
    f.style.width = `${size}px`; f.style.height = `${kind === "petals" ? size * 0.7 : size}px`;
    f.style.left = `${Math.random() * 100}%`;
    f.style.opacity = (0.35 + Math.random() * 0.55).toFixed(2);
    f.style.setProperty("--dx", `${(Math.random() * 140 - 70).toFixed(0)}px`);
    f.style.animationDuration = `${(kind === "sparks" ? 3 + Math.random() * 4 : 6 + Math.random() * 8).toFixed(1)}s`;
    f.style.animationDelay = `${(-Math.random() * 12).toFixed(1)}s`;
    box.appendChild(f);
  }
}

function removeCard(immediate = false) {
  const el = document.getElementById(CARD_ID);
  if (!el) return;
  clearTimeout(el._ready);
  if (immediate) return el.remove();
  if (el.classList.contains("es-leaving")) return;
  el.classList.add("es-leaving");
  setTimeout(() => el.remove(), LEAVE_MS);
}
function setFlipped(f) { document.querySelector(`#${CARD_ID} .es-card`)?.classList.toggle("es-flipped", !!f); }

function renderCard(payload, flipped = false) {
  const { card, stats, opts = {} } = payload;
  removeCard(true);
  const root = document.createElement("div");
  root.id = CARD_ID;
  root.style.setProperty("--es-accent", card.accent);
  root.innerHTML = `
    <div class="es-backdrop"></div><div class="es-snow"></div>
    <div class="es-stage"><div class="es-card">
      <div class="es-face es-front">${frontHTML(card, stats)}</div>
      <div class="es-face es-back">${DECOR_BACK}</div>
    </div></div>
    ${isGM() ? `<button type="button" class="es-close" title="Закрыть у всех (Esc)">✕</button><div class="es-hint">клик по карточке: перевернуть</div>` : ""}`;
  makeParticles(root.querySelector(".es-snow"), opts.particles ?? "snow");
  const cardEl = root.querySelector(".es-card"), back = root.querySelector(".es-back");
  root._ready = setTimeout(() => {
    cardEl.classList.add("es-ready");
    back.innerHTML = statsHTML(stats);
    back.classList.add("es-back-stats");
    if (flipped) setFlipped(true);
  }, SPIN_MS + 50);
  cardEl.addEventListener("click", (ev) => { ev.stopPropagation(); if (isGM() && cardEl.classList.contains("es-ready")) stage.flip(!cardEl.classList.contains("es-flipped")); });
  root.querySelector(".es-close")?.addEventListener("click", (ev) => { ev.stopPropagation(); stage.hide(); });
  document.body.appendChild(root);
}

/* ───────────── тексты: рассказ / сон / видение ───────────── */
function steps(tx) { return [...(tx.paras ?? []), ...(tx.final ? [{ final: tx.final }] : [])]; }

let heartTimer = null;
function renderText(tx, fresh) {
  let el = document.getElementById(TEXT_ID);
  const st = steps(tx), i = Math.max(0, Math.min(tx.i ?? 0, st.length - 1));
  if (fresh || !el) {
    el?.remove();
    el = document.createElement("div");
    el.id = TEXT_ID;
    el.className = `es-m-${tx.mode || "tale"}`;
    el.innerHTML = `
      <div class="es-tx-bg"></div><div class="es-tx-fx"></div>
      ${tx.mode === "dream" ? `<div class="es-lid top"></div><div class="es-lid bot"></div>` : ""}
      <div class="es-tx-body">${tx.title ? `<div class="es-tx-title">${esc(tx.title)}</div>` : ""}<div class="es-tx-paras"></div></div>
      ${isGM() ? `<div class="es-tx-gm"><span class="es-tx-who"></span><button data-tx="prev">◀</button><button data-tx="next" class="prim">Дальше ▶</button><button data-tx="end">Завершить</button></div>` : ""}`;
    document.body.append(el);
    if (tx.mode === "vision") makeParticles(el.querySelector(".es-tx-fx"), "stars", 50);
    if (tx.mode === "dream") makeParticles(el.querySelector(".es-tx-fx"), "snow", 26);
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-tx]"); if (!b || !isGM()) return;
      if (b.dataset.tx === "next") stage.textStep(1); else if (b.dataset.tx === "prev") stage.textStep(-1); else stage.textEnd();
    });
    if (tx.mode === "dream") { heartbeat(); setTimeout(heartbeat, 900); }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
  }
  const box = el.querySelector(".es-tx-paras");
  box.innerHTML = st.map((p, k) => {
    if (k > i) return "";
    if (p.final) return `<div class="es-tx-final ${k === i ? "cur" : ""}">${fmt(p.final)}</div>`;
    return `<p class="${k === i ? "cur" : "old"}">${fmt(p)}</p>`;
  }).join("");
  box.lastElementChild?.scrollIntoView?.({ block: "end", behavior: fresh ? "auto" : "smooth" });
  const who = el.querySelector(".es-tx-who");
  if (who) who.textContent = `${i + 1} / ${st.length} · видят: ${whoLabel(tx.to)}`;
}
function removeText() {
  const el = document.getElementById(TEXT_ID);
  if (!el || el.classList.contains("out")) return;
  el.classList.remove("in"); el.classList.add("out");
  setTimeout(() => el.remove(), 1100);
}
function whoLabel(to) { return !to || to === "all" ? "все" : to.map((u) => game.users.get(u)?.name ?? "?").join(", "); }

let AC = null;
function heartbeat() {
  try {
    AC ??= new (window.AudioContext || window.webkitAudioContext)();
    const vol = 0.5 * (game.settings.get("core", "globalInterfaceVolume") ?? 0.5);
    for (const [dt, f] of [[0, 62], [0.22, 55]]) {
      const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + dt;
      o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 0.3);
    }
  } catch (e) { /* без звука */ }
  document.getElementById(TEXT_ID)?.classList.add("beat");
  setTimeout(() => document.getElementById(TEXT_ID)?.classList.remove("beat"), 260);
}

/* ───────────── эффекты ───────────── */
function crackSVG(n) {
  let paths = "";
  for (let k = 0; k < n; k++) {
    const side = k % 4; let x = side === 0 ? 0 : side === 1 ? 100 : Math.random() * 100, y = side === 2 ? 0 : side === 3 ? 100 : Math.random() * 100;
    let d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    const tx = 50 + (Math.random() - 0.5) * 30, ty = 50 + (Math.random() - 0.5) * 30;
    for (let s = 1; s <= 6; s++) { x += (tx - x) / (7 - s) + (Math.random() - 0.5) * 8; y += (ty - y) / (7 - s) + (Math.random() - 0.5) * 8; d += ` L${x.toFixed(1)},${y.toFixed(1)}`; }
    paths += `<path d="${d}"/>`;
  }
  return `<svg class="es-cracks" viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>`;
}
function shake(cls = "es-shake", ms = 900) {
  const t = document.getElementById("board") ?? document.body;
  t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls);
  setTimeout(() => t.classList.remove(cls), ms);
}

/* ───────────── проявление локации (как в Dark Souls) ───────────── */
function locOf(scene) {
  if (!scene) return null;
  const f = scene.getFlag?.(MID, "loc") ?? {};
  return { on: !!f.on, title: f.title || scene.navName || scene.name, sub: f.sub || "", sound: f.sound ?? LOC_SOUND };
}
function showLocation({ title = "", sub = "", sound = LOC_SOUND } = {}) {
  if (!title) return;
  document.getElementById("es-loc")?.remove();
  const el = document.createElement("div");
  el.id = "es-loc";
  el.innerHTML = `<div class="es-loc-band"></div><div class="es-loc-in">
      <div class="es-loc-title">${esc(title)}</div><div class="es-loc-line"></div>${sub ? `<div class="es-loc-sub">${esc(sub)}</div>` : ""}
    </div>`;
  document.body.append(el);
  if (sound) playSound(sound, 0.9);
  setTimeout(() => el.classList.add("out"), 5200);
  setTimeout(() => el.remove(), 7000);
}

/* ───────────── переходы между сценами ───────────── */
function transStyle() { return game.settings.get(MID, "stageTransition") || "fade"; }
function coverIn() {
  const st = transStyle();
  if (st === "none") return;
  let el = document.getElementById("es-trans");
  if (!el) { el = document.createElement("div"); el.id = "es-trans"; document.body.append(el); }
  el.className = `t-${st}`;
  el.innerHTML = st === "ash" ? `<div class="es-trans-fx"></div>` : st === "mist" ? `<div class="es-trans-fx"></div>` : "";
  if (st === "ash") makeParticles(el.querySelector(".es-trans-fx"), "sparks", 60);
  requestAnimationFrame(() => el.classList.add("in"));
}
function coverOut() {
  const el = document.getElementById("es-trans");
  if (!el) return false;
  setTimeout(() => { el.classList.add("reveal"); setTimeout(() => el.remove(), 2200); }, 350);
  return true;
}
let lastSceneId = null;
function onCanvasReady(cv) {
  const scene = cv?.scene;
  const hadCover = coverOut();
  if (!scene || !game.settings.get(MID, "stageLocAuto")) { lastSceneId = scene?.id ?? null; return; }
  const loc = locOf(scene);
  let seen = null; try { seen = sessionStorage.getItem("es-loc-last"); } catch (e) { /* ok */ }
  const changed = scene.id !== lastSceneId && scene.id !== seen;
  lastSceneId = scene.id;
  try { sessionStorage.setItem("es-loc-last", scene.id); } catch (e) { /* ok */ }
  if (loc?.on && changed) setTimeout(() => showLocation(loc), hadCover ? 1300 : 600);
}
function playFx(fx) {
  if (fx.type === "location") return showLocation(fx.data ?? {});
  if (/^shake[123]$/.test(fx.type)) { shake(`es-shake-${fx.type.slice(-1)}`, 1200); return fx.sound && playSound(fx.sound); }
  if (fx.type === "tremor") { shake("es-tremor", 4200); return fx.sound && playSound(fx.sound); }
  const el = document.createElement("div");
  el.className = `es-fx es-fx-${fx.type}`;
  let life = 3200;
  if (fx.type === "frost" || fx.type === "frostStrong") { el.innerHTML = `<div class="es-frost"></div>${crackSVG(fx.type === "frostStrong" ? 8 : 4)}`; shake(fx.type === "frostStrong" ? "es-shake-hard" : "es-shake"); }
  else if (fx.type === "quake") { el.innerHTML = `<div class="es-dust"></div>`; shake("es-shake-hard"); setTimeout(() => shake("es-shake"), 700); }
  else if (fx.type === "lightning") { el.innerHTML = `<div class="es-flash"></div>`; life = 1600; }
  else if (fx.type === "scourge") { el.innerHTML = `<div class="es-scourge"></div><div class="es-veins"></div>`; life = 4200; }
  else if (fx.type === "divine") { el.innerHTML = `<div class="es-rays"></div><div class="es-glow"></div>`; life = 4200; }
  if (fx.sound) playSound(fx.sound);
  document.body.append(el);
  setTimeout(() => el.classList.add("out"), life - 900);
  setTimeout(() => el.remove(), life);
}
function playSound(src, volume = 0.85) {
  if (!src) return;
  try { (foundry?.audio?.AudioHelper ?? globalThis.AudioHelper)?.play({ src, volume, autoplay: true, loop: false }, false); }
  catch (e) { console.warn(`${MID} | звук`, e); }
}

/* ───────────── мир духов (флаг сцены, как у старого макроса) ───────────── */
const SPIRIT_FRAG = `
  varying vec2 vTextureCoord;
  uniform sampler2D uSampler;
  void main() {
    vec4 c = texture2D(uSampler, vTextureCoord);
    float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    vec3 s = mix(c.rgb, vec3(g), 0.75) * vec3(0.85, 0.95, 1.12);
    gl_FragColor = vec4(s, c.a);
  }`;
const spirit = { filter: null };
function spiritEnter(cmd, instant = false) {
  spiritCleanup();
  try {
    const stg = canvas?.app?.stage;
    if (stg && globalThis.PIXI?.Filter) { spirit.filter = new PIXI.Filter(undefined, SPIRIT_FRAG); stg.filters = [...(stg.filters ?? []), spirit.filter]; }
    else document.getElementById("board")?.classList.add("es-spirit-css");
  } catch (e) { document.getElementById("board")?.classList.add("es-spirit-css"); }
  const fog = document.createElement("div");
  fog.id = "es-spirit";
  document.body.append(fog);
  if (!instant) { fog.classList.add("enter"); playSound(cmd?.soundPath); shake("es-shake"); }
}
function spiritExit(cmd) {
  const fog = document.getElementById("es-spirit");
  if (fog) { fog.classList.add("leave"); setTimeout(() => fog.remove(), 1500); }
  if (cmd?.soundPath) playSound(cmd.soundPath, 0.6);
  setTimeout(() => spiritCleanup(true), 600);
}
function spiritCleanup(keepFog = false) {
  try { const stg = canvas?.app?.stage; if (stg?.filters && spirit.filter) stg.filters = stg.filters.filter((f) => f !== spirit.filter); } catch (e) { /* ok */ }
  spirit.filter = null;
  document.getElementById("board")?.classList.remove("es-spirit-css");
  if (!keepFog) document.getElementById("es-spirit")?.remove();
}
function spiritScene() { return canvas?.scene ?? game.scenes?.active ?? null; }
function spiritOn() { return spiritScene()?.getFlag?.("world", "spiritWorld")?.action === "enter"; }

/* ───────────── API ───────────── */
let order = 0;
const stage = {
  /** Показать карточку: актёр, его id или выделенный токен */
  async show(actorOrId, opts = {}) {
    if (!isGM()) return ui.notifications.warn("Показывать карточки может только мастер.");
    const actor = typeof actorOrId === "string" ? game.actors.get(actorOrId) : actorOrId;
    if (!actor) return ui.notifications.warn("Персонаж не найден. Выдели токен или выбери героя в пульте.");
    const meta = cardMeta(actor);
    const card = { name: actor.name, img: actor.img, art: opts.art ?? meta.art, accent: opts.accent ?? meta.accent };
    const payload = { card, stats: actor.type === "character" || actor.system?.abilities ? buildStats(actor) : null, opts: { particles: opts.particles ?? game.settings.get(MID, "stageParticles") } };
    await setS((s) => { s.card = { payload, flipped: false, t: Date.now() }; });
  },
  showToken() { return stage.show(canvas?.tokens?.controlled?.[0]?.actor ?? null); },
  next() { const h = heroes(); if (!h.length) return; stage.show(h[order++ % h.length]); },
  flip(f) { return setS((s) => { if (s.card) s.card.flipped = f ?? !s.card.flipped; }); },
  toggleFlip() { return stage.flip(); },
  hide() { return setS((s) => { s.card = null; }); },

  /** Текст: { title, mode: "tale"|"dream"|"vision", paras: [], final, to: "all"|[userId] } */
  text(t) {
    const paras = Array.isArray(t.paras) ? t.paras : String(t.text ?? "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    return setS((s) => { s.text = { title: t.title ?? "", mode: t.mode ?? "tale", paras, final: t.final ?? "", to: t.to ?? "all", i: 0, t: Date.now(), libId: t.id ?? null }; });
  },
  textStep(d) { return setS((s) => { if (!s.text) return; s.text.i = Math.max(0, Math.min(steps(s.text).length - 1, (s.text.i ?? 0) + d)); }); },
  textEnd() { return setS((s) => { s.text = null; }); },

  fx(type, opts = {}) { return setS((s) => { s.fx = { type, t: Date.now(), to: opts.to ?? "all", sound: opts.sound ?? "" }; }); },
  /** Название локации всем: ElastriaStage.location("Анор Лондо", "Город богов") */
  location(title, sub = "", o = {}) { return setS((s) => { s.fx = { type: "location", t: Date.now(), to: o.to ?? "all", data: { title, sub, sound: o.sound ?? LOC_SOUND } }; }); },
  /** Показать название текущей (или указанной) сцены по её настройкам */
  showSceneLocation(scene = canvas?.scene) { const l = locOf(scene); if (l) return stage.location(l.title, l.sub, { sound: l.sound }); },
  iceCrack(o = {}) { return stage.fx(o.strength === "strong" ? "frostStrong" : "frost", o); },

  async spiritEnter(o = {}) { const sc = spiritScene(); if (isGM() && sc) await sc.setFlag("world", "spiritWorld", { action: "enter", t: Date.now(), soundPath: o.sound ?? SPIRIT_SOUND }); },
  async spiritExit(o = {}) { const sc = spiritScene(); if (isGM() && sc) await sc.setFlag("world", "spiritWorld", { action: "exit", t: Date.now(), soundPath: o.sound ?? SPIRIT_SOUND }); },
  spiritToggle(o = {}) { return spiritOn() ? stage.spiritExit(o) : stage.spiritEnter(o); },

  panel() { return togglePanel(); },
  heroes, debug: (a) => buildStats(typeof a === "string" ? game.actors.get(a) : a)
};

/* ───────────── пульт мастера ───────────── */
let panel = null;
const AppV2 = foundry.applications.api.ApplicationV2;
class StagePanel extends AppV2 {
  static DEFAULT_OPTIONS = { id: "es-stage-panel", classes: ["es-panel-win"], window: { title: "✦ Сцена Эластрии · пульт", resizable: true, minimizable: true }, position: { width: 470, height: 720 } };
  constructor() {
    super({ position: { ...(game.settings.get(MID, "stagePanelPos") || {}), width: 470, height: Math.min(760, innerHeight - 80) } });
    this.tab = "heroes";
    this.draft = game.settings.get(MID, "stageDraft") || { title: "", mode: "tale", text: "", final: "", to: "all" };
  }
  async _renderHTML() { return this.html(); }
  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.classList.add("es-pn");
    if (!this._bound) {
      content.addEventListener("click", (e) => this.onClick(e));
      content.addEventListener("input", (e) => this.onInput(e));
      content.addEventListener("change", (e) => this.onInput(e, true));
      this._bound = true;
    }
  }
  setPosition(pos) { const r = super.setPosition(pos); try { if (this.rendered) game.settings.set(MID, "stagePanelPos", { left: this.position.left, top: this.position.top }); } catch (e) { /* ok */ } return r; }
  _onClose() { panel = null; }

  html() {
    const s = S();
    const tabs = [["heroes", "Герои"], ["texts", "Тексты"], ["fx", "Эффекты"], ["loc", "Локации"]];
    let body = "";
    if (this.tab === "heroes") body = this.heroesHTML(s);
    else if (this.tab === "texts") body = this.textsHTML(s);
    else if (this.tab === "loc") body = this.locHTML();
    else body = this.fxHTML();
    const live = [s.card ? `карточка: <b>${esc(s.card.payload.card.name)}</b>` : "", s.text ? `текст: <b>${esc(s.text.title || "без названия")}</b> ${(s.text.i ?? 0) + 1}/${steps(s.text).length} · видят: ${esc(whoLabel(s.text.to))}` : "", spiritOn() ? "<b>мир духов</b>" : ""].filter(Boolean);
    return `<nav class="es-pn-tabs">${tabs.map(([id, t]) => `<button data-tab="${id}" class="${this.tab === id ? "on" : ""}">${t}</button>`).join("")}</nav>
      <div class="es-pn-live">${live.length ? `идёт: ${live.join(" · ")}` : "на экранах игроков пусто"}</div>
      <div class="es-pn-body">${body}</div>`;
  }

  heroesHTML(s) {
    const hs = heroes();
    const cur = s.card?.payload?.card?.name;
    return `<div class="es-pn-row">
        <button data-a="token" title="Карточка выделенного токена (любой актёр, хоть NPC)">◎ Токен</button>
        <button data-a="next">Следующий</button><button data-a="flip" ${s.card ? "" : "disabled"}>Перевернуть</button><button data-a="hide" ${s.card ? "" : "disabled"}>Убрать</button>
      </div>
      <label class="es-pn-lbl">Частицы вокруг карточки</label>
      <select data-set="particles">${Object.entries(PARTICLES).map(([k, v]) => `<option value="${k}" ${game.settings.get(MID, "stageParticles") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label class="es-pn-lbl">Персонажи игроков</label>
      ${hs.length ? `<div class="es-pn-heroes">${hs.map((a) => { const m = cardMeta(a); return `<div class="es-pn-hero ${cur === a.name ? "on" : ""}" style="--acc:${m.accent}">
          <button class="es-pn-face" data-a="show" data-id="${a.id}" title="Показать всем"><img src="${esc(m.art || a.img)}" alt=""></button>
          <div class="es-pn-hn">${esc(a.name)}</div>
          <div class="es-pn-hb"><button data-a="art" data-id="${a.id}" title="Своя картинка карточки (16:9)">🖼</button><input type="color" data-color="${a.id}" value="${m.accent}" title="Цвет подсветки">${m.art ? `<button data-a="unart" data-id="${a.id}" title="Убрать свою картинку">✕</button>` : ""}</div>
        </div>`; }).join("")}</div>` : `<p class="es-pn-hint">В мире нет персонажей игроков. Карточку любого актёра можно показать через «Токен».</p>`}
      <p class="es-pn-hint">Без своей картинки карточка собирается из портрета актёра. Своя картинка лучше всего 16:9. Оборот — лист персонажа из dnd5e.</p>`;
  }

  textsHTML(s) {
    const lib = game.settings.get(MID, "stageLib") || [];
    const d = this.draft, ps = game.users.filter((u) => !u.isGM);
    return `${s.text ? `<div class="es-pn-row live"><button data-a="tprev">◀ Назад</button><button data-a="tnext" class="prim">Дальше ▶</button><button data-a="tend">Завершить</button></div>` : ""}
      <label class="es-pn-lbl">Библиотека</label>
      <div class="es-pn-lib">${lib.length ? lib.map((t) => `<div class="es-pn-li ${d.id === t.id ? "on" : ""}"><button data-a="load" data-id="${t.id}"><span class="es-pn-mode m-${t.mode}">${MODES[t.mode] ?? ""}</span>${esc(t.title || "Без названия")}</button><button data-a="play" data-id="${t.id}" title="Показать сразу">▶</button></div>`).join("") : `<p class="es-pn-hint">Пусто. Напиши текст ниже и нажми «В библиотеку».</p>`}</div>
      <label class="es-pn-lbl">Текст ${d.id ? "(из библиотеки)" : "(черновик)"}</label>
      <input type="text" data-d="title" placeholder="Название (видно игрокам сверху, можно пусто)" value="${esc(d.title)}">
      <div class="es-pn-row">
        <select data-d="mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${d.mode === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select data-d="to"><option value="all">Видят все</option>${ps.map((u) => `<option value="${u.id}" ${Array.isArray(d.to) && d.to[0] === u.id ? "selected" : ""}>Только ${esc(u.name)}${u.character ? ` (${esc(u.character.name)})` : ""}</option>`).join("")}</select>
      </div>
      <textarea data-d="text" rows="10" placeholder="Абзацы разделяй пустой строкой. *курсив*, **жирный**.">${esc(d.text)}</textarea>
      <input type="text" data-d="final" placeholder="Финальная фраза крупно (необязательно)" value="${esc(d.final)}">
      <div class="es-pn-row"><button data-a="tshow" class="prim">Показать сейчас</button><button data-a="tsave">${d.id ? "Сохранить" : "В библиотеку"}</button>${d.id ? `<button data-a="tdel" class="ghost">Удалить</button><button data-a="tnew" class="ghost">Новый</button>` : ""}</div>
      <p class="es-pn-hint"><b>Рассказ</b> — тёмная завеса и текст. <b>Сон</b> — веки смыкаются, два удара сердца, мир открывается в дымке. <b>Видение</b> — золотой свет и звёзды. Игроки листать не могут, листаешь ты.</p>`;
  }

  locHTML() {
    const scenes = (game.scenes?.contents ?? Array.from(game.scenes ?? [])).slice().sort((a, b) => (b.active - a.active) || (a.navOrder ?? a.sort ?? 0) - (b.navOrder ?? b.sort ?? 0));
    return `<label class="es-pn-lbl">Переход между картами</label>
      <select data-set="trans">${Object.entries(TRANS).map(([k, v]) => `<option value="${k}" ${transStyle() === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label class="es-pn-check"><input type="checkbox" data-set="locAuto" ${game.settings.get(MID, "stageLocAuto") ? "checked" : ""}> Проявлять название локации при входе на сцену</label>
      <p class="es-pn-hint">Как в Dark Souls: название проступает по центру со звуком. Включается галочкой у нужных сцен ниже. Название по умолчанию — имя сцены в навигации.</p>
      <label class="es-pn-lbl">Сцены</label>
      <div class="es-pn-scenes">${scenes.map((sc) => { const l = locOf(sc); return `<div class="es-pn-sc ${sc.active ? "act" : ""}" data-scene="${sc.id}">
          <div class="es-pn-sc-h"><label><input type="checkbox" data-loc="on" ${l.on ? "checked" : ""}> ${esc(sc.name)}${sc.active ? " <em>· активна</em>" : ""}</label><button data-a="locplay" data-id="${sc.id}" title="Показать название всем сейчас">▶</button></div>
          <input type="text" data-loc="title" placeholder="${esc(sc.navName || sc.name)}" value="${esc(sc.getFlag?.(MID, "loc")?.title ?? "")}">
          <input type="text" data-loc="sub" placeholder="Подзаголовок (необязательно)" value="${esc(l.sub)}">
        </div>`; }).join("") || `<p class="es-pn-hint">В мире нет сцен.</p>`}</div>
      <p class="es-pn-hint">Звук — твой «переход». Свой звук на сцену: <code>scene.setFlag("${MID}", "loc", {...scene.getFlag("${MID}", "loc"), sound: "путь.ogg"})</code></p>`;
  }

  fxHTML() {
    const on = spiritOn();
    return `<div class="es-pn-fx">${Object.entries(FX).map(([k, v]) => `<button data-a="fx" data-fx="${k}">${v}</button>`).join("")}</div>
      <label class="es-pn-lbl">Мир духов</label>
      <div class="es-pn-row"><button data-a="spirit" class="${on ? "on" : "prim"}">${on ? "◐ Вернуться в мир живых" : "◑ Войти в мир духов"}</button></div>
      <p class="es-pn-hint">Обесцвечивает карту и наводит дымку у всех на текущей сцене. Работает от того же флага сцены, что старый макрос «Мир духов», так что он тоже продолжит работать. Игрок, зашедший позже, сразу окажется в мире духов.</p>`;
  }

  saveDraft() { game.settings.set(MID, "stageDraft", this.draft); }
  draftToText() { return { ...this.draft, paras: String(this.draft.text || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) }; }

  async onInput(ev, changed) {
    const t = ev.target;
    if (t.dataset.d) { this.draft[t.dataset.d] = t.dataset.d === "to" ? (t.value === "all" ? "all" : [t.value]) : t.value; this.saveDraft(); return; }
    if (changed && t.dataset.set === "particles") return game.settings.set(MID, "stageParticles", t.value);
    if (changed && t.dataset.set === "trans") return game.settings.set(MID, "stageTransition", t.value);
    if (changed && t.dataset.set === "locAuto") return game.settings.set(MID, "stageLocAuto", t.checked);
    if (changed && t.dataset.loc) {
      const sc = game.scenes.get(t.closest("[data-scene]")?.dataset.scene); if (!sc) return;
      const cur = { ...(sc.getFlag(MID, "loc") ?? {}) };
      cur[t.dataset.loc] = t.type === "checkbox" ? t.checked : t.value;
      return sc.setFlag(MID, "loc", cur);
    }
    if (changed && t.dataset.color) { const m = { ...(game.settings.get(MID, "stageCards") || {}) }; m[t.dataset.color] = { ...(m[t.dataset.color] || {}), accent: t.value }; await game.settings.set(MID, "stageCards", m); this.render(); }
  }

  async onClick(ev) {
    const b = ev.target.closest("[data-tab],[data-a]"); if (!b) return;
    if (b.dataset.tab) { this.tab = b.dataset.tab; return this.render(); }
    const a = b.dataset.a, id = b.dataset.id;
    const lib = () => game.settings.get(MID, "stageLib") || [];
    switch (a) {
      case "show": return stage.show(id);
      case "token": return stage.showToken();
      case "next": return stage.next();
      case "flip": return stage.flip();
      case "hide": return stage.hide();
      case "art": {
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        return new FP({ type: "image", callback: async (path) => { const m = { ...(game.settings.get(MID, "stageCards") || {}) }; m[id] = { ...(m[id] || {}), art: path }; await game.settings.set(MID, "stageCards", m); this.render(); } }).render(true);
      }
      case "unart": { const m = { ...(game.settings.get(MID, "stageCards") || {}) }; if (m[id]) delete m[id].art; await game.settings.set(MID, "stageCards", m); return this.render(); }
      case "tshow": return stage.text(this.draftToText());
      case "tprev": return stage.textStep(-1);
      case "tnext": return stage.textStep(1);
      case "tend": return stage.textEnd();
      case "tsave": {
        const l = lib(), d = { ...this.draft, id: this.draft.id || uid() };
        const i = l.findIndex((x) => x.id === d.id); i >= 0 ? (l[i] = d) : l.push(d);
        this.draft = d; this.saveDraft();
        await game.settings.set(MID, "stageLib", l);
        ui.notifications.info(`«${d.title || "Без названия"}» в библиотеке`);
        return this.render();
      }
      case "tdel": { await game.settings.set(MID, "stageLib", lib().filter((x) => x.id !== this.draft.id)); this.draft = { title: "", mode: "tale", text: "", final: "", to: "all" }; this.saveDraft(); return this.render(); }
      case "tnew": this.draft = { title: "", mode: "tale", text: "", final: "", to: "all" }; this.saveDraft(); return this.render();
      case "load": { const t = lib().find((x) => x.id === id); if (t) { this.draft = clone(t); this.saveDraft(); } return this.render(); }
      case "play": { const t = lib().find((x) => x.id === id); if (!t) return; this.draft = clone(t); this.saveDraft(); return stage.text(this.draftToText()); }
      case "fx": return stage.fx(b.dataset.fx);
      case "locplay": return stage.showSceneLocation(game.scenes.get(id));
      case "spirit": await stage.spiritToggle(); return setTimeout(() => this.render(), 200);
    }
  }
}
function togglePanel() {
  if (!isGM()) return;
  if (panel?.rendered) return panel.close();
  panel = new StagePanel();
  return panel.render(true);
}

/* стартовая библиотека: пара примеров под Эластрию, их можно удалить */
const STARTER = [
  { id: "ex-dream", title: "Сон о Пантеоне", mode: "dream", to: "all", final: "Искра помнит тебя",
    text: "Ты засыпаешь, и тишина становится глубже, чем должна быть.\n\nНад тобой не потолок, а небо, в котором двадцать четыре звезды горят слишком близко. Одна из них смотрит прямо на тебя.\n\nГолос, похожий на треск костра и на шёпот прибоя одновременно: *«Ты носишь мою Искру. Не растрать её на пустое»*." },
  { id: "ex-vision", title: "Цепи под землёй", mode: "vision", to: "all", final: "Кишин просыпается",
    text: "Земля под ногами вздрагивает, и на мгновение ты видишь сквозь неё.\n\nГлубоко внизу, в темноте, которая старше мира, натянуты цепи. Каждое звено — клятва богов.\n\nОдно звено лопается. Где-то там, внизу, *кто-то улыбается*." }
];

/* ───────────── регистрация ───────────── */
Hooks.once("init", () => {
  game.settings.register(MID, "stage", { scope: "world", config: false, type: Object, default: {}, onChange: (v) => onStage(v) });
  game.settings.register(MID, "stageLib", { scope: "world", config: false, type: Array, default: STARTER });
  game.settings.register(MID, "stageCards", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MID, "stageParticles", { scope: "world", config: false, type: String, default: "snow" });
  game.settings.register(MID, "stageTransition", { scope: "world", config: false, type: String, default: "fade" });
  game.settings.register(MID, "stageLocAuto", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(MID, "stageDraft", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MID, "stagePanelPos", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MID, "stageFab", { name: "Кнопка пульта сцены (✦)", hint: "Круглая кнопка в правом нижнем углу, открывает пульт сцены. Видна только мастеру.", scope: "client", config: true, type: Boolean, default: true, onChange: () => location.reload() });
  game.keybindings.register(MID, "stagePanel", { name: "Пульт сцены Эластрии", editable: [{ key: "KeyE", modifiers: ["Shift"] }], restricted: true, onDown: () => { togglePanel(); return true; } });
});

Hooks.once("ready", () => {
  PREV = {};
  onStage(game.settings.get(MID, "stage"));   // опоздавшие сразу видят текущую сцену
  const mod = game.modules.get(MID);
  if (mod) mod.api = Object.assign(mod.api ?? {}, { stage });
  globalThis.ElastriaStage = stage;
  if (globalThis.ElastriaCodex) globalThis.ElastriaCodex.stage = stage;
  if (isGM() && game.settings.get(MID, "stageFab")) {
    const b = document.createElement("button");
    b.id = "es-fab"; b.type = "button"; b.title = "Сцена Эластрии (Shift+E)"; b.textContent = "✦";
    b.addEventListener("click", togglePanel);
    document.body.append(b);
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !isGM()) return;
    if (document.getElementById(CARD_ID)) { ev.stopPropagation(); stage.hide(); }
    else if (document.getElementById(TEXT_ID)) { ev.stopPropagation(); stage.textEnd(); }
  }, true);
});

// Мир духов: флаг сцены world.spiritWorld (как в макросе «Мир духов»)
Hooks.on("updateScene", (scene, changes) => {
  const cmd = changes?.flags?.world?.spiritWorld;
  if (cmd === undefined) return;
  if (canvas?.scene && scene.id !== canvas.scene.id) return;
  if (cmd?.action === "enter") spiritEnter(cmd); else if (cmd?.action === "exit") spiritExit(cmd);
  panel?.rendered && panel.render();
});
Hooks.on("canvasTearDown", () => { try { coverIn(); } catch (e) { console.warn(e); } });
Hooks.on("canvasReady", (cv) => {
  try { onCanvasReady(cv); } catch (e) { console.warn(e); }
  spiritCleanup();
  if (cv?.scene?.getFlag?.("world", "spiritWorld")?.action === "enter") spiritEnter(null, true);
});
