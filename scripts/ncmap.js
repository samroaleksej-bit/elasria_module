/*
 * Найт-Сити · интерактивная карта (Foundry VTT v12, система любая — сделано под Cyberpunk RED).
 * Карта с точками интереса, районами и опасными зонами, прокладка маршрутов, квесты от фиксеров,
 * метка «Мы здесь» и показ карты игрокам. Состояние (квесты, правки точек, метка, общий маршрут)
 * хранится в настройке мира и сразу расходится всем клиентам.
 */
import { MAP_SIZE, POIS, DISTRICTS, ZONES } from "./data.js";

const MID = "night-city-map";
const SOCKET = `module.${MID}`;
const ROOT = "ncm";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isGM = () => !!game.user?.isGM;
const rid = () => foundry.utils.randomID(10);
const clone = (o) => foundry.utils.deepClone(o);

const CATS = {
  culture: { ru: "Культура и искусство", color: "#ff7a2f", icon: "fa-palette" },
  club: { ru: "Клубы и ночная жизнь", color: "#3d5bff", icon: "fa-music" },
  arts: { ru: "Шоу и спорт", color: "#c040e0", icon: "fa-film" },
  public: { ru: "Городские службы", color: "#b0552a", icon: "fa-building-columns" },
  corp: { ru: "Корпорации", color: "#2fbf4a", icon: "fa-building" },
  food: { ru: "Отели, бары, еда", color: "#20c4c0", icon: "fa-martini-glass" },
  other: { ru: "Прочее", color: "#e0303a", icon: "fa-star" },
  custom: { ru: "Метки мастера", color: "#f5e663", icon: "fa-location-dot" }
};
const DANGER = ["Безопасно", "Спокойно", "Неспокойно", "Опасно", "Боевая зона", "Горячая зона"];
const TRANSPORT = [
  { id: "foot", ru: "Пешком", kmh: 5, icon: "fa-person-walking" },
  { id: "bike", ru: "Мотоцикл", kmh: 45, icon: "fa-motorcycle" },
  { id: "car", ru: "Машина", kmh: 35, icon: "fa-car" },
  { id: "av", ru: "AV / ави", kmh: 160, icon: "fa-helicopter" }
];
const QSTATUS = { hidden: "Скрыт", active: "Активен", done: "Выполнен", failed: "Провален" };

/* ================================================================ настройки и состояние */

const DEFAULT_STATE = { quests: [], pins: [], poi: {}, party: null, route: null, visited: [] };

Hooks.once("init", () => {
  game.settings.register(MID, "state", { scope: "world", config: false, type: Object, default: DEFAULT_STATE, onChange: () => UI.refresh() });
  game.settings.register(MID, "image", {
    name: "Картинка карты", hint: "Файл карты Найт-Сити 2045 (без легенды). Точки привязаны к пропорциям этой карты.",
    scope: "world", config: true, type: String, filePicker: "image", default: `modules/${MID}/assets/night-city-2045.webp`, onChange: () => UI.rebuild()
  });
  game.settings.register(MID, "widthKm", {
    name: "Ширина карты, км", hint: "Для расчёта расстояний и времени в пути.", scope: "world", config: true, type: Number, default: 14, range: { min: 4, max: 60, step: 1 }
  });
  game.settings.register(MID, "notify", { name: "Уведомлять игроков о новых квестах", scope: "world", config: true, type: Boolean, default: true });
  game.keybindings.register(MID, "open", {
    name: "Открыть карту Найт-Сити", editable: [{ key: "KeyM", modifiers: ["Shift"] }],
    onDown: () => { UI.toggle(); return true; }
  });
});

const state = () => foundry.utils.mergeObject(clone(DEFAULT_STATE), clone(game.settings.get(MID, "state") ?? {}), { inplace: false });
async function save(mut) {
  if (!isGM()) return ui.notifications.warn("Карта: изменять может только мастер.");
  const s = state();
  mut(s);
  await game.settings.set(MID, "state", s);
}

/* ================================================================ данные */

/** Все точки: базовые + метки мастера, с учётом правок мастера. Скрытые — только мастеру. */
function allPois() {
  const s = state();
  const base = POIS.map(p => ({ ...p, ...(s.poi[p.id] ?? {}) }));
  const pins = s.pins.map(p => ({ cat: "custom", ...p }));
  return [...base, ...pins].filter(p => isGM() || !p.hidden);
}
const poiById = (id) => allPois().find(p => p.id === id);
const questsVisible = () => state().quests.filter(q => isGM() || q.status !== "hidden");

