// Нахтмарк: переименование импортированного приключения под Эластрию.
// Модуль ничего не хранит из чужого текста: он правит документы уже в мире мастера по словарю имён
// и запоминает исходные значения во флагах, чтобы всё можно было вернуть.
import { convertHTML, convertPlain } from "./engine.js";
import { RULES, NAME_OVERRIDES, sceneNameOverride, DICT_VERSION } from "./dictionary.js";
import { openBook, toggleBook, refreshBook, onSocket as onBookSocket, travel as bookTravel } from "./book.js";
import { registerSfx } from "./sfx.js";

const MOD = "nachtmark";
const SOURCE = "kadzoki-proklyatie-strada";
const PACK = `${SOURCE}.${SOURCE}`;

/** Какие поля правим у каждого типа документов. name - простая строка, html - текст с разметкой. */
const FIELDS = {
  Folder: { name: ["name"] },
  JournalEntry: { name: ["name"], embedded: { JournalEntryPage: { coll: "pages", name: ["name"], html: ["text.content"] } } },
  Scene: { name: ["name", "navName"], embedded: {
    Token: { coll: "tokens", name: ["name"] },
    Note: { coll: "notes", name: ["text"] },
    Drawing: { coll: "drawings", name: ["text"] } } },
  Actor: { name: ["name", "prototypeToken.name"], html: ["system.details.biography.value"] },
  Item: { name: ["name"], html: ["system.description.value"] },
  RollTable: { name: ["name"], html: ["description"], embedded: { TableResult: { coll: "results", name: ["name"], html: ["description", "text"] } } },
  Playlist: { name: ["name"] }
};
const ADV_KEYS = { Folder: "folders", JournalEntry: "journal", Scene: "scenes", Actor: "actors", Item: "items", RollTable: "tables", Playlist: "playlists" };
const COLLECTIONS = { Folder: () => game.folders, JournalEntry: () => game.journal, Scene: () => game.scenes, Actor: () => game.actors, Item: () => game.items, RollTable: () => game.tables, Playlist: () => game.playlists };

const get = (obj, path) => foundry.utils.getProperty(obj, path);
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------- исходные значения во флаге (строкой JSON: так не нужны ни удаление ключей, ни ключи с точками) ---------- */
function readFlag(doc) {
  const f = doc._source?.flags?.[MOD];
  let orig = {};
  try { if (f?.orig) orig = JSON.parse(f.orig); } catch (e) { orig = {}; }
  return { orig, v: f?.v ?? 0, raw: f?.orig ?? "" };
}
const origName = (doc) => readFlag(doc).orig.name ?? doc._source?.name ?? doc.name;

function folderPath(doc) {
  const parts = [];
  for (let f = doc.folder; f; f = f.folder) parts.unshift(f.name);
  return parts.join(" / ");
}

function sourceSetting(key) {
  try { return game.settings.get(SOURCE, key); } catch (e) { return undefined; }
}

/**
 * Названия, по которым собственные скрипты приключения ищут документы. Их не трогаем,
 * иначе модуль не найдёт свои папки и актёров после обновления.
 */
function keepName(doc, name) {
  if (doc.documentName === "Folder" && doc.type === "Scene") {
    if (!doc.folder && name === "Проклятие Страда") return true;
    for (let f = doc; f; f = f.folder) if (origName(f) === "Театр Разума") return true;
  }
  if (doc.documentName === "Actor" && name === "Дьявол Страд фон Зарович") return true;
  if (doc.documentName === "Scene" && name === "Аббатство Святой Марковии" && !(sourceSetting("abbeyMapRestore") >= 2)) return true;
  return false;
}

function conv(text, kind, doc, path) {
  if (kind === "html") return convertHTML(text, RULES);
  if (path === "name" && keepName(doc, text)) return text;
  if (NAME_OVERRIDES[text]) return NAME_OVERRIDES[text];
  if (doc.documentName === "Scene" && path === "name") {
    const o = sceneNameOverride(text, folderPath(doc));
    if (o) return o;
  }
  return convertPlain(text, RULES);
}

