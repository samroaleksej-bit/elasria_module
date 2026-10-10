/* ════════════════════════════════════════════════════════════════════
   Спасти Гномреган! · Штаб операции
   Журнал мастера, задания и раздатки. Игроки видят только то,
   что открыл мастер, и получают уведомления.
   ════════════════════════════════════════════════════════════════════ */

const MID = "gnomregan-shtab";
const SOCKET = `module.${MID}`;
const MAP_HID = "04";

let DATA = null;
let PREV = null;
const apps = {};

/* ───────────── утилиты ───────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const isGM = () => !!game.user?.isGM;
const qById = (id) => DATA.quests.find((q) => q.id === id);
const hById = (id) => DATA.handouts.find((h) => h.id === id);
const ptById = (id) => DATA.mapPoints.find((p) => p.id === id);
const KIND = { main: "Основное", side: "Побочное", personal: "Личное", mystery: "Тайна", secret: "Секретно" };

async function loadData() {
  if (DATA) return DATA;
  const r = await fetch(`modules/${MID}/data/ops.json`, { cache: "no-cache" });
  DATA = await r.json();
  return DATA;
}

function getState() {
  const s = clone(game.settings.get(MID, "state"));
  s.q ??= {}; s.h ??= {}; s.pin ??= null; s.trail ??= [];
  return s;
}
async function setState(mut) {
  if (!isGM()) return;
  const s = getState();
  mut(s);
  await game.settings.set(MID, "state", s);
}

/** кому видно: entry.to = "all" | [userId] */
function visibleTo(entry, uid = game.user.id) {
  if (!entry) return false;
  if (uid === "*") return entry.to === "all";
  return entry.to === "all" || (Array.isArray(entry.to) && entry.to.includes(uid));
}
function viewer(app) { return app?.mode === "preview" ? "*" : game.user.id; }

function players() { return game.users.filter((u) => !u.isGM); }
function whoLabel(entry) {
  if (!entry) return "";
  if (entry.to === "all") return "Всем";
  return (entry.to || []).map((id) => game.users.get(id)?.name ?? "?").join(", ");
}
function actorImg(q) {
  if (!q?.actor) return null;
  try {
    const a = fromUuidSync(q.actor);
    const img = a?.img;
    return img && !/mystery-man/.test(img) ? img : null;
  } catch { return null; }
}

/* ───────────── звук: гномьи бип-бупы ───────────── */
let AC = null;
function chirp(kind) {
  try {
    AC ??= new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const vol = 0.09 * (game.settings.get("core", "globalInterfaceVolume") ?? 0.5) * 2;
    const seq = {
      quest: [[523, .09], [659, .09], [784, .09], [1047, .22]],
      handout: [[988, .07], [1319, .16]],
      obj: [[784, .08], [1047, .16]],
      done: [[523, .1], [659, .1], [784, .1], [1047, .1], [1319, .35]],
      fail: [[330, .18], [247, .18], [196, .4]],
      pin: [[1568, .05], [1568, .08]]
    }[kind] ?? [[880, .1]];
    let t = AC.currentTime + 0.02;
    for (const [f, d] of seq) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = kind === "fail" ? "sawtooth" : "square";
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(AC.destination);
      o.start(t); o.stop(t + d + 0.02);
      t += d * 0.85;
    }
  } catch (e) { /* без звука */ }
}

/* ───────────── уведомления ───────────── */
const TOAST_LABEL = {
  quest: "Новое задание!", handout: "Новая раздатка!", obj: "Цель выполнена",
  done: "Задание выполнено!", fail: "Задание провалено", pin: "Отметка на карте"
};
let toastQueue = Promise.resolve();
function toast(kind, { title, sub = "", img = null, onClick = null }) {
  toastQueue = toastQueue.then(() => new Promise((res) => {
    let box = document.getElementById("gs-toasts");
    if (!box) { box = document.createElement("div"); box.id = "gs-toasts"; document.body.append(box); }
    const el = document.createElement("div");
    el.className = `gs-toast gs-t-${kind}`;
    el.innerHTML = `
      <div class="gs-toast-gear"><svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg></div>
      ${img ? `<div class="gs-toast-img" style="background-image:url('${esc(img)}')"></div>` : ""}
      <div class="gs-toast-txt">
        <div class="gs-toast-label">${esc(TOAST_LABEL[kind] ?? "")}</div>
        <div class="gs-toast-title">${esc(title)}</div>
        ${sub ? `<div class="gs-toast-sub">${esc(sub)}</div>` : ""}
      </div>
      <div class="gs-toast-bar"></div>`;
    el.addEventListener("click", () => { onClick?.(); kill(); });
    box.append(el);
    chirp(kind);
    requestAnimationFrame(() => el.classList.add("in"));
    const life = kind === "pin" ? 4000 : 7000;
    el.style.setProperty("--life", `${life}ms`);
    let gone = false;
    function kill() { if (gone) return; gone = true; el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 450); }
    setTimeout(kill, life);
    setTimeout(res, 450);
  }));
}

/* ───────────── диф состояния → уведомления игроку ───────────── */
function onStateChange(next) {
  const prev = PREV ?? { q: {}, h: {}, pin: null };
  next = clone(next); next.q ??= {}; next.h ??= {};
  PREV = clone(next);
  rerenderAll();
  updateFab();
  renderRecap(prev.recap);
  if (isGM() || !DATA) return;
  const me = game.user.id;

  for (const q of DATA.quests) {
    const a = prev.q[q.id], b = next.q[q.id];
    const was = visibleTo(a, me), now = visibleTo(b, me);
    if (!now) continue;
    const open = () => openSquad({ tab: "quests", focus: q.id });
    if (!was) { toast("quest", { title: q.t, sub: q.giver, img: actorImg(q) ?? b.img, onClick: open }); continue; }
    if (a.s !== b.s && b.s === "done") toast("done", { title: q.t, sub: q.reward ? `Награда: ${q.reward}` : "", onClick: open });
    else if (a.s !== b.s && b.s === "failed") toast("fail", { title: q.t, onClick: open });
    else if (a.s !== b.s && b.s === "active") toast("quest", { title: q.t, sub: "Задание снова активно", onClick: open });
    for (const o of q.obj) if (b.o?.[o.id] && !a.o?.[o.id]) toast("obj", { title: o.t, sub: q.t, onClick: open });
  }
  for (const h of DATA.handouts) {
    const was = visibleTo(prev.h[h.id], me), now = visibleTo(next.h[h.id], me);
    if (now && !was) toast("handout", { title: h.t, img: h.img, onClick: () => { markSeen(`h:${h.id}`); lightbox(h.id); } });
  }
  const mapOk = visibleTo(next.h[MAP_HID], me);
  const pp = prev.pin, np = next.pin;
  if (mapOk && np && (!pp || pp.x !== np.x || pp.y !== np.y)) {
    toast("pin", { title: np.label || "Вы здесь", sub: "Схема Гномрегана", onClick: () => lightbox(MAP_HID) });
  }
  refreshLightboxPin();
}