function districtAt(x, y) {
  let best = null, bd = Infinity;
  for (const d of DISTRICTS) { if (d.id === "delbay" || d.id === "sanbay") continue; const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function inPoly(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const aspect = MAP_SIZE.h / MAP_SIZE.w;
const inCircle = (x, y, c) => Math.hypot(x - c.x, (y - c.y) * aspect) < c.r;
function zoneAt(x, y) {
  if (inCircle(x, y, ZONES.hot)) return "hot";
  if (inPoly(x, y, ZONES.combat) && !inCircle(x, y, ZONES.glen)) return "combat";
  return null;
}

/* ================================================================ маршрут */

/** Сетка проходимости (assets/roads.png): 255 — улица, 128 — суша, 0 — вода. */
const GRID = { w: 0, h: 0, cell: null, ready: null };
function loadGrid() {
  GRID.ready ??= new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      GRID.w = img.width; GRID.h = img.height; GRID.cell = new Uint8Array(img.width * img.height);
      for (let i = 0; i < GRID.cell.length; i++) { const v = d[i * 4]; GRID.cell[i] = v > 200 ? 1 : v > 60 ? 2 : 0; }
      res(true);
    };
    img.onerror = () => res(false);
    img.src = `modules/${MID}/assets/roads.png`;
  });
  return GRID.ready;
}
const COST = [Infinity, 1, 7]; // вода / улица / дворы и пустыри

/** A* по сетке: путь от a до b (доли 0..1) → массив точек (доли). */
function findPath(a, b) {
  const { w, h, cell } = GRID;
  if (!cell) return [a, b];
  const idx = (x, y) => y * w + x;
  const snap = (p) => {
    const x = Math.round(p.x * (w - 1)), y = Math.round(p.y * (h - 1));
    if (cell[idx(x, y)] === 1) return idx(x, y);
    for (let r = 1; r < 25; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && cell[idx(nx, ny)] === 1) return idx(nx, ny);
    }
    return cell[idx(x, y)] ? idx(x, y) : -1;
  };
  const s = snap(a), t = snap(b);
  if (s < 0 || t < 0) return [a, b];
  const tx = t % w, ty = (t / w) | 0;
  const g = new Float32Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
  const heap = [];
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  g[s] = 0; push(0, s);
  let found = false, guard = 0;
  while (heap.length && guard++ < 800000) {
    const [, i] = pop();
    if (closed[i]) continue; closed[i] = 1;
    if (i === t) { found = true; break; }
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy, dc] of D) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = idx(nx, ny), c = COST[cell[j]]; if (c === Infinity || closed[j]) continue;
      const ng = g[i] + dc * c;
      if (ng < g[j]) { g[j] = ng; from[j] = i; push(ng + Math.hypot(tx - nx, ty - ny), j); }
    }
  }
  if (!found) return [a, b];
  const raw = []; for (let i = t; i >= 0; i = from[i]) raw.push({ x: (i % w) / (w - 1), y: ((i / w) | 0) / (h - 1) });
  raw.reverse();
  return [a, ...simplify(raw, 0.8 / w), b];
}
/** Упрощение ломаной (Рамер — Дуглас — Пекер). */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts.at(-1);
  let md = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
    const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
    if (d > md) { md = d; mi = i; }
  }
  return md > eps ? [...simplify(pts.slice(0, mi + 1), eps).slice(0, -1), ...simplify(pts.slice(mi), eps)] : [a, b];
}
/** Полный путь по путевым точкам. */
function buildPath(wps) {
  if (wps.length < 2) return wps.slice();
  const out = [wps[0]];
  for (let i = 1; i < wps.length; i++) out.push(...findPath(wps[i - 1], wps[i]).slice(1));
  return out;
}

function routeStats(pts, streets = false) {
  const km = game.settings.get(MID, "widthKm");
  let dist = 0, combat = 0, hot = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, (b.y - a.y) * aspect) * km;
    dist += seg;
    for (let t = 0; t <= 1; t += 0.05) {
      const z = zoneAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (z === "combat") combat += seg * 0.05; else if (z === "hot") hot += seg * 0.05;
    }
  }
  // по улицам дорога длиннее прямой — коэффициент извилистости
  const road = streets ? dist : dist * 1.3;
  return { dist, road, combat, hot };
}
const fmtTime = (h) => h < 1 / 60 ? "<1 мин" : h < 1 ? `${Math.round(h * 60)} мин` : `${Math.floor(h)} ч ${Math.round((h % 1) * 60)} мин`;

/* ================================================================ интерфейс */

