/*
 * Кадры боя — на каждое действие в чате dnd5e появляется кадр на экране ведущего:
 * портрет действующего, иконка оружия/заклинания, портреты целей и итог броска.
 * Источник — сообщения чата (createChatMessage / updateChatMessage), поэтому работает
 * и для бросков игроков, и с midi-qol (объединённые карточки), и с Dice So Nice.
 */
const MID = "action-splash";
const S = (k) => game.settings.get(MID, k);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const loc = (k) => (k ? game.i18n.localize(k) : "");

/* ================================================================ настройки */

Hooks.once("init", () => {
  const reg = (k, o) => game.settings.register(MID, k, { scope: "world", config: true, ...o });
  reg("audience", { name: "Кому показывать кадры", type: String, default: "gm",
    choices: { gm: "Только ведущему (для стрима)", all: "Всем игрокам", off: "Выключено" } });
  reg("layout", { name: "Вид кадра", type: String, default: "big", choices: { big: "Крупный — в центре, на пол-экрана", compact: "Компактный баннер" } });
  reg("position", { name: "Где на экране (для компактного)", type: String, default: "top", choices: { top: "Сверху", center: "По центру", bottom: "Снизу" } });
  reg("duration", { name: "Сколько секунд держать кадр", type: Number, default: 3.5, range: { min: 1.5, max: 10, step: 0.5 } });
  reg("portrait", { name: "Картинка персонажа", type: String, default: "portrait", choices: { portrait: "Портрет актёра", token: "Изображение токена" } });
  reg("bg", { name: "Фон кадра", type: String, default: "scene", choices: { scene: "Карта текущей сцены (место действия)", sceneFull: "Карта сцены целиком", dark: "Тёмный" } });
  reg("bgZoom", { name: "Приближение карты на фоне", hint: "Чем больше, тем крупнее показано место, где стоят участники.", type: Number, default: 3, range: { min: 1, max: 8, step: 0.5 } });
  reg("waitDice", { name: "Ждать, пока докатятся кубики Dice So Nice", type: Boolean, default: true });
  reg("scale", { name: "Размер кадра", type: Number, default: 1, range: { min: 0.6, max: 1.6, step: 0.1 } });
  for (const [k, n] of [["usage", "атаки и заклинания (объявление)"], ["attack", "броски атаки"], ["damage", "урон и лечение"],
    ["save", "спасброски"], ["check", "проверки и навыки"], ["initiative", "инициатива"], ["death", "спасброски от смерти"]]) {
    reg(`ev-${k}`, { name: `Показывать: ${n}`, type: Boolean, default: true });
  }
  reg("npcRolls", { name: "Показывать броски монстров (NPC)", hint: "Если выключено — кадры только для персонажей игроков.", type: Boolean, default: true });
});

/* ================================================================ разбор сообщения */

const seen = new Map(); // messageId → число уже показанных бросков

function wantsDisplay(message) {
  const a = S("audience");
  if (a === "off") return false;
  if (a === "gm" && !game.user.isGM) return false;
  if (a === "all" && !message.visible) return false;
  return true;
}

function portraitOf(actor, tokenDoc) {
  const tok = tokenDoc?.texture?.src ?? actor?.prototypeToken?.texture?.src;
  return S("portrait") === "token" ? (tok || actor?.img) : (actor?.img && !actor.img.includes("mystery-man") ? actor.img : tok || actor?.img);
}

function actorOf(message) {
  const sp = message.speaker ?? {};
  const scene = game.scenes.get(sp.scene);
  const tokenDoc = sp.token ? scene?.tokens.get(sp.token) : null;
  const actor = tokenDoc?.actor ?? game.actors.get(sp.actor) ?? null;
  return { actor, tokenDoc, name: tokenDoc?.name ?? actor?.name ?? sp.alias ?? "" };
}