/* ───────────── «просмотрено» у игрока ───────────── */
function seenSet() { return new Set(game.settings.get(MID, "seen") ?? []); }
async function markSeen(...keys) {
  const s = seenSet(); let ch = false;
  for (const k of keys) if (!s.has(k)) { s.add(k); ch = true; }
  if (ch) { await game.settings.set(MID, "seen", [...s]); updateFab(); }
  return ch;
}
function unseenCount() {
  if (!DATA || isGM()) return 0;
  const st = getState(), s = seenSet();
  let n = 0;
  for (const q of DATA.quests) if (visibleTo(st.q[q.id]) && !s.has(`q:${q.id}`)) n++;
  for (const h of DATA.handouts) if (visibleTo(st.h[h.id]) && !s.has(`h:${h.id}`)) n++;
  return n;
}

/* ───────────── действия мастера ───────────── */
const act = {
  async giveQuest(id, to = "all") {
    const q = qById(id); if (!q) return;
    await setState((s) => {
      const cur = s.q[id];
      let target = to;
      if (to !== "all" && cur && cur.to !== "all" && Array.isArray(cur.to)) target = [...new Set([...cur.to, ...to])];
      s.q[id] = { s: cur?.s === "done" || cur?.s === "failed" ? cur.s : "active", to: target, o: cur?.o ?? {}, t: Date.now(), img: actorImg(q) };
      for (const hid of q.handouts) {
        const hc = s.h[hid];
        if (!hc) s.h[hid] = { to: clone(target), t: Date.now() };
        else if (hc.to !== "all" && target === "all") hc.to = "all";
        else if (hc.to !== "all" && Array.isArray(target)) hc.to = [...new Set([...hc.to, ...target])];
      }
    });
    ui.notifications.info(`Задание «${q.t}» выдано: ${to === "all" ? "всем" : to.map((u) => game.users.get(u)?.name).join(", ")}`);
  },
  async hideQuest(id) { await setState((s) => { delete s.q[id]; }); },
  async questStatus(id, st) { await setState((s) => { if (s.q[id]) s.q[id].s = s.q[id].s === st ? "active" : st; }); },
  async toggleObj(id, oid) {
    await setState((s) => {
      const e = s.q[id]; if (!e) return;
      e.o ??= {}; e.o[oid] ? delete e.o[oid] : (e.o[oid] = 1);
    });
  },
  async revealHandout(id, to = "all") {
    await setState((s) => {
      const cur = s.h[id];
      if (to !== "all" && cur && Array.isArray(cur.to)) to = [...new Set([...cur.to, ...to])];
      s.h[id] = { to, t: Date.now() };
    });
  },
  async hideHandout(id) { await setState((s) => { delete s.h[id]; }); },
  async screen(id) {
    const st = getState();
    if (!st.h[id]) await act.revealHandout(id, "all");
    game.socket.emit(SOCKET, { a: "show", id });
    lightbox(id);
  },
  async setPin(x, y, label = "") { await setState((s) => { s.pin = { x: +x.toFixed(4), y: +y.toFixed(4), label, t: Date.now() }; }); },
  async pinPoint(pid) {
    const p = ptById(pid); if (!p) return;
    await setState((s) => {
      s.pin = { x: p.x, y: p.y, label: p.t, pt: p.id, t: Date.now() };
      s.trail ??= [];
      if (s.trail[s.trail.length - 1] !== p.id) s.trail.push(p.id);
    });
  },
  async clearTrail() { await setState((s) => { s.trail = s.pin?.pt ? [s.pin.pt] : []; }); },
  /* ───── сводка «Ранее в операции» ───── */
  async recapSave(patch) { await setState((s) => { s.recap = { ...defaultRecap(), ...(s.recap ?? {}), ...patch }; }); },
  async recapStart() { await act.recapSave({ on: true, i: 0, t: Date.now() }); },
  async recapStep(d) { await setState((s) => { const r = s.recap; if (!r) return; r.i = Math.max(0, Math.min(recapLines(r).length - 1, (r.i ?? 0) + d)); }); },
  async recapAll() { await setState((s) => { const r = s.recap; if (r) r.i = recapLines(r).length - 1; }); },
  async recapStop() { await setState((s) => { if (s.recap) s.recap.on = false; }); },
  async clearPin() { await setState((s) => { s.pin = null; }); },
  async resetAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Сбросить операцию?" },
      content: "<p>Все задания и раздатки снова станут скрытыми у игроков. Метка на карте пропадёт.</p>"
    });
    if (ok) await game.settings.set(MID, "state", { q: {}, h: {}, pin: null, trail: [], recap: getState().recap ?? null });
  }
};

