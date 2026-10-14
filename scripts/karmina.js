/*
 * Кармина · «Багровый Хор» — модуль для Foundry VTT (v13–v14).
 * Выросло из макросов «Кармина — МАСТЕР / ИГРОК» 2.4: тот же пульт, те же плашки и эффекты,
 * но один модуль на всех — игрокам ничего нажимать не нужно.
 *
 * Канал: мастер пишет скрытые настройки мира («stage» — одноразовая плашка, «state» — всё, что
 * должно висеть: Сигнал, часы, улики, бутоны, фаза). Foundry сам рассылает их всем клиентам,
 * а зашедший позже игрок сразу видит текущее состояние. Результаты проверок игрок пишет флагом
 * на своего пользователя — это ему разрешено.
 */
import * as D from "./data.js";

const MID = "karmina";
const K = { VERSION: "3.0.2" };
const CH = "module." + MID;
const isGM = () => !!game.user?.isGM;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nonce = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);
const clone = (o) => foundry.utils.deepClone(o);

/* ================================================================ настройки */

const DEFAULT_STATE = { signal: null, clock: 0, phase: 1, clues: [], showClues: true, buds: [], alive: [] };

Hooks.once("init", () => {
  const S = (key, data) => game.settings.register(MID, key, data);
  S("stage", { scope: "world", config: false, type: Object, default: {}, onChange: (p) => deliver(p) });
  S("state", { scope: "world", config: false, type: Object, default: DEFAULT_STATE, onChange: (v) => { if (v && typeof v === "object") CUR = v; K.refresh(); } });
  S("artDir", { name: "Папка артов", hint: "Папка с картинками плашек (хор.png, нектар.png, корни.png, голод.png, танец.png, «фаза 2.png», венец.png). Путь от папки Data.", scope: "world", config: true, type: String, default: D.ART_DIR_DEFAULT, filePicker: "folder" });
  S("showArt", { name: "Картинки в плашках", scope: "world", config: true, type: Boolean, default: true });
  S("hints", { name: "Подсказывать игрокам, как сорвать Действие", hint: "Выключено — способ противодействия видит только мастер на пульте.", scope: "world", config: true, type: Boolean, default: false });
  S("chat", { name: "Дублировать плашки в чат", scope: "world", config: true, type: Boolean, default: false });
  S("enhanced", { name: "Усиленная версия (с ящиком экспедиции)", hint: "Регенерация 25/15 и третья фаза «Последняя песня» на 78 хитах.", scope: "world", config: true, type: Boolean, default: false });
  S("buds", { name: "Имена в бутонах", hint: "Одиннадцать имён через запятую — из дневника Ренна.", scope: "world", config: true, type: String, default: D.BUD_NAMES.join(", ") });
  S("sfx", { name: "Звуки (JSON)", hint: "Пути к звукам: choir, growl, roots, splash, slash, clock. Пустая строка — без звука.", scope: "world", config: true, type: String, default: JSON.stringify(D.SFX_DEFAULT) });
  S("fx", { name: "Эффекты на сцене (JSON, нужен Sequencer)", hint: "bloom, nectar, root, drain, cone, pollen, rise — путь к .webm или ключ JB2A. Пусто — эффект пропускается.", scope: "world", config: true, type: String, default: JSON.stringify(D.FX_DEFAULT) });
  S("motion", { name: "Тряска и вспышки экрана", hint: "Только у вас. Укачивает — выключите.", scope: "client", config: true, type: Boolean, default: true });
  game.keybindings.register(MID, "panel", { name: "Пульт Кармины", editable: [{ key: "KeyK", modifiers: ["Shift"] }], restricted: true, onDown: () => { K.panel(); return true; } });
});

/* Доставка: основной канал — сокет модуля (мгновенно, всем открытым клиентам), запасной — настройки мира
   (их же читает зашедший позже). Повторы отсекаются по nonce. */
let CUR = null;
const seen = new Set();
function deliver(p) {
  if (!p?.nonce || seen.has(p.nonce)) return;
  seen.add(p.nonce);
  try { K._render(p); } catch (e) { console.error("Karmina | render", e); }
}
const emit = (msg) => { try { game.socket?.emit(CH, msg); } catch (e) { console.warn("Karmina | socket", e); } };
function readState() { try { return game.settings.get(MID, "state") ?? {}; } catch (e) { return {}; } }
const state = () => foundry.utils.mergeObject(clone(DEFAULT_STATE), clone(CUR ?? readState()), { inplace: false });
async function save(mut) {
  if (!isGM()) return;
  const s = state(); mut(s);
  CUR = s;
  emit({ t: "state", s });
  K.refresh();
  try { await game.settings.set(MID, "state", s); } catch (e) { console.error("Karmina | state", e); }
}
function onSocket(m) {
  if (!m) return;
  if (m.t === "state") { CUR = m.s; return K.refresh(); }
  if (m.t === "stage") return deliver(m.p);
  if (m.t === "check") { if (isGM()) gotResult(m.r); return; }
  if (m.nonce) deliver(m);            // старый макрос мастера 2.4 шлёт плашку как есть
}
const gotResult = (r) => { if (!r?.nonce || seen.has("r" + r.nonce)) return; seen.add("r" + r.nonce); K.Panel.result(r); };
const json = (key, def) => { try { return { ...def, ...JSON.parse(game.settings.get(MID, key) || "{}") }; } catch (e) { return def; } };
const sfx = () => json("sfx", D.SFX_DEFAULT);
const fxPaths = () => json("fx", D.FX_DEFAULT);
const budNames = () => {
  const n = String(game.settings.get(MID, "buds") || "").split(",").map(x => x.trim()).filter(Boolean);
  return Array.from({ length: 11 }, (_, i) => n[i] ?? `Бутон ${i + 1}`);
};

/** Путь Foundry → URL: кириллица, пробелы и решётки кодируются, уже закодированное не трогаем. */
const url = (p) => !p ? "" : String(p).split("/").map(seg => /%[0-9A-Fa-f]{2}/.test(seg) ? seg : encodeURIComponent(seg)).join("/");
K.art = (key) => {
  if (!game.settings.get(MID, "showArt")) return null;
  const f = D.ART_FILES[key]; if (!f) return null;
  let dir = String(game.settings.get(MID, "artDir") || "").trim();
  if (dir && !dir.endsWith("/")) dir += "/";
  return url(dir + f);
};

