/*
 * Монстрятина — боссы с Боевыми действиями (Сигнал → Разрешение) для Foundry VTT v13–v14, dnd5e.
 * Пульт мастера (кнопка ☠ или Shift+M), полноэкранные плашки с артом и звуком у всех игроков,
 * фазы, призыв миньонов на сцену. Движок от «Кармины», данные боссов — в bosses.js.
 */
import { BOSSES, TONES } from "./bosses.js";

const MID = "monstryatina";
const M = { VERSION: "0.5.2", BOSSES };
const CH = "module." + MID;
const ROOT = `modules/${MID}/`;
const isGM = () => !!game.user?.isGM;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nonce = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);
const clone = (o) => foundry.utils.deepClone(o);
const url = (p) => !p ? "" : String(p).split("/").map(seg => /%[0-9A-Fa-f]{2}/.test(seg) ? seg : encodeURIComponent(seg)).join("/");

/* ================================================================ состояние */

const DEFAULT_STATE = { boss: "sickle", signal: null, target: null, phase: 1, segs: {} };
let CUR = null;
const seen = new Set();

Hooks.once("init", () => {
  const S = (key, data) => game.settings.register(MID, key, data);
  S("stage", { scope: "world", config: false, type: Object, default: {}, onChange: (p) => deliver(p) });
  S("state", { scope: "world", config: false, type: Object, default: DEFAULT_STATE, onChange: (v) => { if (v && typeof v === "object") CUR = v; M.refresh(); } });
  S("hints", { name: "Подсказывать игрокам, как сорвать Действие", hint: "Выключено — способ противодействия видит только мастер.", scope: "world", config: true, type: Boolean, default: false });
  S("rolls", { name: "Бросать урон на Разрешении", hint: "Плашка покажет выпавший урон. Смягчено — половина.", scope: "world", config: true, type: Boolean, default: true });
  S("autoSummon", { name: "Ставить призванных автоматически", hint: "На Разрешении призыва (например, «Королевская стража») токены сразу встают вокруг босса.", scope: "world", config: true, type: Boolean, default: false });
  S("chat", { name: "Дублировать плашки в чат", scope: "world", config: true, type: Boolean, default: false });
  S("volume", { name: "Громкость звуков", scope: "client", config: true, type: Number, range: { min: 0, max: 1, step: 0.05 }, default: 0.8 });
  S("motion", { name: "Тряска и вспышки экрана", hint: "Только у вас. Укачивает — выключите.", scope: "client", config: true, type: Boolean, default: true });
  game.keybindings.register(MID, "panel", { name: "Пульт Монстрятины", editable: [{ key: "KeyM", modifiers: ["Shift"] }], restricted: true, onDown: () => { M.panel(); return true; } });
});

function deliver(p) {
  if (!p?.nonce || seen.has(p.nonce)) return;
  seen.add(p.nonce);
  try { M._render(p); } catch (e) { console.error("Monstryatina | render", e); }
}
const emit = (msg) => { try { game.socket?.emit(CH, msg); } catch (e) { console.warn("Monstryatina | socket", e); } };
function readState() { try { return game.settings.get(MID, "state") ?? {}; } catch (e) { return {}; } }
const state = () => foundry.utils.mergeObject(clone(DEFAULT_STATE), clone(CUR ?? readState()), { inplace: false });
async function save(mut) {
  if (!isGM()) return;
  const s = state(); mut(s); CUR = s;
  emit({ t: "state", s }); M.refresh();
  try { await game.settings.set(MID, "state", s); } catch (e) { console.error("Monstryatina | state", e); }
}
function onSocket(m) {
  if (!m) return;
  if (m.t === "state") { CUR = m.s; return M.refresh(); }
  if (m.t === "stage") return deliver(m.p);
}

const boss = (id) => BOSSES[id ?? state().boss] ?? Object.values(BOSSES)[0];
const bossId = () => BOSSES[state().boss] ? state().boss : Object.keys(BOSSES)[0];
M.artPath = (id, key, kind) => ROOT + `assets/${id}/acts/${key}-${kind}.webp`;
M.sfxPath = (id, name) => ROOT + `sounds/${id}/${name}.ogg`;

/* ================================================================ звук */

M.play = function (src, volume = 1) {
  if (!src) return;
  try {
    const helper = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
    helper?.play({ src: url(src), volume: volume * (game.settings.get(MID, "volume") ?? .8), autoplay: true, loop: false }, false);
  } catch (e) { }
};
/** Звук всем: мастер шлёт по сокету, каждый играет у себя (с учётом своей громкости). */
M.sound = (id, name) => M.broadcast({ silent: true, sound: M.sfxPath(id, name) });

M.warn = (msg) => ui.notifications?.warn(`Монстрятина: ${msg}`);
M._reduced = function () {
  if (!game.settings.get(MID, "motion")) return true;
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
};

/* ================================================================ экранные эффекты */

