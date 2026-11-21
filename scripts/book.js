/* ===== Книга Нахтмарка: тёмная кожа, тусклое железо, серый пергамент ===== */
import { MOD, getContent, getState, saveState } from "./book-const.js";
import { bookHTML, esc, isOpen, STATUS } from "./render.js";
import { sfx } from "./sfx.js";

const TAB_OF = (C, id) => ["quests", "npcs", "places", "letters"].find((t) => C[t].some((x) => x.id === id));
const NAMES = { npcs: "Новое знакомство", places: "Новое место", letters: "Новая бумага" };
const ICONS = { npcs: "👤", places: "🏰", letters: "✉" };

/* ---------- уведомление-свиток ---------- */
export function toast({ title, sub = "", icon = "📜", tab = null, sel = null, kind = "" }, broadcast = false) {
  if (broadcast) game.socket.emit(`module.${MOD}`, { action: "toast", data: { title, sub, icon, tab, sel, kind } });
  const el = document.createElement("div");
  el.className = `bb-toast ${kind}`;
  el.innerHTML = `<i class="bb-roll"></i><div class="bb-tpaper"><span class="bb-seal">${icon}</span><div><b>${esc(title)}</b>${sub ? `<em>${esc(sub)}</em>` : ""}</div></div><i class="bb-roll"></i>`;
  if (tab) {
    el.classList.add("click");
    el.title = "Открыть в книге";
    el.addEventListener("click", () => { openBook(tab, sel); el.classList.add("out"); });
  }
  document.body.appendChild(el);
  sfx(kind === "done" ? "stamp" : kind === "failed" ? "fail" : tab === "quests" ? "pen" : "find");
  setTimeout(() => el.classList.add("out"), 5200);
  setTimeout(() => el.remove(), 6000);
}

/* ---------- окно ---------- */
const { ApplicationV2 } = foundry.applications.api;
export class BorderlandsBook extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "nachtmark-book", classes: ["bb-app"],
    window: { frame: false, positioned: true },
    position: { width: 1040, height: 700 }
  };
  view = { tab: "map", sel: null };
  _first = true;

  async _renderHTML() {
    const C = await getContent();
    const el = document.createElement("div");
    this.view.here = C.places.find((p) => p.scene === canvas?.scene?.id)?.id ?? null;
    el.innerHTML = bookHTML(C, getState(), this.view, game.user.isGM);
    return el;
  }

  _replaceHTML(result, content) {
    const turned = this._turn; this._turn = false;
    content.replaceChildren(result);
    const bk = content.querySelector(".bb-book");
    if (this._first) { bk.classList.add("opening"); this._first = false; }
    if (turned) content.querySelector(".bb-turn")?.classList.add("flip");
    const go = (tab, sel) => { sfx("page"); this.view = { tab, sel }; this._turn = true; this.render(); };

    content.querySelector(".bb-close").onclick = () => this.close();
    content.querySelectorAll("[data-tab]").forEach((a) => a.onclick = () => { sfx("tab"); go(a.dataset.tab, null); });
    content.querySelectorAll("[data-sel]").forEach((li) => li.onclick = () => go(this.view.tab, li.dataset.sel));
    content.querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(...a.dataset.go.split(":")));
    content.querySelectorAll("[data-zoom]").forEach((im) => im.onclick = () => {
      const IP = foundry.applications.apps.ImagePopout;
      new IP({ src: im.getAttribute("src"), window: { title: im.dataset.zoom } }).render({ force: true });
    });
    content.querySelectorAll("[data-travel]").forEach((a) => a.onclick = (e) => { e.stopPropagation(); travel(a.dataset.travel, e); });
    content.querySelectorAll("[data-etravel]").forEach((a) => a.onclick = (e) => { e.stopPropagation(); travel(a.dataset.etravel, e); });
    content.querySelectorAll("[data-eroll]").forEach((b) => b.onclick = () => rollEncounter(b.dataset.eroll));
    content.querySelectorAll("[data-etable]").forEach((b) => b.onclick = () => rollTable(b.dataset.etable));
    content.querySelectorAll("[data-eopen]").forEach((a) => a.onclick = () => setEncounter(a.dataset.eopen, true));
    content.querySelectorAll("[data-ehide]").forEach((a) => a.onclick = () => setEncounter(a.dataset.ehide, false));
    // действия мастера
    content.querySelectorAll("[data-qs]").forEach((b) => b.onclick = () => setQuest(b.dataset.id, b.dataset.qs));
    content.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => setOpen([b.dataset.open], true));
    content.querySelectorAll("[data-hide]").forEach((b) => b.onclick = () => setOpen([b.dataset.hide], false));
    content.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => showAll(this.view.tab, b.dataset.show));
    content.querySelectorAll("[data-gm]").forEach((b) => b.onclick = () => openMasterPage(b.dataset.gm));
    content.querySelectorAll("[data-openall]").forEach((a) => a.onclick = (e) => { e.stopPropagation(); massOpen(this.view.tab, a.dataset.openall, true); });
    content.querySelectorAll("[data-hideall]").forEach((a) => a.onclick = (e) => { e.stopPropagation(); massOpen(this.view.tab, a.dataset.hideall, false); });

    const el = this.element;
    placeWindow(el);
    paginate(content);
    requestAnimationFrame(() => requestAnimationFrame(() => paginate(content)));
    content.querySelectorAll(".bb-page img").forEach((im) => !im.complete && im.addEventListener("load", () => paginate(content), { once: true }));
    document.fonts?.ready?.then(() => paginate(content));
    el.onpointerdown = () => toFront(el);
    content.querySelector(".bb-cover").addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".bb-page, button, a, input, select, .bb-ribbons")) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, p0 = { ...POS };
      el.classList.add("dragging");
      const mv = (ev) => { POS.left = p0.left + ev.clientX - sx; POS.top = p0.top + ev.clientY - sy; placeWindow(el); };
      const up = () => { el.classList.remove("dragging"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); savePos(); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
  }

  // положением окна управляем сами, чтобы Foundry его не сбрасывал
  setPosition() { if (this.element) placeWindow(this.element); return this.position; }

  async close(options) {
    sfx("close");
    const el = this.element?.querySelector(".bb-book");
    if (el) { el.classList.add("closing"); await new Promise((r) => setTimeout(r, 260)); }
    this._first = true;
    return super.close(options);
  }
}