/* ================================================================ звук */

K.playSound = function (src, volume = 0.7) {
  if (!src) return;
  try {
    const helper = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
    helper?.play({ src: url(src), volume, autoplay: true, loop: false }, true);
  } catch (e) { /* файла нет — тихо продолжаем */ }
};
const playKey = (k, vol) => K.playSound(sfx()[k], vol);

K.warn = (msg) => ui.notifications?.warn(`Кармина: ${msg}`);
K._reduced = function () {
  if (!game.settings.get(MID, "motion")) return true;
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
};
K.motion = (on) => game.settings.set(MID, "motion", !!on);

/* ================================================================ экранные эффекты (из макроса 2.4) */

K.Screen = {
  board() { return document.getElementById("board"); },
  layer() {
    let el = document.getElementById("karmina-fx");
    if (!el) { el = document.createElement("div"); el.id = "karmina-fx"; document.body.appendChild(el); }
    return el;
  },
  _fx: [], _raf: null,
  _push(dur, fn) {
    if (K._reduced()) return;
    this._fx.push({ start: performance.now(), dur, fn });
    this._loop();
  },
  _loop() {
    if (this._raf) return;
    const el = this.board(); if (!el) return;
    el.style.willChange = "transform"; el.style.pointerEvents = "none";
    const tick = (now) => {
      const acc = { x: 0, y: 0, rot: 0, scale: 1 };
      this._fx = this._fx.filter(e => now - e.start < e.dur);
      if (!this._fx.length) { el.style.transform = ""; el.style.willChange = ""; el.style.pointerEvents = ""; this._raf = null; return; }
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
  flash({ color = "#C42743", duration = 550, opacity = .5 } = {}) {
    if (K._reduced()) return;
    const el = document.createElement("div");
    el.className = "kf-flash"; el.style.background = color;
    el.style.animation = `kfFlash ${duration}ms ease-out forwards`; el.style.setProperty("opacity", opacity);
    this.layer().appendChild(el); setTimeout(() => el.remove(), duration + 60);
  },
  rings({ color = "#C9963A", duration = 1600, count = 4, dir = "out" } = {}) {
    if (K._reduced()) return;
    const layer = this.layer(), size = Math.max(window.innerWidth, window.innerHeight);
    for (let i = 0; i < count; i++) {
      const r = document.createElement("div");
      r.className = "kf-ring"; r.style.setProperty("--kf-c", color); r.style.width = r.style.height = size + "px";
      r.style.animation = `${dir === "in" ? "kfRingIn" : "kfRingOut"} ${duration}ms ease-out ${i * (duration / count / 1.6)}ms forwards`;
      layer.appendChild(r); setTimeout(() => r.remove(), duration * 2);
    }
  },
  tide({ color = "rgba(214,169,72,.55)", to = .35, duration = 1400, hold = 900 } = {}) {
    if (K._reduced()) return;
    const el = document.createElement("div");
    el.className = "kf-tide"; el.style.setProperty("--kf-c", color);
    el.style.transition = `height ${duration}ms cubic-bezier(.25,.8,.3,1), opacity 700ms ease`;
    this.layer().appendChild(el);
    requestAnimationFrame(() => { el.style.height = Math.round(to * 100) + "vh"; });
    setTimeout(() => { el.style.opacity = "0"; }, duration + hold);
    setTimeout(() => el.remove(), duration + hold + 900);
  },
  petals({ count = 90, duration = 3000, color = "#B0243A", spin = true } = {}) {
    if (K._reduced()) return;
    const cv = document.createElement("canvas");
    cv.className = "kf-petals"; cv.width = window.innerWidth; cv.height = window.innerHeight;
    this.layer().appendChild(cv);
    const ctx = cv.getContext("2d"), cx = cv.width / 2, cy = cv.height / 2;
    const P = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
      return { x: spin ? cx + Math.cos(a) * 40 : Math.random() * cv.width, y: spin ? cy + Math.sin(a) * 40 : -20 - Math.random() * 200,
        vx: spin ? Math.cos(a) * sp : (Math.random() - .5) * 1.5, vy: spin ? Math.sin(a) * sp * .6 : 1.5 + Math.random() * 3,
        r: 3 + Math.random() * 7, rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, a: .55 + Math.random() * .45 };
    });
    const t0 = performance.now();
    const tick = (now) => {
      const p = (now - t0) / duration;
      if (p >= 1) { cv.remove(); return; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const q of P) {
        q.x += q.vx; q.y += q.vy; q.rot += q.vr; q.vy += spin ? .05 : .02;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.globalAlpha = q.a * (1 - p);
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, 0, q.r, q.r * .55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  play(list) {
    if (!Array.isArray(list)) return;
    for (const [name, opts] of list) { try { this[name]?.(opts || {}); } catch (e) { console.warn("Karmina FX:", name, e); } }
  }
};

/* ================================================================ плашка */

K._render = function (p) {
  if (p.check) K.Check.show(p.check); else if (p.check === null) K.Check.hide();
  if (p.silent) return;
  K.Screen.play(p.screen);
  document.getElementById("karmina-stage")?.remove();
  const duration = p.duration ?? 6500;
  const stage = document.createElement("div");
  stage.id = "karmina-stage";
  if (!p.art) stage.classList.add("kx-noart");
  stage.style.setProperty("--kx-accent", p.accent);
  stage.style.setProperty("--kx-glow", p.glow);
  stage.innerHTML = `
    ${p.art ? `<img class="kx-bg" src="${esc(p.art)}" onerror="this.classList.add('kx-missing');this.closest('#karmina-stage').classList.add('kx-noart')">` : ""}
    <div class="kx-scrim"></div>
    <div class="kx-caption">
      <div class="kx-bar"></div>
      <p class="kx-kicker">${p.kicker || ""}</p>
      <h1 class="kx-title">${p.title || ""}</h1>
      ${p.text ? `<p class="kx-text">${p.text}</p>` : ""}
      ${p.meta ? `<p class="kx-meta">${p.meta}</p>` : ""}
    </div>
    <div class="kx-timer"></div>`;
  document.body.appendChild(stage);
  const bar = stage.querySelector(".kx-timer");
  bar.style.transition = `transform ${duration}ms linear`;
  requestAnimationFrame(() => { bar.style.transform = "scaleX(0)"; });
  let done = false;
  const close = () => {
    if (done) return; done = true;
    stage.classList.add("kx-out"); setTimeout(() => stage.remove(), 850);
    document.removeEventListener("pointerdown", close);
  };
  setTimeout(close, duration);
  setTimeout(() => document.addEventListener("pointerdown", close), 500);
};

/** Показать всем: мастер пишет плашку в настройку мира, onChange отрисует её у каждого. */
K.broadcast = async function (payload) {
  if (!isGM()) return K.warn("показывать плашки может только мастер");
  payload.nonce = nonce();
  if (game.settings.get(MID, "chat") && !payload.silent) {
    ChatMessage.create({
      speaker: { alias: "Кармина" },
      content: `<div style="border-left:3px solid ${payload.accent};padding:6px 0 6px 10px;">
        <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${payload.accent}">${payload.kicker}</div>
        <div style="font-size:17px;font-weight:600;margin:2px 0 4px">${payload.title}</div>
        ${payload.text ? `<div style="font-size:13px;opacity:.85">${payload.text}</div>` : ""}${payload.meta ? `<div style="font-size:12px;margin-top:4px">${payload.meta}</div>` : ""}</div>`
    });
  }
  emit({ t: "stage", p: payload });
  deliver(payload);
  try { await game.settings.set(MID, "stage", payload); } catch (e) { console.error("Karmina | stage", e); }
};

/* ================================================================ постоянные виджеты: Сигнал, часы, улики */

K.refresh = function (animate = true) {
  const s = state();
  K.Track.render(s);
  K.Clock.render(s, animate);
  K.Clues.render(s);
  K.Panel.render();
};

K.Track = {
  render(s) {
    const a = s.signal && D.ACTIONS[s.signal];
    const hints = game.settings.get(MID, "hints");
    const heart = s.signal === "hor" && s.clues.includes("heart");
    const key = a ? `${s.signal}|${hints}|${heart}` : "";
    const old = document.getElementById("karmina-signal");
    if (old?.dataset.key === key) return;
    old?.remove();
    if (!a) return;
    const el = document.createElement("div");
    el.id = "karmina-signal";
    el.dataset.key = key;
    el.innerHTML = `
      <p class="ks-k">Активный сигнал</p>
      <p class="ks-t">${a.title}</p>
      <p class="ks-l">${hints ? a.counterLabel : "Что происходит"}</p>
      <p class="ks-c">${hints ? a.counter : a.signal}</p>
      ${heart ? `<p class="ks-x">Горло открыто: атаки по Кармине с преимуществом и +2к10.</p>` : ""}`;
    document.body.appendChild(el);
  }
};

K.Clock = {
  render(s, animate = true) {
    const n = Math.max(0, Math.min(4, Number(s.clock) || 0));
    let el = document.getElementById("karmina-clock");
    if (!n) return el?.remove();
    if (!el) { el = document.createElement("div"); el.id = "karmina-clock"; document.body.appendChild(el); }
    const prev = Number(el.dataset.n || 0);
    if (prev === n) return;
    el.dataset.n = n;
    el.innerHTML = `
      <p class="kc-lbl">Часы Кармины</p>
      <div class="kc-ticks">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? "on" : ""}${i === n && n > prev ? " new" : ""}"></i>`).join("")}</div>
      <p class="kc-txt">${D.CLOCK_TEXT[n]}</p>`;
    if (animate && n > prev) {
      el.classList.remove("kc-pulse"); void el.offsetWidth; el.classList.add("kc-pulse");
      if (n >= 4) K.Screen.play([["rumble", { power: 6, duration: 2200 }], ["flash", { color: "#C42743", opacity: .35 }]]);
      else K.Screen.play([["rumble", { power: 2, duration: 1200 }]]);
      playKey("clock", .5);
    }
  }
};

K.Clues = {
  render(s) {
    document.getElementById("karmina-clues")?.remove();
    if (!s.clues.length || !s.showClues) return;
    const el = document.createElement("div");
    el.id = "karmina-clues";
    el.innerHTML = `<p class="kq-lbl">Улики · ${s.clues.length} из 7</p>` +
      D.CLUES.filter(c => s.clues.includes(c.id)).map(c => `<div class="kq-row"><b>${c.name}</b><span>${c.effect}</span></div>`).join("");
    document.body.appendChild(el);
  }
};

/* ================================================================ Sequencer: эффекты на сцене */

K.boss = function () {
  const sel = canvas?.tokens?.controlled?.find(t => /кармин/i.test(t.name));
  return sel ?? canvas?.tokens?.placeables?.find(t => /кармин/i.test(t.name)) ?? canvas?.tokens?.controlled?.[0] ?? null;
};
K.targets = () => Array.from(game.user?.targets ?? []);
K.hasSequencer = () => !!game.modules.get("sequencer")?.active;

K.FX = {
  _seq() { return K.hasSequencer() ? new Sequence() : null; },
  _f(key) { return fxPaths()[key] || ""; },
  _end() { if (K.hasSequencer()) Sequencer.EffectManager.endEffects({ origin: "karmina:signal" }); },
  budsBloom() { const b = K.boss(), f = this._f("bloom"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).atLocation(b).scaleToObject(3).fadeIn(600).persist().origin("karmina:signal").opacity(.85).play(); },
  budsBurst() { this._end(); const b = K.boss(), f = this._f("bloom"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).atLocation(b).scaleToObject(4.5).fadeOut(900).duration(1400).play(); },
  nectarPool() { const b = K.boss(), f = this._f("nectar"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).atLocation(b).scaleToObject(6).belowTokens().fadeIn(900).persist().origin("karmina:signal").opacity(.6).play(); },
  nectarBurst() { this._end(); const b = K.boss(), f = this._f("nectar"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).atLocation(b).scaleToObject(9).belowTokens().duration(1600).fadeOut(800).play(); },
  rootMark() {
    const f = this._f("root"), q = this._seq(); if (!f || !q) return;
    const ts = K.targets(); if (!ts.length) return K.warn("наведись на цели «Корней-рыбаков» (клавиша T)");
    for (const t of ts) q.effect().file(f).attachTo(t).scaleToObject(1.6).belowTokens().fadeIn(500).persist().origin("karmina:signal");
    q.play();
  },
  rootGrab() {
    this._end(); const b = K.boss(), f = this._f("root"), q = this._seq(); if (!b || !f || !q) return;
    for (const t of K.targets()) q.effect().file(f).atLocation(t).stretchTo(b).duration(1100).fadeOut(500).belowTokens();
    q.play();
  },
  drainRings() { const b = K.boss(), f = this._f("drain"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).atLocation(b).scaleToObject(7).belowTokens().fadeIn(700).persist().origin("karmina:signal").opacity(.7).play(); },
  drainHeal() {
    this._end(); const b = K.boss(), f = this._f("drain"), g = this._f("pollen"), q = this._seq(); if (!b || !q || !(f || g)) return;
    if (f) q.effect().file(f).atLocation(b).scaleToObject(3).duration(1500).fadeOut(700);
    if (g) q.effect().file(g).atLocation(b).scaleToObject(2.4).duration(1800).fadeOut(600).opacity(.8);
    q.play();
  },
  petalsSpin() { const b = K.boss(), f = this._f("pollen"), q = this._seq(); if (!b || !f || !q) return; q.effect().file(f).attachTo(b).scaleToObject(2.2).fadeIn(500).persist().origin("karmina:signal").opacity(.75).play(); },
  petalsCone() {
    this._end(); const b = K.boss(), t = K.targets()[0], f = this._f("cone"), q = this._seq(); if (!b || !f || !q) return;
    if (!t) return K.warn("наведись на того, в чью сторону летит конус");
    q.effect().file(f).atLocation(b).stretchTo(t).duration(1300).fadeOut(500).play();
  },
  rise() {
    const b = K.boss(), f = this._f("rise"), g = this._f("pollen"), q = this._seq(); if (!b || !q || !(f || g)) return;
    if (f) q.effect().file(f).atLocation(b).scaleToObject(4).duration(2200).fadeOut(900);
    if (g) q.effect().file(g).attachTo(b).scaleToObject(2.6).fadeIn(800).persist().name("karmina-phase2").opacity(.6);
    q.play();
  }
};

/* ================================================================ публичное API */

K.signal = async function (key) {
  const a = D.ACTIONS[key];
  if (!a) return K.warn(`нет такого действия: «${key}»`);
  const t = D.TONES.signal, hints = game.settings.get(MID, "hints");
  await save(s => { s.signal = key; });
  await K.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title: a.title, text: a.signal,
    meta: hints ? `<b>${a.counterLabel}:</b> ${a.counter}` : null, art: K.art(a.art), duration: 7000, screen: D.SCREEN[key]?.signal });
  const k = D.SFX_MAP[key]?.signal; if (k) playKey(k);
  K.FX[a.fx.signal]?.();
  if (a.note) ui.notifications.info(`Кармина — ${a.title}: ${a.note}`);
};

K.resolve = async function (key, outcome = "full") {
  key ??= state().signal;
  const a = D.ACTIONS[key];
  if (!a) return K.warn(`нет такого действия: «${key}»`);
  const t = D.TONES[outcome] ?? D.TONES.full;
  let text, meta = null;
  if (outcome === "none") text = a.neutralized;
  else {
    text = a.resolution;
    const parts = [];
    if (a.roll?.save) parts.push(`<b>Спасбросок:</b> ${a.roll.save}`);
    if (a.roll?.formula) {
      const f = outcome === "soft" ? "3d10+6" : a.roll.formula;
      let total = null;
      try { total = (await new Roll(f).evaluate()).total; } catch (e) { }
      parts.push(total === null ? `<b>Урон:</b> ${f} ${a.roll.type}`
        : `<b>Урон:</b> ${total} ${a.roll.type} <span style="opacity:.6">(${f}${outcome === "soft" ? ", смягчено" : ""})</span>`);
    }
    if (parts.length) meta = parts.join(" &nbsp;·&nbsp; ");
  }
  await save(s => { if (s.signal === key) s.signal = null; });
  await K.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title: a.title, text, meta, art: K.art(a.art),
    duration: outcome === "none" ? 4500 : 6500, screen: D.SCREEN[key]?.[outcome === "none" ? "none" : "full"] });
  if (outcome !== "none") { const k = D.SFX_MAP[key]?.resolve; if (k) playKey(k); K.FX[a.fx.resolve]?.(); }
  else K.FX._end();
};

K.phase2 = async function () {
  await save(s => { s.phase = 2; s.signal = null; });
  const t = D.TONES.phase, en = game.settings.get(MID, "enhanced");
  await K.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title: "Она встаёт",
    text: "Корни рвутся из камня сцены с треском ломаемой кладки. Впервые за сорок лет Кармина делает шаг.",
    meta: `<b>Скорость 40 фт · Громадное существо · Регенерация ${en ? 15 : 10} · Два Боевых Действия за раунд.</b> Дно чаши поднимается на 1 фут за раунд.`,
    art: K.art("phase2"), duration: 9000, screen: D.SCREEN.phase2 });
  playKey(D.SFX_MAP.phase2, .85); K.FX.rise();
};

K.phase3 = async function () {
  await save(s => { s.phase = 3; s.signal = null; });
  await K.broadcast({ kicker: "ФАЗА ТРЕТЬЯ", accent: "#E4677C", glow: "rgba(228,103,124,.7)", title: "Последняя песня",
    text: "Все одиннадцать бутонов раскрываются разом и поют в один голос — её собственный.",
    meta: "<b>Регенерация отключена · пять легендарных действий · «Плевок нектара» на 4–6.</b> Начинающий ход на дне чаши — спасбросок Мудрости СЛ 18 или помеха на атаки.",
    art: K.art("phase3"), duration: 9000, screen: D.SCREEN.phase3 });
  playKey(D.SFX_MAP.phase3, .9); K.FX.rise();
};

/** Часы Кармины: 1..4, 0 — убрать. Видят все. */
K.clock = (n) => save(s => { s.clock = Math.max(0, Math.min(4, Number(n) || 0)); });

K.banner = function (title, text = "", tone = "signal", art = null) {
  const t = D.TONES[tone] ?? D.TONES.signal;
  return K.broadcast({ kicker: t.kicker, accent: t.accent, glow: t.glow, title, text, meta: null, art: art ? (K.art(art) ?? art) : null, duration: 6500 });
};
K.fx = (name, opts = {}) => K.Screen.play([[name, opts]]);
K.demo = async function () {
  const seq = [["rumble", { power: 5, duration: 1500 }], ["shake", { power: 20, duration: 700 }], ["spin", { degrees: 8 }], ["punch", { amount: .06 }],
    ["creep", { amount: .06, duration: 1500 }], ["flash", { color: "#C42743" }], ["rings", { color: "#C9963A", dir: "in" }],
    ["rings", { color: "#E4677C", dir: "out" }], ["tide", { to: .4, duration: 900, hold: 500 }], ["petals", { count: 120, spin: true }]];
  for (const [n, o] of seq) { ui.notifications?.info(`FX: ${n}`); K.Screen.play([[n, o]]); await new Promise(r => setTimeout(r, 1900)); }
};

/* ---------- улики ---------- */
K.clue = (id, on = null) => save(s => {
  const has = s.clues.includes(id);
  const want = on === null ? !has : !!on;
  s.clues = want ? [...new Set([...s.clues, id])] : s.clues.filter(x => x !== id);
});
K.showClues = (on) => save(s => { s.showClues = !!on; });

/* ---------- бутоны ---------- */
/** Новый бой: все 11 закрыты, трое живых — 3 разных броска к11 (игроки не видят). */
K.budsReset = () => save(s => {
  const alive = new Set(); while (alive.size < 3) alive.add(Math.floor(Math.random() * 11));
  s.buds = Array(11).fill("closed"); s.alive = [...alive];
});
/** Бутон i: "burst" — уничтожен, "saved" — вырезан (Медицина СЛ 18), "closed" — вернуть. */
K.bud = async function (i, status) {
  const s = state(); if (!s.buds.length) { await K.budsReset(); return K.bud(i, status); }
  const names = budNames(), alive = state().alive.includes(i), name = names[i];
  await save(st => { st.buds[i] = status; });
  if (status === "burst") {
    ui.notifications.info(`Бутон «${name}» уничтожен: Кармина получает 10 психического урона и теряет одно легендарное действие в этом раунде.${alive ? " ⚠ Это был живой." : ""}`);
    if (alive) K.broadcast({ kicker: "БУТОН", accent: "#C42743", glow: "rgba(196,39,67,.6)", title: name, text: "Из лопнувшего бутона на камень выливается тёплое. Он дышал. До этого удара — дышал.", duration: 6000, screen: [["flash", { color: "#C42743", opacity: .35 }]] });
  }
  if (status === "saved") K.broadcast(alive
    ? { kicker: "ЖИВОЙ", accent: "#5E9463", glow: "rgba(94,148,99,.5)", title: name, text: "Слой за слоем — и внутри лицо. Глаза открываются. Он кашляет нектаром и хватается за твою руку.", duration: 6500, screen: [["rings", { color: "#5E9463", duration: 1200, count: 3, dir: "out" }]] }
    : { kicker: "СЛИШКОМ ПОЗДНО", accent: "#8E8B78", glow: "rgba(0,0,0,.4)", title: name, text: "Внутри только тёплая ткань с чертами лица. Её уже ничего не держит.", duration: 5500 });
};

/* ---------- проверки с выбором ---------- */
K.check = function (src) {
  const data = typeof src === "string" ? D.CHECKS[src] : src;
  if (!data) return K.warn(`нет такой проверки: «${src}»`);
  K.Panel.results(data.title);
  return K.broadcast({ kicker: "", accent: "#C9963A", glow: "rgba(0,0,0,0)", title: "", silent: true, check: data });
};
K.checkClose = () => K.broadcast({ kicker: "", accent: "#C9963A", glow: "rgba(0,0,0,0)", title: "", silent: true, check: null });

K.Check = {
  _label(o) {
    if (o.skill) return (D.SKILL_RU[o.skill] || o.skill).toUpperCase();
    if (o.ability) return (D.ABIL_RU[o.ability] || o.ability).toUpperCase();
    return "БРОСОК";
  },
  hide() { const el = document.getElementById("karmina-choice"); if (!el) return; el.classList.add("kx-out"); setTimeout(() => el.remove(), 520); },
  show(data) {
    document.getElementById("karmina-choice")?.remove();
    const el = document.createElement("div");
    el.id = "karmina-choice";
    if (isGM()) el.classList.add("gm");
    el.innerHTML = `
      <h1 class="kc-q">${data.title}</h1>
      ${data.sub ? `<p class="kc-sub">${data.sub}</p>` : ""}
      <div class="kc-opts">${data.options.map((o, n) => `
        <button class="kc-opt" data-n="${n}" style="--kc-c:${D.TIERS[o.tier]?.color || "#C9963A"}">
          <span class="kc-tier">${D.TIERS[o.tier]?.name || ""} · ${K.Check._label(o)} СЛ ${o.dc}</span>
          <span class="kc-label">${o.label}</span>
          <p class="kc-text">${o.text || ""}</p>
          ${isGM() && o.cost ? `<span class="kc-cost">${o.cost}</span>` : ""}
        </button>`).join("")}</div>
      <p class="kc-foot">${isGM() ? "Игроки выбирают. Результаты придут на пульт. <a data-close>Убрать у всех</a>" : "Выбери подход"}</p>`;
    document.body.appendChild(el);
    if (isGM()) {
      el.querySelectorAll(".kc-opt").forEach(b => b.style.pointerEvents = "none");
      el.querySelector("[data-close]")?.addEventListener("click", () => K.checkClose());
      return;
    }
    el.addEventListener("click", async (ev) => {
      const b = ev.target.closest(".kc-opt");
      if (!b || el.classList.contains("kc-done")) return;
      el.classList.add("kc-done"); b.classList.add("kc-picked");
      const o = data.options[Number(b.dataset.n)], foot = el.querySelector(".kc-foot");
      foot.textContent = "Бросок…";
      const r = await K.Check.roll(o), ok = r.total !== null && r.total >= o.dc;
      foot.innerHTML = r.total === null ? "Не нашёл твоего персонажа — кидай вручную."
        : `<b style="color:${ok ? "#7FBA86" : "#E4677C"};font-size:17px">${r.total} — ${ok ? "успех" : "провал"}</b> <span style="opacity:.6">(${K.Check._label(o)} СЛ ${o.dc}${r.mod !== null ? `, мод ${r.mod >= 0 ? "+" : ""}${r.mod}` : ""})</span>`;
      K.Check.send({ who: game.user.name, actor: r.actorName, label: o.label, check: K.Check._label(o), dc: o.dc, total: r.total, ok, cost: o.cost || "" });
      setTimeout(() => K.Check.hide(), 4500);
    });
  },
  async roll(o) {
    const actor = game.user.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.actors?.find(a => a.isOwner && a.type === "character");
    if (!actor) return { total: null, mod: null, actorName: null };
    const name = actor.name;
    try {
      let res = o.skill ? await actor.rollSkill({ skill: o.skill }, { configure: false }, { create: false })
        : await actor.rollAbilityCheck({ ability: o.ability }, { configure: false }, { create: false });
      res = Array.isArray(res) ? res[0] : res;
      if (res?.total != null) return { total: res.total, mod: null, actorName: name };
    } catch (e) { }
    try {
      const mod = o.skill ? (actor.system.skills?.[o.skill]?.total ?? 0) : (actor.system.abilities?.[o.ability]?.mod ?? 0);
      const roll = await new Roll("1d20 + @m", { m: mod }).evaluate();
      return { total: roll.total, mod, actorName: name };
    } catch (e) { }
    return { total: null, mod: null, actorName: name };
  },
  send(res) {
    res.nonce = nonce();
    emit({ t: "check", r: res });
    game.user.setFlag(MID, "check", res).catch(() => ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM"),
      content: `<b>${esc(res.actor || res.who)}</b> — ${esc(res.label)}: ${res.check} СЛ ${res.dc} → <b>${res.total}</b> ${res.ok ? "успех" : "провал"}`
    }));
  }
};
Hooks.on("updateUser", (user, diff) => {
  if (!isGM()) return;
  if (diff?.flags?.[MID]?.check) gotResult(user.getFlag(MID, "check"));
  if (diff?.flags?.world?.karminaCheck) gotResult(user.getFlag("world", "karminaCheck"));   // игрок на старом макросе
});