M.Screen = {
  board() { return document.getElementById("board"); },
  layer() {
    let el = document.getElementById("monstr-fx");
    if (!el) { el = document.createElement("div"); el.id = "monstr-fx"; document.body.appendChild(el); }
    return el;
  },
  _fx: [], _raf: null,
  _push(dur, fn) { if (M._reduced()) return; this._fx.push({ start: performance.now(), dur, fn }); this._loop(); },
  _loop() {
    if (this._raf) return;
    const el = this.board(); if (!el) return;
    el.style.willChange = "transform";
    const tick = (now) => {
      const acc = { x: 0, y: 0, rot: 0, scale: 1 };
      this._fx = this._fx.filter(e => now - e.start < e.dur);
      if (!this._fx.length) { el.style.transform = ""; el.style.willChange = ""; this._raf = null; return; }
      for (const e of this._fx) {
        const v = e.fn(Math.min(1, (now - e.start) / e.dur)) || {};
        acc.x += v.x || 0; acc.y += v.y || 0; acc.rot += v.rot || 0; acc.scale *= (v.scale || 1);
      }
      el.style.transform = `translate(${acc.x.toFixed(2)}px,${acc.y.toFixed(2)}px) rotate(${acc.rot.toFixed(3)}deg) scale(${acc.scale.toFixed(4)})`;
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  },
  shake({ power = 12, duration = 600, rot = 0.5 } = {}) {
    this._push(duration, p => { const d = (1 - p) * (1 - p); return { x: (Math.random() * 2 - 1) * power * d, y: (Math.random() * 2 - 1) * power * d, rot: (Math.random() * 2 - 1) * rot * d }; });
  },
  rumble({ power = 4, duration = 1600 } = {}) {
    this._push(duration, p => { const d = Math.sin(p * Math.PI); return { y: Math.sin(p * 46) * power * d, x: Math.sin(p * 31) * power * .4 * d }; });
  },
  spin({ degrees = 7, duration = 900 } = {}) {
    this._push(duration, p => { const e = p < .35 ? (p / .35) : 1 - ((p - .35) / .65); return { rot: degrees * e, scale: 1 + .012 * e }; });
  },
  wobble({ degrees = 1.6, duration = 1500 } = {}) { this._push(duration, p => ({ rot: Math.sin(p * 20) * degrees * Math.sin(p * Math.PI) })); },
  punch({ amount = .035, duration = 450 } = {}) {
    this._push(duration, p => { const e = p < .25 ? (p / .25) : 1 - ((p - .25) / .75); return { scale: 1 + amount * e }; });
  },
  creep({ amount = .05, duration = 2000 } = {}) { this._push(duration, p => ({ scale: 1 + amount * Math.sin(p * Math.PI) })); },
  /** Падение: экран резко проваливается вниз и пружинит обратно. */
  drop({ amount = 50, duration = 1100 } = {}) {
    this._push(duration, p => { const y = p < .18 ? amount * (p / .18) : amount * Math.exp(-(p - .18) * 7) * Math.cos((p - .18) * 22); return { y }; });
  },
  /** Дробь клинков по коре: серия коротких толчков. */
  drum({ beats = 8, gap = 170 } = {}) {
    for (let i = 0; i < beats; i++) setTimeout(() => this.punch({ amount: .012 + i * .002, duration: 140 }), i * gap);
  },
  flash({ color = "#C42743", duration = 550, opacity = .5 } = {}) {
    if (M._reduced()) return;
    const el = document.createElement("div");
    el.className = "mf-flash"; el.style.background = color;
    el.style.animation = `mfFlash ${duration}ms ease-out forwards`; el.style.setProperty("--mf-o", opacity);
    this.layer().appendChild(el); setTimeout(() => el.remove(), duration + 60);
  },
  /** Тень сверху: сгущается тёмная виньетка от верхнего края. */
  shadow({ duration = 6000 } = {}) {
    if (M._reduced()) return;
    const el = document.createElement("div"); el.className = "mf-shadow";
    el.style.animation = `mfShadow ${duration}ms ease-in-out forwards`;
    this.layer().appendChild(el); setTimeout(() => el.remove(), duration + 60);
  },
  /** Туман: цветная дымка, которая наползает и медленно тает. */
  fog({ color = "rgba(232,111,168,.5)", duration = 5000 } = {}) {
    if (M._reduced()) return;
    const el = document.createElement("div"); el.className = "mf-fog"; el.style.setProperty("--mf-c", color);
    el.style.animation = `mfFog ${duration}ms ease-in-out forwards`;
    this.layer().appendChild(el); setTimeout(() => el.remove(), duration + 60);
  },
  rings({ color = "#C9963A", duration = 1600, count = 4, dir = "out" } = {}) {
    if (M._reduced()) return;
    const layer = this.layer(), size = Math.max(window.innerWidth, window.innerHeight);
    for (let i = 0; i < count; i++) {
      const r = document.createElement("div");
      r.className = "mf-ring"; r.style.setProperty("--mf-c", color); r.style.width = r.style.height = size + "px";
      r.style.animation = `${dir === "in" ? "mfRingIn" : "mfRingOut"} ${duration}ms ease-out ${i * (duration / count / 1.6)}ms forwards`;
      layer.appendChild(r); setTimeout(() => r.remove(), duration * 2);
    }
  },
  /** Листья: зелёные «лепестки» — разлетаются из центра (spin) или сыплются сверху. */
  leaves({ count = 90, duration = 3000, spin = true, colors = ["#3E6B2F", "#5A8A3A", "#2C4A22", "#7A9A44", "#E4677C"] } = {}) {
    if (M._reduced()) return;
    const cv = document.createElement("canvas");
    cv.className = "mf-leaves"; cv.width = window.innerWidth; cv.height = window.innerHeight;
    this.layer().appendChild(cv);
    const ctx = cv.getContext("2d"), cx = cv.width / 2, cy = cv.height / 2;
    const P = Array.from({ length: count }, (_, i) => {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      return { x: spin ? cx + Math.cos(a) * 40 : Math.random() * cv.width, y: spin ? cy + Math.sin(a) * 40 : -20 - Math.random() * 300,
        vx: spin ? Math.cos(a) * sp : (Math.random() - .5) * 2, vy: spin ? Math.sin(a) * sp * .6 : 2 + Math.random() * 3.5,
        r: 4 + Math.random() * 8, rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, a: .6 + Math.random() * .4,
        c: colors[i % colors.length] };
    });
    const t0 = performance.now();
    const tick = (now) => {
      const p = (now - t0) / duration;
      if (p >= 1) { cv.remove(); return; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const q of P) {
        q.x += q.vx + Math.sin(now / 300 + q.r) * .6; q.y += q.vy; q.rot += q.vr; q.vy += spin ? .05 : .015;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.globalAlpha = q.a * (1 - p);
        ctx.fillStyle = q.c; ctx.beginPath(); ctx.ellipse(0, 0, q.r, q.r * .42, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  /** Жуки: тёмные многоногие точки разбегаются по экрану. */
  bugs({ count = 120, duration = 3200 } = {}) {
    if (M._reduced()) return;
    const cv = document.createElement("canvas"); cv.className = "mf-leaves"; cv.width = innerWidth; cv.height = innerHeight;
    this.layer().appendChild(cv);
    const ctx = cv.getContext("2d"), edge = () => { const s = Math.floor(Math.random() * 4); return s === 0 ? [Math.random() * cv.width, -20] : s === 1 ? [cv.width + 20, Math.random() * cv.height] : s === 2 ? [Math.random() * cv.width, cv.height + 20] : [-20, Math.random() * cv.height]; };
    const P = Array.from({ length: count }, () => { const [x, y] = edge(); const a = Math.atan2(cv.height / 2 - y + (Math.random() - .5) * 400, cv.width / 2 - x + (Math.random() - .5) * 600);
      return { x, y, a, sp: 3 + Math.random() * 5, r: 4 + Math.random() * 6, ph: Math.random() * 6 }; });
    const t0 = performance.now();
    const tick = (now) => {
      const p = (now - t0) / duration; if (p >= 1) return cv.remove();
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const q of P) {
        q.a += (Math.random() - .5) * .35; q.x += Math.cos(q.a) * q.sp; q.y += Math.sin(q.a) * q.sp; q.ph += .9;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a); ctx.globalAlpha = .85 * (1 - p * p);
        ctx.strokeStyle = "#1a120a"; ctx.lineWidth = 1.2;
        for (let k = -1; k <= 1; k++) { const w = Math.sin(q.ph + k) * q.r * .5; ctx.beginPath(); ctx.moveTo(k * q.r * .5, 0); ctx.lineTo(k * q.r * .5 + w, -q.r * 1.1); ctx.moveTo(k * q.r * .5, 0); ctx.lineTo(k * q.r * .5 - w, q.r * 1.1); ctx.stroke(); }
        ctx.fillStyle = "#2a1c0e"; ctx.beginPath(); ctx.ellipse(0, 0, q.r, q.r * .55, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(232,162,58,.7)"; ctx.beginPath(); ctx.ellipse(-q.r * .5, 0, q.r * .35, q.r * .3, 0, 0, 7); ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  /** Пыль и каменная крошка сверху. */
  dust({ count = 100, duration = 3000 } = {}) { this.leaves({ count, duration, spin: false, colors: ["#8A7A5A", "#6E5E44", "#B0A080", "#4A3E2C"] }); },
  play(list) {
    if (!Array.isArray(list)) return;
    for (const [name, opts] of list) { try { this[name]?.(opts || {}); } catch (e) { console.warn("Monstryatina FX:", name, e); } }
  }
};

/* ================================================================ плашка */

M._render = function (p) {
  if (p.sound) M.play(p.sound, p.volume ?? 1);
  M.Screen.play(p.screen);
  if (p.silent) return;
  document.getElementById("monstr-stage")?.remove();
  const duration = p.duration ?? 6500;
  const stage = document.createElement("div");
  stage.id = "monstr-stage";
  if (!p.art) stage.classList.add("mx-noart");
  if (p.fit === "contain") stage.classList.add("mx-contain");
  stage.style.setProperty("--mx-accent", p.accent);
  stage.style.setProperty("--mx-glow", p.glow);
  stage.innerHTML = `
    ${p.art ? `<img class="mx-bg" src="${esc(p.art)}"${p.art2 ? ` data-alt="${esc(p.art2)}"` : ""} onerror="if(this.dataset.alt){this.src=this.dataset.alt;delete this.dataset.alt;}else{this.classList.add('mx-missing');this.closest('#monstr-stage').classList.add('mx-noart')}">` : ""}
    <div class="mx-scrim"></div>
    <div class="mx-caption">
      <div class="mx-bar"></div>
      <p class="mx-kicker">${p.kicker || ""}</p>
      <h1 class="mx-title">${p.title || ""}</h1>
      ${p.text ? `<p class="mx-text">${p.text}</p>` : ""}
      ${p.meta ? `<p class="mx-meta">${p.meta}</p>` : ""}
    </div>
    <div class="mx-timer"></div>`;
  document.body.appendChild(stage);
  const bar = stage.querySelector(".mx-timer");
  bar.style.transition = `transform ${duration}ms linear`;
  requestAnimationFrame(() => { bar.style.transform = "scaleX(0)"; });
  let done = false;
  const close = () => {
    if (done) return; done = true;
    stage.classList.add("mx-out"); setTimeout(() => stage.remove(), 850);
    document.removeEventListener("pointerdown", close);
  };
  setTimeout(close, duration);
  setTimeout(() => document.addEventListener("pointerdown", close), 500);
};

M.broadcast = async function (payload) {
  if (!isGM()) return M.warn("показывать плашки может только мастер");
  payload.nonce = nonce();
  if (game.settings.get(MID, "chat") && !payload.silent) {
    ChatMessage.create({
      speaker: { alias: boss().name },
      content: `<div style="border-left:3px solid ${payload.accent};padding:6px 0 6px 10px;">
        <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${payload.accent}">${payload.kicker}</div>
        <div style="font-size:17px;font-weight:600;margin:2px 0 4px">${payload.title}</div>
        ${payload.text ? `<div style="font-size:13px;opacity:.85">${payload.text}</div>` : ""}${payload.meta ? `<div style="font-size:12px;margin-top:4px">${payload.meta}</div>` : ""}</div>`
    });
  }
  emit({ t: "stage", p: payload });
  deliver(payload);
  try { await game.settings.set(MID, "stage", payload); } catch (e) { console.error("Monstryatina | stage", e); }
};

/* ================================================================ трекер Сигнала (виден всем) */

M.refresh = function () { M.Track.render(state()); M.Panel.render(); };

M.Track = {
  render(s) {
    const b = BOSSES[s.boss], a = s.signal && b?.actions[s.signal];
    const hints = game.settings.get(MID, "hints");
    const key = a ? `${s.boss}|${s.signal}|${hints}|${s.target ?? ""}` : "";
    const old = document.getElementById("monstr-signal");
    if (old?.dataset.key === key) return;
    old?.remove();
    if (!a) return;
    const el = document.createElement("div");
    el.id = "monstr-signal"; el.dataset.key = key;
    el.innerHTML = `
      <span class="ms-grip" title="Зажми и тащи. Двойной клик — на место">⠿</span>
      <p class="ms-k">${esc(b.name)} · активный сигнал</p>
      <p class="ms-t">${a.title}</p>
      ${s.target ? `<p class="ms-x">Цель: <b>${esc(s.target)}</b></p>` : ""}
      <p class="ms-l">${hints ? a.kind : "Что происходит"}</p>
      <p class="ms-c">${hints ? a.counter : a.signal}</p>`;
    document.body.appendChild(el);
    M.drag(el, el.querySelector(".ms-grip"), "monstr-signal-pos");
  }
};

/** Перетаскивание плашек за ручку; позиция у каждого игрока своя (localStorage). */
M.drag = function (el, grip, key) {
  try { const p = JSON.parse(localStorage.getItem(key)); if (p) { el.style.left = Math.min(Math.max(0, p.x), innerWidth - 80) + "px"; el.style.top = Math.min(Math.max(0, p.y), innerHeight - 40) + "px"; el.style.right = "auto"; } } catch (e) { }
  grip.addEventListener("dblclick", () => { try { localStorage.removeItem(key); } catch (e) { } el.style.left = ""; el.style.top = ""; el.style.right = ""; });
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); grip.setPointerCapture(ev.pointerId);
    const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    el.style.right = "auto"; el.style.left = r.left + "px"; el.style.top = r.top + "px";
    const move = (e) => { el.style.left = Math.min(Math.max(0, e.clientX - dx), innerWidth - 80) + "px"; el.style.top = Math.min(Math.max(0, e.clientY - dy), innerHeight - 40) + "px"; };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      try { localStorage.setItem(key, JSON.stringify({ x: parseInt(el.style.left), y: parseInt(el.style.top) })); } catch (e) { } };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
};

/* ================================================================ токены на сцене */

M.bossToken = function (id = bossId()) {
  const b = BOSSES[id]; if (!globalThis.canvas?.tokens) return null;
  const is = (t) => !t.actor?.getFlag?.(MID, "part") && (t.actor?.getFlag?.(MID, "id") === id || b.match?.test(t.name) || b.match?.test(t.actor?.name ?? ""));
  return canvas.tokens.controlled.find(is) ?? canvas.tokens.placeables.find(is) ?? null;
};

/** Поставить миньонов вокруг босса (или в центр экрана) из компендиума модуля. */
const getActor = async (name) => {
  let actor = game.actors.find(a => a.name === name);
  const pack = game.packs.get(`${MID}.actors`);
  if (!actor && pack) {
    const idx = (await pack.getIndex()).find(e => e.name === name);
    if (idx) actor = await game.actors.importFromCompendium(pack, idx._id, {}, { keepId: false });
  }
  return actor;
};
/** Призыв. name — какой миньон (для боссов с выводком), "roll" — случайно по таблице к6. */
M.summon = async function (id = bossId(), count, name) {
  if (!isGM()) return;
  const b = BOSSES[id], sm = b?.summon; if (!sm) return M.warn("у этого босса нет призыва");
  if (!canvas?.scene) return M.warn("нет активной сцены");
  count ??= sm.count;
  if (name === "roll" && sm.table) {
    const got = [];
    for (let i = 0; i < count; i++) { const r = Math.ceil(Math.random() * sm.table.length); got.push(sm.table[r - 1]); }
    const tally = {}; got.forEach(n => tally[n] = (tally[n] || 0) + 1);
    for (const [n, c] of Object.entries(tally)) await M.summon(id, c, n);
    return;
  }
  name ??= sm.actor;
  const actor = await getActor(name);
  if (!actor) return M.warn(`не нашёл актёра «${name}»`);
  const grid = canvas.grid.size, bt = M.bossToken(id);
  const c = bt ? bt.center : canvas.stage.pivot;
  const docs = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * .4, dist = grid * (2.4 + Math.random() * .8);
    const td = await actor.getTokenDocument({ x: c.x + Math.cos(ang) * dist - grid / 2, y: c.y + Math.sin(ang) * dist - grid / 2 });
    const o = td.toObject();
    const snapped = canvas.grid.getSnappedPoint?.({ x: o.x, y: o.y }, { mode: CONST.GRID_SNAPPING_MODES?.TOP_LEFT_VERTEX ?? 1 });
    if (snapped) { o.x = snapped.x; o.y = snapped.y; }
    docs.push(o);
  }
  await canvas.scene.createEmbeddedDocuments("Token", docs);
  M.sound(id, sm.sound ?? "nymph");
  ui.notifications.info(`${b.name}: на сцене ${count} × ${name}.`);
};

/* ================================================================ API */

const avail = (a, phase) => (a.only ? phase === a.only : phase >= (a.phase || 1));

M.signal = async function (key, id = bossId()) {
  const b = BOSSES[id], a = b?.actions[key];
  if (!a) return M.warn(`нет такого действия: «${key}»`);
  const t = TONES.signal, hints = game.settings.get(MID, "hints");
  const target = a.target ? (Array.from(game.user.targets)[0]?.name ?? null) : null;
  if (a.target && !target) M.warn("цель не наведена — плашка уйдёт без имени (клавиша T)");
  await save(s => { s.boss = id; s.signal = key; s.target = target; });
  await M.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title: a.title,
    text: a.signal + (target ? ` <b style="color:${t.accent}">${esc(target)}</b>${a.targetText ?? ""}` : ""),
    meta: hints ? `<b>${a.kind}:</b> ${a.counter}` : null, art: M.artPath(id, key, "signal"), duration: 7500,
    screen: a.screen?.signal, sound: M.sfxPath(id, key + "-signal") });
  if (a.note) ui.notifications.info(`${b.name} — ${a.title}: ${a.note}`);
};

M.resolve = async function (key, outcome = "full", id = bossId()) {
  const s0 = state(); key ??= s0.signal;
  const b = BOSSES[id], a = b?.actions[key];
  if (!a) return M.warn(`нет такого действия: «${key}»`);
  const t = TONES[outcome] ?? TONES.full;
  let text, meta = null;
  if (outcome === "none") text = a.neutralized;
  else {
    text = a.resolution;
    const parts = [], r = a.roll ?? {};
    if (r.attack != null && game.settings.get(MID, "rolls")) {
      let atk = null; try { atk = await new Roll(`${r.adv && outcome === "full" ? "2d20kh" : "1d20"}+${r.attack}`).evaluate(); } catch (e) { }
      parts.push(`<b>Атака:</b> ${atk ? atk.total : "?"} <span style="opacity:.6">(+${r.attack}${r.adv && outcome === "full" ? ", преимущество" : ""})</span>`);
    }
    if (r.save) parts.push(`<b>Спасбросок:</b> ${r.save}`);
    if (r.formula) {
      let total = null;
      if (game.settings.get(MID, "rolls")) { try { total = (await new Roll(r.formula).evaluate()).total; } catch (e) { } }
      if (total !== null && outcome === "soft") total = Math.floor(total / 2);
      parts.push(total === null ? `<b>Урон:</b> ${r.formula} ${r.type}`
        : `<b>Урон:</b> ${total} ${r.type} <span style="opacity:.6">(${r.formula}${outcome === "soft" ? ", смягчено — половина" : ""})</span>`);
    }
    if (s0.target && s0.signal === key) parts.unshift(`<b>Цель:</b> ${esc(s0.target)}`);
    if (parts.length) meta = parts.join(" &nbsp;·&nbsp; ");
  }
  await save(s => { if (s.signal === key) { s.signal = null; s.target = null; } });
  await M.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title: a.title, text, meta,
    art: M.artPath(id, key, outcome === "none" ? "none" : "res"), art2: outcome === "none" ? M.artPath(id, key, "signal") : null, duration: outcome === "none" ? 5000 : 7000,
    screen: a.screen?.[outcome === "none" ? "none" : "full"], sound: M.sfxPath(id, outcome === "none" ? "none" : key + "-res") });
  if (a.summon && outcome !== "none") {
    if (a.summonActor && game.settings.get(MID, "autoSummon")) M.summon(id, a.summonCount ?? 2, a.summonActor);
    else M.Panel.flash("res", `«${a.title}» сработал — поставь ${a.summonActor ? `${a.summonCount ?? ""} × ${a.summonActor}` : "миньонов"} кнопкой на пульте.`);
  }
};