/* ───────────── лайтбокс ───────────── */
let LB = null;
function lightbox(id, { remote = false } = {}) {
  const h = hById(id); if (!h) return;
  closeLightbox();
  const el = document.createElement("div");
  el.id = "gs-lightbox";
  el.dataset.hid = id;
  el.innerHTML = `
    <div class="gs-lb-back"></div>
    <div class="gs-lb-frame">
      <div class="gs-lb-wrap">${h.map ? mapInner() : `<img src="${esc(h.img)}" alt="">`}</div>
      <div class="gs-lb-cap"><span class="gs-chip">№ ${esc(h.id)}</span> ${esc(h.t)}</div>
      ${isGM() ? `<div class="gs-lb-gm">
          ${h.map ? `<button data-lb="pinmode" class="${LB_PINMODE ? "on" : ""}">📍 Ставить метку кликом</button><button data-lb="unpin">Убрать метку</button>` : ""}
          <button data-lb="screen">🖥 Показать всем</button><button data-lb="hideall">Закрыть у всех</button></div>` : ""}
      <button class="gs-lb-x" data-lb="close" title="Закрыть (Esc)">✕</button>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-lb]");
    if (b) {
      const a = b.dataset.lb;
      if (a === "close") return closeLightbox();
      if (a === "screen") return act.screen(id);
      if (a === "hideall") { game.socket.emit(SOCKET, { a: "hide" }); return closeLightbox(); }
      if (a === "pinmode") { LB_PINMODE = !LB_PINMODE; b.classList.toggle("on", LB_PINMODE); el.classList.toggle("pinmode", LB_PINMODE); return; }
      if (a === "unpin") return act.clearPin();
    }
    if (ev.target.classList.contains("gs-lb-back")) return closeLightbox();
    if (ev.target.closest(".gs-hm")) return;
    const img = ev.target.closest(".gs-lb-wrap img, .gs-map-img");
    if (img && isGM() && h.map && LB_PINMODE) return pinFromClick(ev, img);
    if (img && !h.map) el.classList.toggle("zoom");
  });
  el.classList.toggle("pinmode", isGM() && h.map && LB_PINMODE);
  LB = { el, id };
  if (!isGM()) markSeen(`h:${id}`);
}
let LB_PINMODE = false;
function closeLightbox() { if (!LB) return false; const el = LB.el; LB = null; el.classList.remove("in"); setTimeout(() => el.remove(), 250); return true; }
function refreshLightboxPin() {
  for (const wrap of document.querySelectorAll(".gs-map")) wrap.querySelector(".gs-pin-layer").innerHTML = layerHTML(wrap.dataset.viewer);
}
function pinFromClick(ev, img) {
  const r = img.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  // примагнитить к ближайшей локации, если кликнули рядом
  let best = null, bd = 0.05;
  for (const p of DATA.mapPoints) { const d = Math.hypot(p.x - x, (p.y - y) * 1.15); if (d < bd) { bd = d; best = p; } }
  return best ? act.setPin(best.x, best.y, best.t) : act.setPin(x, y, "");
}

/* ───────────── карта с меткой ───────────── */
function pinHTML() {
  const p = getState().pin;
  if (!p) return "";
  return `<div class="gs-pin" style="left:${p.x * 100}%;top:${p.y * 100}%">
      <span class="gs-pin-ring"></span><span class="gs-pin-ring r2"></span>
      <span class="gs-pin-head"><svg viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.5"/></svg></span>
      <span class="gs-pin-label">ВЫ ЗДЕСЬ${p.label ? `<small>${esc(p.label)}</small>` : ""}</span>
    </div>`;
}
function defViewer() { return isGM() ? "gm" : game.user.id; }
function layerHTML(viewer = defViewer()) { return hintsHTML(viewer) + pinHTML(); }
function mapInner(viewer = defViewer()) {
  const h = hById(MAP_HID);
  return `<div class="gs-map" data-viewer="${esc(viewer)}"><img class="gs-map-img" src="${esc(h.img)}" alt="" draggable="false"><div class="gs-pin-layer">${layerHTML(viewer)}</div></div>`;
}

/* подсказки заданий на карте: «!» — куда идти, «?» — где сдавать */
function hintsHTML(viewer) {
  const st = getState();
  if (st.hints === false) return "";
  const by = new Map();
  for (const q of DATA.quests) {
    const e = st.q[q.id];
    if (!e || e.s !== "active") continue;
    if (viewer !== "gm" && !visibleTo(e, viewer)) continue;
    const o = q.obj.find((x) => !e.o?.[x.id]);
    if (!o?.pt) continue;
    if (!by.has(o.pt)) by.set(o.pt, []);
    by.get(o.pt).push({ q, o });
  }
  let out = "";
  for (const [pid, list] of by) {
    const p = ptById(pid); if (!p) continue;
    const ret = list.every((x) => x.o.ret);
    const main = list.some((x) => x.q.kind === "main");
    out += `<div class="gs-hm ${ret ? "ret" : ""} ${main ? "main" : ""}" style="left:${((p.x - 0.1) * 100).toFixed(2)}%;top:${((p.y + 0.006) * 100).toFixed(2)}%">
      <span class="gs-hm-ic">${ret ? "?" : "!"}</span>${list.length > 1 ? `<span class="gs-hm-n">${list.length}</span>` : ""}
      <div class="gs-hm-tip"><div class="gs-hm-loc">${esc(p.t)}</div>${list.map(({ q, o }) => `<div class="gs-hm-row"><b>${o.ret ? "?" : "!"} ${esc(q.t)}</b><span>${esc(o.t)}</span></div>`).join("")}</div>
    </div>`;
  }
  return out;
}

/* ───────────── окно штаба / журнала отряда ───────────── */
const AppV2 = foundry.applications.api.ApplicationV2;

class ShtabApp extends AppV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gs-window"],
    window: { resizable: true, minimizable: true },
    position: { width: 1200, height: 840 }
  };

  constructor(mode, opts = {}) {
    const gm = mode === "gm";
    super({
      id: `gs-${mode}`,
      window: { title: gm ? "Спасти Гномреган! · Штаб операции" : mode === "preview" ? "Журнал отряда · глазами игроков" : "Журнал отряда · Операция «Гномреган II»", icon: "fas fa-cog" },
      position: gm ? { width: Math.min(1240, innerWidth - 80), height: Math.min(880, innerHeight - 60) } : { width: Math.min(920, innerWidth - 80), height: Math.min(820, innerHeight - 60) }
    });
    this.mode = mode;
    this.tab = opts.tab ?? (gm ? "journal" : "quests");
    this.page = opts.page ?? game.settings.get(MID, "lastPage") ?? "gs-help";
    this.focus = opts.focus ?? null;
    this.openSec = new Set([DATA.nav.find((s) => s.pages.includes(this.page))?.id ?? "intro"]);
    this.showDone = false;
    this.hFilter = "all";
  }

  async _renderHTML() {
    const html = this.mode === "gm" ? await this.gmHTML() : this.squadHTML();
    return html;
  }

  _replaceHTML(html, content) {
    const sc = content.querySelector(".gs-scroll");
    const keep = sc && this._lastKey === this.viewKey() ? sc.scrollTop : 0;
    content.innerHTML = html;
    content.classList.add("gs-content");
    if (!this._bound) {
      content.addEventListener("click", (ev) => this.onClick(ev));
      content.addEventListener("change", (ev) => this.onChange(ev));
      this._bound = true;
    }
    const sc2 = content.querySelector(".gs-scroll");
    if (sc2) sc2.scrollTop = keep;
    this._lastKey = this.viewKey();
    if (this.focus) {
      const f = content.querySelector(`[data-qcard="${this.focus}"]`);
      if (f) { f.scrollIntoView({ block: "center" }); f.classList.add("flash"); }
      this.focus = null;
    }
    if (this.mode === "player") {
      const st = getState();
      const keys = this.tab === "quests" ? DATA.quests.filter((q) => visibleTo(st.q[q.id])).map((q) => `q:${q.id}`)
        : this.tab === "handouts" ? DATA.handouts.filter((h) => visibleTo(st.h[h.id])).map((h) => `h:${h.id}`) : [];
      // карточки «НОВОЕ» подсвечены на этом показе, бейдж вкладки гаснет через пару секунд
      if (keys.length) setTimeout(() => markSeen(...keys).then((ch) => ch && this.rendered && this.tab !== "handouts" && this.render()), 2500);
    }
  }

  viewKey() { return `${this.tab}|${this.page}`; }

  _onClose(o) { super._onClose?.(o); delete apps[this.mode]; }

  /* ───── мастер ───── */
  async gmHTML() {
    const tabs = [["journal", "📖", "Журнал"], ["quests", "⚙", "Задания"], ["handouts", "📜", "Раздатки"], ["map", "📍", "Карта"], ["recap", "⏪", "Сводка"]];
    const st = getState();
    const nQ = Object.keys(st.q).length, nH = Object.keys(st.h).length;
    let body = "";
    if (this.tab === "journal") body = await this.journalHTML(st);
    else if (this.tab === "quests") body = `<div class="gs-scroll gs-pad">${this.questsGM(st)}</div>`;
    else if (this.tab === "handouts") body = `<div class="gs-scroll gs-pad">${this.handoutsGM(st)}</div>`;
    else if (this.tab === "recap") body = `<div class="gs-scroll gs-pad">${this.recapGM(st)}</div>`;
    else body = `<div class="gs-scroll gs-pad">${this.mapGM(st)}</div>`;
    return `<div class="gs-shell gs-gm">
      <header class="gs-top">
        <div class="gs-logo"><svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg><div><b>Спасти Гномреган!</b><small>Штаб операции «Гномреган II»</small></div></div>
        <nav class="gs-tabs">${tabs.map(([id, ic, t]) => `<button data-tab="${id}" class="${this.tab === id ? "on" : ""}"><i>${ic}</i>${t}${id === "quests" ? `<em>${nQ}/${DATA.quests.length}</em>` : id === "handouts" ? `<em>${nH}/${DATA.handouts.length}</em>` : ""}</button>`).join("")}</nav>
        <div class="gs-top-r"><button data-act="${st.recap?.on ? "recapStop" : "recapStart"}" class="${st.recap?.on ? "on" : ""}" title="Сводка «Ранее в операции» на экраны игроков">${st.recap?.on ? "■ Сводка идёт" : "⏪ Сводка"}</button><button data-act="preview" title="Что сейчас видят игроки">👁 Глазами игроков</button></div>
      </header>
      <div class="gs-body">${body}</div>
    </div>`;
  }

  async journalHTML(st) {
    const navHTML = DATA.nav.map((s) => {
      const open = this.openSec.has(s.id);
      return `<div class="gs-sec ${open ? "open" : ""}">
        <button class="gs-sec-h" data-sec="${s.id}"><span class="gs-sec-ic">${s.ic}</span><span>${esc(s.t)}</span><i>▸</i></button>
        <div class="gs-sec-b">${s.pages.map((pid) => {
          const p = DATA.pages[pid];
          return `<a class="gs-nav-p ${pid === this.page ? "on" : ""} ${p.src === "gm" ? "gm" : ""}" data-page="${pid}">${p.code ? `<span class="gs-code">${esc(p.code)}</span>` : p.src === "gm" ? `<span class="gs-code gm">★</span>` : ""}${esc(p.t)}</a>`;
        }).join("")}</div></div>`;
    }).join("");

    const p = DATA.pages[this.page] ?? DATA.pages["gs-help"];
    const links = DATA.pageLinks[this.page] ?? {};
    let content = "";
    let raw = p.html;
    let rel = null;
    if (p.src === "adv") {
      const j = advJournal();
      const page = j?.pages.get(this.page) ?? j?.pages.find((x) => x.name === p.t);
      if (!page) content = `<div class="gs-box gs-box-warn"><h4>Журнал «Приключение» не найден</h4><p>Штаб читает текст приключения из журнала «Приключение» в этом мире. Импортируй приключение из модуля «Гномреган» или переименуй журнал обратно в «Приключение».</p></div>`;
      else { raw = page.text?.content ?? ""; rel = page; }
    }
    if (raw != null && !content) {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      content = await TE.enrichHTML(raw, { secrets: true, relativeTo: rel, async: true });
    }
    const pin = links.pin ? ptById(links.pin) : null;
    const pinNow = st.pin && pin && Math.abs(st.pin.x - pin.x) < 0.001 && Math.abs(st.pin.y - pin.y) < 0.001;
    const idx = DATA.nav.flatMap((s) => s.pages), i = idx.indexOf(this.page);
    const prev = idx[i - 1], next = idx[i + 1];
    const panel = (links.h?.length || links.q?.length) ? `<div class="gs-panel">
        ${links.q?.length ? `<div class="gs-panel-col"><div class="gs-panel-h">Задания сцены</div>${links.q.map((id) => this.questMini(qById(id), st)).join("")}</div>` : ""}
        ${links.h?.length ? `<div class="gs-panel-col"><div class="gs-panel-h">Раздатки сцены</div><div class="gs-hmini-grid">${links.h.map((id) => this.handoutMini(hById(id), st)).join("")}</div></div>` : ""}
      </div>` : "";
    return `<aside class="gs-nav">${navHTML}
        <div class="gs-nav-foot"><button data-act="reset">⟲ Сбросить операцию</button></div></aside>
      <main class="gs-main">
        <div class="gs-scroll">
          <div class="gs-page-h">
            <div>${p.code ? `<span class="gs-code big">${esc(p.code)}</span>` : ""}<h1>${esc(p.t)}</h1></div>
            <div class="gs-page-acts">
              ${pin ? `<button data-act="pinpt" data-pt="${pin.id}" class="gs-pinbtn ${pinNow ? "on" : ""}">📍 ${pinNow ? "Отряд здесь" : "Вы здесь"}: ${esc(pin.t)}</button>` : ""}
              ${p.src === "adv" ? `<button data-act="openjournal" title="Открыть в обычном журнале Foundry">↗</button>` : ""}
            </div>
          </div>
          ${panel}
          <article class="gs-article">${content}</article>
          <div class="gs-pager">
            ${prev ? `<a data-page="${prev}">← ${esc(DATA.pages[prev].t)}</a>` : "<span></span>"}
            ${next ? `<a data-page="${next}">${esc(DATA.pages[next].t)} →</a>` : "<span></span>"}
          </div>
        </div>
      </main>`;
  }

  questMini(q, st) {
    const e = st.q[q.id];
    const status = !e ? "hidden" : e.s;
    return `<div class="gs-qmini s-${status}" data-qcard="${q.id}">
      <div class="gs-qmini-h">
        <span class="gs-dot"></span><b>${esc(q.t)}</b>
        <span class="gs-qmini-who">${e ? esc(whoLabel(e)) : "скрыто"}</span>
        ${!e ? this.giveCtl(q) : `<button data-act="qdone" data-q="${q.id}" class="mini ${e.s === "done" ? "on" : ""}" title="Выполнено">✔</button>`}
      </div>
      ${e ? `<div class="gs-qmini-o">${q.obj.map((o) => `<label class="${e.o?.[o.id] ? "on" : ""}" data-act="obj" data-q="${q.id}" data-o="${o.id}"><span class="gs-cb"></span>${esc(o.t)}</label>`).join("")}</div>` : ""}
    </div>`;
  }

  giveCtl(q, big = false) {
    const ps = players();
    return `<span class="gs-give ${big ? "big" : ""}">
      ${q.secret ? "" : `<button data-act="give" data-q="${q.id}" class="${big ? "" : "mini"} prim">Выдать всем</button>`}
      <select data-act="giveTo" data-q="${q.id}" class="${big ? "" : "mini"}"><option value="">${q.secret ? "Выдать лично…" : "Лично…"}</option>${ps.map((u) => `<option value="${u.id}">${esc(u.name)}${u.character ? ` (${esc(u.character.name)})` : ""}</option>`).join("")}</select>
    </span>`;
  }
  revealCtl(h, big = false) {
    const ps = players();
    return `<span class="gs-give ${big ? "big" : ""}">
      ${h.secret ? "" : `<button data-act="reveal" data-h="${h.id}" class="${big ? "" : "mini"} prim">Открыть всем</button>`}
      <select data-act="revealTo" data-h="${h.id}" class="${big ? "" : "mini"}"><option value="">${h.secret ? "Отдать лично…" : "Лично…"}</option>${ps.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>
    </span>`;
  }

  handoutMini(h, st) {
    const e = st.h[h.id];
    return `<div class="gs-hmini ${e ? "shown" : ""}">
      <div class="gs-hmini-img" data-act="look" data-h="${h.id}" style="background-image:url('${esc(h.img)}')"><span class="gs-chip">${esc(h.id)}</span>${e ? `<span class="gs-eye" title="${esc(whoLabel(e))}">👁</span>` : ""}</div>
      <div class="gs-hmini-t">${esc(h.t)}</div>
      <div class="gs-hmini-b">${e ? `<button data-act="screen" data-h="${h.id}" class="mini">🖥 На экран</button><button data-act="hideh" data-h="${h.id}" class="mini ghost" title="Скрыть">✕</button>` : `<button data-act="reveal" data-h="${h.id}" class="mini prim" ${h.secret ? "disabled" : ""}>Открыть</button><button data-act="screen" data-h="${h.id}" class="mini" ${h.secret ? "disabled" : ""}>🖥</button>`}</div>
    </div>`;
  }

  questsGM(st) {
    const groups = [["Основная линия", (q) => q.kind === "main"], ["Побочные и тайны", (q) => q.kind === "side" || q.kind === "mystery"], ["Личные крючки", (q) => q.kind === "personal" || q.kind === "secret"]];
    return groups.map(([t, f]) => `<h2 class="gs-h2">${t}</h2><div class="gs-qgrid">${DATA.quests.filter(f).map((q) => this.questCard(q, st.q[q.id], true)).join("")}</div>`).join("");
  }

  questCard(q, e, gm = false) {
    const status = !e ? "hidden" : e.s;
    const img = actorImg(q) ?? e?.img;
    const done = q.obj.filter((o) => e?.o?.[o.id]).length;
    return `<div class="gs-qcard s-${status} k-${q.kind}" data-qcard="${q.id}">
      ${status === "done" ? `<div class="gs-stamp">Выполнено</div>` : status === "failed" ? `<div class="gs-stamp fail">Провалено</div>` : ""}
      <div class="gs-qcard-top">
        <div class="gs-portrait">${img ? `<img src="${esc(img)}" alt="">` : `<svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg>`}</div>
        <div class="gs-qcard-ttl">
          <span class="gs-kind">${KIND[q.kind]}</span>${gm && !e ? `<span class="gs-kind hid">Скрыто</span>` : ""}${gm && e ? `<span class="gs-kind to">👁 ${esc(whoLabel(e))}</span>` : ""}
          <h3>${esc(q.t)}</h3>
          ${q.giver ? `<div class="gs-giver">${esc(q.giver)}</div>` : ""}
        </div>
        <div class="gs-prog"><b>${done}</b>/${q.obj.length}</div>
      </div>
      ${q.quote ? `<blockquote>«${esc(q.quote)}»</blockquote>` : ""}
      <p class="gs-desc">${esc(q.desc)}</p>
      <ul class="gs-objs">${q.obj.map((o) => `<li class="${e?.o?.[o.id] ? "on" : ""}" ${gm && e ? `data-act="obj" data-q="${q.id}" data-o="${o.id}"` : ""}><span class="gs-cb"></span>${esc(o.t)}</li>`).join("")}</ul>
      ${q.reward ? `<div class="gs-reward"><span>Награда</span>${esc(q.reward)}</div>` : ""}
      ${q.handouts.length ? `<div class="gs-qh">${q.handouts.filter((hid) => gm || visibleTo(getState().h[hid], this.viewerId())).map((hid) => { const h = hById(hid); return `<div class="gs-qh-i" data-act="look" data-h="${hid}" title="${esc(h.t)}" style="background-image:url('${esc(h.img)}')"></div>`; }).join("")}</div>` : ""}
      ${gm ? `${q.gm ? `<div class="gs-gmnote">🔒 ${esc(q.gm)}</div>` : ""}
        <div class="gs-qctl">${!e ? this.giveCtl(q, true) : `
          <button data-act="qdone" data-q="${q.id}" class="${e.s === "done" ? "on gold" : ""}">✔ Выполнено</button>
          <button data-act="qfail" data-q="${q.id}" class="${e.s === "failed" ? "on red" : ""}">✖ Провалено</button>
          ${e.to !== "all" ? `<select data-act="giveTo" data-q="${q.id}"><option value="">+ ещё игроку…</option>${players().map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>${q.secret ? "" : `<button data-act="give" data-q="${q.id}">Всем</button>`}` : ""}
          <button data-act="hideq" data-q="${q.id}" class="ghost">Скрыть</button>`}</div>` : ""}
    </div>`;
  }

  handoutsGM(st) {
    const groups = [[1, "Сессия 1"], [2, "Сессия 2"], [3, "Сессия 3"], [4, "Сессия 4"], [0, "Секретное"]];
    return groups.map(([s, t]) => `<h2 class="gs-h2">${t}</h2><div class="gs-hgrid">${DATA.handouts.filter((h) => h.s === s).map((h) => {
      const e = st.h[h.id];
      return `<div class="gs-hcard ${e ? "shown" : ""}">
        <div class="gs-hcard-img" data-act="look" data-h="${h.id}"><img src="${esc(h.img)}" alt="" loading="lazy"><span class="gs-chip">№ ${esc(h.id)}</span>${h.map ? `<span class="gs-chip map">📍 карта</span>` : ""}</div>
        <div class="gs-hcard-b">
          <b>${esc(h.t)}</b>
          <div class="gs-hcard-st">${e ? `👁 ${esc(whoLabel(e))}` : "🔒 скрыто"}</div>
          <div class="gs-gmnote">${esc(h.gm)}</div>
          <div class="gs-hcard-ctl">${e ? `<button data-act="screen" data-h="${h.id}">🖥 На экран</button>${e.to !== "all" ? `<select data-act="revealTo" data-h="${h.id}"><option value="">+ игроку…</option>${players().map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>` : ""}<button data-act="hideh" data-h="${h.id}" class="ghost">Скрыть</button>` : this.revealCtl(h, true) + (h.secret ? "" : `<button data-act="screen" data-h="${h.id}">🖥</button>`)}</div>
        </div></div>`;
    }).join("")}</div>`).join("");
  }

  mapGM(st) {
    const e = st.h[MAP_HID];
    return `<div class="gs-maplay">
      <div class="gs-mapbox gm" data-act="mapclick">${mapInner()}</div>
      <aside class="gs-mapside">
        <h2 class="gs-h2">Где отряд?</h2>
        <p class="gs-hint">Кликни по карте или выбери локацию. Игроки увидят метку «ВЫ ЗДЕСЬ» и уведомление.</p>
        <div class="gs-mpts">${DATA.mapPoints.map((p) => `<button data-act="pinpt" data-pt="${p.id}" class="${st.pin && Math.abs(st.pin.x - p.x) < 0.001 && Math.abs(st.pin.y - p.y) < 0.001 ? "on" : ""}">${esc(p.t)}</button>`).join("")}</div>
        <button data-act="unpin" class="ghost">Убрать метку</button>
        <label class="gs-check"><input type="checkbox" data-hints ${st.hints === false ? "" : "checked"}><span>Подсказки заданий на карте: <b style="color:#ffd23a">!</b> — куда идти, <b style="color:#ffd23a">?</b> — где сдать. Жёлтые — основные, голубые — побочные.</span></label>
        <div class="gs-mapstate">${e ? `Карта открыта: 👁 ${esc(whoLabel(e))}` : `<b>Карта ещё не у игроков.</b> ${this.revealCtl(hById(MAP_HID))}`}</div>
        ${e ? `<button data-act="screen" data-h="${MAP_HID}">🖥 Карту на экран всем</button>` : ""}
      </aside></div>`;
  }

  recapGM(st) {
    const r = { ...defaultRecap(), ...(st.recap ?? {}) };
    const trail = (st.trail ?? []).map((id) => ptById(id)?.t).filter(Boolean);
    return `<div class="gs-recap-ed">
      <div class="gs-recap-l">
        <h2 class="gs-h2">Ранее в операции</h2>
        <p class="gs-hint">Каждая строка — один шаг рассказа. На показе ты листаешь их кнопкой ▶, а у игроков строки появляются по одной. Пустая строка — пропускается. <b>**текст**</b> — выделить.</p>
        <label class="gs-lbl">Заголовок</label>
        <input type="text" data-recap="title" value="${esc(r.title)}">
        <label class="gs-lbl">Строки рассказа</label>
        <textarea data-recap="text" rows="14">${esc(r.text)}</textarea>
        <label class="gs-check"><input type="checkbox" data-recap="map" ${r.map ? "checked" : ""}> Показывать мини-карту Хинкла с меткой и маршрутом</label>
        <div class="gs-qctl">
          <button data-act="recapGen">⚙ Собрать из прогресса</button>
          <button data-act="${r.on ? "recapStop" : "recapStart"}" class="${r.on ? "on" : "prim"}">${r.on ? "■ Закончить показ" : "▶ Показать игрокам"}</button>
        </div>
      </div>
      <aside class="gs-recap-r">
        <h2 class="gs-h2">Маршрут отряда</h2>
        <p class="gs-hint">Пишется сам, когда ставишь метку «Вы здесь» по локации.</p>
        <ol class="gs-trail">${trail.map((t) => `<li>${esc(t)}</li>`).join("") || "<li class='gs-hint'>пока пусто</li>"}</ol>
        <button data-act="clearTrail" class="ghost">Сбросить маршрут</button>
        <div class="gs-mapbox">${mapInner()}</div>
      </aside>
    </div>`;
  }

  /* ───── игроки (и предпросмотр мастера) ───── */
  viewerId() { return this.mode === "preview" ? "*" : game.user.id; }

  squadHTML() {
    const st = getState(), me = this.viewerId();
    const qs = DATA.quests.filter((q) => visibleTo(st.q[q.id], me)).sort((a, b) => (st.q[b.id].t ?? 0) - (st.q[a.id].t ?? 0));
    const hs = DATA.handouts.filter((h) => visibleTo(st.h[h.id], me)).sort((a, b) => (st.h[b.id].t ?? 0) - (st.h[a.id].t ?? 0));
    const mapOk = visibleTo(st.h[MAP_HID], me);
    const seen = this.mode === "player" ? seenSet() : new Set();
    const newQ = this.mode === "player" ? qs.filter((q) => !seen.has(`q:${q.id}`)).length : 0;
    const newH = this.mode === "player" ? hs.filter((h) => !seen.has(`h:${h.id}`)).length : 0;
    if (this.tab === "map" && !mapOk) this.tab = "quests";
    const active = qs.filter((q) => st.q[q.id].s === "active"), closed = qs.filter((q) => st.q[q.id].s !== "active");
    let body;
    if (this.tab === "quests") {
      body = !qs.length ? empty("Заданий пока нет", "Мастер выдаст их по ходу операции.") :
        `<div class="gs-qgrid one">${active.map((q) => this.questCard(q, st.q[q.id])).join("")}</div>
         ${closed.length ? `<button class="gs-closed-t" data-act="toggleDone">${this.showDone ? "▾" : "▸"} Завершённые (${closed.length})</button>${this.showDone ? `<div class="gs-qgrid one">${closed.map((q) => this.questCard(q, st.q[q.id])).join("")}</div>` : ""}` : ""}`;
    } else if (this.tab === "handouts") {
      body = !hs.length ? empty("Раздаток пока нет", "Всё, что найдёт отряд, появится здесь.") :
        `<div class="gs-hgrid pl">${hs.map((h) => `<div class="gs-hcard pl ${this.mode === "player" && !seen.has(`h:${h.id}`) ? "new" : ""}" data-act="look" data-h="${h.id}">
            <div class="gs-hcard-img"><img src="${esc(h.img)}" alt="" loading="lazy">${h.map ? `<span class="gs-chip map">📍 карта</span>` : ""}</div>
            <div class="gs-hcard-b"><b>${esc(h.t)}</b></div></div>`).join("")}</div>`;
    } else {
      body = `<div class="gs-mapbox">${mapInner(this.viewerId())}</div>`;
    }
    const tabs = [["quests", "⚙", "Задания", newQ, qs.length], ["handouts", "📜", "Раздатки", newH, hs.length], ...(mapOk ? [["map", "📍", "Карта", 0, null]] : [])];
    return `<div class="gs-shell gs-squad">
      <header class="gs-top">
        <div class="gs-logo"><svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg><div><b>Журнал отряда</b><small>Операция «Гномреган II»${this.mode === "preview" ? " · глазами игроков" : ""}</small></div></div>
        <nav class="gs-tabs">${tabs.map(([id, ic, t, n, c]) => `<button data-tab="${id}" class="${this.tab === id ? "on" : ""}"><i>${ic}</i>${t}${c != null ? `<em>${c}</em>` : ""}${n ? `<span class="gs-new">${n}</span>` : ""}</button>`).join("")}</nav>
      </header>
      <div class="gs-body"><div class="gs-scroll gs-pad">${body}</div></div>
    </div>`;
  }

  /* ───── события ───── */
  async onClick(ev) {
    // ссылки на страницы приключения открываем внутри штаба
    const link = ev.target.closest("a.content-link[data-uuid]");
    if (link && this.mode === "gm") {
      const m = String(link.dataset.uuid).match(/JournalEntryPage\.([A-Za-z0-9]{16})/);
      if (m && DATA.pages[m[1]] && String(link.dataset.uuid).includes(DATA.journal)) {
        ev.preventDefault(); ev.stopPropagation();
        return this.goPage(m[1]);
      }
      return;
    }
    const fig = ev.target.closest(".gs-article figure img, .gs-article img.gs-zoomable");
    if (fig && !ev.target.closest("a")) return quickImage(fig.src);

    const t = ev.target.closest("[data-tab],[data-sec],[data-page],[data-act]");
    if (!t) return;
    if (t.tagName === "SELECT") return;
    if (t.dataset.tab) { this.tab = t.dataset.tab; return this.render(); }
    if (t.dataset.sec) { const id = t.dataset.sec; this.openSec.has(id) ? this.openSec.delete(id) : this.openSec.add(id); t.parentElement.classList.toggle("open"); return; }
    if (t.dataset.page) return this.goPage(t.dataset.page);
    const a = t.dataset.act, q = t.dataset.q, h = t.dataset.h;
    switch (a) {
      case "preview": return openSquad({ preview: true });
      case "reset": return act.resetAll();
      case "give": return act.giveQuest(q, "all");
      case "hideq": return act.hideQuest(q);
      case "qdone": return act.questStatus(q, "done");
      case "qfail": return act.questStatus(q, "failed");
      case "obj": ev.preventDefault(); return isGM() && this.mode === "gm" ? act.toggleObj(q, t.dataset.o) : null;
      case "reveal": return act.revealHandout(h, "all");
      case "hideh": return act.hideHandout(h);
      case "screen": return act.screen(h);
      case "look": return lightbox(h);
      case "pinpt": return act.pinPoint(t.dataset.pt);
      case "unpin": return act.clearPin();
      case "clearTrail": return act.clearTrail();
      case "recapStart": await this.saveRecapForm(); return act.recapStart();
      case "recapStop": return act.recapStop();
      case "recapGen": {
        const ta = this.element.querySelector("textarea[data-recap=text]");
        if (ta) { ta.value = genRecapText(); await this.saveRecapForm(); }
        return;
      }
      case "toggleDone": this.showDone = !this.showDone; return this.render();
      case "openjournal": { const pg = advJournal()?.pages.get(this.page); return pg?.parent?.sheet?.render(true, { pageId: pg.id }); }
      case "mapclick": {
        if (ev.target.closest(".gs-hm")) return;
        const img = ev.target.closest(".gs-map-img, .gs-pin-layer, .gs-map");
        const mi = t.querySelector(".gs-map-img");
        if (img && mi && isGM()) return pinFromClick(ev, mi);
      }
    }
  }

  async saveRecapForm() {
    const el = this.element; if (!el?.querySelector("[data-recap]")) return;
    await act.recapSave({
      title: el.querySelector("[data-recap=title]").value,
      text: el.querySelector("[data-recap=text]").value,
      map: el.querySelector("[data-recap=map]").checked
    });
  }

  async onChange(ev) {
    if (ev.target.closest("[data-recap]")) return this.saveRecapForm();
    if (ev.target.matches("[data-hints]")) return setState((s) => { s.hints = ev.target.checked; });
    const s = ev.target.closest("select[data-act]");
    if (!s || !s.value) return;
    const uid = s.value; s.value = "";
    if (s.dataset.act === "giveTo") return act.giveQuest(s.dataset.q, [uid]);
    if (s.dataset.act === "revealTo") return act.revealHandout(s.dataset.h, [uid]);
  }

  goPage(pid) {
    this.page = pid;
    const sec = DATA.nav.find((s) => s.pages.includes(pid));
    if (sec) this.openSec.add(sec.id);
    game.settings.set(MID, "lastPage", pid);
    this._lastKey = null;
    return this.render();
  }
}

function empty(t, s) { return `<div class="gs-empty"><svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg><b>${t}</b><span>${s}</span></div>`; }

function quickImage(src) {
  closeLightbox();
  const el = document.createElement("div");
  el.id = "gs-lightbox";
  el.innerHTML = `<div class="gs-lb-back"></div><div class="gs-lb-frame"><div class="gs-lb-wrap"><img src="${esc(src)}" alt=""></div><button class="gs-lb-x" data-lb="close">✕</button></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  el.addEventListener("click", (ev) => { if (ev.target.closest("[data-lb=close]") || ev.target.classList.contains("gs-lb-back")) closeLightbox(); else if (ev.target.tagName === "IMG") el.classList.toggle("zoom"); });
  LB = { el, id: null };
}

function advJournal() {
  return game.journal.get(DATA.journal) ?? game.journal.getName("Приключение") ?? game.journal.find((j) => j.pages.has?.(DATA.nav[1].pages[3]));
}

function rerenderAll() { for (const a of Object.values(apps)) if (a.rendered) a.render(); }

async function openShtab(opts = {}) {
  await loadData();
  if (!isGM()) return openSquad(opts);
  let a = apps.gm;
  if (!a) a = apps.gm = new ShtabApp("gm", opts);
  else { if (opts.tab) a.tab = opts.tab; if (opts.page) a.page = opts.page; }
  return a.render(true);
}
async function openSquad(opts = {}) {
  await loadData();
  const mode = opts.preview || isGM() ? "preview" : "player";
  let a = apps[mode];
  if (!a) a = apps[mode] = new ShtabApp(mode, opts);
  else { if (opts.tab) a.tab = opts.tab; a.focus = opts.focus ?? null; }
  return a.render(true);
}
function toggle() {
  const a = isGM() ? apps.gm : apps.player;
  if (a?.rendered) return a.close();
  return openShtab();
}

/* ───────────── сводка «Ранее в операции» ───────────── */
function defaultRecap() {
  return {
    title: "Ранее в операции «Гномреган II»", map: true, on: false, i: 0,
    text: [
      "Главный механик **Гелбин Меггакрут** собрал добровольцев у Ворот-шестерни.",
      "Голозапись показала провал первой операции: **Облучатель 3000**, экстренный телепорт…",
      "…и клон. Машина, которую убили в глубинах, была подделкой. **Настоящий Термоштепсель жив.**",
      "Отряд получил разрешение главного механика и спустился в **Верхний Гномреган**.",
      "Дезактивация, госпиталь, Часовой ход. Депо обошли стороной.",
      "В Машинном зале вас перехватил **Мерд-Док** и записал в **Команду «Г»**. Это очень почётно.",
      "Он выдал парашюты и крикнул: «Прыгайте!»",
      "И вы прыгнули. Прямо вниз. **В зелёный туман.**",
      "Где-то наверху остались Эми Фитилюшка, «Безопасная зона» и Спальни…",
      "А здесь, внизу, в радиоактивной жиже **что-то шевелится**."
    ].join("\n")
  };
}
function recapLines(r) { return String(r?.text ?? "").split("\n").map((x) => x.trim()).filter(Boolean); }
function fmtLine(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }

function genRecapText() {
  const st = getState(), out = [];
  const qs = DATA.quests.filter((q) => st.q[q.id] && st.q[q.id].to === "all").sort((a, b) => st.q[a.id].t - st.q[b.id].t);
  for (const q of qs) {
    const e = st.q[q.id];
    out.push(`${q.giver ? `**${q.giver}**: ` : ""}задание «**${q.t}**».`);
    for (const o of q.obj) if (e.o?.[o.id]) out.push(`✔ ${o.t}`);
    if (e.s === "done") out.push(`Задание «${q.t}» **выполнено**.`);
    if (e.s === "failed") out.push(`Задание «${q.t}» **провалено**.`);
  }
  const hs = DATA.handouts.filter((h) => st.h[h.id]?.to === "all");
  if (hs.length) out.push(`В руках у отряда: ${hs.map((h) => h.t).join(", ")}.`);
  const trail = (st.trail ?? []).map((id) => ptById(id)?.t).filter(Boolean);
  if (trail.length > 1) out.push(`Путь отряда: ${trail.join(" → ")}.`);
  if (st.pin?.label) out.push(`Сейчас отряд: **${st.pin.label}**.`);
  return out.join("\n") || defaultRecap().text;
}

function trailSVG(st) {
  const pts = (st.trail ?? []).map((id) => ptById(id)).filter(Boolean);
  if (pts.length < 2) return "";
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(p.x * 100).toFixed(2)},${(p.y * 100 + 3).toFixed(2)}`).join(" ");
  return `<svg class="gs-trail-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}"/>${pts.slice(0, -1).map((p) => `<circle cx="${(p.x * 100).toFixed(2)}" cy="${(p.y * 100 + 3).toFixed(2)}" r=".9"/>`).join("")}</svg>`;
}

const RC_GEAR = (cls, size) => `<svg class="gs-rc-gear ${cls}" viewBox="0 0 100 100" style="width:${size}px;height:${size}px"><path d="${GEAR_PATH}"/></svg>`;

function renderRecap(prevRecap) {
  if (!DATA) return;
  const st = getState(), r = st.recap;
  let el = document.getElementById("gs-recap");
  if (!r?.on) {
    if (el && !el.classList.contains("out")) { el.classList.remove("in"); el.classList.add("out"); chirp("fail"); setTimeout(() => el.remove(), 900); }
    return;
  }
  const lines = recapLines(r);
  const i = Math.min(r.i ?? 0, lines.length - 1);
  const fresh = !el || el.classList.contains("out");
  if (fresh) {
    el?.remove();
    el = document.createElement("div");
    el.id = "gs-recap";
    el.innerHTML = `
      ${RC_GEAR("g1", 340)}${RC_GEAR("g2", 190)}${RC_GEAR("g3", 260)}${RC_GEAR("g4", 140)}
      <div class="gs-rc-col">
        <div class="gs-rc-panel">
          <div class="gs-rc-head">${RC_GEAR("mini", 34)}<div><small>Сводка штаба</small><b class="gs-rc-title"></b></div><span class="gs-rc-n"></span></div>
          <ol class="gs-rc-lines"></ol>
          ${isGM() ? `<div class="gs-rc-ctl"><button data-rc="prev" title="Назад">◀</button><button data-rc="next" class="prim" title="Следующая строка">Дальше ▶</button><button data-rc="all" title="Показать все строки">⏭</button><button data-rc="stop" title="Закончить показ">✕</button></div>` : ""}
        </div>
        <div class="gs-rc-map"></div>
      </div>`;
    document.body.append(el);
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rc]"); if (!b || !isGM()) return;
      const a = b.dataset.rc;
      if (a === "next") act.recapStep(1); else if (a === "prev") act.recapStep(-1);
      else if (a === "all") act.recapAll(); else if (a === "stop") act.recapStop();
    });
    el.querySelector(".gs-rc-map").addEventListener("click", () => lightbox(MAP_HID));
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    chirp("quest");
  }
  el.querySelector(".gs-rc-title").textContent = r.title || "Ранее в операции";
  el.querySelector(".gs-rc-n").textContent = `${i + 1}/${lines.length}`;
  const ol = el.querySelector(".gs-rc-lines");
  const prevI = fresh ? -1 : (prevRecap?.on ? prevRecap.i ?? 0 : -1);
  ol.innerHTML = lines.map((l, k) => {
    const vis = k <= i;
    if (!vis && !isGM()) return "";
    return `<li class="${vis ? "vis" : "ghost"} ${k === i ? "cur" : ""} ${k === i && k !== prevI ? "typing" : ""}"><span class="gs-rc-dot"></span><span>${fmtLine(l)}</span></li>`;
  }).join("");
  ol.querySelector("li.cur")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!fresh && i !== prevI) chirp("obj");
  const mapBox = el.querySelector(".gs-rc-map");
  mapBox.style.display = r.map ? "" : "none";
  if (r.map) mapBox.innerHTML = `<div class="gs-rc-map-h">📍 Схема Гномрегана${st.pin?.label ? ` · <b>${esc(st.pin.label)}</b>` : ""}</div>
    <div class="gs-map" data-viewer="${esc(defViewer())}">${`<img class="gs-map-img" src="${esc(hById(MAP_HID).img)}" alt="" draggable="false">`}${trailSVG(st)}<div class="gs-pin-layer">${layerHTML()}</div></div>`;
}

/* ───────────── плавающая шестерёнка ───────────── */
function buildFab() {
  if (document.getElementById("gs-fab")) return;
  const b = document.createElement("div");
  b.id = "gs-fab";
  b.title = isGM() ? "Штаб операции (J)" : "Журнал отряда (J)";
  b.innerHTML = `<svg viewBox="0 0 100 100"><path d="${GEAR_PATH}"/></svg><span class="gs-fab-n"></span>`;
  const pos = game.settings.get(MID, "fabPos");
  if (pos?.x != null) { b.style.left = `${Math.min(pos.x, innerWidth - 60)}px`; b.style.top = `${Math.min(pos.y, innerHeight - 60)}px`; }
  document.body.append(b);
  let drag = null;
  b.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, l: b.offsetLeft, t: b.offsetTop, moved: false }; b.setPointerCapture(e.pointerId); });
  b.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) { b.style.left = `${drag.l + dx}px`; b.style.top = `${drag.t + dy}px`; b.style.right = "auto"; b.style.bottom = "auto"; }
  });
  b.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) game.settings.set(MID, "fabPos", { x: b.offsetLeft, y: b.offsetTop });
    else toggle();
    drag = null;
  });
  updateFab();
}
function updateFab() {
  const b = document.getElementById("gs-fab"); if (!b) return;
  const n = unseenCount();
  b.querySelector(".gs-fab-n").textContent = n || "";
  b.classList.toggle("has", n > 0);
}

/* ───────────── шестерёнка (SVG) ───────────── */
const GEAR_PATH = (() => {
  const teeth = 12, R = 46, r = 38, w = 0.13;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const pts = [[a - w * 1.6, r], [a - w, R], [a + w, R], [a + w * 1.6, r], [a + Math.PI / teeth, r]];
    for (const [ang, rad] of pts) d += `${d ? "L" : "M"}${(50 + rad * Math.cos(ang)).toFixed(2)},${(50 + rad * Math.sin(ang)).toFixed(2)}`;
  }
  d += "Z M50,34 A16,16 0 1,0 50.01,34 Z";
  return d;
})();

/* ───────────── регистрация ───────────── */
Hooks.once("init", () => {
  game.settings.register(MID, "state", {
    scope: "world", config: false, type: Object, default: { q: {}, h: {}, pin: null },
    onChange: (v) => onStateChange(v)
  });
  game.settings.register(MID, "seen", { scope: "client", config: false, type: Array, default: [] });
  game.settings.register(MID, "fabPos", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MID, "lastPage", { scope: "client", config: false, type: String, default: "gs-help" });
  game.settings.register(MID, "fab", {
    name: "Плавающая кнопка-шестерёнка", hint: "Кнопка штаба / журнала отряда поверх экрана. Её можно перетаскивать.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: (v) => v ? buildFab() : document.getElementById("gs-fab")?.remove()
  });
  game.keybindings.register(MID, "open", {
    name: "Штаб операции / Журнал отряда",
    editable: [{ key: "KeyJ" }],
    onDown: () => { toggle(); return true; }
  });
});

Hooks.once("ready", async () => {
  await loadData();
  PREV = getState();
  if (game.settings.get(MID, "fab")) buildFab();
  game.socket.on(SOCKET, (d) => {
    if (!d || isGM()) return;
    if (d.a === "show") lightbox(d.id, { remote: true });
    else if (d.a === "hide") closeLightbox();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && LB) { ev.stopPropagation(); ev.preventDefault(); closeLightbox(); }
  }, true);
  renderRecap(null);
  const api = {
    recap: act.recapStart, recapNext: () => act.recapStep(1), recapStop: act.recapStop,
    open: openShtab, squad: openSquad,
    give: act.giveQuest, done: (id) => act.questStatus(id, "done"), fail: (id) => act.questStatus(id, "failed"),
    reveal: act.revealHandout, screen: act.screen, pin: act.pinPoint, unpin: act.clearPin,
    get data() { return DATA; }, get state() { return getState(); }
  };
  game.modules.get(MID).api = api;
  globalThis.GnomreganShtab = api;
});

Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".gs-dir-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gs-dir-btn";
  btn.innerHTML = `<i class="fas fa-cog"></i> ${isGM() ? "Штаб операции «Гномреган»" : "Журнал отряда"}`;
  btn.addEventListener("click", () => openShtab());
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(btn);
});