const UI = {
  el: null, view: { x: 0, y: 0, s: 0.5 }, sel: null, mode: "browse", route: [], filter: new Set(Object.keys(CATS)), query: "", tab: "info",
  drag: null, streets: true, path: [],

  toggle() { this.el ? this.close() : this.open(); },
  open(focus = null) {
    if (!this.el) this.build();
    if (focus) this.focus(focus.x, focus.y, focus.s);
  },
  close() {
    if (!this.el) return;
    this.el.classList.remove("ncm-in");
    const el = this.el; this.el = null;
    setTimeout(() => el.remove(), 250);
  },
  rebuild() { if (this.el) { this.el.remove(); this.el = null; this.build(); } },
  refresh() { if (this.el) { this.renderMarkers(); this.renderSvg(); this.renderPanel(); this.renderQuestList(); } },

  build() {
    const el = document.createElement("div");
    el.id = ROOT;
    el.innerHTML = `
      <header class="ncm-top">
        <div class="ncm-brand"><span>NIGHT CITY</span><small>2045 · NET MAP</small></div>
        <label class="ncm-search"><i class="fas fa-magnifying-glass"></i><input type="search" placeholder="Поиск: бар, корпорация, район…"></label>
        <div class="ncm-modes">
          <button data-act="mode-route" title="Проложить маршрут: кликайте точки на карте"><i class="fas fa-route"></i> Маршрут</button>
          <button data-act="quests" title="Список заказов"><i class="fas fa-scroll"></i> Заказы</button>
          ${isGM() ? `<button data-act="mode-party" title="Поставить метку «Мы здесь»"><i class="fas fa-users"></i> Мы здесь</button>
          <button data-act="mode-pin" title="Добавить свою точку"><i class="fas fa-location-dot"></i> Точка</button>
          <button data-act="share" title="Открыть карту у всех игроков на этом месте"><i class="fas fa-satellite-dish"></i> Показать всем</button>` : ""}
        </div>
        <button class="ncm-x" data-act="close" title="Закрыть (Esc)"><i class="fas fa-xmark"></i></button>
      </header>
      <nav class="ncm-cats">${Object.entries(CATS).map(([k, c]) => `<button data-cat="${k}" class="on" style="--c:${c.color}"><i class="fas ${c.icon}"></i>${c.ru}</button>`).join("")}</nav>
      <div class="ncm-viewport">
        <div class="ncm-world">
          <img class="ncm-img" src="${esc(game.settings.get(MID, "image"))}" alt="" draggable="false">
          <svg class="ncm-svg" viewBox="0 0 1000 ${Math.round(1000 * aspect)}" preserveAspectRatio="none"></svg>
          <div class="ncm-labels"></div>
          <div class="ncm-markers"></div>
        </div>
        <div class="ncm-hint"></div>
        <div class="ncm-zoom"><button data-act="zin">+</button><button data-act="zout">−</button><button data-act="fit" title="Вся карта"><i class="fas fa-expand"></i></button></div>
      </div>
      <aside class="ncm-panel"></aside>
      <aside class="ncm-quests"></aside>
      <div class="ncm-scan"></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.world = el.querySelector(".ncm-world");
    this.vp = el.querySelector(".ncm-viewport");
    const img = el.querySelector(".ncm-img");
    const ready = () => { this.fit(); this.renderLabels(); this.renderMarkers(); this.renderSvg(); };
    img.complete && img.naturalWidth ? ready() : img.addEventListener("load", ready, { once: true });
    img.addEventListener("error", () => ui.notifications.error("Карта Найт-Сити: не найден файл картинки. Укажите его в настройках модуля."), { once: true });
    this.bind();
    this.renderPanel();
    this.renderQuestList();
    loadGrid();
    requestAnimationFrame(() => el.classList.add("ncm-in"));
  },

  /* ------------------------------------------------ вид */
  size() { const img = this.el.querySelector(".ncm-img"); return { w: img.naturalWidth || MAP_SIZE.w, h: img.naturalHeight || MAP_SIZE.h }; },
  apply() {
    const { x, y, s } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    this.world.style.setProperty("--inv", 1 / s);
    this.el.classList.toggle("ncm-far", s < 0.42);
  },
  fit() {
    const { w, h } = this.size(); const r = this.vp.getBoundingClientRect();
    const s = Math.min(r.width / w, r.height / h) * 0.98;
    this.world.style.width = `${w}px`; this.world.style.height = `${h}px`;
    this.view = { s, x: (r.width - w * s) / 2, y: (r.height - h * s) / 2 };
    this.apply();
  },
  zoomAt(f, cx, cy) {
    const v = this.view, r = this.vp.getBoundingClientRect();
    const ns = Math.min(4, Math.max(0.15, v.s * f));
    const px = (cx ?? r.width / 2), py = (cy ?? r.height / 2);
    v.x = px - (px - v.x) * (ns / v.s); v.y = py - (py - v.y) * (ns / v.s); v.s = ns;
    this.apply();
  },
  /** Центрировать точку (доли 0..1). */
  focus(fx, fy, s = null) {
    if (!this.el) return;
    const { w, h } = this.size(), r = this.vp.getBoundingClientRect();
    if (s) this.view.s = s;
    this.view.x = r.width / 2 - fx * w * this.view.s;
    this.view.y = r.height / 2 - fy * h * this.view.s;
    this.world.classList.add("ncm-anim"); this.apply();
    setTimeout(() => this.world?.classList.remove("ncm-anim"), 450);
  },
  toFrac(ev) {
    const r = this.world.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  },

  /* ------------------------------------------------ слои */
  renderLabels() {
    this.el.querySelector(".ncm-labels").innerHTML = DISTRICTS.map(d =>
      `<div class="ncm-dist d${d.danger}" data-dist="${d.id}" style="left:${d.x * 100}%;top:${d.y * 100}%">${esc(d.ru)}</div>`).join("");
  },
  renderMarkers() {
    const s = state(), q = this.query.toLowerCase();
    const qByPoi = {};
    for (const qu of questsVisible()) if (qu.status === "active" || (isGM() && qu.status === "hidden")) { if (qu.target) (qByPoi[qu.target] ??= []).push(qu); if (qu.giver) (qByPoi[qu.giver] ??= []).push(qu); }
    const html = allPois().filter(p => this.filter.has(p.cat)).map(p => {
      const c = CATS[p.cat] ?? CATS.custom;
      const hit = !q || `${p.name} ${p.desc ?? ""} ${p.n ?? ""}`.toLowerCase().includes(q);
      const qs = qByPoi[p.id];
      return `<button class="ncm-pin${this.sel === p.id ? " sel" : ""}${hit ? "" : " dim"}${p.hidden ? " secret" : ""}${qs ? " has-q" : ""}${s.visited.includes(p.id) ? " visited" : ""}"
        data-poi="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${c.color}" title="${esc(p.name)}">
        <span class="ncm-dot">${p.n ?? `<i class="fas ${c.icon}"></i>`}</span>
        ${qs ? `<span class="ncm-qmark">!</span>` : ""}
        <span class="ncm-name">${esc(p.name)}</span></button>`;
    }).join("");
    const party = s.party ? `<div class="ncm-party" style="left:${s.party.x * 100}%;top:${s.party.y * 100}%"><span></span><b>МЫ ЗДЕСЬ</b></div>` : "";
    this.el.querySelector(".ncm-markers").innerHTML = html + party;
  },
  renderSvg() {
    const H = 1000 * aspect, P = (p) => `${(p.x * 1000).toFixed(1)},${(p.y * H).toFixed(1)}`;
    const shared = state().route;
    const mine = this.path.length ? this.path : this.route;
    const line = (pts, cls, wps = pts) => pts.length > 1 ? `<polyline class="${cls}" points="${pts.map(P).join(" ")}"/>` +
      wps.map((p, i) => `<circle class="${cls}-pt${i === 0 ? " start" : i === wps.length - 1 ? " end" : ""}" cx="${(p.x * 1000).toFixed(1)}" cy="${(p.y * H).toFixed(1)}" r="${i === 0 || i === wps.length - 1 ? 5 : 3}"/>`).join("") : "";
    this.el.querySelector(".ncm-svg").innerHTML = `
      <defs><filter id="ncmglow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${shared?.pts?.length > 1 ? line(shared.path ?? shared.pts, "ncm-rt ncm-rt-shared", shared.pts) : ""}
      ${line(mine, "ncm-rt", this.route)}`;
    this.renderHint();
  },
  renderHint() {
    const h = this.el.querySelector(".ncm-hint");
    const msg = { route: "Маршрут: кликайте по карте или точкам — каждая точка добавляет поворот. Правый клик — убрать последнюю.",
      party: "Кликните по карте, чтобы поставить метку «Мы здесь».", pin: "Кликните по карте, чтобы добавить свою точку." }[this.mode];
    h.innerHTML = msg ? `<i class="fas fa-crosshairs"></i> ${msg} <button data-act="mode-off">Готово</button>` : "";
    h.classList.toggle("on", !!msg);
    this.el.querySelectorAll(".ncm-modes button").forEach(b => b.classList.toggle("on", b.dataset.act === `mode-${this.mode}`));
    this.vp.classList.toggle("ncm-pick", this.mode !== "browse");
  },

  /* ------------------------------------------------ панель справа */
  renderPanel() {
    const panel = this.el.querySelector(".ncm-panel");
    if (this.route.length > 1 || (this.mode === "route")) return this.renderRoutePanel(panel);
    const p = this.sel && poiById(this.sel);
    if (!p) { panel.classList.remove("on"); panel.innerHTML = ""; return; }
    const c = CATS[p.cat] ?? CATS.custom, d = districtAt(p.x, p.y), z = zoneAt(p.x, p.y);
    const s = state();
    const qs = questsVisible().filter(q => q.target === p.id || q.giver === p.id);
    panel.classList.add("on");
    panel.innerHTML = `
      <div class="ncm-p-head" style="--c:${c.color}">
        <span class="ncm-p-cat"><i class="fas ${c.icon}"></i> ${c.ru}${p.n ? ` · №${p.n}` : ""}</span>
        <h2>${esc(p.name)}</h2>
        ${d ? `<button class="ncm-p-dist" data-act="dist" data-id="${d.id}">${esc(d.ru)} <small>${esc(d.en)}</small></button>` : ""}
        ${z ? `<div class="ncm-warn ${z}"><i class="fas fa-triangle-exclamation"></i> ${z === "hot" ? "Горячая зона — радиация и мародёры" : "Боевая зона — банды и перестрелки"}</div>` : ""}
        <button class="ncm-p-x" data-act="unsel"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ncm-p-body">
        <p>${esc(p.desc ?? "")}</p>
        ${isGM() && p.notes ? `<div class="ncm-gm"><b>Заметки мастера</b><p>${esc(p.notes)}</p></div>` : ""}
        ${qs.length ? `<h3><i class="fas fa-scroll"></i> Заказы</h3>${qs.map(qcard).join("")}` : ""}
        <div class="ncm-p-acts">
          <button data-act="route-from" data-id="${p.id}"><i class="fas fa-play"></i> Маршрут отсюда</button>
          <button data-act="route-to" data-id="${p.id}"><i class="fas fa-flag-checkered"></i> Маршрут сюда</button>
          ${isGM() ? `
          <button data-act="visit" data-id="${p.id}"><i class="fas fa-${s.visited.includes(p.id) ? "eye-slash" : "check"}"></i> ${s.visited.includes(p.id) ? "Не посещено" : "Посещено"}</button>
          <button data-act="edit-poi" data-id="${p.id}"><i class="fas fa-pen"></i> Править</button>
          <button data-act="new-quest" data-id="${p.id}"><i class="fas fa-plus"></i> Заказ здесь</button>
          <button data-act="toggle-hide" data-id="${p.id}"><i class="fas fa-${p.hidden ? "eye" : "eye-slash"}"></i> ${p.hidden ? "Показать игрокам" : "Скрыть от игроков"}</button>
          ${p.cat === "custom" ? `<button class="danger" data-act="del-pin" data-id="${p.id}"><i class="fas fa-trash"></i> Удалить точку</button>` : ""}` : ""}
        </div>
      </div>`;
  },
  renderRoutePanel(panel) {
    const pts = this.route, st = routeStats(this.path.length ? this.path : pts, this.path.length > 1);
    panel.classList.add("on");
    const names = pts.map(p => p.poi ? poiById(p.poi)?.name : null);
    panel.innerHTML = `
      <div class="ncm-p-head" style="--c:#ff2a6d">
        <span class="ncm-p-cat"><i class="fas fa-route"></i> Маршрут</span>
        <h2>${esc(names[0] ?? (pts[0] ? "Точка на карте" : "Выберите старт"))}${pts.length > 1 ? ` → ${esc(names.at(-1) ?? "точка на карте")}` : ""}</h2>
        <button class="ncm-p-x" data-act="route-clear"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ncm-p-body">
        ${pts.length > 1 ? `
        <label class="ncm-toggle"><input type="checkbox" data-act="streets" ${this.streets ? "checked" : ""}> По улицам (обход воды и кварталов)</label>
        <div class="ncm-stats"><div><b>${st.road.toFixed(1)}</b><span>км в пути</span></div><div><b>${routeStats(pts).dist.toFixed(1)}</b><span>км по прямой</span></div><div><b>${pts.length}</b><span>точек</span></div></div>
        ${st.hot > 0.05 ? `<div class="ncm-warn hot"><i class="fas fa-radiation"></i> Через Горячую зону: ${st.hot.toFixed(1)} км</div>` : ""}
        ${st.combat > 0.05 ? `<div class="ncm-warn combat"><i class="fas fa-triangle-exclamation"></i> Через Боевую зону: ${st.combat.toFixed(1)} км — возможна встреча с бандой</div>` : ""}
        <div class="ncm-eta">${TRANSPORT.map(t => `<div><i class="fas ${t.icon}"></i><span>${t.ru}</span><b>${fmtTime((t.id === "av" ? st.dist : st.road) / t.kmh)}</b></div>`).join("")}</div>
        <ol class="ncm-steps">${pts.map((p, i) => `<li>${esc(names[i] ?? districtAt(p.x, p.y)?.ru ?? "точка")}</li>`).join("")}</ol>` :
        `<p class="ncm-muted">Кликните по карте или по точке, чтобы задать начало, потом — следующие точки пути.</p>`}
        <div class="ncm-p-acts">
          ${this.mode !== "route" ? `<button data-act="mode-route"><i class="fas fa-pen"></i> Дорисовать</button>` : ""}
          <button data-act="route-undo"><i class="fas fa-rotate-left"></i> Убрать последнюю</button>
          ${isGM() && pts.length > 1 ? `<button data-act="route-share"><i class="fas fa-satellite-dish"></i> Показать маршрут всем</button>` : ""}
          ${isGM() && state().route ? `<button data-act="route-unshare"><i class="fas fa-eraser"></i> Стереть общий маршрут</button>` : ""}
          <button class="danger" data-act="route-clear"><i class="fas fa-trash"></i> Сбросить</button>
        </div>
      </div>`;
  },
  renderDistrict(id) {
    const d = DISTRICTS.find(x => x.id === id);
    if (!d) return;
    this.sel = null;
    const panel = this.el.querySelector(".ncm-panel");
    const inside = allPois().filter(p => districtAt(p.x, p.y)?.id === id);
    panel.classList.add("on");
    panel.innerHTML = `
      <div class="ncm-p-head" style="--c:${["#2fbf4a", "#7bd88f", "#f5e663", "#ff9f43", "#ff4d4d", "#ff2a6d"][d.danger]}">
        <span class="ncm-p-cat"><i class="fas fa-city"></i> Район · ${DANGER[d.danger]}</span>
        <h2>${esc(d.ru)}</h2><div class="ncm-muted">${esc(d.en)}</div>
        <div class="ncm-danger">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= d.danger ? "on" : ""}"></i>`).join("")}</div>
        <button class="ncm-p-x" data-act="unsel"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ncm-p-body"><p>${esc(d.desc)}</p>
        ${inside.length ? `<h3>Места района</h3><div class="ncm-list">${inside.map(p => `<button data-poi="${p.id}" style="--c:${(CATS[p.cat] ?? CATS.custom).color}"><span>${p.n ?? "•"}</span>${esc(p.name)}</button>`).join("")}</div>` : ""}
      </div>`;
    this.focus(d.x, d.y);
  },

  /* ------------------------------------------------ квесты */
  renderQuestList() {
    const box = this.el.querySelector(".ncm-quests");
    const qs = questsVisible();
    const order = { active: 0, hidden: 1, done: 2, failed: 3 };
    qs.sort((a, b) => order[a.status] - order[b.status]);
    box.innerHTML = `
      <div class="ncm-q-head"><h2><i class="fas fa-scroll"></i> Заказы</h2>
        ${isGM() ? `<button data-act="new-quest"><i class="fas fa-plus"></i> Новый</button>` : ""}
        <button class="ncm-p-x" data-act="quests"><i class="fas fa-xmark"></i></button></div>
      <div class="ncm-q-body">${qs.length ? qs.map(qcard).join("") : `<p class="ncm-muted">Пока заказов нет. Фиксеры молчат.</p>`}</div>`;
  },
  async editQuest(id = null, atPoi = null) {
    const s = state();
    const q = s.quests.find(x => x.id === id) ?? { id: rid(), title: "", fixer: "", desc: "", reward: "", status: "hidden", target: atPoi, giver: null, notes: "" };
    const opts = (sel) => `<option value="">—</option>` + allPois().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    const html = `<form class="ncm-form">
      <label>Название<input name="title" value="${esc(q.title)}" placeholder="Например: Груз для Рога"></label>
      <label>Фиксер / заказчик<input name="fixer" value="${esc(q.fixer)}" placeholder="Роуг, Ватсон…"></label>
      <div class="ncm-row"><label>Где выдают<select name="giver">${opts(q.giver)}</select></label><label>Цель<select name="target">${opts(q.target)}</select></label></div>
      <label>Описание для игроков<textarea name="desc" rows="4">${esc(q.desc)}</textarea></label>
      <div class="ncm-row"><label>Награда<input name="reward" value="${esc(q.reward)}" placeholder="2000 eb"></label>
        <label>Статус<select name="status">${Object.entries(QSTATUS).map(([k, v]) => `<option value="${k}"${k === q.status ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
      <label>Заметки мастера (игроки не видят)<textarea name="notes" rows="3">${esc(q.notes)}</textarea></label></form>`;
    const data = await formDialog(id ? "Заказ" : "Новый заказ", html);
    if (!data) return;
    const wasHidden = q.status === "hidden";
    Object.assign(q, data);
    await save(st => { const i = st.quests.findIndex(x => x.id === q.id); i >= 0 ? (st.quests[i] = q) : st.quests.push(q); });
    if (wasHidden && q.status === "active" && game.settings.get(MID, "notify")) emit({ action: "quest", id: q.id });
  },

  /* ------------------------------------------------ события */
  bind() {
    const el = this.el, vp = this.vp;
    el.addEventListener("click", (ev) => this.onClick(ev));
    el.querySelector(".ncm-search input").addEventListener("input", (ev) => { this.query = ev.target.value.trim(); this.renderMarkers(); });
    el.querySelector(".ncm-search input").addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key !== "Enter") return;
      const q = this.query.toLowerCase();
      const p = allPois().find(x => x.name.toLowerCase().includes(q)) ;
      const d = DISTRICTS.find(x => x.ru.toLowerCase().includes(q) || x.en.toLowerCase().includes(q));
      if (p) this.select(p.id, true); else if (d) this.renderDistrict(d.id);
    });
    vp.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = vp.getBoundingClientRect(); this.zoomAt(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    vp.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || ev.target.closest("button, .ncm-hint")) return;
      this.drag = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y, moved: false };
      vp.setPointerCapture(ev.pointerId);
    });
    vp.addEventListener("pointermove", (ev) => {
      const d = this.drag; if (!d) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) { this.view.x = d.vx + dx; this.view.y = d.vy + dy; this.apply(); vp.classList.add("ncm-grab"); }
    });
    vp.addEventListener("pointerup", (ev) => {
      const d = this.drag; this.drag = null; vp.classList.remove("ncm-grab");
      if (d && !d.moved && !ev.target.closest("button")) this.onMapClick(ev);
    });
    vp.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      if (this.mode === "route" && this.route.length) { this.route.pop(); this.recalc(); }
    });
    this.onKey = (ev) => {
      if (!this.el) return document.removeEventListener("keydown", this.onKey, true);
      if (ev.key === "Escape") { ev.stopPropagation(); if (this.mode !== "browse") this.setMode("browse"); else this.close(); }
    };
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", () => this.el && this.fit());
  },
  async recalc() {
    if (this.streets && this.route.length > 1) { await loadGrid(); this.path = buildPath(this.route); }
    else this.path = [];
    this.renderSvg(); this.renderPanel();
  },
  setMode(m) {
    this.mode = this.mode === m ? "browse" : m;
    if (this.mode === "route" && !this.route.length && this.sel) { const p = poiById(this.sel); if (p) this.route.push({ x: p.x, y: p.y, poi: p.id }); }
    this.renderHint(); this.renderPanel(); this.renderSvg();
  },
  select(id, center = false) {
    this.sel = id;
    const p = poiById(id);
    this.renderMarkers(); this.renderPanel();
    if (center && p) this.focus(p.x, p.y, Math.max(this.view.s, 0.9));
  },
  async onMapClick(ev) {
    const pin = ev.target.closest("[data-poi]");
    const f = this.toFrac(ev);
    if (this.mode === "route") {
      const p = pin ? poiById(pin.dataset.poi) : null;
      this.route.push(p ? { x: p.x, y: p.y, poi: p.id } : f);
      return this.recalc();
    }
    if (this.mode === "party") { await save(s => { s.party = f; }); this.setMode("browse"); return; }
    if (this.mode === "pin") {
      const data = await formDialog("Новая точка", `<form class="ncm-form"><label>Название<input name="name" placeholder="Схрон Мальстрема"></label>
        <label>Описание<textarea name="desc" rows="3"></textarea></label><label>Заметки мастера<textarea name="notes" rows="2"></textarea></label>
        <label class="ncm-check"><input type="checkbox" name="hidden" checked> Скрыть от игроков</label></form>`);
      if (data?.name) await save(s => { s.pins.push({ id: `c${rid()}`, ...f, ...data }); });
      this.setMode("browse"); return;
    }
    if (pin) return this.select(pin.dataset.poi);
    const dist = ev.target.closest("[data-dist]");
    if (dist) return this.renderDistrict(dist.dataset.dist);
    if (this.sel) { this.sel = null; this.renderMarkers(); this.renderPanel(); }
  },
  async onClick(ev) {
    const b = ev.target.closest("[data-act], [data-cat], .ncm-list [data-poi], .ncm-qcard [data-poi]");
    if (!b) return;
    if (b.dataset.cat) {
      const c = b.dataset.cat;
      this.filter.has(c) ? this.filter.delete(c) : this.filter.add(c);
      b.classList.toggle("on", this.filter.has(c)); return this.renderMarkers();
    }
    if (!b.dataset.act && b.dataset.poi) return this.select(b.dataset.poi, true);
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case "close": return this.close();
      case "zin": return this.zoomAt(1.3);
      case "zout": return this.zoomAt(1 / 1.3);
      case "fit": return this.fit();
      case "unsel": this.sel = null; this.renderMarkers(); return this.renderPanel();
      case "dist": return this.renderDistrict(id);
      case "quests": return this.el.querySelector(".ncm-quests").classList.toggle("on");
      case "mode-route": return this.setMode("route");
      case "mode-party": return this.setMode("party");
      case "mode-pin": return this.setMode("pin");
      case "mode-off": return this.setMode("browse");
      case "route-from": { const p = poiById(id); this.route = [{ x: p.x, y: p.y, poi: p.id }]; this.path = []; this.mode = "browse"; return this.setMode("route"); }
      case "route-to": {
        const p = poiById(id), party = state().party;
        const start = this.route[0] ?? (party ? { ...party } : null);
        this.route = start ? [start, { x: p.x, y: p.y, poi: p.id }] : [{ x: p.x, y: p.y, poi: p.id }];
        this.mode = "browse";
        if (!start) return this.setMode("route");
        return this.recalc();
      }
      case "route-undo": this.route.pop(); return this.recalc();
      case "streets": this.streets = b.checked; return this.recalc();
      case "route-clear": this.route = []; this.path = []; this.mode = "browse"; this.renderHint(); this.renderSvg(); return this.renderPanel();
      case "route-share": return save(s => { s.route = { pts: clone(this.route), path: this.path.length ? clone(this.path) : null }; });
      case "route-unshare": return save(s => { s.route = null; });
      case "share": { const r = this.vp.getBoundingClientRect(), { w, h } = this.size(), v = this.view;
        const cx = (r.width / 2 - v.x) / (w * v.s), cy = (r.height / 2 - v.y) / (h * v.s);
        emit({ action: "open", x: cx, y: cy, s: v.s, sel: this.sel }); return ui.notifications.info("Карта открыта у игроков."); }
      case "visit": return save(s => { s.visited = s.visited.includes(id) ? s.visited.filter(x => x !== id) : [...s.visited, id]; });
      case "toggle-hide": return save(s => {
        if (id.startsWith("c")) { const p = s.pins.find(x => x.id === id); if (p) p.hidden = !p.hidden; }
        else { s.poi[id] = { ...(s.poi[id] ?? {}), hidden: !(s.poi[id]?.hidden) }; }
      });
      case "del-pin": this.sel = null; return save(s => { s.pins = s.pins.filter(x => x.id !== id); });
      case "edit-poi": {
        const p = poiById(id);
        const data = await formDialog(p.name, `<form class="ncm-form"><label>Название<input name="name" value="${esc(p.name)}"></label>
          <label>Описание (видят игроки)<textarea name="desc" rows="4">${esc(p.desc ?? "")}</textarea></label>
          <label>Заметки мастера<textarea name="notes" rows="3">${esc(p.notes ?? "")}</textarea></label></form>`);
        if (!data) return;
        return save(s => {
          if (id.startsWith("c")) Object.assign(s.pins.find(x => x.id === id) ?? {}, data);
          else s.poi[id] = { ...(s.poi[id] ?? {}), ...data };
        });
      }
      case "new-quest": return this.editQuest(null, id ?? this.sel);
      case "edit-quest": return this.editQuest(id);
      case "quest-go": { const q = state().quests.find(x => x.id === id); const p = q && poiById(q.target ?? q.giver); if (p) this.select(p.id, true); return; }
      case "quest-status": return save(s => { const q = s.quests.find(x => x.id === id); if (q) q.status = b.dataset.st; })
        .then(() => { if (b.dataset.st === "active" && game.settings.get(MID, "notify")) emit({ action: "quest", id }); });
      case "del-quest": return save(s => { s.quests = s.quests.filter(x => x.id !== id); });
    }
  }
};