/* ================================================================ связка с боем */

const isKarmina = (c) => !!c && /кармин/i.test(c.name ?? c.actor?.name ?? "");
const rhythm = (round, phase) => phase >= 2 ? 2 : (round >= 3 ? 2 : 1);

Hooks.on("updateCombat", (combat, diff) => {
  if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
  if (!("turn" in diff) && !("round" in diff)) return;
  const s = state(), cur = combat.combatant, prevId = combat.previous?.combatantId;
  const prev = prevId ? combat.combatants.get(prevId) : null;
  if (isKarmina(prev) && !isKarmina(cur)) {
    const n = rhythm(combat.round, s.phase);
    K.Panel.flash("sig", `Конец хода Кармины — время Сигнала: ${n === 1 ? "одно Действие" : "два Действия"} (раунд ${combat.round}).`);
  }
  if (isKarmina(cur)) {
    const en = game.settings.get(MID, "enhanced"), ph = D.PHASES[s.phase] ?? D.PHASES[1];
    const regen = en ? ph.regenPlus : ph.regen;
    const parts = [];
    if (s.signal) parts.push(`Разрешение «${D.ACTIONS[s.signal]?.title}»`);
    if (regen) parts.push(`регенерация ${regen}, если не было урона огнём`);
    K.Panel.flash(s.signal ? "res" : "info", `Начало хода Кармины: ${parts.join(" · ") || "регенерации нет"}.`);
  }
  K.Panel.render();
});