/** Что надо поменять в документе, чтобы он соответствовал словарю. */
function planApply(doc, spec) {
  const src = doc._source;
  const { orig, v, raw } = readFlag(doc);
  const upd = {}, next = {};
  const each = (path, kind) => {
    const cur = get(src, path);
    if (typeof cur !== "string" || !cur) return;
    let base = cur;
    if (path in orig) {
      const was = orig[path];
      // исходник берём из флага, если текст с тех пор никто не менял (или сменился сам словарь)
      if (v !== DICT_VERSION || cur === was || cur === conv(was, kind, doc, path)) base = was;
    }
    const out = conv(base, kind, doc, path);
    if (out !== base) next[path] = base;
    if (out !== cur) upd[path] = out;
  };
  for (const p of spec.name ?? []) each(p, "name");
  for (const p of spec.html ?? []) each(p, "html");
  const str = Object.keys(next).length ? JSON.stringify(next) : "";
  if (str !== raw || (str && v !== DICT_VERSION)) { upd[`flags.${MOD}.orig`] = str; upd[`flags.${MOD}.v`] = DICT_VERSION; }
  return upd;
}

/** Что надо поменять, чтобы вернуть документ к исходному виду. */
function planRevert(doc) {
  const src = doc._source;
  const { orig, raw } = readFlag(doc);
  const upd = {};
  for (const [path, was] of Object.entries(orig)) if (get(src, path) !== was) upd[path] = was;
  if (raw) upd[`flags.${MOD}.orig`] = "";
  return upd;
}

const changed = (upd) => Object.keys(upd).filter((k) => !k.startsWith("flags.")).length;

/** Документы мира, которые пришли из приключения: по идентификаторам из его компендиума. */
async function collect() {
  const pack = game.packs.get(PACK);
  if (!pack) throw new Error("Не найден компендиум приключения. Включите модуль «Kadzoki — Проклятие Страда».");
  const [adv] = await pack.getDocuments();
  if (!adv) throw new Error("В компендиуме нет приключения.");
  const data = adv.toObject();
  const sets = {};
  for (const [cls, key] of Object.entries(ADV_KEYS)) {
    const coll = COLLECTIONS[cls]();
    sets[cls] = (data[key] ?? []).map((d) => coll.get(d._id)).filter(Boolean);
  }
  return sets;
}

/** mode: "apply" - перенести, "revert" - вернуть, "preview" - только посчитать. */
export async function run(mode = "apply") {
  if (!game.user.isGM) throw new Error("Только мастер может переносить приключение.");
  const sets = await collect();
  const report = { docs: 0, fields: 0, byType: {} };
  const note = (cls, n) => { if (!n) return; report.docs++; report.fields += n; report.byType[cls] = (report.byType[cls] ?? 0) + 1; };
  const planOf = (doc, spec) => (mode === "revert" ? planRevert(doc) : planApply(doc, spec));
  let seen = 0;
  for (const [cls, docs] of Object.entries(sets)) {
    const spec = FIELDS[cls];
    const batch = [];
    for (const doc of docs) {
      const upd = planOf(doc, spec);
      if (Object.keys(upd).length) { batch.push({ _id: doc.id, ...upd }); note(cls, changed(upd)); }
      for (const [ecls, es] of Object.entries(spec.embedded ?? {})) {
        const eb = [];
        for (const ed of doc[es.coll] ?? []) {
          const eu = planOf(ed, es);
          if (Object.keys(eu).length) { eb.push({ _id: ed.id, ...eu }); note(ecls, changed(eu)); }
        }
        if (eb.length && mode !== "preview") await doc.updateEmbeddedDocuments(ecls, eb);
      }
      if (++seen % 15 === 0) await tick();
    }
    if (batch.length && mode !== "preview") await CONFIG[cls].documentClass.updateDocuments(batch);
  }
  if (mode !== "preview") await game.settings.set(MOD, "state", { applied: mode === "apply", v: DICT_VERSION, at: Date.now() });
  return report;
}

/* =====================================================================
 * Замена мобов: токены на сценах приключения получают существ из других
 * установленных модулей. Статблоков здесь нет - только ссылки на компендиумы.
 * ===================================================================== */