/* листание: если текст не влезает - внизу страницы «‹ 1 / 3 ›» */
function paginate(content) {
  for (const pg of content.querySelectorAll(".bb-page")) {
    pg.querySelector(".bb-pager")?.remove();
    const step = () => pg.clientHeight - 70;
    const total = () => Math.max(1, Math.ceil((pg.scrollHeight - pg.clientHeight) / step()) + 1);
    if (pg.scrollHeight <= pg.clientHeight + 4) continue;
    const bar = document.createElement("div");
    bar.className = "bb-pager";
    bar.innerHTML = `<a data-pg="-1" title="Назад">‹</a><span></span><a data-pg="1" title="Дальше">›</a>`;
    pg.append(bar);
    const cur = () => Math.min(total(), Math.round(pg.scrollTop / step()) + 1);
    const upd = () => { const c = cur(), t = total(); bar.querySelector("span").textContent = `${c} / ${t}`;
      bar.querySelector("[data-pg='-1']").classList.toggle("off", c <= 1); bar.querySelector("[data-pg='1']").classList.toggle("off", c >= t); };
    bar.addEventListener("click", (e) => {
      const a = e.target.closest("[data-pg]"); if (!a) return;
      const n = Math.max(0, Math.min(total() - 1, cur() - 1 + Number(a.dataset.pg)));
      sfx("page"); pg.classList.remove("bb-flip"); void pg.offsetWidth; pg.classList.add("bb-flip");
      pg.scrollTo({ top: n * step(), behavior: "auto" });
    });
    pg.addEventListener("scroll", upd, { passive: true });
    upd();
  }
}

let book = null;
const POS = { left: null, top: null };
try { Object.assign(POS, JSON.parse(localStorage.getItem(`${MOD}.bookPos`) || "{}")); } catch (e) {}
function savePos() { try { localStorage.setItem(`${MOD}.bookPos`, JSON.stringify(POS)); } catch (e) {} }
function toFront(el) {
  if (book?.bringToFront) { try { return book.bringToFront(); } catch (e) {} }
  el.style.zIndex = String(ApplicationV2._maxZ !== undefined ? ++ApplicationV2._maxZ : 100);
}
function placeWindow(el) {
  const w = Math.min(1080, window.innerWidth - 40), h = Math.min(780, window.innerHeight - 110);
  if (POS.left === null || POS.top === null) { POS.left = (window.innerWidth - w) / 2; POS.top = (window.innerHeight - h) / 2; }
  POS.left = Math.max(-w + 120, Math.min(window.innerWidth - 120, POS.left));
  POS.top = Math.max(0, Math.min(window.innerHeight - 60, POS.top));
  Object.assign(el.style, { position: "fixed", left: `${POS.left}px`, top: `${POS.top}px`, width: `${w}px`, height: `${h}px`, maxHeight: `${h}px`, margin: "0" });
  const bk = el.querySelector(".bb-book"); if (bk) Object.assign(bk.style, { height: `${h}px`, width: `${w}px` });
  const wc = el.querySelector(".window-content"); if (wc) Object.assign(wc.style, { height: `${h}px`, maxHeight: `${h}px`, overflow: "visible" });
  if (!el.style.zIndex) toFront(el);
}
window.addEventListener("resize", () => { if (book?.rendered) placeWindow(book.element); });