Hooks.on("updateActor", (actor, diff) => {
  if (!isGM() || game.users.activeGM?.id !== game.user.id) return;
  if (!/кармин/i.test(actor.name) || diff?.system?.attributes?.hp?.value === undefined) return;
  const hp = actor.system.attributes.hp.value, s = state();
  if (s.phase === 1 && hp <= D.PHASES[2].hp) K.Panel.flash("phase", `Хиты Кармины ${hp} — пора «Она встаёт» (вторая фаза).`);
  else if (s.phase === 2 && game.settings.get(MID, "enhanced") && hp <= D.PHASES[3].hp) K.Panel.flash("phase", `Хиты Кармины ${hp} — третья фаза «Последняя песня».`);
});

/* ================================================================ пульт мастера */

K.Panel = {
  el: null, note: null,
  toggle() { this.el ? this.close() : this.open(); },
  close() { this.el?.remove(); this.el = null; },
  open() {
    if (!isGM()) return K.warn("пульт только для мастера");
    this.close();
    const el = document.createElement("div");
    el.id = "karmina-panel";
    let pos = { left: 120, top: 90 };
    try { pos = JSON.parse(localStorage.getItem("karmina-panel-pos")) || pos; } catch (e) { }
    el.style.left = Math.max(0, Math.min(pos.left, window.innerWidth - 360)) + "px";
    el.style.top = Math.max(0, Math.min(pos.top, window.innerHeight - 140)) + "px";
    document.body.appendChild(el);
    this.el = el;
    this.render();
    this.bind();
  },
  /** Перерисовать содержимое (позиция и открытые разделы сохраняются). */
  render() {
    const el = this.el; if (!el) return;
    const s = state(), names = budNames(), combat = game.combat, round = combat?.round ?? 0;
    const open = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.sec));
    if (!el.dataset.init) { ["now", "acts"].forEach(x => open.add(x)); el.dataset.init = 1; }
    const scroll = el.querySelector(".kp-body")?.scrollTop ?? 0;
    const res = el.querySelector(".kp-res")?.innerHTML ?? "";
    const a = s.signal && D.ACTIONS[s.signal];
    const clueHelp = a ? (D.CLUE_FOR[s.signal] ?? []).filter(id => s.clues.includes(id)).map(id => D.CLUES.find(c => c.id === id)) : [];
    const sec = (id, title, html) => `<details data-sec="${id}"${open.has(id) ? " open" : ""}><summary class="kp-sect">${title}</summary>${html}</details>`;
    const en = game.settings.get(MID, "enhanced");
    const enough = s.buds.length ? s.buds : Array(11).fill("closed");

    el.innerHTML = `
      <div class="kp-head"><b>Кармина · пульт</b><i data-do="settings" title="Настройки модуля">⚙</i><i data-do="close" title="Закрыть (Shift+K)">✕</i></div>
      <div class="kp-body">
        ${this.note ? `<div class="kp-note ${this.note.kind}">${this.note.text}<i data-do="note-x">✕</i></div>` : ""}
        ${sec("now", `Сейчас · фаза ${s.phase}${round ? ` · раунд ${round}` : ""}`, `
          <p class="kp-hint" style="margin-top:0">${round ? `Действий за раунд: <b>${rhythm(round, s.phase)}</b>. ` : ""}${(D.PHASES[s.phase] ?? D.PHASES[1]).actions}. Регенерация ${en ? D.PHASES[s.phase]?.regenPlus : D.PHASES[s.phase]?.regen}.</p>
          ${a ? `<div class="kp-active"><b>Сигнал: ${a.title}.</b> ${a.counterLabel}: ${a.counter}
            ${clueHelp.length ? `<div class="kp-clue">У партии есть: ${clueHelp.map(c => `<b>${c.name}</b> — ${c.effect}`).join("; ")}</div>` : ""}
            <div class="kp-grid c3" style="margin-top:7px">
              <button class="b-res" data-do="full" data-k="${s.signal}">Разрешение</button>
              <button class="b-soft" data-do="soft" data-k="${s.signal}">Смягчено</button>
              <button class="b-none" data-do="none" data-k="${s.signal}">Сорвали</button></div></div>`
            : `<p class="kp-hint">Активного Сигнала нет.</p>`}
          <div class="kp-res"${res ? "" : ' style="display:none"'}>${res}</div>`)}
        ${sec("acts", "Боевые действия", Object.entries(D.ACTIONS).map(([k, x]) => {
          const off = (k === "tanec" && s.phase < 2) || (k === "venec" && s.phase < 3);
          return `<div class="kp-row${off ? " off" : ""}${s.signal === k ? " live" : ""}">
            <span class="kp-name" title="${x.title}${off ? ` — ${k === "tanec" ? "только 2-я фаза" : "только 3-я фаза"}` : ""}">${x.title}</span>
            <button class="b-sig" data-do="signal" data-k="${k}" title="Сигнал">СИГ</button>
            <button class="b-res" data-do="full" data-k="${k}" title="Разрешение в полную силу">РАЗР</button>
            <button class="b-soft" data-do="soft" data-k="${k}" title="Смягчено">СМЯГ</button>
            <button class="b-none" data-do="none" data-k="${k}" title="Нейтрализовано">НЕЙТ</button></div>`;
        }).join(""))}
        ${sec("buds", `Бутоны · уничтожено ${enough.filter(b => b === "burst").length}, спасено ${enough.filter(b => b === "saved").length}`, `
          <div class="kp-buds">${names.map((n, i) => `<button class="kb ${enough[i]}${s.alive.includes(i) ? " alive" : ""}" data-do="bud" data-n="${i}" title="${esc(n)}${s.alive.includes(i) ? " — живой" : ""}. ЛКМ — уничтожен, ПКМ — вырезан (Медицина СЛ 18), Shift — вернуть.">${i + 1}<small>${esc(n.split(" ")[0])}</small></button>`).join("")}</div>
          <p class="kp-hint">Точка — живой (видишь только ты). Уничтоженный: Кармине 10 психического и −1 легендарное действие.</p>
          <button class="wide" data-do="buds-reset">Новый бой: закрыть все, перебросить живых (3×к11)</button>`)}
        ${sec("clues", `Улики · ${s.clues.length} из 7`, `
          ${D.CLUES.map(c => `<button class="kp-cl${s.clues.includes(c.id) ? " on" : ""}" data-do="clue" data-k="${c.id}"><b>${c.name}</b><span>${c.where} → ${c.effect}</span></button>`).join("")}
          <button class="wide${s.showClues ? " on" : ""}" data-do="clues-show" style="margin-top:4px">Показывать игрокам найденные улики</button>
          <p class="kp-hint">6–7 улик — победа «умная», 4–5 — на грани, 3 и меньше — риск TPK: подскажи одну через Ксимену или Ренна.</p>`)}
        ${sec("checks", "Проверки с выбором", `
          <select class="kp-pick">
            <optgroup label="Акт I"><option value="bones">Костяная линия</option><option value="porter">Первый цветущий</option></optgroup>
            <optgroup label="Акт II"><option value="camp">① Лагерь экспедиции</option><option value="ash">② Пепелище</option><option value="salt">③ Солёный ключ</option><option value="nests">④ Гнездовье колибри</option><option value="renn">⑤ Тобиас Ренн</option></optgroup>
            <optgroup label="Акт III, в бою"><option value="hor">Багровый Хор</option><option value="priliv">Нектарный прилив</option><option value="korni">Корни-рыбаки</option><option value="tanec">Танец лепестков</option></optgroup>
          </select>
          <div class="kp-grid"><button data-do="ask">Спросить</button><button data-do="ask-close">Убрать</button></div>`)}
        ${sec("clock", `Часы Кармины · ${s.clock}/4`, `
          <div class="kp-grid c5">${[1, 2, 3, 4].map(n => `<button data-do="clock" data-n="${n}" class="${s.clock >= n ? "on" : ""}">${n}</button>`).join("")}<button data-do="clock" data-n="0">✕</button></div>
          <p class="kp-hint">Деление — за исследованную точку, громкое действие или долгое обсуждение. На 4 она находит их там, где они стоят.</p>`)}
        ${sec("phase", "Фазы", `
          <div class="kp-grid"><button data-do="phase2" class="${s.phase >= 2 ? "on" : ""}">Фаза 2 · 126 хитов</button><button data-do="phase3" class="${s.phase >= 3 ? "on" : ""}">Фаза 3 · 78 хитов</button></div>
          <button class="wide" data-do="phase1" style="margin-top:4px">Вернуть первую фазу (новый бой)</button>`)}
        ${sec("banner", "Своя плашка", `
          <input class="kp-in" data-in="title" placeholder="Заголовок">
          <textarea class="kp-in" data-in="text" rows="2" placeholder="Текст"></textarea>
          <div class="kp-grid"><select class="kp-in" data-in="tone">${Object.entries(D.TONES).map(([k, t]) => `<option value="${k}">${t.kicker.toLowerCase()}</option>`).join("")}</select><button data-do="banner">Показать всем</button></div>`)}
        ${sec("fx", "Эффекты вручную", `
          <div class="kp-grid">${[["shake", "Тряска"], ["rumble", "Гул"], ["spin", "Раскрутка"], ["punch", "Зум"], ["petals", "Лепестки"], ["flash", "Вспышка"]].map(([k, n]) => `<button data-do="fx" data-n="${k}">${n}</button>`).join("")}</div>
          <button class="wide" data-do="demo" style="margin-top:5px">Прогнать все эффекты (только у меня)</button>
          <button class="wide${game.settings.get(MID, "motion") ? " on" : ""}" data-do="t-motion">Тряска экрана (у меня)</button>
          <p class="kp-hint">«Корни» и «Танец» читают наведённые цели — наведись клавишей T до нажатия.</p>`)}
      </div>`;
    el.querySelector(".kp-body").scrollTop = scroll;
  },
  bind() {
    const el = this.el;
    el.addEventListener("mousedown", (ev) => {
      const head = ev.target.closest(".kp-head");
      if (!head || ev.target.tagName === "I") return;
      const dx = ev.clientX - el.offsetLeft, dy = ev.clientY - el.offsetTop;
      const move = (e) => {
        el.style.left = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 60)) + "px";
        el.style.top = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 40)) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
        try { localStorage.setItem("karmina-panel-pos", JSON.stringify({ left: el.offsetLeft, top: el.offsetTop })); } catch (e) { }
      };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    });
    el.addEventListener("contextmenu", (ev) => {
      const b = ev.target.closest("[data-do=bud]"); if (!b) return;
      ev.preventDefault(); K.bud(Number(b.dataset.n), "saved");
    });
    el.addEventListener("keydown", (ev) => ev.stopPropagation());
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-do]"); if (!b) return;
      const d = b.dataset.do, k = b.dataset.k, n = b.dataset.n;
      switch (d) {
        case "signal": return K.signal(k);
        case "full": case "soft": case "none": return K.resolve(k, d);
        case "phase1": return save(s => { s.phase = 1; s.signal = null; });
        case "phase2": return K.phase2();
        case "phase3": return K.phase3();
        case "clock": return K.clock(Number(n));
        case "clue": return K.clue(k);
        case "clues-show": return K.showClues(!state().showClues);
        case "bud": return K.bud(Number(n), ev.shiftKey ? "closed" : "burst");
        case "buds-reset": return K.budsReset();
        case "fx": return K.fx(n, n === "petals" ? { count: 110, spin: true } : {});
        case "demo": return K.demo();
        case "t-motion": return K.motion(!game.settings.get(MID, "motion")).then(() => this.render());
        case "ask": return K.check(el.querySelector(".kp-pick").value);
        case "ask-close": return K.checkClose();
        case "banner": {
          const v = (x) => el.querySelector(`[data-in=${x}]`)?.value?.trim() ?? "";
          if (!v("title")) return K.warn("напиши заголовок плашки");
          return K.banner(esc(v("title")), esc(v("text")).replace(/\n/g, "<br>"), v("tone"));
        }
        case "note-x": this.note = null; return this.render();
        case "settings": return (game.settings.sheet ?? new (foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig)()).render(true);
        case "close": return this.close();
      }
    });
  },
  /** Подсветить подсказку на пульте (и уведомлением, если пульт закрыт). */
  flash(kind, text) {
    this.note = { kind, text };
    if (this.el) this.render(); else ui.notifications.info(`Кармина: ${text}`);
  },
  results(title) {
    if (!this.el) return;
    const box = this.el.querySelector(".kp-res");
    box.style.display = "block";
    box.innerHTML = `<div class="kp-res-h">${esc(title)}</div>`;
  },
  result(r) {
    const box = this.el?.querySelector(".kp-res");
    if (!box) return ui.notifications.info(`${r.actor || r.who}: ${r.label} — ${r.total ?? "?"} (${r.ok ? "успех" : "провал"})`);
    box.style.display = "block";
    const row = document.createElement("div");
    row.className = "kp-res-row " + (r.ok ? "ok" : "no");
    row.innerHTML = `<b>${esc(r.actor || r.who)}</b> — ${esc(r.label)}<span>${r.check} СЛ ${r.dc} → <b>${r.total ?? "?"}</b></span>${r.cost ? `<small class="kp-res-cost">${r.cost}</small>` : ""}`;
    box.appendChild(row);
  }
};
K.panel = () => K.Panel.toggle();