function targetsOf(message) {
  const out = [];
  const add = (doc) => {
    const actor = doc?.actor ?? doc;
    if (!actor || out.some(t => t.uuid === (doc.uuid ?? actor.uuid))) return;
    const td = doc.documentName === "Token" ? doc : doc.document?.documentName === "Token" ? doc.document : null;
    out.push({ uuid: doc.uuid ?? actor.uuid, name: doc.name ?? actor.name, pos: tokenPos(td), img: portraitOf(actor, doc.document ?? (doc.documentName === "Token" ? doc : null)),
      ac: actor.system?.attributes?.ac?.value, hidden: doc.hidden ?? doc.document?.hidden });
  };
  for (const t of message.flags?.dnd5e?.targets ?? []) {
    const d = t.uuid ? fromUuidSync(t.uuid) : null;
    if (d) add(d); else out.push({ uuid: t.uuid, name: t.name, img: t.img, ac: t.ac });
  }
  const midi = message.flags?.["midi-qol"];
  for (const u of midi?.targetUuids ?? midi?.targets ?? []) { const d = typeof u === "string" ? fromUuidSync(u) : null; if (d) add(d); }
  if (!out.length) for (const t of message.author?.targets ?? []) add(t.document ?? t);
  return out.slice(0, 5);
}

function tokenPos(td) {
  if (!td || td.parent?.id !== canvas.scene?.id) return null;
  const g = canvas.scene.grid.size;
  return { x: td.x + (td.width * g) / 2, y: td.y + (td.height * g) / 2 };
}

/** Фон кадра: карта сцены, сфокусированная на участниках. */
function backdrop(ev) {
  const mode = S("bg");
  const src = canvas.scene?.background?.src;
  if (mode === "dark" || !src) return null;
  if (mode === "sceneFull") return { src, size: "cover", pos: "center" };
  const pts = [ev.actorPos, ...ev.targets.map(t => t.pos)].filter(Boolean);
  if (!pts.length) return { src, size: "cover", pos: "center" };
  const d = canvas.dimensions;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const px = Math.clamp(((cx - d.sceneX) / d.sceneWidth) * 100, 0, 100), py = Math.clamp(((cy - d.sceneY) / d.sceneHeight) * 100, 0, 100);
  return { src, size: `${Math.round(S("bgZoom") * 100)}% auto`, pos: `${px.toFixed(1)}% ${py.toFixed(1)}%` };
}

function itemOf(message) {
  try {
    const act = message.getAssociatedActivity?.();
    const item = act?.item ?? message.getAssociatedItem?.();
    if (item) return { item, activity: act };
  } catch (e) { /* старые сообщения */ }
  const f = message.flags?.dnd5e ?? {};
  const uuid = f.item?.uuid ?? f.use?.itemUuid ?? message.flags?.["midi-qol"]?.itemUuid;
  const item = uuid ? fromUuidSync(uuid) : null;
  return { item, activity: null };
}

const VERB = { weapon: "атакует", spell: "сотворяет", consumable: "использует", feat: "применяет", tool: "использует", equipment: "использует" };
const abilityLabel = (id) => loc(CONFIG.DND5E.abilities?.[id]?.label) || id || "";
const skillLabel = (id) => loc(CONFIG.DND5E.skills?.[id]?.label) || id || "";