function qcard(q) {
  const t = q.target && poiById(q.target), g = q.giver && poiById(q.giver);
  return `<div class="ncm-qcard st-${q.status}">
    <div class="ncm-qc-top"><b>${esc(q.title || "Без названия")}</b><span class="ncm-qst">${QSTATUS[q.status]}</span></div>
    ${q.fixer ? `<div class="ncm-qc-fx"><i class="fas fa-user-secret"></i> ${esc(q.fixer)}</div>` : ""}
    ${q.desc ? `<p>${esc(q.desc)}</p>` : ""}
    <div class="ncm-qc-meta">
      ${g ? `<button data-poi="${g.id}"><i class="fas fa-handshake"></i> ${esc(g.name)}</button>` : ""}
      ${t ? `<button data-poi="${t.id}"><i class="fas fa-crosshairs"></i> ${esc(t.name)}</button>` : ""}
      ${q.reward ? `<span class="ncm-eb">${esc(q.reward)}</span>` : ""}
    </div>
    ${isGM() && q.notes ? `<div class="ncm-gm"><p>${esc(q.notes)}</p></div>` : ""}
    ${isGM() ? `<div class="ncm-qc-acts">
      <button data-act="edit-quest" data-id="${q.id}"><i class="fas fa-pen"></i></button>
      ${q.status !== "active" ? `<button data-act="quest-status" data-st="active" data-id="${q.id}">Выдать</button>` : ""}
      ${q.status === "active" ? `<button data-act="quest-status" data-st="done" data-id="${q.id}">Выполнен</button><button data-act="quest-status" data-st="failed" data-id="${q.id}">Провален</button>` : ""}
      <button class="danger" data-act="del-quest" data-id="${q.id}"><i class="fas fa-trash"></i></button></div>` : ""}
  </div>`;
}

