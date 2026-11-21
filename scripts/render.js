// Разметка книги: чистая функция без обращений к Foundry - её же использует страница предпросмотра.
export const STATUS = {
  active: { n: "Взято", mark: "✒", stamp: "" },
  done: { n: "Выполнено", mark: "✔", stamp: "ВЫПОЛНЕНО" },
  failed: { n: "Провалено", mark: "✖", stamp: "ПРОВАЛЕНО" }
};
export const TABS = [["map", "Карта"], ["quests", "Задания"], ["npcs", "Жители"], ["places", "Места"], ["letters", "Письма"]];
export const LISTS = { quests: "quests", npcs: "npcs", places: "places", letters: "letters" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CREST = `<svg class="bb-crest" viewBox="0 0 64 72" aria-hidden="true"><path d="M4 4h56v30c0 18-12 28-28 34C16 62 4 52 4 34z" fill="currentColor" opacity=".14"/><path d="M4 4h56v30c0 18-12 28-28 34C16 62 4 52 4 34z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 52l11-20 6 9 7-15 16 26z" fill="currentColor"/><path d="M46 12a9 9 0 1 0 6 15a7 7 0 0 1-6-15z" fill="currentColor"/></svg>`;

/** Что видит зритель: мастер - всё, игрок - только открытое. */
export function isOpen(st, tab, id) {
  if (tab === "quests") return !!(st.q ?? {})[id];
  return !!(st.o ?? {})[id];
}

function gmBlock(tab, item, st) {
  const open = isOpen(st, tab, item.id);
  let btns = "";
  if (tab === "quests") {
    const s = (st.q ?? {})[item.id] ?? "";
    btns = [["active", "Выдать"], ["done", "Выполнено"], ["failed", "Провалено"], ["", "Скрыть"]]
      .map(([k, n]) => `<button data-qs="${k}" data-id="${item.id}" class="${s === k ? "on" : ""}">${n}</button>`).join("");
  } else {
    btns = open
      ? `<button data-hide="${item.id}">🔒 Скрыть от игроков</button>`
      : `<button data-open="${item.id}">👁 Открыть игрокам</button>`;
  }
  return `<div class="bb-gm"><h4>Мастеру${open ? "" : " · <i>игроки не видят</i>"}</h4><div class="bb-btns">${btns}
    ${open ? `<button data-show="${item.id}">📖 Показать всем</button>` : ""}
    ${item.gm ? `<button data-gm="${esc(item.gm)}">🗝 Страница мастера</button>` : ""}</div></div>`;
}

export const symOf = (p) => p.num ?? "✦";
const link = (tab, id, text) => `<a data-go="${tab}:${id}">${esc(text)}</a>`;
const photo = (C, src, title, cls = "") => src ? `<figure class="bb-photo ${cls}"><img src="${C.art}${src}" data-zoom="${esc(title)}" draggable="false" loading="lazy"></figure>` : "";

/** Встречи в области Диких земель: игрок видит случившиеся, мастер - все четыре и кнопки броска. */
function encountersHTML(C, st, place, view, isGM) {
  const all = (C.encounters ?? []).filter((e) => e.area === place.id);
  if (!all.length) return "";
  const met = (e) => !!(st.e ?? {})[e.id];
  const vis = all.filter((e) => isGM || met(e));
  if (!vis.length) return `<div class="bb-enc"><h4>Встречи в пути</h4><p class="bb-hand bb-encnone">Здесь с нами пока ничего не случилось.</p></div>`;
  return `<div class="bb-enc"><h4>Встречи в пути</h4>
    ${isGM ? `<div class="bb-btns bb-encroll"><button data-eroll="${place.id}">🎲 Бросить встречу (к4)</button>${place.table ? `<button data-etable="${place.id}">🎲 Случайная сцена (к8)</button>` : ""}</div>` : ""}
    <ul>${vis.map((e) => `<li class="${met(e) ? "met" : "locked"} ${view.enc === e.id ? "hit" : ""}">
      <span class="bb-die">${isGM ? e.roll : "✦"}</span>
      <div><b>${esc(e.n)}</b><p class="bb-hand">${esc(e.teaser)}</p>
        <div class="bb-encbtns">${e.scene ? `<a data-etravel="${e.id}">🧭 ${isGM ? "на карту встречи" : "вернуться на это место"}</a>` : ""}${isGM
          ? `<a data-${met(e) ? "ehide" : "eopen"}="${e.id}">${met(e) ? "🔒 скрыть" : "👁 записать игрокам"}</a><a data-gm="${esc(e.gm)}">🗝 страница мастера</a>` : ""}</div>
      </div></li>`).join("")}</ul></div>`;
}

export function bookHTML(C, st, view, isGM) {
  const tab = view.tab;
  const byId = (list, id) => C[list].find((x) => x.id === id);
  const seen = (t, id) => isGM || isOpen(st, t, id);
  let left = "", right = "", wide = "";

  /* ---------- Карта: метки ведут на сцены ---------- */
  if (tab === "map") {
    const maps = C.maps.filter((m) => seen("places", m.place));
    const m = maps.find((x) => x.id === view.sel) ?? maps.find((x) => x.place === view.here || x.pins.some((p) => p.place === view.here)) ?? maps[0];
    if (!m) wide = `<h2 class="bb-h">Карта</h2><p class="bb-hand bb-empty">Карты у отряда пока нет. Она появится, когда вы войдёте в Нахтмарк.</p>`;
    else {
      const pins = m.pins.map((p) => ({ ...p, pl: byId("places", p.place) })).filter((p) => seen("places", p.place));
      const cls = (p) => `${isOpen(st, "places", p.place) ? "" : "locked"} ${p.place === view.here ? "here" : ""}`;
      wide = `<div class="bb-maphead"><h2 class="bb-h">Карта</h2><nav class="bb-mapsw">${maps.map((x) => `<a data-sel="${x.id}" class="${x.id === m.id ? "on" : ""}">${esc(x.n)}</a>`).join("")}</nav></div>
        <div class="bb-maprow">
          <div class="bb-mapwrap"><div class="bb-mapbox" style="--r:${m.ratio}"><img src="${C.art}${m.img}" draggable="false">
            ${pins.map((p, i) => `<a class="bb-pin ${cls(p)}" data-travel="${p.place}" style="left:${(p.x * 100).toFixed(1)}%;top:${(p.y * 100).toFixed(1)}%;--i:${i}"><b>${esc(symOf(p.pl))}</b><span>${esc(p.pl.n)}</span></a>`).join("")}
          </div></div>
          <aside class="bb-maplist">
            <h4>Куда идём</h4>
            <ul>${pins.filter((p, i, a) => a.findIndex((q) => q.place === p.place) === i).map((p) => `<li data-travel="${p.place}" class="${cls(p)}"><span class="bb-mk">${esc(symOf(p.pl))}</span><span>${esc(p.pl.n)}</span></li>`).join("") || `<li class="none">Ни одного места ещё не отмечено.</li>`}</ul>
            <button data-travel="${m.place}">🧭 Общий вид: ${esc(m.n)}</button>
            <p class="bb-maphint">${isGM ? "Клик - перейти самому. Shift+клик - перевести весь отряд. Alt+клик - открыть или скрыть место для игроков." : "Нажмите на метку, чтобы отправиться туда."}</p>
          </aside>
        </div>`;
    }
  }

  /* ---------- Задания ---------- */
  if (tab === "quests") {
    const q = st.q ?? {};
    const vis = C.quests.filter((x) => isGM || q[x.id]);
    const sel = vis.find((x) => x.id === view.sel) ?? vis.find((x) => q[x.id] === "active") ?? vis[0];
    const groups = [["active", "В работе"], ["done", "Выполнены"], ["failed", "Провалены"], ["", "Не выданы"]].map(([k, n]) => {
      const xs = vis.filter((x) => (q[x.id] ?? "") === k);
      if (!xs.length) return "";
      return `<div class="bb-grp"><h4>${n}</h4><ul>${xs.map((x, i) =>
        `<li data-sel="${x.id}" class="${k || "locked"} ${sel?.id === x.id ? "sel" : ""}" style="--i:${i}"><span class="bb-mk">${k ? STATUS[k].mark : "◇"}</span><span>${esc(x.n)}</span></li>`).join("")}</ul></div>`;
    }).join("");
    left = `<h2 class="bb-h">Задания</h2>${groups || `<p class="bb-hand bb-empty">Пока никто в Нахтмарке не доверил вам своих бед.</p>`}`;
    if (sel) {
      const s = q[sel.id], g = byId("npcs", sel.giver), p = byId("places", sel.place);
      right = `<div class="bb-detail bb-notice">
        <i class="bb-nail"></i>
        <h2>${esc(sel.n)}</h2>
        <div class="bb-meta">${g ? `Поручает ${seen("npcs", g.id) ? link("npcs", g.id, g.n) : esc(g.n)}` : esc(sel.giverName ?? "")}${p ? ` · ${seen("places", p.id) ? link("places", p.id, p.n) : esc(p.n)}` : ""}</div>
        <div class="bb-rule"></div>
        ${photo(C, sel.art, sel.n, "spot")}
        <p class="bb-hand">${esc(sel.goal)}</p>
        ${sel.more ? `<p class="bb-hand">${esc(sel.more)}</p>` : ""}
        ${sel.reward ? `<p class="bb-reward"><b>Награда.</b> ${esc(sel.reward)}</p>` : ""}
        ${sel.letter && seen("letters", sel.letter) ? `<p class="bb-text"><b>Бумаги.</b> ${link("letters", sel.letter, byId("letters", sel.letter).n)}</p>` : ""}
        ${s && STATUS[s].stamp ? `<div class="bb-stamp ${s}">${STATUS[s].stamp}</div>` : ""}
        ${isGM ? gmBlock("quests", sel, st) : ""}
      </div>`;
    }
  }

  /* ---------- Жители ---------- */
  if (tab === "npcs") {
    const known = C.npcs.filter((x) => isOpen(st, "npcs", x.id));
    const sel = C.npcs.find((x) => x.id === view.sel && seen("npcs", x.id)) ?? (isGM ? C.npcs[0] : known[0]);
    left = `<h2 class="bb-h">Жители</h2>
      <p class="bb-count">Знакомы: ${known.length} из ${C.npcs.length}</p>
      <div class="bb-faces">${C.npcs.map((x, i) => {
        const o = isOpen(st, "npcs", x.id);
        if (!o && !isGM) return `<div class="bb-face unknown" style="--i:${i}"><span class="bb-ring"><b>?</b></span><em>Незнакомец</em></div>`;
        return `<div class="bb-face ${o ? "" : "locked"} ${sel?.id === x.id ? "sel" : ""}" data-sel="${x.id}" style="--i:${i}"><span class="bb-ring"><img src="${C.art}${x.img}" draggable="false" loading="lazy"></span><em>${esc(x.n)}</em></div>`;
      }).join("")}</div>`;
    if (sel) {
      const p = byId("places", sel.place);
      const qs = C.quests.filter((x) => x.giver === sel.id && seen("quests", x.id));
      right = `<div class="bb-detail bb-dossier">
        <figure class="bb-portrait"><img src="${C.art}${sel.img}" data-zoom="${esc(sel.n)}" draggable="false"></figure>
        <h2>${esc(sel.n)}</h2>
        <div class="bb-meta">${esc(sel.role)}${p ? ` · ${seen("places", p.id) ? link("places", p.id, p.n) : esc(p.n)}` : ""}</div>
        <div class="bb-rule"></div>
        <p class="bb-hand">${esc(sel.look)}</p>
        ${sel.use ? `<p class="bb-text"><b>Чем полезен.</b> ${esc(sel.use)}</p>` : ""}
        ${qs.length ? `<p class="bb-text"><b>Дела.</b> ${qs.map((x) => link("quests", x.id, x.n)).join(", ")}</p>` : ""}
        ${isGM ? gmBlock("npcs", sel, st) : ""}
      </div>`;
    }
  }

  /* ---------- Места и Письма: общий список по группам ---------- */
  if (tab === "places" || tab === "letters") {
    const list = C[tab];
    const vis = list.filter((x) => seen(tab, x.id));
    const sel = vis.find((x) => x.id === view.sel) ?? (isGM ? vis.find((x) => isOpen(st, tab, x.id)) ?? vis[0] : vis[vis.length - 1]);
    const groups = {};
    for (const x of vis) (groups[x.g] ??= []).push(x);
    const title = tab === "places" ? "Места" : "Письма";
    const empty = tab === "places" ? "Вы ещё нигде не были. Карта ждёт первых отметок." : "В сумке пока ни одной бумаги.";
    left = `<h2 class="bb-h">${title}</h2>${vis.length ? Object.entries(groups).map(([g, xs]) =>
      `<div class="bb-grp"><h4>${esc(g)}${isGM ? `<span class="bb-mass"><a data-openall="${esc(g)}" title="Открыть игрокам всю группу">👁</a><a data-hideall="${esc(g)}" title="Скрыть всю группу">🔒</a></span>` : ""}</h4><ul>${xs.map((x, i) => {
        const o = isOpen(st, tab, x.id);
        return `<li data-sel="${x.id}" class="${o ? "" : "locked"} ${sel?.id === x.id ? "sel" : ""}" style="--i:${i}"><span class="bb-mk">${x.num ?? (tab === "letters" ? "✉" : "✦")}</span><span>${esc(x.n)}</span></li>`;
      }).join("")}</ul></div>`).join("") : `<p class="bb-hand bb-empty">${empty}</p>`}`;
    if (sel && tab === "places") {
      const who = (sel.who ?? []).map((id) => byId("npcs", id)).filter(Boolean);
      const qs = C.quests.filter((x) => x.place === sel.id && seen("quests", x.id));
      const lt = sel.letter ? byId("letters", sel.letter) : null;
      right = `<div class="bb-detail bb-place">
        ${sel.icon ? `<img class="bb-vignette" src="${C.art}${sel.icon}" draggable="false">` : ""}
        <h2>${sel.num ? `<span class="bb-num">${esc(sel.num)}</span>` : ""}${esc(sel.n)}</h2>
        <div class="bb-meta">${esc(sel.g)}</div>
        <div class="bb-rule"></div>
        <p class="bb-hand">${esc(sel.text)}</p>
        ${sel.facts?.length ? `<ul class="bb-facts">${sel.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        ${who.length ? `<p class="bb-text"><b>Кого искать.</b> ${who.map((n) => seen("npcs", n.id) ? link("npcs", n.id, n.n) : "кто-то, с кем мы ещё не знакомы").join(", ")}</p>` : ""}
        ${qs.length ? `<p class="bb-text"><b>Дела.</b> ${qs.map((x) => link("quests", x.id, x.n)).join(", ")}</p>` : ""}
        ${lt && seen("letters", lt.id) ? `<p class="bb-text"><b>Бумаги.</b> ${link("letters", lt.id, lt.n)}</p>` : ""}
        ${photo(C, sel.img, sel.n, "plan")}
        ${sel.scene ? `<div class="bb-go"><button data-travel="${sel.id}">🧭 Отправиться сюда</button></div>` : ""}
        ${encountersHTML(C, st, sel, view, isGM)}
        ${isGM ? gmBlock("places", sel, st) : ""}
      </div>`;
    }
    if (sel && tab === "letters") {
      right = `<div class="bb-detail bb-letter">
        <h2>${esc(sel.n)}</h2>
        <div class="bb-meta">${esc(sel.g)}</div>
        <div class="bb-rule"></div>
        ${sel.html ? `<div class="bb-paper ${esc(sel.kind ?? "")}">${sel.img ? `<img class="bb-mug" src="${C.art}${sel.img}" data-zoom="${esc(sel.n)}" draggable="false">` : ""}${sel.html}</div>` : photo(C, sel.img, sel.n, "sheet")}
        ${isGM ? gmBlock("letters", sel, st) : ""}
      </div>`;
    }
  }

  if (!right && !wide) right =`<div class="bb-blank">${CREST}</div>`;
  const ribbons = TABS.map(([k, n], i) => `<a data-tab="${k}" class="bb-rib r${i} ${tab === k ? "on" : ""}"><span>${n}</span></a>`).join("");
  return `<div class="bb-book"><div class="bb-cover" data-drag>
      <i class="bb-strap t"></i><i class="bb-strap b"></i>
      <div class="bb-title" data-drag>${CREST}<span>Книга Нахтмарка</span>${CREST}</div>
      <a class="bb-close" title="Закрыть">✕</a>
      <div class="bb-spread">${wide ? `<section class="bb-page bb-wide"><div class="bb-turn">${wide}</div></section>` : `<section class="bb-page bb-left">${left}</section><section class="bb-page bb-right"><div class="bb-turn">${right}</div></section><div class="bb-gutter"></div>`}</div>
      <nav class="bb-ribbons">${ribbons}</nav>
      <i class="bb-corner tl"></i><i class="bb-corner tr"></i><i class="bb-corner bl"></i><i class="bb-corner br"></i>
    </div></div>`;
}
