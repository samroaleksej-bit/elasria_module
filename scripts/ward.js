/*
 * Волшебный щит (Arcane Ward, PHB 2024) — автоматизация для dnd5e 5.x (+ midi-qol по желанию).
 *
 * Хиты щита = «использования» предмета (uses): макс = 2 × уровень волшебника + мод. Инт.
 *  • Заклинание Ограждения, сотворённое ячейкой: первый раз после Долгого отдыха — щит создаётся
 *    с полными Хитами; дальше — щит восстанавливает 2 × уровень ячейки.
 *  • Активность «Подзарядить щит» (Бонусное действие, тратит ячейку): +2 × уровень ячейки.
 *  • Любой урон по владельцу (после сопротивлений/уязвимостей) сначала снимается со щита.
 *  • Долгий отдых: щит исчезает (0 Хитов), его можно создать заново.
 * Модуль сам приводит предмет в порядок (формула максимума, активности) — достаточно, чтобы
 * у персонажа был предмет «Волшебный щит» / «Волшебный оберег» / «Arcane Ward».
 */
const MID = "volshebnyj-shit";
const IDS = ["arcane-ward", "magicheskaya-zashita", "volshebnyj-shit", "volshebnyj-obereg"];
const NAMES = /волшебный\s+(щит|оберег)|arcane\s+ward/i;
const MAX_FORMULA = "@classes.wizard.levels * 2 + @abilities.int.mod";
const RECHARGE_ID = "vsRecharge000001";
const { getProperty, flattenObject } = foundry.utils;

/* ---------------------------------------------------------------- поиск */

const isWard = (item) => item?.type === "feat" && (IDS.includes(item.system?.identifier) || NAMES.test(item.name ?? "") || item.getFlag?.(MID, "ward"));
const wardOf = (actor) => actor?.items?.find(isWard) ?? null;
const hpOf = (item) => {
  const max = Number(item.system.uses?.max) || 0;
  const spent = Number(item.system.uses?.spent) || 0;
  return { value: Math.max(0, max - spent), max };
};
const created = (item) => !!item.getFlag(MID, "created");

/** Кто должен выполнять обновления: владелец-игрок онлайн, иначе ГМ. */
function isResponsible(actor) {
  const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  if (owners.length) return owners.sort((a, b) => a.id.localeCompare(b.id))[0].isSelf;
  return game.users.activeGM?.isSelf ?? game.user.isGM;
}

/* ---------------------------------------------------------------- изменение Хитов щита */

async function setWardHP(item, value, { reason = "", delta = 0, silent = false } = {}) {
  const { max } = hpOf(item);
  const v = Math.clamp(Math.round(value), 0, max);
  await item.update({ "system.uses.spent": max - v });
  if (!silent) await announce(item, v, max, reason, delta);
  floatText(item.actor, delta);
  return v;
}

async function announce(item, value, max, reason, delta) {
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "";
  const pct = max ? Math.round((value / max) * 100) : 0;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: item.actor }),
    content: `<div class="vs-card"><h4><img src="${item.img}" width="22" height="22" style="border:none"> ${item.name}</h4>
      <div>${reason}${sign ? ` <span class="vs-n">${sign}</span>` : ""}</div>
      <div>Хиты щита: <span class="vs-n">${value} / ${max}</span></div>
      <div class="vs-bar"><i style="width:${pct}%"></i></div></div>`
  });
}

function floatText(actor, delta) {
  if (!delta || !canvas?.ready) return;
  for (const t of actor.getActiveTokens()) {
    canvas.interface?.createScrollingText(t.center, `🛡 ${delta > 0 ? "+" : ""}${delta}`, {
      anchor: CONST.TEXT_ANCHOR_POINTS.TOP, fontSize: 30, fill: delta > 0 ? "#a8d8ff" : "#6aa9e0",
      stroke: 0x000000, strokeThickness: 4, jitter: 0.25
    });
  }
}

/* ---------------------------------------------------------------- использование активностей */

const log = (...a) => { if (game.settings.get(MID, "debug")) console.log("%c[Волшебный щит]", "color:#6aa9e0;font-weight:bold", ...a); };
const recent = new Map(); // защита от двойного срабатывания: actorId → время

/** Уровень потраченной ячейки: из настроек использования или из обновлений актёра. */
function slotLevel(actor, usageConfig, updates) {
  const slot = usageConfig?.spell?.slot;
  if (slot && usageConfig?.consume?.spellSlot !== false) {
    const lvl = slot === "pact" ? actor.system.spells.pact?.level : Number(String(slot).replace(/\D/g, ""));
    if (lvl > 0) return lvl;
  }
  const upd = flattenObject(updates?.actor ?? {});
  for (const k of Object.keys(upd)) {
    const m = k.match(/^system\.spells\.(spell(\d)|pact)\.value$/);
    if (m) return m[2] ? Number(m[2]) : (actor.system.spells.pact?.level ?? 0);
  }
  return 0;
}