let swapTable = null;
async function loadSwaps() {
  swapTable ??= await (await fetch(`modules/${MOD}/data/swaps.json`)).json();
  return swapTable;
}

async function mobFolder() {
  const have = game.folders.find((f) => f.type === "Actor" && f._source.flags?.[MOD]?.mobs);
  return have ?? Folder.create({ name: "Нахтмарк · мобы", type: "Actor", flags: { [MOD]: { mobs: true } } });
}

/** Существо-замена в мире: берём уже импортированное или импортируем из компендиума. */
async function importMob(swap, dry) {
  const have = game.actors.find((a) => a._source.flags?.[MOD]?.source === swap.uuid);
  if (have) return have;
  const src = await fromUuid(swap.uuid);
  if (!src) return null;
  if (dry) return src;
  const data = game.actors.fromCompendium(src);
  data.folder = (await mobFolder()).id;
  data.flags = { ...(data.flags ?? {}), [MOD]: { source: swap.uuid } };
  return Actor.implementation.create(data);
}

async function mobTexture(actor) {
  const proto = actor.prototypeToken.toObject();
  let src = proto.texture?.src;
  if (proto.randomImg && typeof actor.getTokenImages === "function") {
    const imgs = await actor.getTokenImages();
    if (imgs?.length) src = imgs[Math.floor(Math.random() * imgs.length)];
  }
  return { ...proto.texture, src };
}

const cleanName = (s) => String(s ?? "").replace(/\s*\[[^\]]*\]\s*$/, "");
/** Поля, которые новый токен берёт у нового существа; всё остальное (место, этаж, скрытость, флаги) остаётся от старого. */
const FROM_PROTO = ["width", "height", "ring", "sight", "detectionModes", "light", "bar1", "bar2", "disposition"];

/**
 * Пересоздать токены на том же месте и с тем же идентификатором.
 * Править на месте нельзя: у половины токенов в сцену вшита копия старого существа со всеми способностями.
 */
async function replaceTokens(scene, items) {
  const ids = items.map((d) => d._id);
  const backup = ids.map((id) => scene.tokens.get(id)?.toObject()).filter(Boolean);
  await scene.deleteEmbeddedDocuments("Token", ids);
  try {
    await scene.createEmbeddedDocuments("Token", items, { keepId: true });
  } catch (e) {
    await scene.createEmbeddedDocuments("Token", backup, { keepId: true }); // вернуть как было и сообщить
    throw e;
  }
}