M.phase = async function (n, id = bossId()) {
  const b = BOSSES[id], ph = b?.phases.find(p => p.n === n); if (!ph) return;
  await save(s => { s.boss = id; s.phase = n; s.signal = null; s.target = null; });
  if (n === 1) return;
  const t = TONES.phase;
  await M.broadcast({ kicker: `${b.name} · фаза ${["", "первая", "вторая", "третья", "четвёртая"][n] ?? n}`, accent: b.accent || t.accent, glow: t.glow,
    title: ph.title, text: ph.text, meta: ph.meta ?? null, art: ROOT + `assets/${id}/portrait.webp`, duration: 8500,
    screen: [["rumble", { power: 5, duration: 2000 }], ["flash", { color: b.accent || t.accent, opacity: .35 }], ["leaves", { count: 100 }]],
    sound: M.sfxPath(id, "phase") });
};

/** Плашка начала боя (общий арт босса со свитой). */
M.intro = async function (id = bossId()) {
  const b = BOSSES[id], it = b?.intro; if (!it) return;
  await save(s => { s.boss = id; s.phase = 1; s.signal = null; s.target = null; });
  await M.broadcast({ kicker: "БОСС", accent: b.accent, glow: "rgba(0,0,0,.5)", title: it.title ?? b.name, text: it.text, art: ROOT + `assets/${id}/${it.art}`, duration: 9000,
    screen: [["rumble", { power: 4, duration: 2500 }], ["bugs", { count: 140 }]], sound: M.sfxPath(id, "phase") });
};
M.banner = function (title, text = "", tone = "info") {
  const t = TONES[tone] ?? TONES.info;
  return M.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title, text, meta: null, art: null, duration: 6500 });
};
M.fx = (name, opts = {}) => M.Screen.play([[name, opts]]);
M.fxAll = (name, opts = {}) => M.broadcast({ silent: true, screen: [[name, opts]] });