/* ================================================================ запуск */

function launcher() {
  if (!isGM() || document.getElementById("karmina-launch")) return;
  const b = document.createElement("button");
  b.id = "karmina-launch"; b.type = "button"; b.title = "Пульт Кармины (Shift+K)";
  b.innerHTML = `<span>✿</span>`;
  b.addEventListener("click", () => K.panel());
  document.body.appendChild(b);
}

Hooks.once("ready", () => {
  game.socket?.on(CH, onSocket);
  // Старые макросы 2.4 делают globalThis.Karmina = своё и тянут одеяло на себя (свой пульт, свой CSS, свои каналы).
  // При включённом модуле такой макрос останавливается на этой строке и просит себя удалить.
  try {
    Object.defineProperty(globalThis, "Karmina", {
      configurable: true, enumerable: false, get: () => K,
      set: () => {
        ui.notifications?.warn("Кармина: старый макрос 2.4 больше не нужен — модуль уже всё делает. Удали макрос с панели. Пульт: кнопка ✿ или Shift+K.", { permanent: true });
        throw new Error("Karmina: module is active, legacy macro stopped");
      }
    });
  } catch (e) { globalThis.Karmina = K; }
  console.log(`Karmina | ${K.VERSION} готова (${isGM() ? "мастер" : "игрок"})`);
  game.modules.get(MID).api = K;
  K.refresh(false);
  launcher();
  if (isGM() && !state().buds.length) K.budsReset();
});

export default K;