/** mode: "apply" - заменить, "revert" - вернуть, "preview" - только посчитать. */
export async function runSwaps(mode = "apply") {
  if (!game.user.isGM) throw new Error("Только мастер может менять мобов.");
  const dry = mode === "preview";
  const table = await loadSwaps();
  const sets = await collect();
  const report = { tokens: 0, scenes: 0, byMob: {}, missing: [] };

  if (mode === "revert") {
    const pack = game.packs.get(PACK);
    const [adv] = await pack.getDocuments();
    const original = new Map();
    for (const s of adv.toObject().scenes ?? []) for (const t of s.tokens ?? []) original.set(`${s._id}.${t._id}`, t);
    for (const scene of sets.Scene) {
      const items = [];
      for (const tok of scene.tokens) {
        const was = tok._source.flags?.[MOD]?.was;
        if (!was) continue;
        const cur = tok.toObject();
        const place = { x: cur.x, y: cur.y, elevation: cur.elevation, hidden: cur.hidden, ...("level" in cur ? { level: cur.level } : {}) };
        const orig = original.get(`${scene.id}.${tok.id}`);
        let data;
        if (orig) data = { ...orig, ...place };
        else {
          const actor = game.actors.get(was);
          if (!actor) continue;
          const proto = actor.prototypeToken.toObject();
          data = { ...cur, actorId: actor.id, name: proto.name || actor.name, texture: await mobTexture(actor) };
          for (const k of FROM_PROTO) if (k in proto) data[k] = proto[k];
          delete data.delta;
          data.flags = { ...(data.flags ?? {}), [MOD]: { was: "" } };
        }
        data._id = tok.id;
        items.push(data);
      }
      if (!items.length) continue;
      report.tokens += items.length; report.scenes++;
      await replaceTokens(scene, items);
      await tick();
    }
    // токены вернулись из компендиума со старыми именами: если имена уже перенесены, переносим и их
    if (report.tokens && game.settings.get(MOD, "state")?.applied) await run("apply");
    return report;
  }

  // существа-замены
  const mobs = new Map();
  for (const swap of table) {
    const mob = await importMob(swap, dry);
    if (mob) mobs.set(swap.uuid, mob); else report.missing.push(`${swap.name} (${swap.book})`);
  }
  const byOld = new Map(table.map((s) => [s.old, s]));
  for (const scene of sets.Scene) {
    const items = [];
    for (const tok of scene.tokens) {
      if (tok._source.flags?.[MOD]?.was) continue; // уже заменён
      const actor = game.actors.get(tok._source.actorId);
      if (!actor) continue;
      const swap = byOld.get(origName(actor));
      if (!swap) continue;
      if (swap.minHp && (actor._source.system?.attributes?.hp?.max ?? 0) < swap.minHp) continue;
      const mob = mobs.get(swap.uuid);
      if (!mob) continue;
      report.byMob[swap.name] = (report.byMob[swap.name] ?? 0) + 1;
      if (dry) { items.push(null); continue; }
      const old = tok.toObject();
      const proto = mob.prototypeToken.toObject();
      const data = { ...old, actorId: mob.id, actorLink: false, name: cleanName(proto.name || mob.name), texture: await mobTexture(mob) };
      for (const k of FROM_PROTO) if (k in proto) data[k] = proto[k];
      delete data.delta;
      // от старого токена берём чужие флаги, но не сохранённое прежнее имя: иначе «вернуть имена» назвало бы нового моба старым
      data.flags = { ...(old.flags ?? {}), [MOD]: { was: actor.id } };
      items.push(data);
    }
    if (!items.length) continue;
    report.tokens += items.length; report.scenes++;
    if (!dry) { await replaceTokens(scene, items); await tick(); }
  }
  return report;
}

const TYPE_NAMES = { Folder: "папки", JournalEntry: "журналы", JournalEntryPage: "страницы журналов", Scene: "сцены", Token: "токены на сценах",
  Note: "заметки на картах", Drawing: "надписи на картах", Actor: "существа", Item: "предметы", RollTable: "таблицы", TableResult: "строки таблиц", Playlist: "плейлисты" };
const listReport = (r) => Object.entries(r.byType).map(([k, n]) => `<li>${TYPE_NAMES[k] ?? k}: ${n}</li>`).join("");