/** Разобрать один бросок (или объявление без бросков) в «кадр». */
function buildEvent(message, roll, kindHint) {
  const f = message.flags?.dnd5e ?? {};
  const rf = f.roll ?? {};
  const { actor, tokenDoc, name } = actorOf(message);
  if (!actor && !name) return null;
  if (!S("npcRolls") && actor && !actor.hasPlayerOwner) return null;
  const { item, activity } = itemOf(message);
  const targets = targetsOf(message);
  const D20 = CONFIG.Dice.D20Roll, DMG = CONFIG.Dice.DamageRoll;

  let kind = kindHint ?? rf.type;
  if (message.flags?.core?.initiativeRoll) kind = "initiative";
  if (!kind && roll) kind = (DMG && roll instanceof DMG) ? "damage" : (D20 && roll instanceof D20) ? (item ? "attack" : "check") : "roll";
  if (!kind && !roll) kind = f.messageType === "usage" || item ? "usage" : null;
  if (!kind) return null;
  if (["ability", "skill", "tool", "check"].includes(kind)) kind = kind === "check" ? "check" : kind;

  const ev = { id: message.id, group: f.originatingMessage ?? message.id, kind, actor: { name, img: portraitOf(actor, tokenDoc) }, actorPos: tokenPos(tokenDoc),
    item: item ? { name: item.name, img: item.img } : null, targets, title: "", sub: "", total: null, verdict: null, tone: "neutral" };
  const blind = message.blind && !game.user.isGM;
  const d20 = roll?.dice?.[0]?.total;
  if (roll && !blind) ev.total = roll.total;

  switch (kind) {
    case "usage": {
      if (!S("ev-usage") || !item) return null;
      ev.title = `${VERB[item.type] ?? "использует"} · ${item.name}`;
      ev.sub = activity?.name && activity.name !== item.name ? activity.name : (item.type === "spell" ? (item.system.level ? `${item.system.level} круг` : "заговор") : "");
      ev.tone = item.type === "spell" ? "magic" : "steel";
      break;
    }
    case "attack": {
      if (!S("ev-attack")) return null;
      ev.title = `Атака · ${item?.name ?? "оружие"}`;
      ev.tone = "steel";
      if (roll?.isCritical) { ev.verdict = "КРИТ!"; ev.tone = "crit"; }
      else if (roll?.isFumble) { ev.verdict = "ПРОВАЛ"; ev.tone = "fumble"; }
      else if (targets.length === 1 && targets[0].ac != null && ev.total != null) {
        const hit = ev.total >= targets[0].ac;
        ev.verdict = hit ? "ПОПАДАНИЕ" : "ПРОМАХ"; ev.tone = hit ? "hit" : "miss";
        if (game.user.isGM) ev.sub = `КД ${targets[0].ac}`;
      } else if (targets.length > 1 && ev.total != null) {
        for (const t of targets) if (t.ac != null) t.mark = ev.total >= t.ac ? "hit" : "miss";
      }
      break;
    }
    case "damage": case "healing": {
      if (!S("ev-damage")) return null;
      const heal = kind === "healing" || (roll?.options?.type && ["healing", "temphp"].includes(roll.options.type));
      const types = [...new Set((message.rolls ?? [roll]).map(r => r?.options?.type).filter(Boolean))]
        .map(t => loc(CONFIG.DND5E.damageTypes?.[t]?.label ?? CONFIG.DND5E.healingTypes?.[t]?.label) || t);
      ev.title = heal ? `Лечение · ${item?.name ?? ""}` : `Урон · ${item?.name ?? ""}`;
      ev.sub = types.join(", ");
      ev.tone = heal ? "heal" : roll?.isCritical ? "crit" : "damage";
      if (roll?.isCritical) ev.verdict = "КРИТИЧЕСКИЙ УРОН";
      break;
    }
    case "save": {
      if (!S("ev-save")) return null;
      const ab = rf.ability ?? rf.abilityId ?? roll?.options?.ability ?? "";
      ev.title = `Спасбросок ${abilityLabel(ab)}`.trim();
      ev.targets = []; // спасбросок — дело самого персонажа
      const dc = roll?.options?.target ?? rf.dc;
      if (d20 === 20) { ev.verdict = "НАТУРАЛЬНАЯ 20"; ev.tone = "crit"; }
      else if (d20 === 1) { ev.verdict = "НАТУРАЛЬНАЯ 1"; ev.tone = "fumble"; }
      if (dc != null && ev.total != null) { const ok = ev.total >= dc; ev.verdict = ok ? "УСПЕХ" : "ПРОВАЛ"; ev.tone = ok ? "hit" : "fail"; if (game.user.isGM) ev.sub = `Сл ${dc}`; }
      break;
    }
    case "ability": case "skill": case "tool": case "check": case "concentration": {
      if (!S(kind === "concentration" ? "ev-save" : "ev-check")) return null;
      ev.targets = [];
      if (kind === "concentration") ev.title = "Концентрация";
      else if (kind === "skill") ev.title = `Проверка · ${skillLabel(rf.skill ?? rf.skillId ?? roll?.options?.skill)}`;
      else if (kind === "tool") ev.title = `Инструмент · ${item?.name ?? loc(CONFIG.DND5E.tools?.[rf.tool ?? rf.toolId]?.label) ?? ""}`;
      else ev.title = `Проверка ${abilityLabel(rf.ability ?? rf.abilityId ?? roll?.options?.ability)}`.trim();
      const dc = roll?.options?.target;
      if (d20 === 20) { ev.verdict = "НАТУРАЛЬНАЯ 20"; ev.tone = "crit"; }
      else if (d20 === 1) { ev.verdict = "НАТУРАЛЬНАЯ 1"; ev.tone = "fumble"; }
      if (dc != null && ev.total != null) { const ok = ev.total >= dc; ev.verdict = ok ? "УСПЕХ" : "ПРОВАЛ"; ev.tone = ok ? "hit" : "fail"; }
      break;
    }
    case "initiative": {
      if (!S("ev-initiative")) return null;
      ev.title = "Инициатива"; ev.targets = []; ev.tone = "steel";
      break;
    }
    case "death": {
      if (!S("ev-death")) return null;
      ev.title = "Спасбросок от смерти"; ev.targets = [];
      if (d20 === 20) { ev.verdict = "ВСТАЁТ НА НОГИ!"; ev.tone = "crit"; }
      else if (d20 === 1) { ev.verdict = "ДВА ПРОВАЛА"; ev.tone = "fumble"; }
      else if (ev.total != null) { const ok = ev.total >= 10; ev.verdict = ok ? "УСПЕХ" : "ПРОВАЛ"; ev.tone = ok ? "hit" : "fail"; }
      break;
    }
    default: {
      if (!roll || !S("ev-check")) return null;
      ev.title = message.flavor ? String(message.flavor).replace(/<[^>]+>/g, "").slice(0, 60) : "Бросок";
      ev.targets = [];
    }
  }
  return ev;
}