/* ---------- части тела ---------- */
M.segDmg = (id, sid) => Number(state().segs?.[`${id}.${sid}`] ?? 0);
/** Актёр части тела (отдельный токен, по которому бьют игроки): флаг monstryatina.part = "<босс>.<часть>". */
M.partActor = (id, sid) => game.actors?.find(a => a.getFlag?.(MID, "part") === `${id}.${sid}`) ?? null;
const partName = (b, sg) => `${b.name}: ${sg.name}`;

/** Урон по части тела: копит урон части, снимает хиты с босса, на поломке — плашка всем и −1 легендарное сопротивление.
 *  opts.fromPart — урон уже нанесён по токену части (не трогаем её хиты повторно). */
M.segHit = async function (sid, dmg, id = bossId(), opts = {}) {
  const b = BOSSES[id], sg = b?.segments?.find(x => x.id === sid); if (!sg || !dmg) return;
  const before = M.segDmg(id, sid), after = Math.max(0, before + dmg);
  await save(s => { s.segs = s.segs || {}; s.segs[`${id}.${sid}`] = after; });
  const pa = M.partActor(id, sid);
  if (pa && !opts.fromPart) {
    try { await pa.update({ "system.attributes.hp.value": Math.max(0, sg.hp - after) }, { [MID]: true }); } catch (e) { console.warn(e); }
  }
  const tok = M.bossToken(id), actor = tok?.actor ?? game.actors?.find(a => a.getFlag?.(MID, "id") === id);
  const broke = before < sg.hp && after >= sg.hp;
  if (actor && ((dmg > 0 && !b.segNoBossDmg) || broke)) {
    const hp = actor.system.attributes.hp.value;
    const upd = b.segNoBossDmg ? {} : { "system.attributes.hp.value": Math.max(0, hp - dmg) };
    if (broke && actor.system.resources?.legres) upd["system.resources.legres.value"] = Math.max(0, (actor.system.resources.legres.value ?? 0) - 1);
    try { await actor.update(upd, { [MID]: true }); } catch (e) { console.warn(e); }
  }
  if (broke) {
    await M.broadcast({ kicker: `${b.name} · ${b.segKicker ?? "часть тела сломана"}`, accent: "#E8C46A", glow: "rgba(232,196,106,.5)", title: sg.name, text: sg.broken,
      meta: b.segMeta ?? "<b>−1 легендарное сопротивление.</b>", art: ROOT + (sg.img ? `assets/${id}/${sg.img}` : `assets/${id}/seg-${sid}.webp`), duration: 7000, fit: sg.img ? null : "contain",
      screen: [["shake", { power: 16, duration: 700 }], ["flash", { color: "#E8C46A", opacity: .35 }]], sound: M.sfxPath(id, "none") });
    if (pa) { try { await pa.toggleStatusEffect?.("dead", { active: true, overlay: true }); } catch (e) { } }
  }
};
M.segReset = async (id = bossId()) => {
  await save(s => { for (const k of Object.keys(s.segs || {})) if (k.startsWith(id + ".")) delete s.segs[k]; });
  for (const sg of BOSSES[id]?.segments ?? []) {
    const pa = M.partActor(id, sg.id); if (!pa) continue;
    try { await pa.update({ "system.attributes.hp.value": sg.hp }, { [MID]: true }); } catch (e) { }
    try { await pa.toggleStatusEffect?.("dead", { active: false, overlay: true }); } catch (e) { }
  }
};
/** Части тела на сцену: токены-части из компендиума (по ним бьют как по обычной цели) цепочкой от токена босса.
 *  Если актёров частей нет — тайлы-метки. */
