// Звуки книги. Kenney (CC0). Громкость и выключатель — в настройках клиента.
import { MOD } from "./book-const.js";
const SET = {
  page: ["page-1", "page-2", "page-3"], open: "book-open", close: "book-close", tab: "tab",
  find: "find", pen: "pen", stamp: "stamp", fail: "stamp-fail"
};
export function registerSfx() {
  game.settings.register(MOD, "sfxOn", { name: "Звуки книги", hint: "Перелистывание, печати, новые записи.",
    scope: "client", config: true, type: Boolean, default: true });
  game.settings.register(MOD, "sfxVol", { name: "Громкость звуков книги", scope: "client", config: true, type: Number,
    range: { min: 0, max: 1, step: 0.05 }, default: 0.6 });
}
const last = {};
export function sfx(name) {
  try {
    if (!game.settings.get(MOD, "sfxOn")) return;
    const now = Date.now(); if (now - (last[name] ?? 0) < 120) return; last[name] = now;
    let f = SET[name]; if (Array.isArray(f)) f = f[Math.floor(Math.random() * f.length)];
    if (!f) return;
    foundry.audio.AudioHelper.play({ src: `modules/${MOD}/sounds/${f}.ogg`, volume: game.settings.get(MOD, "sfxVol"), autoplay: true, loop: false }, false);
  } catch (e) {}
}