/* ================================================================ Dice So Nice */

const diceWait = new Map();
Hooks.on("diceSoNiceRollComplete", (id) => { diceWait.get(id)?.(); diceWait.delete(id); });
function afterDice(message) {
  if (!S("waitDice") || !game.modules.get("dice-so-nice")?.active || !message.rolls?.length) return Promise.resolve();
  return new Promise(res => { diceWait.set(message.id, res); setTimeout(() => { diceWait.delete(message.id); res(); }, 6000); });
}

/* ================================================================ хуки чата */

async function handle(message, isUpdate = false) {
  if (!wantsDisplay(message)) return;
  const rolls = message.rolls ?? [];
  const already = seen.get(message.id);
  if (!isUpdate && already !== undefined) return;
  if (isUpdate && (already ?? 0) >= rolls.length) return;
  seen.set(message.id, rolls.length);
  if (seen.size > 300) seen.delete(seen.keys().next().value);

  const events = [];
  if (!rolls.length) { const e = buildEvent(message, null); if (e) events.push(e); }
  else {
    const fresh = rolls.slice(isUpdate ? (already ?? 0) : 0);
    // урон из нескольких бросков (разные типы) — один кадр с суммой
    const dmgCls = CONFIG.Dice.DamageRoll;
    const dmg = fresh.filter(r => dmgCls && r instanceof dmgCls), other = fresh.filter(r => !(dmgCls && r instanceof dmgCls));
    if (!isUpdate && !rolls.length) { /* нет */ }
    if (!isUpdate && message.flags?.dnd5e?.messageType === "usage") { const e = buildEvent(message, null, "usage"); if (e) events.push(e); }
    for (const r of other) { const e = buildEvent(message, r); if (e) events.push(e); }
    if (dmg.length) {
      const e = buildEvent(message, dmg[0], message.flags?.dnd5e?.roll?.type === "healing" ? "healing" : "damage");
      if (e) { if (!(message.blind && !game.user.isGM)) e.total = dmg.reduce((s, r) => s + (r.total ?? 0), 0); events.push(e); }
    }
  }
  if (!events.length) return;
  await afterDice(message);
  for (const e of events) Splash.push(e);
}

Hooks.on("createChatMessage", (m) => handle(m).catch(console.error));
Hooks.on("updateChatMessage", (m, ch) => { if (ch.rolls || ch.flags) handle(m, true).catch(console.error); });

/* ================================================================ показ */