async function onActivity(activity, usageConfig, updates, source) {
  const item = activity?.item, actor = item?.actor;
  if (!actor) return;
  const ward = wardOf(actor);
  if (!ward) return log(source, "у персонажа нет предмета щита", actor.name);
  const isRecharge = item.id === ward.id;  // любая активность самого щита = подзарядка
  const isAbj = item.type === "spell" && item.system.school === "abj";
  if (!isRecharge && !isAbj) return;
  const lvl = slotLevel(actor, usageConfig, updates);
  log(source, item.name, { school: item.system.school, slot: usageConfig?.spell?.slot, lvl, updates: updates?.actor });
  if (!lvl) return;
  if (!isResponsible(actor)) return;
  const key = `${actor.uuid}|${item.id}`;
  if (Date.now() - (recent.get(key) ?? 0) < 1500) return;
  recent.set(key, Date.now());

  if (isRecharge) {
    if (!created(ward)) return ui.notifications.warn("Волшебный щит ещё не создан — сотворите заклинание Ограждения ячейкой.");
    const { value, max } = hpOf(ward), heal = lvl * 2;
    return setWardHP(ward, value + heal, { reason: `Подзарядка ячейкой ${lvl} уровня`, delta: Math.min(heal, max - value) });
  }
  if (!created(ward)) {
    await ward.setFlag(MID, "created", true);
    const { max } = hpOf(ward);
    return setWardHP(ward, max, { reason: `${item.name}: щит соткан`, delta: max });
  }
  const { value, max } = hpOf(ward), heal = lvl * 2;
  if (value >= max) return ui.notifications.info(`Волшебный щит уже полон (${value}/${max}).`);
  return setWardHP(ward, value + heal, { reason: `${item.name}: щит восстанавливается`, delta: Math.min(heal, max - value) });
}

// Основной путь — момент траты ресурсов (работает и при обычном касте, и через midi-qol, и для реакций)
Hooks.on("dnd5e.activityConsumption", (activity, usageConfig, messageConfig, updates) => {
  setTimeout(() => onActivity(activity, usageConfig, updates, "consumption").catch(console.error), 50);
});
// Запасной путь
Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  onActivity(activity, usageConfig, results?.updates, "postUse").catch(console.error);
});

/* ---------------------------------------------------------------- поглощение урона */

Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (userId !== game.user.id || options.vsSkip || options.isRest) return;
  const nv = getProperty(changes, "system.attributes.hp.value");
  const nt = getProperty(changes, "system.attributes.hp.temp");
  if (nv === undefined && nt === undefined) return;
  const ward = wardOf(actor);
  if (!ward || !created(ward)) return;
  const hp = actor.system.attributes.hp;
  const value = hp.value ?? 0, temp = hp.temp ?? 0;
  const dmg = (value + temp) - ((nv ?? value) + (nt ?? temp));
  if (!(dmg > 0)) return;
  const { value: wv } = hpOf(ward);
  if (wv <= 0) return;

  const absorbed = Math.min(wv, dmg);
  const rest = dmg - absorbed;
  const newTemp = Math.max(0, temp - rest);
  const newValue = value - Math.max(0, rest - temp);
  foundry.utils.setProperty(changes, "system.attributes.hp.temp", newTemp);
  foundry.utils.setProperty(changes, "system.attributes.hp.value", newValue);
  options.vsAbsorbed = absorbed;

  const left = wv - absorbed;
  setWardHP(ward, left, {
    reason: rest > 0 ? `Щит поглотил урон и рассыпался — ${rest} урона проходит` : "Щит поглотил урон",
    delta: -absorbed
  });
});