export function openBook(tab, sel = null, extra = {}) {
  book ??= new BorderlandsBook();
  if (tab) book.view = { tab, sel, ...extra };
  if (book.rendered) { book._turn = true; book.render(); toFront(book.element); return; }
  sfx("open");
  book.render({ force: true });
}
export function toggleBook() { if (book?.rendered) book.close(); else openBook(); }
export function refreshBook() { if (book?.rendered) book.render(); }

/* ---------- действия мастера ---------- */
async function setQuest(id, status) {
  if (!game.user.isGM) return;
  const C = await getContent();
  const q = C.quests.find((x) => x.id === id);
  const st = getState();
  st.q[id] = status || null; // settings сливает объекты: delete не стирает ключ
  await saveState(st);
  refreshBook();
  if (!status) return;
  const giver = C.npcs.find((x) => x.id === q.giver);
  const head = { active: "Новое задание", done: "Задание выполнено", failed: "Задание провалено" }[status];
  toast({ title: `${head}: ${q.n}`, sub: giver ? `${giver.n} · ${giver.role}` : "", icon: status === "active" ? "📜" : STATUS[status].mark, tab: "quests", sel: id, kind: status }, true);
}

async function setOpen(ids, open, quiet = false) {
  if (!game.user.isGM) return;
  const C = await getContent();
  const st = getState();
  const fresh = ids.filter((id) => open && !st.o[id]);
  for (const id of ids) st.o[id] = open ? true : null;
  await saveState(st);
  refreshBook();
  if (quiet || !fresh.length) return;
  if (fresh.length === 1) {
    const tab = TAB_OF(C, fresh[0]);
    const it = C[tab].find((x) => x.id === fresh[0]);
    toast({ title: `${NAMES[tab]}: ${it.n}`, sub: it.role ?? it.g ?? "", icon: ICONS[tab], tab, sel: it.id }, true);
  } else {
    const tab = TAB_OF(C, fresh[0]);
    toast({ title: `В книге новые записи: ${fresh.length}`, sub: C[tab].find((x) => x.id === fresh[0]).g ?? "", icon: ICONS[tab], tab }, true);
  }
}

async function massOpen(tab, group, open) {
  const C = await getContent();
  await setOpen(C[tab].filter((x) => x.g === group).map((x) => x.id), open);
}

/** Раскрыть книгу у всех на нужной странице. */
async function showAll(tab, id) {
  if (!game.user.isGM) return;
  if (!isOpen(getState(), tab, id)) return ui.notifications.warn("Сначала откройте запись игрокам.");
  game.socket.emit(`module.${MOD}`, { action: "show", data: { tab, sel: id } });
  ui.notifications.info("Книга раскрыта у игроков на этой странице.");
}

/** Открыть исходную страницу приключения - подробности и секреты остаются там. */
async function openMasterPage(ref) {
  const page = await fromUuid(ref);
  if (!page) return ui.notifications.warn("Страница не найдена: импортируйте приключение в этот мир.");
  page.parent.sheet.render(true, { pageId: page.id });
}

/* ---------- путешествие: клик по метке ведёт на сцену места ---------- */
/** Цель путешествия: место или встреча в Диких землях (у встречи своя карта). */
function target(C, id, st) {
  const p = C.places.find((x) => x.id === id);
  if (p) return { id, n: p.n, g: p.g, scene: p.scene, page: p.id, open: isOpen(st, "places", id), toggle: (v) => setOpen([id], v) };
  const e = (C.encounters ?? []).find((x) => x.id === id);
  if (!e) return null;
  const area = C.places.find((x) => x.id === e.area);
  return { id, n: e.n, g: area.n, scene: e.scene, page: area.id, open: !!st.e?.[id], toggle: (v) => setEncounter(id, v) };
}