/** Окно мастера. */
export async function openDialog() {
  if (!game.user.isGM) return;
  const { DialogV2 } = foundry.applications.api;
  let preview, mobs;
  try { preview = await run("preview"); mobs = await runSwaps("preview"); } catch (e) { return ui.notifications.error(`Нахтмарк: ${e.message}`); }
  const state = game.settings.get(MOD, "state") ?? {};
  const mobStatus = `<p><b>Мобы.</b> К замене токенов: <b>${mobs.tokens}</b> на ${mobs.scenes} сценах.${mobs.missing.length
    ? ` Не найдены в компендиумах (модуль не установлен или не включён): ${mobs.missing.join(", ")}.` : ""}</p>`;
  const status = state.applied
    ? `<p>Перенос уже выполнен. ${preview.docs ? `С тех пор изменилось документов: <b>${preview.docs}</b> — нажмите «Перенести», чтобы обновить.` : "Все документы в порядке."}</p>`
    : `<p>Будет изменено документов: <b>${preview.docs}</b>, полей: <b>${preview.fields}</b>.</p><ul>${listReport(preview)}</ul>`;
  const answer = await DialogV2.wait({
    window: { title: "Нахтмарк — перенос приключения" },
    content: `<p>Модуль заменяет имена и названия в импортированном приключении на имена Нахтмарка: журналы, сцены, существа, предметы, таблицы, заметки на картах.</p>
      <p><b>Имена.</b></p>${status}
      ${mobStatus}
      <p><b>Сначала сделайте копию мира.</b> Имена возвращаются из сохранённых значений, мобы - из компендиума приключения.</p>
      <p>Не меняются: подписи, нарисованные на самих картах, английские названия в квадратных скобках и папки видеосцен. Мобов меняйте вне боя.</p>`,
    buttons: [
      { action: "apply", label: "Имена: перенести", icon: "fa-solid fa-feather-pointed", default: true },
      { action: "revert", label: "Имена: вернуть", icon: "fa-solid fa-rotate-left" },
      { action: "mobs", label: "Мобы: заменить", icon: "fa-solid fa-skull" },
      { action: "mobs-revert", label: "Мобы: вернуть", icon: "fa-solid fa-rotate-left" },
      { action: "close", label: "Закрыть", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (answer === "mobs" || answer === "mobs-revert") {
    ui.notifications.info(answer === "mobs" ? "Нахтмарк: меняю мобов…" : "Нахтмарк: возвращаю прежних мобов…");
    try {
      const report = await runSwaps(answer === "mobs" ? "apply" : "revert");
      ui.notifications.info(`Нахтмарк: готово. Токенов: ${report.tokens}, сцен: ${report.scenes}.`);
      console.log(`${MOD} | ${answer}`, report);
    } catch (e) {
      console.error(`${MOD} |`, e);
      ui.notifications.error(`Нахтмарк: ${e.message}`);
    }
    return;
  }
  if (answer !== "apply" && answer !== "revert") return;
  ui.notifications.info(answer === "apply" ? "Нахтмарк: переношу, это займёт до минуты…" : "Нахтмарк: возвращаю исходные названия…");
  try {
    const report = await run(answer);
    ui.notifications.info(`Нахтмарк: готово. Изменено документов: ${report.docs}, полей: ${report.fields}.`);
    console.log(`${MOD} | ${answer}`, report);
  } catch (e) {
    console.error(`${MOD} |`, e);
    ui.notifications.error(`Нахтмарк: ${e.message}`);
  }
}

Hooks.once("init", () => {
  game.settings.register(MOD, "state", { scope: "world", config: false, type: Object, default: { applied: false, v: 0 } });

  // книга отряда
  game.settings.register(MOD, "book", { scope: "world", config: false, type: Object, default: { q: {}, o: {}, e: {} }, onChange: () => refreshBook() });
  game.settings.register(MOD, "travel", {
    name: "Клик по метке на карте книги",
    hint: "Что происходит, когда игрок нажимает на метку места в Книге Нахтмарка.",
    scope: "world", config: true, type: String, default: "self",
    choices: {
      self: "Игрок сразу переходит на сцену сам",
      ask: "Спросить мастера",
      party: "Мастер автоматически переводит весь отряд",
      off: "Только открыть страницу места"
    }
  });
  registerSfx();
  game.keybindings.register(MOD, "book", {
    name: "Открыть или закрыть Книгу Нахтмарка",
    editable: [{ key: "KeyB" }],
    onDown: () => { toggleBook(); return true; }
  });
});

Hooks.on("canvasReady", () => refreshBook());

// кнопка книги в панели инструментов слева
Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens?.tools;
  if (!tools) return;
  tools.nachtmarkBook = {
    name: "nachtmarkBook", title: "Книга Нахтмарка", icon: "fa-solid fa-book-open",
    order: Object.keys(tools).length, button: true,
    onChange: () => toggleBook()
  };
});

Hooks.once("ready", () => {
  game.socket.on(`module.${MOD}`, onBookSocket);
  game.modules.get(MOD).api = { open: openDialog, run, swaps: runSwaps, convert: (text) => convertHTML(text, RULES),
    book: openBook, toggleBook, travel: bookTravel };
  if (!game.user.isGM) return;
  const state = game.settings.get(MOD, "state") ?? {};
  if (!state.applied && game.packs.get(PACK))
    ui.notifications.info("Нахтмарк: приключение найдено. Кнопка «Нахтмарк» — во вкладке журналов.");
});

// кнопка во вкладке журналов
Hooks.on("renderJournalDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".nachtmark-open")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nachtmark-open";
  btn.innerHTML = `<i class="fa-solid fa-feather-pointed"></i> Нахтмарк`;
  btn.addEventListener("click", () => openDialog());
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(btn);
});
