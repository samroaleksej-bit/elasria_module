// Builds dnd5e (v4/v5) actor JSON for Foundry "Import Data"
const fs = require("fs");
global.window = {};
require("/tmp/claude-0/-home-claude/2e4b7e6e-616d-5522-93e7-5a6dcdb0afa2/scratchpad/bosses_data.js");
const B = window.BOSSES.find(x => x.id === "sickle");
const ART = "modules/monstryatina/assets/sickle/";
const path = require("path");
const OUT = path.join(__dirname, "actors-src");
fs.mkdirSync(OUT, { recursive: true });
let seed = 7; Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rid = () => { const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s = ""; for (let i = 0; i < 16; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
const p = t => `<p>${t}</p>`;
const ab = a => { const k = ["str", "dex", "con", "int", "wis", "cha"]; const o = {}; k.forEach((x, i) => o[x] = { value: a[i], proficient: 0 }); return o; };

function feat(name, desc, o = {}) {
  const it = { _id: rid(), name, type: "feat", img: o.img || "icons/svg/aura.svg",
    system: { description: { value: p(desc) }, type: { value: "monster", subtype: "" },
      activation: {}, uses: o.uses ? { max: String(o.uses), spent: 0, recovery: [{ period: "day", type: "recoverAll" }] } : { max: "", spent: 0, recovery: [] },
      activities: {} } };
  if (o.act) {
    const id = rid();
    const a = { _id: id, type: o.save ? "save" : "utility", activation: { type: o.act, value: o.cost || 1, condition: "" },
      consumption: { targets: o.legCost ? [{ type: "attribute", target: "resources.legact.value", value: String(o.legCost) }] : (o.uses ? [{ type: "itemUses", value: "1" }] : []) },
      range: {}, target: {}, duration: { units: "inst" } };
    if (o.save) { a.save = { ability: [o.save.ab], dc: { calculation: "", formula: String(o.save.dc) } };
      a.damage = { onSave: o.save.half ? "half" : "none", parts: o.save.dmg || [] };
      if (o.save.area) a.target = { template: { type: "radius", size: String(o.save.area), units: "ft" }, affects: { type: "creature" } }; }
    it.system.activities[id] = a;
  }
  return it;
}
const dp = (n, d, bonus, t) => ({ number: n, denomination: d, bonus: bonus || "", types: [t] });

function weapon(name, desc, o) {
  const id = rid();
  return { _id: rid(), name, type: "weapon", img: o.img || "icons/creatures/claws/claw-scaled-red.webp",
    system: { description: { value: p(desc) }, type: { value: "natural", baseItem: "" }, proficient: 1, equipped: true,
      properties: o.fin ? ["fin"] : [], range: { reach: o.reach || 5, units: "ft" },
      damage: { base: dp(o.n, o.d, "", "slashing") },
      activities: { [id]: { _id: id, type: "attack", activation: { type: o.act || "action", value: o.cost || 1 },
        consumption: { targets: o.legCost ? [{ type: "attribute", target: "resources.legact.value", value: String(o.legCost) }] : [] },
        attack: { ability: o.fin ? "dex" : "str", bonus: "", flat: false, type: { value: "melee", classification: "weapon" } },
        damage: { includeBase: true, parts: o.extra || [] }, range: { override: false } } } } };
}

function actor(o) {
  const _id = rid();
  for (const it of o.items) it._key = `!actors.items!${_id}.${it._id}`;
  return { _id, _key: `!actors!${_id}`, folder: null, name: o.name, type: "npc", img: o.portrait,
    system: { abilities: o.abilities,
      attributes: { ac: { flat: o.ac, calc: "natural" }, hp: { value: o.hp, max: o.hp, formula: o.hpf },
        movement: { walk: 40, climb: 40, units: "ft" }, senses: { darkvision: 60, units: "ft" } },
      details: { cr: o.cr, type: { value: "monstrosity", subtype: o.subtype }, alignment: "без мировоззрения",
        biography: { value: o.bio } },
      traits: { size: o.size, dr: { value: o.dr || [] }, di: { value: o.di || [] }, ci: { value: o.ci || [] }, languages: { value: [] } },
      skills: o.skills, resources: o.resources || {} },
    items: o.items,
    prototypeToken: { name: o.name, displayName: 20, displayBars: 20, actorLink: false, disposition: -1,
      width: o.w, height: o.w, bar1: { attribute: "attributes.hp" },
      texture: { src: o.token, scaleX: o.scale, scaleY: o.scale, fit: "contain" },
      sight: { enabled: true, range: 60, visionMode: "darkvision" }, ring: { enabled: false } },
    flags: { monstryatina: { id: o.id } } };
}

// ---------- Серповик ----------
const sAb = ab(B.stats); ["dex", "con", "wis"].forEach(k => sAb[k].proficient = 1);
const T = Object.fromEntries(B.traits);
const pink = [dp(2, 6, "", "poison")];
const baHTML = B.ba.map(a => `<h3>${a.n} <small>(${a.t}${a.ph !== "все" ? ", фаза " + a.ph : ""})</small></h3>
<p><b>Сигнал.</b> ${a.s}</p><p><b>${a.t}.</b> ${a.c}</p><p><b>Разрешение.</b> ${a.r}</p><p><b>Сорвано.</b> ${a.x}</p>${a.note ? `<p><i>${a.note}</i></p>` : ""}`).join("");
const sickleItems = [
  feat("Охотник крон", T["Охотник крон"]),
  feat("Тень в листве", T["Тень в листве"], { act: "bonus" }),
  feat("Прыгун", T["Прыгун"]),
  feat("Розовая кромка", T["Розовая кромка"]),
  feat("Панцирь охотника (3/день)", T["Панцирь охотника (3/день)"], { act: "special", uses: 3 }),
  feat("Мультиатака", B.actions[0][1], { act: "action" }),
  weapon("Клинок", B.actions[1][1], { n: 2, d: 10, reach: 10, extra: pink }),
  weapon("Захват", B.actions[2][1] + " СЛ высвобождения 18.", { n: 0, d: 0, reach: 10, img: "icons/magic/control/debuff-chains-ropes-net-white.webp" }),
  feat("Прыжок в крону", B.bonus[0][1], { act: "bonus" }),
  feat("Сброс высоты (1/раунд)", B.reactions[0][1], { act: "reaction" }),
  feat("Прыжок", B.legendary[0][1], { act: "legendary", legCost: 1 }),
  weapon("Клинок (легендарное)", B.legendary[1][1], { n: 2, d: 10, reach: 10, extra: pink, act: "legendary", legCost: 1 }),
  feat("Пикирование (2 действия)", B.legendary[2][1], { act: "legendary", cost: 2, legCost: 2, save: { ab: "str", dc: 18 } }),
  feat("Вихрь (Боевое действие)", B.ba[0].r, { act: "special", save: { ab: "dex", dc: 18, half: true, area: 15, dmg: [dp(8, 10, "", "slashing")] } }),
  feat("Розовый туман (Боевое действие)", B.ba[2].r, { act: "special", save: { ab: "con", dc: 17, area: 20 } }),
  feat("Боевые действия", `Сигнал в конце хода → Разрешение в начале следующего. Раунды 1–2: одно действие, с 3-го раунда: два.</p>${baHTML}<p>`, { img: "icons/svg/sword.svg" }),
  feat("Слабое место: " + B.weak[0], B.weak[1], { img: "icons/svg/target.svg" }),
  feat("Фазы", B.phases.join("<br>"), { img: "icons/svg/clockwork.svg" }),
];
// Fix Захват: no damage
sickleItems[7].system.damage.base = { number: null, denomination: null, types: [] };
const sickle = actor({ id: "sickle", name: "Серповик", portrait: ART + "portrait.webp", token: ART + "token.webp",
  abilities: sAb, ac: 17, hp: 210, hpf: "20d12 + 80", cr: 10, subtype: "ящер-богомол", size: "huge", w: 3, scale: 1.25,
  dr: ["poison"], ci: ["frightened", "poisoned"],
  skills: { ste: { value: 2, ability: "dex" }, prc: { value: 1, ability: "wis" }, ath: { value: 1, ability: "str" } },
  resources: { legact: { value: 3, max: 3 }, legres: { value: 3, max: 3 } },
  bio: `<blockquote>${B.quote}</blockquote><p><b>${B.cls}</b> · гекс ${B.hex}</p>
<h3>Фавориты</h3><p>${B.fav.join(", ")}</p><h3>Фолы</h3><p>${B.fol.join(", ")}</p>
<h3>Знания</h3>${B.lore.map(l => `<p><b>СЛ ${l[0]}.</b> ${l[1]} <i>(${l[2]})</i></p>`).join("")}
<h3>Тактика</h3><p><b>Лёгкая:</b> ${B.tactics.easy}</p><p><b>Средняя:</b> ${B.tactics.mid}</p><p><b>Сложная:</b> ${B.tactics.hard}</p>
<h3>Добыча</h3>${B.loot.map(l => `<p><b>${l[0]}</b> (${l[1]}). ${l[2]}</p>`).join("")}`,
  items: sickleItems });

// ---------- Нимфа ----------
const N = window.SUMMONS.sickle.list[0];
const nAb = ab(N.stats); nAb.dex.proficient = 1;
const NT = Object.fromEntries(N.traits);
const grab = weapon("Захват", N.actions[2][1], { n: 0, d: 0, reach: 5, img: "icons/magic/control/debuff-chains-ropes-net-white.webp" });
grab.system.damage.base = { number: null, denomination: null, types: [] };
const nymph = actor({ id: "sickle-nymph", name: "Нимфа Серповика", portrait: ART + "nymph-portrait.webp", token: ART + "nymph-token.webp",
  abilities: nAb, ac: 15, hp: 39, hpf: "6d8 + 12", cr: 3, subtype: "молодой ящер-богомол", size: "med", w: 1, scale: 1.3,
  ci: ["frightened"], skills: { ste: { value: 1, ability: "dex" }, ath: { value: 1, ability: "str" } },
  bio: `<p>Призывается Боевым действием Серповика «Клич гнезда» (3 нимфы).</p>`,
  items: [feat("Лазун", NT["Лазун"]), feat("Утащить", NT["Утащить"]), feat("Зов отца", NT["Зов отца"]),
    feat("Мультиатака", N.actions[0][1], { act: "action" }),
    weapon("Клинок", N.actions[1][1], { n: 1, d: 10, reach: 5, fin: true }), grab,
    feat("Отскок", N.reactions[0][1], { act: "reaction" })] });

for (const [f, a] of [["sickle", sickle], ["sickle-nymph", nymph]]) fs.writeFileSync(path.join(OUT, f + ".json"), JSON.stringify(a, null, 1));
console.log("ok", sickle.items.length, nymph.items.length);
