// Нахтмарк: переименование импортированного приключения под Эластрию.
// Модуль ничего не хранит из чужого текста: он правит документы уже в мире мастера по словарю имён
// и запоминает исходные значения во флагах, чтобы всё можно было вернуть.
import { convertHTML, convertPlain } from "./engine.js";
import { RULES, NAME_OVERRIDES, sceneNameOverride, DICT_VERSION } from "./dictionary.js";

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

const TYPE_NAMES = { Folder: "папки", JournalEntry: "журналы", JournalEntryPage: "страницы журналов", Scene: "сцены", Token: "токены на сценах",
  Note: "заметки на картах", Drawing: "надписи на картах", Actor: "существа", Item: "предметы", RollTable: "таблицы", TableResult: "строки таблиц", Playlist: "плейлисты" };
const listReport = (r) => Object.entries(r.byType).map(([k, n]) => `<li>${TYPE_NAMES[k] ?? k}: ${n}</li>`).join("");

/** Окно мастера. */
export async function openDialog() {
  if (!game.user.isGM) return;
  const { DialogV2 } = foundry.applications.api;
  let preview;
  try { preview = await run("preview"); } catch (e) { return ui.notifications.error(`Нахтмарк: ${e.message}`); }
  const state = game.settings.get(MOD, "state") ?? {};
  const status = state.applied
    ? `<p>Перенос уже выполнен. ${preview.docs ? `С тех пор изменилось документов: <b>${preview.docs}</b> — нажмите «Перенести», чтобы обновить.` : "Все документы в порядке."}</p>`
    : `<p>Будет изменено документов: <b>${preview.docs}</b>, полей: <b>${preview.fields}</b>.</p><ul>${listReport(preview)}</ul>`;
  const answer = await DialogV2.wait({
    window: { title: "Нахтмарк — перенос приключения" },
    content: `<p>Модуль заменяет имена и названия в импортированном приключении на имена Нахтмарка: журналы, сцены, существа, предметы, таблицы, заметки на картах.</p>
      ${status}
      <p><b>Сначала сделайте копию мира.</b> Исходные значения сохраняются, кнопка «Вернуть как было» их восстанавливает.</p>
      <p>Не меняются: подписи, нарисованные на самих картах, английские названия в квадратных скобках и папки видеосцен.</p>`,
    buttons: [
      { action: "apply", label: "Перенести в Нахтмарк", icon: "fa-solid fa-feather-pointed", default: true },
      { action: "revert", label: "Вернуть как было", icon: "fa-solid fa-rotate-left" },
      { action: "close", label: "Закрыть", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
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
});

Hooks.once("ready", () => {
  game.modules.get(MOD).api = { open: openDialog, run, convert: (text) => convertHTML(text, RULES) };
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