const Splash = {
  queue: [], cur: null, timer: null,
  push(ev) {
    // тот же «ход» (объявление → атака → урон) обновляет текущий кадр, а не ставит новый в очередь
    if (this.cur && this.cur.group === ev.group) return this.show(ev, true);
    const same = this.queue.findIndex(q => q.group === ev.group);
    if (same >= 0) { this.queue[same] = ev; return; }
    this.queue.push(ev);
    if (!this.cur) this.next();
  },
  next() {
    const ev = this.queue.shift();
    if (!ev) { this.cur = null; return this.hide(); }
    this.show(ev, false);
  },
  root() {
    let el = document.getElementById("as-splash");
    if (!el) {
      el = document.createElement("div"); el.id = "as-splash"; document.body.appendChild(el); el.addEventListener("click", () => this.skip());
      const veil = document.createElement("div"); veil.id = "as-veil"; document.body.appendChild(veil);
    }
    el.dataset.layout = S("layout");
    el.dataset.pos = S("layout") === "big" ? "center" : S("position");
    el.style.setProperty("--as-scale", S("scale"));
    return el;
  },
  show(ev, merge) {
    const el = this.root();
    this.cur = ev;
    const card = document.createElement("div");
    card.className = `as-card as-${ev.tone}${merge ? " as-merge" : ""}`;
    card.innerHTML = render(ev);
    const old = el.querySelector(".as-card");
    if (old) { old.classList.add("as-out"); setTimeout(() => old.remove(), 260); }
    el.appendChild(card);
    document.getElementById("as-veil")?.classList.toggle("on", S("layout") === "big");
    requestAnimationFrame(() => card.classList.add("as-in"));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), S("duration") * 1000);
  },
  hide() {
    document.getElementById("as-veil")?.classList.remove("on");
    const c = document.querySelector("#as-splash .as-card");
    if (c) { c.classList.add("as-out"); setTimeout(() => c.remove(), 300); }
  },
  skip() { clearTimeout(this.timer); this.next(); }
};

function render(ev) {
  const face = (p, cls = "") => `<div class="as-face ${cls}"><div class="as-ring">${p.img ? `<img src="${esc(p.img)}" alt="">` : "<span>?</span>"}</div><b>${esc(p.name)}</b></div>`;
  const tg = ev.targets.length ? `<div class="as-vs">⚔</div><div class="as-targets">${ev.targets.map(t =>
    face(t, t.mark ? `as-t-${t.mark}` : "")).join("")}</div>` : "";
  const bg = backdrop(ev);
  return `${bg ? `<div class="as-bg" style="background-image:url('${esc(bg.src)}');background-size:${bg.size};background-position:${bg.pos}"></div><div class="as-bgshade"></div>` : ""}<div class="as-glow"></div>
    ${face(ev.actor, "as-actor")}
    <div class="as-mid">
      ${ev.item?.img ? `<img class="as-icon" src="${esc(ev.item.img)}" alt="">` : ""}
      <div class="as-title">${esc(ev.title)}</div>
      ${ev.sub ? `<div class="as-sub">${esc(ev.sub)}</div>` : ""}
      ${ev.total != null || ev.verdict ? `<div class="as-result">${ev.total != null ? `<span class="as-total">${ev.total}</span>` : ""}${ev.verdict ? `<span class="as-verdict">${esc(ev.verdict)}</span>` : ""}</div>` : ""}
    </div>
    ${tg}`;
}

/* ================================================================ API */

globalThis.ActionSplash = {
  /** Показать кадр вручную: ActionSplash.show({ actor:{name,img}, title:"...", verdict:"...", tone:"crit" }) */
  show: (ev) => Splash.push({ id: foundry.utils.randomID(), group: foundry.utils.randomID(), targets: [], tone: "neutral", ...ev }),
  skip: () => Splash.skip(),
  /** Проверка вида кадров */
  demo() {
    const a = canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? game.actors.contents[0];
    const t = [...game.user.targets][0]?.actor;
    const w = a?.items.find(i => i.type === "weapon");
    this.show({ actor: { name: a?.name ?? "Герой", img: a?.img }, item: w ? { name: w.name, img: w.img } : null,
      targets: t ? [{ name: t.name, img: t.img }] : [], title: `Атака · ${w?.name ?? "меч"}`, total: 18, verdict: "ПОПАДАНИЕ", tone: "hit" });
  }
};