/* ================================================================ диалоги */

function formDialog(title, content) {
  return new Promise(resolve => {
    new Dialog({
      title, content,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: "Сохранить", callback: (html) => {
          const form = (html[0] ?? html).querySelector("form");
          const fd = new FormDataExtended(form).object;
          for (const cb of form.querySelectorAll("input[type=checkbox]")) fd[cb.name] = cb.checked;
          resolve(fd);
        } },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok", close: () => resolve(null)
    }, { classes: ["ncm-dialog"], width: 480 }).render(true);
  });
}

/* ================================================================ сокет и уведомления */

function emit(data) { game.socket.emit(SOCKET, data); }

function questToast(q) {
  const t = document.createElement("div");
  t.className = "ncm-toast";
  t.innerHTML = `<div class="ncm-toast-k">НОВЫЙ ЗАКАЗ</div><b>${esc(q.title)}</b>${q.fixer ? `<span>от ${esc(q.fixer)}</span>` : ""}${q.reward ? `<em>${esc(q.reward)}</em>` : ""}`;
  t.addEventListener("click", () => { UI.open(); const p = poiById(q.target ?? q.giver); if (p) setTimeout(() => UI.select(p.id, true), 300); t.remove(); });
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("on"));
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 400); }, 7000);
}

Hooks.once("ready", () => {
  game.socket.on(SOCKET, (d) => {
    if (!d || isGM()) return;
    if (d.action === "open") { UI.open(); setTimeout(() => { UI.focus(d.x, d.y, d.s); if (d.sel) UI.select(d.sel); }, 120); }
    if (d.action === "quest") { const q = state().quests.find(x => x.id === d.id); if (q) questToast(q); }
  });
  game.modules.get(MID).api = { open: () => UI.open(), close: () => UI.close(), ui: UI };
  globalThis.NightCityMap = game.modules.get(MID).api;
});

/* ================================================================ кнопки запуска */

Hooks.on("getSceneControlButtons", (controls) => {
  const tok = controls.find?.(c => c.name === "token");
  tok?.tools?.push({ name: "ncm", title: "Карта Найт-Сити (Shift+M)", icon: "fas fa-city", button: true, onClick: () => UI.toggle() });
});
Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".ncm-dir-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "ncm-dir-btn";
  btn.innerHTML = `<i class="fas fa-city"></i> Карта Найт-Сити`;
  btn.addEventListener("click", () => UI.open());
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(btn);
});