export async function travel(targetId, ev = {}) {
  const C = await getContent();
  const p = target(C, targetId, getState());
  if (!p?.scene) return;
  const scene = game.scenes.get(p.scene);
  if (!scene) return ui.notifications.warn("Сцена не найдена: импортируйте приключение в этот мир.");
  const open = p.open, placeId = targetId;
  if (game.user.isGM) {
    if (ev.altKey) return p.toggle(!open);
    if (ev.shiftKey) return moveParty(scene, p);
    return scene.view();
  }
  if (!open) return;
  const mode = game.settings.get(MOD, "travel");
  if (mode === "off") return openBook("places", p.page);
  if (mode === "self") {
    toast({ title: `${game.user.name} отправляется: ${p.n}`, sub: p.g, icon: "🧭", tab: "places", sel: p.page }, true);
    if (book?.rendered) book.close();
    return scene.view();
  }
  if (!game.users.activeGM) return ui.notifications.warn("Мастера нет в сети - отправиться пока нельзя.");
  game.socket.emit(`module.${MOD}`, { action: "travel", data: { place: placeId, user: game.user.id } });
  ui.notifications.info(mode === "ask" ? "Просьба отправлена мастеру." : `Отряд отправляется: ${p.n}`);
}

async function moveParty(scene, p) {
  toast({ title: `Отряд отправляется: ${p.n}`, sub: p.g, icon: "🧭", tab: "places", sel: p.page }, true);
  await scene.activate({ pullUsers: true }); // если сцена уже активна - подтянуть тех, кто смотрит другую
}

/* ---------- случайные встречи в Диких землях ---------- */
const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** Бросок к4 по основным сценам области. Результат видит только мастер. */
async function rollEncounter(areaId) {
  if (!game.user.isGM) return;
  const C = await getContent();
  const area = C.places.find((x) => x.id === areaId);
  const roll = await new Roll("1d4").evaluate();
  const e = C.encounters.find((x) => x.area === areaId && x.roll === roll.total);
  const again = getState().e?.[e.id] ? " Эта встреча уже была: бросьте ещё раз или выберите другую." : "";
  await roll.toMessage({ flavor: `<b>${esc(area.n)}: ${esc(e.n)}</b>.${again}`, speaker: { alias: "Книга Нахтмарка" }, whisper: gmIds() });
  sfx("find");
  openBook("places", areaId, { enc: e.id });
}

/** Бросок по родной таблице случайных сцен приключения (к8). Текст остаётся в таблице, результат шёпотом мастеру. */
async function rollTable(areaId) {
  if (!game.user.isGM) return;
  const C = await getContent();
  const table = await fromUuid(C.places.find((x) => x.id === areaId)?.table ?? "");
  if (!table) return ui.notifications.warn("Таблица не найдена: включите модуль с таблицами.");
  const { roll, results } = await table.roll();
  await table.toMessage(results, { roll, messageData: { whisper: gmIds() } });
}

/** Записать встречу в книгу игроков или убрать её оттуда. */
async function setEncounter(id, on) {
  if (!game.user.isGM) return;
  const C = await getContent();
  const e = C.encounters.find((x) => x.id === id);
  const st = getState();
  st.e ??= {};
  const fresh = on && !st.e[id];
  st.e[id] = on ? true : null;
  await saveState(st);
  refreshBook();
  if (fresh) toast({ title: `Встреча в пути: ${e.n}`, sub: C.places.find((x) => x.id === e.area).n, icon: "⚔", tab: "places", sel: e.area }, true);
}

/** Просьба игрока пришла мастеру (режимы «спросить мастера» и «весь отряд»). */
async function onTravelRequest({ place, user }) {
  if (!game.users.activeGM?.isSelf) return;
  const C = await getContent();
  const p = target(C, place, getState());
  const scene = game.scenes.get(p?.scene);
  const who = game.users.get(user);
  if (!scene || !who || !p.open) return;
  if (game.settings.get(MOD, "travel") === "party") return moveParty(scene, p);
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "Книга Нахтмарка: путешествие" },
    content: `<p><b>${esc(who.name)}</b> хочет отправиться: <b>${esc(p.n)}</b>.</p>`,
    buttons: [
      { action: "party", label: "Весь отряд", icon: "fa-solid fa-users", default: true },
      { action: "one", label: "Только его", icon: "fa-solid fa-user" },
      { action: "no", label: "Не сейчас", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (answer === "party") return moveParty(scene, p);
  if (answer === "one") return scene.pullUsers([who]);
  game.socket.emit(`module.${MOD}`, { action: "deny", data: { user, place: p.n } });
}

export function onSocket({ action, data }) {
  if (action === "toast") toast(data);
  if (action === "show" && !game.user.isGM) openBook(data.tab, data.sel);
  if (action === "travel") onTravelRequest(data);
  if (action === "deny" && data.user === game.user.id) ui.notifications.info(`Мастер пока не отпускает: ${data.place}.`);
}