M.segPlace = async function (id = bossId()) {
  const b = BOSSES[id]; if (!b?.segments || !canvas?.scene) return;
  const g = canvas.grid.size, bt = M.bossToken(id), c = bt ? { x: bt.x, y: bt.y + bt.h / 2 - g } : { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
  const pack = game.packs.get(`${MID}.actors`), idx = pack ? await pack.getIndex({ fields: ["flags"] }) : null;
  const docs = [];
  for (const [i, sg] of b.segments.entries()) {
    let a = M.partActor(id, sg.id);
    if (!a && idx) {
      const e = idx.find(x => x.flags?.[MID]?.part === `${id}.${sg.id}`) ?? idx.find(x => x.name === partName(b, sg));
      if (e) a = await game.actors.importFromCompendium(pack, e._id, {}, { keepId: false });
    }
    if (!a) continue;
    const td = (await a.getTokenDocument({ x: c.x + (bt ? bt.w : 0) + i * g * 2, y: c.y })).toObject();
    docs.push(td);
  }
  if (docs.length) {
    await canvas.scene.createEmbeddedDocuments("Token", docs);
    return ui.notifications.info(`${b.name}: части тела на сцене — растащи их вдоль тела. Игроки бьют по ним как по обычным целям, урон уходит в хиты босса.`);
  }
  const tiles = b.segments.map((sg, i) => ({ texture: { src: ROOT + `assets/${id}/seg-${sg.id}.webp` }, x: c.x + i * g * 2, y: c.y, width: g, height: g,
    elevation: 0, sort: 10, flags: { [MID]: { seg: sg.id } } }));
  await canvas.scene.createEmbeddedDocuments("Tile", tiles);
  ui.notifications.info(`${b.name}: метки частей тела на сцене.`);
};
/* Урон по токену части тела → трекер и хиты босса (обрабатывает один активный мастер). */
Hooks.on("preUpdateActor", (actor, diff, opts) => {
  if (!actor.getFlag?.(MID, "part") || opts?.[MID]) return;
  if (foundry.utils.getProperty(diff, "system.attributes.hp.value") === undefined) return;
  opts.monstrOldHp = actor.system.attributes.hp.value;
});
Hooks.on("updateActor", (actor, diff, opts) => {
  const tag = actor.getFlag?.(MID, "part"); if (!tag || opts?.[MID] || opts?.monstrOldHp === undefined) return;
  if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
  const [id, sid] = tag.split("."), dmg = opts.monstrOldHp - actor.system.attributes.hp.value;
  if (dmg) M.segHit(sid, dmg, id, { fromPart: true });
});

/* ================================================================ связка с боем */

const rhythm = (round) => (round >= 3 ? 2 : 1);
const isBoss = (c) => { const b = boss(); return !!c && !c.actor?.getFlag?.(MID, "part") && (c.actor?.getFlag?.(MID, "id") === bossId() || b.match?.test(c.name ?? c.actor?.name ?? "")); };

Hooks.on("updateCombat", (combat, diff) => {
  if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
  if (!("turn" in diff) && !("round" in diff)) return;
  const s = state(), b = boss(), cur = combat.combatant;
  const prevId = combat.previous?.combatantId, prev = prevId ? combat.combatants.get(prevId) : null;
  if (isBoss(prev) && !isBoss(cur)) {
    const n = rhythm(combat.round);
    M.Panel.flash("sig", `Конец хода: ${b.name} подаёт Сигнал — ${n === 1 ? "одно Действие" : "два Действия"} (раунд ${combat.round}).`);
  }
  if (isBoss(cur)) M.Panel.flash(s.signal ? "res" : "info", s.signal ? `Начало хода: Разрешение «${b.actions[s.signal]?.title}».` : `Ход ${b.name}: активного Сигнала нет.`);
  M.Panel.render();
});

Hooks.on("updateActor", (actor, diff) => {
  if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
  if (diff?.system?.attributes?.hp?.value === undefined || actor.getFlag(MID, "part")) return;
  for (const [id, b] of Object.entries(BOSSES)) {
    if (actor.getFlag(MID, "id") !== id && !b.match?.test(actor.name)) continue;
    const hp = actor.system.attributes.hp.value, s = state();
    const next = b.phases.filter(p => p.n > (s.boss === id ? s.phase : 1) && hp <= p.hp).pop();
    if (next) M.Panel.flash("phase", `${b.name}: ${hp} хитов — пора фаза ${next.n} «${next.title}».`);
  }
});

/* ================================================================ пульт мастера */

M.Panel = {
  el: null, note: null,
  toggle() { this.el ? this.close() : this.open(); },
  close() { this.el?.remove(); this.el = null; },
  open() {
    if (!isGM()) return M.warn("пульт только для мастера");
    this.close();
    const el = document.createElement("div");
    el.id = "monstr-panel";
    let pos = { left: 120, top: 90 };
    try { pos = JSON.parse(localStorage.getItem("monstr-panel-pos")) || pos; } catch (e) { }
    el.style.left = Math.max(0, Math.min(pos.left, window.innerWidth - 380)) + "px";
    el.style.top = Math.max(0, Math.min(pos.top, window.innerHeight - 140)) + "px";
    document.body.appendChild(el);
    this.el = el; this.render(); this.bind();
  },
  render() {
    const el = this.el; if (!el) return;
    const s = state(), id = bossId(), b = BOSSES[id], round = game.combat?.round ?? 0;
    const open = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.sec));
    if (!el.dataset.init) { ["now", "acts"].forEach(x => open.add(x)); el.dataset.init = 1; }
    const scroll = el.querySelector(".mp-body")?.scrollTop ?? 0;
    const a = s.signal && b.actions[s.signal];
    const sec = (sid, title, html) => `<details data-sec="${sid}"${open.has(sid) ? " open" : ""}><summary class="mp-sect">${title}</summary>${html}</details>`;
    const ph = b.phases.find(p => p.n === s.phase) ?? b.phases[0];
    el.style.setProperty("--mp-accent", b.accent || "#C42743");
    el.innerHTML = `
      <div class="mp-head"><b>☠ ${esc(b.name)}</b>
        ${Object.keys(BOSSES).length > 1 ? `<select class="mp-boss">${Object.entries(BOSSES).map(([k, x]) => `<option value="${k}"${k === id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
        <i data-do="settings" title="Настройки модуля">⚙</i><i data-do="close" title="Закрыть (Shift+M)">✕</i></div>
      <div class="mp-body">
        ${this.note ? `<div class="mp-note ${this.note.kind}">${this.note.text}<i data-do="note-x">✕</i></div>` : ""}
        ${sec("now", `Сейчас · фаза ${s.phase}${round ? ` · раунд ${round}` : ""}`, `
          <p class="mp-hint" style="margin-top:0">${round ? `Действий за раунд: <b>${rhythm(round)}</b>. ` : ""}${esc(ph.text)}</p>
          ${a ? `<div class="mp-active"><b>Сигнал: ${a.title}.</b>${s.target ? ` Цель: <b>${esc(s.target)}</b>.` : ""} ${a.kind}: ${a.counter}
            <div class="mp-grid c3" style="margin-top:7px">
              <button class="b-res" data-do="full" data-k="${s.signal}">Разрешение</button>
              <button class="b-soft" data-do="soft" data-k="${s.signal}">Смягчено</button>
              <button class="b-none" data-do="none" data-k="${s.signal}">Сорвали</button></div></div>`
            : `<p class="mp-hint">Активного Сигнала нет.</p>`}`)}
        ${sec("acts", "Боевые действия", Object.entries(b.actions).map(([k, x]) => {
          const ok = avail(x, s.phase);
          const why = x.only ? `только фаза ${x.only}` : (x.phase > 1 ? `с фазы ${x.phase}` : "");
          return `<div class="mp-row${ok ? "" : " off"}${s.signal === k ? " live" : ""}">
            <span class="mp-name" title="${esc(x.title)} · ${x.kind}${why ? " · " + why : ""}">${x.title}${x.summon ? ' <em class="mp-tag">призыв</em>' : ""}</span>
            <button class="b-sig" data-do="signal" data-k="${k}" title="Сигнал">СИГ</button>
            <button class="b-res" data-do="full" data-k="${k}" title="Разрешение в полную силу">РАЗР</button>
            <button class="b-soft" data-do="soft" data-k="${k}" title="Смягчено">СМЯГ</button>
            <button class="b-none" data-do="none" data-k="${k}" title="Сорвано">НЕЙТ</button></div>`;
        }).join("") + `<p class="mp-hint">Серое — не в эту фазу (кнопки всё равно работают). Раунды 1–2: одно Действие, с 3-го — два.</p>`)}
        ${b.summon?.list ? sec("summon", "Выводок", `
          ${b.summon.list.map(n => `<div class="mp-row"><span class="mp-name">${esc(n)}</span>${[1, 2, 4].map(c => `<button data-do="summon" data-n="${c}" data-a="${esc(n)}">+${c}</button>`).join("")}</div>`).join("")}
          <div class="mp-grid c3" style="margin-top:4px">${[2, 4, 6].map(c => `<button data-do="summon" data-n="${c}" data-a="roll" title="${esc(b.summon.tableNote ?? "")}">к6 ×${c}</button>`).join("")}</div>
          <p class="mp-hint">${esc(b.summon.tableNote ?? "")}</p>`)
        : b.summon ? sec("summon", `Призыв · ${esc(b.summon.actor)}`, `
          <div class="mp-grid c3">${[1, 2, 3].map(n => `<button data-do="summon" data-n="${n}"${n === b.summon.count ? ' class="on"' : ""}>${n}</button>`).join("")}</div>
          <p class="mp-hint">Ставит токены вокруг босса (или в центр экрана), актёра берёт из компендиума.</p>`) : ""}
        ${b.segments ? sec("segs", `${b.segTitle ?? "Части тела"} · сломано ${b.segments.filter(x => M.segDmg(id, x.id) >= x.hp).length} из ${b.segments.length}`, b.segments.map(x => {
          const d = M.segDmg(id, x.id), br = d >= x.hp;
          return `<div class="mp-seg${br ? " broken" : ""}" title="${esc(x.where)}. Сломана: ${esc(x.broken)}">
            <span class="mp-name">${x.name} <small>КД ${x.ac}</small></span>
            <span class="mp-bar"><i style="width:${Math.min(100, d / x.hp * 100)}%"></i><b>${Math.min(d, x.hp)}/${x.hp}</b></span>
            <input type="number" class="mp-dmg" data-seg="${x.id}" placeholder="урон" min="-99" max="999">
            <button data-do="seg" data-k="${x.id}" title="Нанести урон (Enter)">−</button></div>`;
        }).join("") + `<div class="mp-grid" style="margin-top:5px">${b.segNoPlace ? "" : `<button data-do="seg-place">Части на сцену</button>`}<button data-do="seg-reset">Сбросить</button></div>
          <p class="mp-hint">${b.segHint ?? "Урон по части идёт и в хиты босса. Сломана — плашка всем и −1 легендарное сопротивление."}</p>`) : ""}
        ${sec("phase", "Фазы", (b.intro ? `<button class="wide" data-do="intro">Начало боя — плашка со свитой</button>` : "") + b.phases.map(p => `<button class="wide${s.phase === p.n ? " on" : ""}" data-do="phase" data-n="${p.n}" title="${esc(p.text)}">${p.n}. ${esc(p.title)}${p.n > 1 ? ` · ${p.hp} хитов` : ""}</button>`).join(""))}
        ${sec("sfx", "Звуки всем", `
          <div class="mp-grid">${Object.entries(b.sfx || {}).map(([k, f]) => `<button data-do="sfx" data-n="${f}">${({ strike: "Удар клинка", clash: "Звон клинков", roar: "Рёв", nymph: "Писк нимфы", bite: "Укус", tail: "Удар хвоста", swallow: "Глоток", thorn: "Шипы", guest: "Стон гостя", bloom: "Цветение", chitter: "Стрёкот", spit: "Плевок", sting: "Жало" })[k] ?? k}</button>`).join("")}</div>`)}
        ${sec("banner", "Своя плашка", `
          <input class="mp-in" data-in="title" placeholder="Заголовок">
          <textarea class="mp-in" data-in="text" rows="2" placeholder="Текст"></textarea>
          <div class="mp-grid"><select class="mp-in" data-in="tone">${Object.entries(TONES).map(([k, t]) => `<option value="${k}">${t.kicker.toLowerCase()}</option>`).join("")}</select><button data-do="banner">Показать всем</button></div>`)}
        ${sec("fx", "Эффекты вручную", `
          <div class="mp-grid">${[["shake", "Тряска"], ["rumble", "Гул"], ["spin", "Раскрутка"], ["drop", "Падение"], ["leaves", "Листья"], ["shadow", "Тень"], ["fog", "Туман"], ["drum", "Дробь"], ["bugs", "Жуки"], ["dust", "Пыль"]].map(([k, n]) => `<button data-do="fx" data-n="${k}" title="Всем игрокам">${n}</button>`).join("")}</div>
          <button class="wide${game.settings.get(MID, "motion") ? " on" : ""}" data-do="t-motion" style="margin-top:5px">Тряска экрана (у меня)</button>`)}
      </div>`;
    el.querySelector(".mp-body").scrollTop = scroll;
  },
  bind() {
    const el = this.el;
    el.addEventListener("mousedown", (ev) => {
      const head = ev.target.closest(".mp-head");
      if (!head || ["I", "SELECT", "OPTION"].includes(ev.target.tagName)) return;
      const dx = ev.clientX - el.offsetLeft, dy = ev.clientY - el.offsetTop;
      const move = (e) => {
        el.style.left = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 60)) + "px";
        el.style.top = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 40)) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
        try { localStorage.setItem("monstr-panel-pos", JSON.stringify({ left: el.offsetLeft, top: el.offsetTop })); } catch (e) { }
      };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    });
    el.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && ev.target.classList?.contains("mp-dmg")) { const v = Number(ev.target.value); if (v) M.segHit(ev.target.dataset.seg, v); }
    });
    el.addEventListener("change", (ev) => { if (ev.target.classList.contains("mp-boss")) save(s => { s.boss = ev.target.value; s.signal = null; s.phase = 1; }); });
    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-do]"); if (!btn) return;
      const d = btn.dataset.do, k = btn.dataset.k, n = btn.dataset.n, id = bossId();
      switch (d) {
        case "signal": return M.signal(k);
        case "full": case "soft": case "none": return M.resolve(k, d);
        case "phase": return M.phase(Number(n));
        case "intro": return M.intro(id);
        case "summon": return M.summon(id, Number(n), btn.dataset.a || undefined);
        case "seg": { const inp = el.querySelector(`.mp-dmg[data-seg="${k}"]`); const v = Number(inp?.value); if (!v) return M.warn("впиши урон"); return M.segHit(k, v, id); }
        case "seg-place": return M.segPlace(id);
        case "seg-reset": return M.segReset(id);
        case "sfx": return M.sound(id, n);
        case "fx": return M.fxAll(n);
        case "t-motion": return game.settings.set(MID, "motion", !game.settings.get(MID, "motion")).then(() => this.render());
        case "banner": {
          const v = (x) => el.querySelector(`[data-in=${x}]`)?.value?.trim() ?? "";
          if (!v("title")) return M.warn("напиши заголовок плашки");
          return M.banner(esc(v("title")), esc(v("text")).replace(/\n/g, "<br>"), v("tone"));
        }
        case "note-x": this.note = null; return this.render();
        case "settings": return (game.settings.sheet ?? new (foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig)()).render(true);
        case "close": return this.close();
      }
    });
  },
  flash(kind, text) { this.note = { kind, text }; if (this.el) this.render(); else ui.notifications.info(`Монстрятина: ${text}`); }
};
M.panel = () => M.Panel.toggle();

/* ================================================================ запуск */

function launcher() {
  if (!isGM() || document.getElementById("monstr-launch")) return;
  const b = document.createElement("button");
  b.id = "monstr-launch"; b.type = "button"; b.title = "Пульт Монстрятины (Shift+M)";
  b.innerHTML = `<span>☠</span>`;
  b.addEventListener("click", () => M.panel());
  document.body.appendChild(b);
}

Hooks.once("ready", () => {
  game.socket?.on(CH, onSocket);
  globalThis.Monstryatina = M;
  game.modules.get(MID).api = M;
  console.log(`Monstryatina | ${M.VERSION} готова (${isGM() ? "мастер" : "игрок"})`);
  M.refresh();
  launcher();
});

export default M;