/* ---------------------------------------------------------------- отдых */

Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  const long = result?.longRest ?? config?.type === "long";
  if (!long || !isResponsible(actor)) return;
  const ward = wardOf(actor);
  if (!ward) return;
  await ward.setFlag(MID, "created", false);
  await ward.update({ "system.uses.spent": hpOf(ward).max });
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="vs-card"><h4>${ward.name}</h4>Долгий отдых: щит развеялся. Сотворите заклинание Ограждения ячейкой, чтобы соткать новый.</div>` });
});

/* ---------------------------------------------------------------- настройка предмета */

const MIDI_DEFAULTS = {
  macroData: { name: "", command: "" },
  midiProperties: { ignoreTraits: [], triggeredActivityId: "none", triggeredActivityConditionText: "", triggeredActivityTargets: "targets",
    triggeredActivityRollAs: "self", autoConsume: false, forceConsumeDialog: "default", forceRollDialog: "default", forceDamageDialog: "default",
    confirmTargets: "default", autoTargetType: "any", autoTargetAction: "default", automationOnly: false, otherActivityCompatible: true,
    otherActivityAsParentType: true, identifier: "", displayActivityName: false, rollMode: "default", chooseEffects: false, toggleEffect: false,
    ignoreFullCover: false, removeChatButtons: "default", magicEffect: false, magicDamage: false, noConcentrationCheck: false, autoCEEffects: "default" },
  useConditionText: "", useConditionReason: "", effectConditionText: "", otherActivityId: "none", otherActivityAsParentType: true,
  isOverTimeFlag: false, overTimeProperties: { saveRemoves: true, preRemoveConditionText: "", postRemoveConditionText: "" }
};
const RECHARGE = {
  name: "Подзарядить щит",
  activation: { type: "bonus", value: 1, condition: "Щит уже создан", override: false },
  consumption: { scaling: { allowed: true, max: "9" }, spellSlot: false,
    targets: [{ type: "spellSlots", value: "1", target: "1", scaling: { mode: "level", formula: "" } }] },
  "description.chatFlavor": "Волшебник вливает ячейку в щит: +2 Хита за каждый уровень ячейки.",
  "range.units": "self", "duration.units": "inst"
};

/** Правка предмета: формула Хитов, без восстановления на отдыхе, активность — подзарядка ячейкой.
 *  Существующую активность правим на месте, чтобы не потерять поля midi-qol и других модулей. */
function wardPatch(item) {
  const p = {};
  if (item.system.uses?.max !== MAX_FORMULA) p["system.uses.max"] = MAX_FORMULA;
  if (item.system.uses?.recovery?.length) p["system.uses.recovery"] = [];
  if (item.system.identifier !== "arcane-ward") p["system.identifier"] = "arcane-ward";
  if (!item.getFlag(MID, "ward")) p[`flags.${MID}.ward`] = true;
  const acts = item.system.activities;
  const act = acts?.get(RECHARGE_ID) ?? acts?.contents?.[0] ?? acts?.find?.(() => true);
  const id = act?.id ?? RECHARGE_ID;
  const src = act ? (item._source.system.activities?.[id] ?? {}) : null;
  const need = !act || act.name !== RECHARGE.name || act.activation?.type !== "bonus"
    || act.consumption?.targets?.[0]?.type !== "spellSlots" || src.macroData === undefined && game.modules.get("midi-qol")?.active;
  if (need) {
    const base = act ? {} : { _id: id, type: "utility", sort: 0, target: { affects: { type: "self" }, prompt: false } };
    if (game.modules.get("midi-qol")?.active) for (const [k, v] of Object.entries(MIDI_DEFAULTS)) if (src?.[k] === undefined) base[k] = v;
    for (const [k, v] of Object.entries({ ...base, ...RECHARGE })) p[`system.activities.${id}.${k}`] = v;
  }
  return p;
}

async function fixWard(item) {
  if (!isWard(item) || !item.isOwner) return;
  const p = wardPatch(item);
  if (!Object.keys(p).length) return;
  const fresh = !item.getFlag(MID, "ward");
  await item.update(p);
  if (fresh) await item.update({ "system.uses.spent": hpOf(item).max, [`flags.${MID}.created`]: false });
}

Hooks.once("init", () => {
  game.settings.register(MID, "debug", { name: "Волшебный щит: отладка в консоли (F12)", scope: "client", config: true, type: Boolean, default: false });
});

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  for (const a of game.actors) for (const i of a.items) if (isWard(i)) await fixWard(i).catch(console.error);
  for (const s of game.scenes) for (const t of s.tokens) if (!t.actorLink && t.actor) for (const i of t.actor.items) if (isWard(i)) await fixWard(i).catch(console.error);
});
Hooks.on("createItem", (item, opts, userId) => { if (userId === game.user.id) fixWard(item); });

/* ---------------------------------------------------------------- API для макросов */

globalThis.ArcaneWard = {
  /** Хиты щита актёра: ArcaneWard.hp(actor) */
  hp: (actor) => { const w = wardOf(actor); return w ? { ...hpOf(w), created: created(w) } : null; },
  /** Установить Хиты вручную: ArcaneWard.set(actor, 10) */
  set: async (actor, v) => { const w = wardOf(actor); if (w) { await w.setFlag(MID, "created", true); return setWardHP(w, v, { reason: "Мастер изменил щит", delta: v - hpOf(w).value }); } },
  /** Снять «создан» (как после долгого отдыха) */
  /** Диагностика: ArcaneWard.debug(actor) или выделенный токен */
  debug(actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character) {
    const w = wardOf(actor);
    const info = { actor: actor?.name, ward: w?.name ?? "НЕ НАЙДЕН", identifier: w?.system.identifier, uses: w?.system.uses, created: w ? created(w) : null,
      wizardLevel: actor?.classes?.wizard?.system.levels, int: actor?.system.abilities.int.mod,
      abjSpells: actor?.items.filter(i => i.type === "spell" && i.system.school === "abj").map(i => i.name) };
    console.table(info); ui.notifications.info(`Щит: ${info.ward} · ${w ? hpOf(w).value + "/" + hpOf(w).max : "—"} · создан: ${info.created}`);
    return info;
  },
  reset: async (actor) => { const w = wardOf(actor); if (w) { await w.setFlag(MID, "created", false); await w.update({ "system.uses.spent": hpOf(w).max }); } }
};
