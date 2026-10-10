/*
 * Кодекс Эластрии — интерактивная вики сеттинга для Foundry VTT (v13–v14).
 * Данные: компендиум «Эластрия — Вики» (страны, истории) + data/gods.json (пантеон).
 * Всё, что добавлено в компендиум, появляется в Кодексе само.
 */
const MID = "elastria-wiki";
const P = `modules/${MID}/`;
const SOCKET = `module.${MID}`;
const ROOT_ID = "ew-codex";
const REVEAL_ID = "ew-reveal";
const SKIP_FOLDERS = ["Пантеон", "Главная", "Служебное"];
const STORY_FOLDER = "Истории";
const TIER = {
  F: { name: "Фундаментальные", one: "Фундаментальный", accent: "#e0b553" },
  M: { name: "Средние", one: "Средний", accent: "#b48cf0" },
  S: { name: "Малые", one: "Малый", accent: "#6fd0bd" }
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isGM = () => !!globalThis.game?.user?.isGM;
const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html ?? ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ================================================================ данные */

let DB = null;

function linkify(html) {
  return String(html ?? "").replace(/@UUID\[([^\]]+)\]\{([^}]*)\}/g,
    (m, uuid, text) => `<a class="ew-link" data-uuid="${esc(uuid)}">${text}</a>`);
}

function parseEntry(doc, kind, group) {
  const pages = (doc.pages?.contents ?? Array.from(doc.pages ?? []))
    .slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const raw = pages.map(p => p.text?.content ?? "").join("\n");
  const dom = new DOMParser().parseFromString(`<div id="x">${linkify(raw)}</div>`, "text/html");
  const box = dom.getElementById("x");
  const header = box.querySelector("header");
  let emblem = "", region = "", subtitle = "", title = "", headerCover = "";
  if (header) {
    const hImg = header.querySelector("img");
    const hs = hImg?.getAttribute("src") ?? "";
    // svg/png в шапке — герб; фото в шапке — обложка
    if (hs && /\.(svg|png)(\?|$)/i.test(hs)) emblem = hs;
    else if (hs) hImg.setAttribute("data-ew-cover", hs);
    region = (header.querySelector("div")?.textContent ?? "").replace(/\s+/g, " ").trim();
    subtitle = (header.querySelector("em")?.textContent ?? "").trim();
    title = (header.querySelector("h1")?.textContent ?? "").trim();
    headerCover = header.querySelector("img[data-ew-cover]")?.getAttribute("data-ew-cover") ?? "";
    header.remove();
  }
  box.querySelectorAll("footer").forEach(f => f.remove());
  // первая «настоящая» картинка — обложка
  const firstImg = Array.from(box.querySelectorAll("img")).find(i => !/\.svg(\?|$)/i.test(i.getAttribute("src") ?? ""));
  let cover = headerCover || (firstImg?.getAttribute("src") ?? "");
  if (kind === "story" && emblem && !/\.svg/i.test(emblem)) { cover = emblem; emblem = ""; }
  if (!cover && emblem && !/\.svg/i.test(emblem)) cover = emblem;
  // пустые абзацы-обёртки
  box.querySelectorAll("p").forEach(p => { if (!p.textContent.trim() && !p.querySelector("img,a")) p.remove(); });
  // заголовки получают якоря
  const toc = [];
  box.querySelectorAll("h2").forEach((h, i) => { h.id = `ew-h-${i}`; toc.push({ id: h.id, text: h.textContent.trim() }); });
  const text = (box.textContent || "").replace(/\s+/g, " ").trim();
  const firstH1 = box.querySelector("h1");
  if (!title && firstH1 && kind === "story") title = firstH1.textContent.trim();
  return {
    id: doc.id, kind, group, name: doc.name, title: title || doc.name,
    region: region.replace(/^Эластрия\s*•\s*/i, ""), subtitle, emblem, cover,
    body: box.innerHTML, toc, text, sort: doc.sort ?? 0,
    adult: kind === "story" && /18\+|до 18|Ворнинг/i.test(text.slice(0, 400))
  };
}

async function loadDB(force = false) {
  if (DB && !force) return DB;
  const data = await (await fetch(`${P}data/gods.json`)).json();
  const gods = data.gods;
  const byId = Object.fromEntries(gods.map(g => [g.id, g]));
  const pageToGod = Object.fromEntries(gods.map(g => [g.pageId, g.id]));
  const pack = game.packs.get(data.packId);
  const entries = {};
  if (pack) {
    const docs = await pack.getDocuments();
    const fName = {};
    for (const f of (pack.folders?.contents ?? Array.from(pack.folders ?? []))) fName[f.id] = f.name;
    for (const doc of docs) {
      const fid = doc._source?.folder ?? doc.folder?.id ?? doc.folder ?? null;
      const group = fName[fid] ?? "Страны";
      if (SKIP_FOLDERS.includes(group)) continue;
      const kind = group === STORY_FOLDER ? "story" : "country";
      try { entries[doc.id] = parseEntry(doc, kind, group); }
      catch (e) { console.warn("Кодекс Эластрии | не разобрал", doc.name, e); }
    }
  }
  const list = Object.values(entries);
  const sortFn = (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "ru");
  const countries = list.filter(e => e.kind === "country").sort(sortFn);
  const stories = list.filter(e => e.kind === "story").sort(sortFn);
  const groups = [...new Set(countries.map(c => c.group))];
  const domains = [...new Set(gods.flatMap(g => g.dom))].sort((a, b) => a.localeCompare(b, "ru"));
  let epochs = [], universe = "Летопись Эластрии";
  try {
    const src = await (await fetch(`${P}chronicle/data/epochs.js`, { cache: "no-store" })).text();
    const r = new Function(`${src}\n;return { E: typeof EPOCHS !== "undefined" ? EPOCHS : [], U: typeof UNIVERSE_NAME !== "undefined" ? UNIVERSE_NAME : "" };`)();
    epochs = Array.isArray(r.E) ? r.E : [];
    if (r.U) universe = r.U;
  } catch (e) { console.warn("Кодекс Эластрии | летопись не загрузилась", e); }
  DB = { ...data, gods, byId, pageToGod, entries, countries, stories, groups, domains, epochs, universe };
  return DB;
}

function routeFromUuid(uuid) {
  const parts = String(uuid).split(".");
  const pi = parts.indexOf("JournalEntryPage");
  if (pi > -1) {
    const gid = DB.pageToGod[parts[pi + 1]];
    if (gid) return { v: "god", id: gid };
  }
  const ji = parts.indexOf("JournalEntry");
  const jid = ji > -1 ? parts[ji + 1] : parts.at(-1);
  if (jid === DB.pantheonId) return { v: "pantheon" };
  if (DB.entries[jid]) return { v: "entry", id: jid };
  return null;
}

/* ================================================================ шаблоны */

const coin = (g, cls = "") =>
  `<span class="ew-coin ${cls}" style="--acc:${TIER[g.tier].accent}"><img src="${P}assets/gods/${g.id}-e.webp" alt=""></span>`;

function godCard(g) {
  return `<button type="button" class="ew-godcard" data-go="god:${g.id}" style="--acc:${TIER[g.tier].accent}">
    ${coin(g)}
    <span class="ew-godcard-n">${esc(g.n)}</span>
    <span class="ew-godcard-t">${esc(g.t)}</span>
    <span class="ew-godcard-d">${g.dom.map(esc).join(" · ")}</span>
  </button>`;
}

function entryCard(e, big = false) {
  return `<button type="button" class="ew-card${big ? " ew-card-big" : ""}${e.adult ? " ew-adult" : ""}" data-go="entry:${e.id}">
    <span class="ew-card-img">${e.cover ? `<img src="${esc(e.cover)}" alt="" loading="lazy">` : ""}</span>
    <span class="ew-card-shade"></span>
    ${e.emblem ? `<span class="ew-card-emb"><img src="${esc(e.emblem)}" alt=""></span>` : ""}
    <span class="ew-card-txt">
      ${e.region ? `<span class="ew-eyebrow">${esc(e.region)}</span>` : ""}
      <span class="ew-card-n">${esc(e.title)}</span>
      ${e.subtitle ? `<span class="ew-card-s">${esc(e.subtitle)}</span>` : ""}
    </span>
    ${e.adult ? `<span class="ew-badge">18+</span>` : ""}
  </button>`;
}

function ringHTML() {
  const n = DB.gods.length;
  return `<div class="ew-ring"><div class="ew-ring-rot">${DB.gods.map((g, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return `<button type="button" class="ew-ring-item" data-go="god:${g.id}" data-tip="${esc(g.n)}"
      style="left:${(50 + 46 * Math.cos(a)).toFixed(2)}%;top:${(50 + 46 * Math.sin(a)).toFixed(2)}%">${coin(g, g.tier === "F" ? "ew-coin-f" : "")}</button>`;
  }).join("")}</div>
  <div class="ew-ring-core"><span class="ew-ring-star">✦</span><span class="ew-ring-title">Пантеон</span><span class="ew-ring-sub">23 бога</span></div></div>`;
}

function viewHome() {
  const c = DB.countries, s = DB.stories;
  return `<section class="ew-hero ew-hero-home">
    <div class="ew-hero-copy">
      <div class="ew-eyebrow">Авторский сеттинг · Подмастерье Мастера</div>
      <h1 class="ew-title-xl">Эластрия</h1>
      <p class="ew-lead">Мир, собранный из четырёх великих душ. Страны, народы, боги и истории — всё в одном кодексе. Имена в тексте кликабельны: от страны к богу, от бога к легенде.</p>
      <div class="ew-hero-stats">
        <button type="button" data-go="list:country"><b>${c.length}</b><span>земель</span></button>
        <button type="button" data-go="pantheon"><b>${DB.gods.length}</b><span>богов</span></button>
        <button type="button" data-go="list:story"><b>${s.length}</b><span>историй</span></button>
        ${DB.epochs.length ? `<button type="button" data-go="chronicle"><b>${DB.epochs.length}</b><span>${DB.epochs.length === 1 ? "эпоха" : "эпох"}</span></button>` : ""}
      </div>
    </div>
    ${ringHTML()}
  </section>
  <section class="ew-sec">
    <div class="ew-sec-head"><h2>Земли и народы</h2><button type="button" class="ew-more" data-go="list:country">все земли →</button></div>
    <div class="ew-grid">${c.map(e => entryCard(e)).join("")}</div>
  </section>
  ${DB.epochs.length ? `<section class="ew-sec">
    <div class="ew-sec-head"><h2>Летопись</h2><button type="button" class="ew-more" data-go="chronicle">вся летопись →</button></div>
    <div class="ew-epochs">${DB.epochs.map(epochCard).join("")}</div>
  </section>` : ""}
  ${s.length ? `<section class="ew-sec">
    <div class="ew-sec-head"><h2>Истории Эластрии</h2><button type="button" class="ew-more" data-go="list:story">все истории →</button></div>
    <div class="ew-grid ew-grid-wide">${s.map(e => entryCard(e, true)).join("")}</div>
  </section>` : ""}`;
}

function viewList(kind) {
  const list = kind === "story" ? DB.stories : DB.countries;
  const head = kind === "story"
    ? `<div class="ew-eyebrow">Рассказы Verlierboy</div><h1 class="ew-title-l">Истории Эластрии</h1>`
    : `<div class="ew-eyebrow">Атлас</div><h1 class="ew-title-l">Земли и народы</h1>`;
  if (kind === "story") return `<section class="ew-pagehead">${head}</section><div class="ew-grid ew-grid-wide">${list.map(e => entryCard(e, true)).join("")}</div>`;
  return `<section class="ew-pagehead">${head}</section>` + DB.groups.map(gr => {
    const items = list.filter(e => e.group === gr);
    return `<section class="ew-sec">${DB.groups.length > 1 ? `<div class="ew-sec-head"><h2>${esc(gr)}</h2></div>` : ""}
      <div class="ew-grid">${items.map(e => entryCard(e)).join("")}</div></section>`;
  }).join("");
}

function viewPantheon(r) {
  const dom = r.dom ?? "";
  const tiers = ["F", "M", "S"].map(t => {
    const gs = DB.gods.filter(g => g.tier === t && (!dom || g.dom.includes(dom)));
    if (!gs.length) return "";
    return `<section class="ew-sec ew-tier" style="--acc:${TIER[t].accent}">
      <div class="ew-tier-head"><h2>${TIER[t].name}</h2><p>${esc(DB.tierDesc?.[t] ?? "")}</p></div>
      <div class="ew-godgrid">${gs.map(godCard).join("")}</div></section>`;
  }).join("");
  return `<section class="ew-pagehead ew-pagehead-center">
      <div class="ew-eyebrow">Боги Эластрии</div><h1 class="ew-title-l">Пантеон</h1>
      <p class="ew-lead">Ярус решает не сила, а то, что держит бог: сам мир, Искру или веру смертных.</p>
      <div class="ew-chips">
        <button type="button" class="ew-chip${!dom ? " on" : ""}" data-go="pantheon">Все домены</button>
        ${DB.domains.map(d => `<button type="button" class="ew-chip${d === dom ? " on" : ""}" data-go="pantheon:${esc(d)}">${esc(d)}</button>`).join("")}
      </div>
    </section>
    ${tiers}
    <section class="ew-sec ew-rules">
      <div class="ew-rule"><h3>Правила веры</h3><ul>
        <li>Сила бога растёт от числа верующих и силы их веры. Забытый бог слабеет.</li>
        <li>Малые боги дают полный домен, но сильнее всего там, где их помнят.</li>
        <li>Малые боги ходят по миру и встречаются как NPC.</li>
        <li>Класс опасности персонажа = уровень / 2.</li></ul></div>
      <div class="ew-rule ew-rule-red"><h3>Главная угроза эпохи</h3>
        <p>Общий план злых богов: освободить <a class="ew-link" data-go="god:kishin">Кишина</a> и убить <a class="ew-link" data-go="god:simori">Симори</a>. Тогда в мир вырвутся страх и Плеть одновременно.</p></div>
    </section>`;
}

function viewGod(id) {
  const g = DB.byId[id];
  if (!g) return viewPantheon({});
  const acc = TIER[g.tier].accent;
  const tierGods = DB.gods;
  const i = tierGods.indexOf(g);
  const prev = tierGods[(i - 1 + tierGods.length) % tierGods.length];
  const next = tierGods[(i + 1) % tierGods.length];
  const ties = DB.ties.filter(t => t[0] === id || t[1] === id).map(([a, b, txt]) => {
    const o = DB.byId[a === id ? b : a];
    return o
      ? `<button type="button" class="ew-tie" data-go="god:${o.id}">${coin(o)}<span><b>${esc(o.n)}</b><i>${esc(txt)}</i></span></button>`
      : `<div class="ew-tie">${`<span class="ew-coin ew-coin-blank">✦</span>`}<span><b>Фундаментальные</b><i>${esc(txt)}</i></span></div>`;
  }).join("");
  const facts = [["Сфера", g.sph], ["Домены", g.dom.join(", ")], ["Мировоззрение", g.al], ["Кто молится", g.who], ["Символ", g.sym]];
  const mentions = DB.countries.concat(DB.stories).filter(e => new RegExp(`(^|[^А-Яа-яЁё])${g.n.slice(0, Math.max(3, g.n.length - 1))}`).test(e.text));
  return `<article class="ew-god" style="--acc:${acc}">
    <section class="ew-godhero">
      <img class="ew-godhero-art" src="${P}assets/gods/${g.id}.webp" alt="">
      <div class="ew-godhero-shade"></div>
      <div class="ew-godhero-copy">
        <button type="button" class="ew-coinzoom" data-zoom="${P}assets/gods/${g.id}-e.webp" data-cap="${esc(g.n)} — эмблема" title="Открыть эмблему">${coin(g, "ew-coin-xl")}</button>
        <div>
          <div class="ew-eyebrow">${TIER[g.tier].one} бог · ${esc(g.dom.join(" · "))}</div>
          <h1 class="ew-title-l">${esc(g.n)}</h1>
          <p class="ew-godhero-t">${esc(g.t)}</p>
        </div>
      </div>
      <button type="button" class="ew-zoombtn" data-zoom="${P}assets/gods/${g.id}.webp" data-cap="${esc(g.n)} — ${esc(g.t)}" title="Открыть арт">⤢</button>
      ${isGM() ? `<button type="button" class="ew-btn ew-btn-reveal" data-act="reveal" data-id="${g.id}" title="Показать всем игрокам с анимацией">✦ Явление</button>` : ""}
    </section>
    <div class="ew-godbody">
      <div class="ew-godmain">
        <div class="ew-facts">${facts.map(([k, v]) => `<div class="ew-fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        <div class="ew-prose">${g.txt.map(t => `<p>${esc(t)}</p>`).join("")}</div>
        ${g.death ? `<div class="ew-death"><span>Если умрёт</span><p>${esc(g.death)}</p></div>` : ""}
        ${g.leg ? `<div class="ew-legend"><div class="ew-eyebrow">Легенда</div><h3>${esc(g.leg.h)}</h3>
          ${g.leg.p.map(p => `<p>${esc(p)}</p>`).join("")}${g.leg.c ? `<p class="ew-legend-c">${esc(g.leg.c)}</p>` : ""}</div>` : ""}
      </div>
      <aside class="ew-godside">
        ${ties ? `<div class="ew-side-h">Связи</div><div class="ew-ties">${ties}</div>` : ""}
        ${mentions.length ? `<div class="ew-side-h">Упоминается</div><div class="ew-mentions">${mentions.map(e => `<button type="button" data-go="entry:${e.id}">${esc(e.title)}</button>`).join("")}</div>` : ""}
      </aside>
    </div>
    <nav class="ew-pager">
      <button type="button" data-go="god:${prev.id}">${coin(prev)}<span>← ${esc(prev.n)}</span></button>
      <button type="button" data-go="pantheon">Весь пантеон</button>
      <button type="button" data-go="god:${next.id}"><span>${esc(next.n)} →</span>${coin(next)}</button>
    </nav>
  </article>`;
}

function viewEntry(id) {
  const e = DB.entries[id];
  if (!e) return viewHome();
  const linked = [...new Set([...e.body.matchAll(/data-uuid="([^"]+)"/g)].map(m => m[1]))]
    .map(u => routeFromUuid(u)).filter(Boolean);
  const gods = [...new Set(linked.filter(r => r.v === "god").map(r => r.id))].map(i => DB.byId[i]);
  const places = [...new Set(linked.filter(r => r.v === "entry" && r.id !== id).map(r => r.id))].map(i => DB.entries[i]);
  const list = e.kind === "story" ? DB.stories : DB.countries;
  const i = list.indexOf(e);
  const prev = list[(i - 1 + list.length) % list.length], next = list[(i + 1) % list.length];
  return `<article class="ew-entry ew-entry-${e.kind}">
    <section class="ew-entryhero">
      ${e.cover ? `<img class="ew-entryhero-bg" src="${esc(e.cover)}" alt="">` : ""}
      <div class="ew-entryhero-shade"></div>
      ${e.cover ? `<button type="button" class="ew-zoombtn" data-zoom="${esc(e.cover)}" data-cap="${esc(e.title)}" title="Открыть арт">⤢</button>` : ""}
      <div class="ew-entryhero-copy">
        ${e.emblem ? `<button type="button" class="ew-entry-emb" data-zoom="${esc(e.emblem)}" data-cap="${esc(e.title)} — герб" title="Открыть герб"><img src="${esc(e.emblem)}" alt=""></button>` : ""}
        <div class="ew-eyebrow">${esc(e.kind === "story" ? "Истории Эластрии" : (e.region || e.group))}</div>
        <h1 class="ew-title-l">${esc(e.title)}</h1>
        ${e.subtitle ? `<p class="ew-entryhero-s">${esc(e.subtitle)}</p>` : ""}
        ${e.adult ? `<span class="ew-badge">18+</span>` : ""}
      </div>
    </section>
    <div class="ew-entrybody">
      <aside class="ew-toc">
        ${e.toc.length > 1 ? `<div class="ew-side-h">Содержание</div>${e.toc.map(t => `<button type="button" data-anchor="${t.id}">${esc(t.text)}</button>`).join("")}` : ""}
        ${gods.length ? `<div class="ew-side-h">Боги</div><div class="ew-toc-gods">${gods.map(g => `<button type="button" data-go="god:${g.id}" data-tip="${esc(g.n)}">${coin(g)}</button>`).join("")}</div>` : ""}
        ${places.length ? `<div class="ew-side-h">Связанные земли</div>${places.map(p => `<button type="button" data-go="entry:${p.id}">${esc(p.title)}</button>`).join("")}` : ""}
      </aside>
      <div class="ew-article">${e.body}</div>
    </div>
    ${list.length > 1 ? `<nav class="ew-pager">
      <button type="button" data-go="entry:${prev.id}"><span>← ${esc(prev.title)}</span></button>
      <button type="button" data-go="list:${e.kind}">${e.kind === "story" ? "Все истории" : "Все земли"}</button>
      <button type="button" data-go="entry:${next.id}"><span>${esc(next.title)} →</span></button>
    </nav>` : ""}
  </article>`;
}

function viewSearch(q) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return `<section class="ew-pagehead"><h1 class="ew-title-l">Поиск</h1><p class="ew-lead">Введите хотя бы две буквы.</p></section>`;
  const snip = (t) => { const i = t.toLowerCase().indexOf(s); if (i < 0) return ""; const a = Math.max(0, i - 70);
    return (a ? "…" : "") + esc(t.slice(a, i)) + `<mark>${esc(t.slice(i, i + s.length))}</mark>` + esc(t.slice(i + s.length, i + s.length + 110)) + "…"; };
  const gods = DB.gods.filter(g => [g.n, g.t, g.sph, g.who, g.sym, ...g.txt, g.leg?.p?.join(" ") ?? ""].join(" ").toLowerCase().includes(s));
  const ents = DB.countries.concat(DB.stories).filter(e => (e.title + " " + e.text).toLowerCase().includes(s));
  const epText = (ep) => [ep.title, ep.subtitle, ep.tagline, ep.description, ...(ep.keyEvents ?? []),
    ...(ep.chronicle ?? []).flatMap(c => [c.title, ...paras(c.text), c.character?.name, ...paras(c.character?.bio)]),
    ...(ep.heroes ?? []).flatMap(h => [h.name, ...paras(h.bio)]), ...(ep.characters ?? []).flatMap(c => [c.name, c.description])].filter(Boolean).join(" ").replace(/\s+/g, " ");
  const eps = DB.epochs.filter(ep => epText(ep).toLowerCase().includes(s));
  return `<section class="ew-pagehead"><div class="ew-eyebrow">Поиск</div><h1 class="ew-title-l">«${esc(q)}»</h1>
    <p class="ew-lead">${gods.length + ents.length + eps.length ? `Найдено: ${gods.length + ents.length + eps.length}` : "Ничего не найдено"}</p></section>
    ${eps.length ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Летопись</h2></div><div class="ew-results">${eps.map(ep =>
      `<button type="button" class="ew-result" data-go="epoch:${esc(ep.id)}"><b>${esc(ep.title)} <small>${esc(ep.years ?? "")}</small></b><span>${snip(epText(ep)) || esc(ep.tagline ?? "")}</span></button>`).join("")}</div></section>` : ""}
    ${gods.length ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Боги</h2></div><div class="ew-godgrid">${gods.map(godCard).join("")}</div></section>` : ""}
    ${ents.length ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Земли и истории</h2></div><div class="ew-results">${ents.map(e =>
      `<button type="button" class="ew-result" data-go="entry:${e.id}"><b>${esc(e.title)}</b><span>${snip(e.text) || esc(e.subtitle)}</span></button>`).join("")}</div></section>` : ""}`;
}

/* ================================================================ летопись */

const CP = (p) => !p ? "" : (/^(https?:|data:|modules\/|worlds\/|systems\/|\/)/.test(p) ? p : encodeURI(`${P}chronicle/${p}`));
const paras = (arr) => (Array.isArray(arr) ? arr : String(arr ?? "").trim().split(/\n\s*\n/)).map(t => String(t).trim()).filter(Boolean);
const yearOf = (t) => { const m = String(t).match(/^\s*(\d{1,5})\s*г\.?\s*э\.?/i); return m ? +m[1] : null; };

/** Автоссылки на богов и земли в тексте летописи (первое упоминание на страницу) */
function autoLinker() {
  const used = new Set();
  const T = [];
  for (const g of DB.gods) T.push({ key: "god:" + g.id, re: new RegExp(`(?<![А-Яа-яЁё])${g.n.replace(/[аяь]$/, "")}[а-яё]{0,3}(?![А-Яа-яЁё])`) });
  for (const e of DB.countries) {
    const base = e.name.replace(/[аяиь]$/, "");
    if (base.length >= 5) T.push({ key: "entry:" + e.id, re: new RegExp(`(?<![А-Яа-яЁё])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[а-яё]{0,3}(?![А-Яа-яЁё])`) });
  }
  return (text) => {
    let out = esc(text);
    for (const t of T) {
      if (used.has(t.key)) continue;
      const m = out.match(t.re);
      if (!m) continue;
      out = out.slice(0, m.index) + `<a class="ew-link" data-go="${t.key}">${m[0]}</a>` + out.slice(m.index + m[0].length);
      used.add(t.key);
    }
    return out;
  };
}

function portrait(c, cls = "") {
  const a = CP(c.image), b = CP(c.altImage);
  return `<div class="ew-portrait ${cls}">
    ${a ? `<img class="ew-z" src="${esc(a)}" alt="${esc(c.name)}" data-a="${esc(a)}" ${b ? `data-b="${esc(b)}"` : ""}>` : `<span class="ew-portrait-ph">⚔</span>`}
    ${b ? `<button type="button" class="ew-swap" data-act="swap" title="Сменить облик">⇄ ${esc(c.altLabel || "Сменить облик")}</button>` : ""}
  </div>`;
}

function epochCard(ep) {
  return `<button type="button" class="ew-epochcard" data-go="epoch:${esc(ep.id)}" style="--ep:${esc(ep.color || "#e0b553")}">
    <span class="ew-epochcard-bg">${ep.backgroundImage ? `<img src="${esc(CP(ep.backgroundImage))}" alt="" loading="lazy">` : ""}</span>
    <span class="ew-epochcard-shade"></span>
    <span class="ew-epochcard-txt">
      <span class="ew-epoch-years">${esc(ep.years ?? "")}</span>
      <span class="ew-epochcard-n">${esc(ep.title)}</span>
      ${ep.subtitle ? `<span class="ew-epochcard-s">${esc(ep.subtitle)}</span>` : ""}
      ${ep.tagline ? `<span class="ew-epochcard-t">«${esc(ep.tagline)}»</span>` : ""}
    </span>
  </button>`;
}

function viewChronicle() {
  const eps = DB.epochs;
  if (!eps.length) return `<section class="ew-pagehead"><h1 class="ew-title-l">Летопись</h1><p class="ew-lead">Эпохи пока не добавлены. Файл: chronicle/data/epochs.js</p></section>`;
  const events = eps.flatMap(ep => (ep.keyEvents ?? []).map(t => ({ ep, t, y: yearOf(t) })));
  return `<section class="ew-pagehead ew-pagehead-center">
      <div class="ew-eyebrow">${esc(DB.universe)}</div><h1 class="ew-title-l">Летопись</h1>
      <p class="ew-lead">Эпохи Эластрии от падения Вестарии до наших дней. Каждая эпоха — хроника, герои, лица и музыка.</p>
    </section>
    <section class="ew-sec"><div class="ew-epochs">${eps.map(epochCard).join("")}</div></section>
    ${events.length ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Ключевые события</h2></div>
      <ol class="ew-timeline">${events.map(({ ep, t, y }) => `<li style="--ep:${esc(ep.color || "#e0b553")}">
        <span class="ew-tl-year">${y ?? "✦"}</span><span class="ew-tl-dot"></span>
        <span class="ew-tl-body"><b>${esc(y != null ? t.replace(/^\s*\d+\s*г\.?\s*э\.?\s*[—–-]?\s*/i, "") : t)}</b>
        <button type="button" class="ew-tl-ep" data-go="epoch:${esc(ep.id)}">${esc(ep.title)}</button></span></li>`).join("")}</ol></section>` : ""}`;
}

function viewEpoch(id) {
  const eps = DB.epochs;
  const ep = eps.find(e => e.id === id);
  if (!ep) return viewChronicle();
  const L = autoLinker();
  const i = eps.indexOf(ep);
  const bg = CP(ep.backgroundImage);
  const music = CP(ep.music);
  const chron = (ep.chronicle ?? []).map((ch, k) => `
    <li class="ew-ch${ch.isEpilogue ? " ew-ch-epi" : ""}">
      <div class="ew-ch-mark"><span>${esc(ch.part ?? "")}</span><i>${ch.isEpilogue ? "✦" : "◆"}</i></div>
      <div class="ew-ch-body">
        <h3>${esc(ch.title ?? "")}</h3>
        <div class="ew-ch-text">${paras(ch.text).map(t => `<p>${L(t)}</p>`).join("")}</div>
        ${ch.character ? `<div class="ew-chchar${k % 2 ? " ew-chchar-l" : ""}">
          ${portrait(ch.character)}
          <div class="ew-chchar-info"><div class="ew-eyebrow">${esc(ch.character.role ?? "")}</div>
            <div class="ew-chchar-n">${esc(ch.character.name)}</div>
            ${paras(ch.character.bio).map(t => `<p>${L(t)}</p>`).join("")}</div>
        </div>` : ""}
      </div>
    </li>`).join("");
  const heroes = (ep.heroes ?? []).map((h, k) => `
    <div class="ew-hero-row${k % 2 ? " ew-hero-row-r" : ""}">
      ${portrait(h, "ew-portrait-lg")}
      <div class="ew-hero-row-txt"><div class="ew-eyebrow">${esc(h.role ?? "")}</div><h3>${esc(h.name)}</h3>
        ${paras(h.bio).map(t => `<p>${L(t)}</p>`).join("")}</div>
    </div>`).join("");
  const chars = (ep.characters ?? []).map(c => `
    <div class="ew-person">${portrait(c)}
      <div class="ew-person-txt"><b>${esc(c.name)}</b><span class="ew-eyebrow">${esc(c.role ?? "")}</span>
      ${c.description ? `<p>${L(c.description)}</p>` : ""}
      ${DB.gods.find(g => g.n === c.name) ? `<button type="button" class="ew-tl-ep" data-go="god:${DB.gods.find(g => g.n === c.name).id}">✦ в пантеоне →</button>` : ""}</div></div>`).join("");
  const gallery = (ep.gallery ?? []).map(g => `
    <figure class="ew-gal"><img class="ew-z" src="${esc(CP(g.image))}" alt="${esc(g.caption ?? "")}" loading="lazy"><figcaption>${esc(g.caption ?? "")}</figcaption></figure>`).join("");
  const events = (ep.keyEvents ?? []).map(t => { const y = yearOf(t); return `<li><span class="ew-tl-year">${y ?? "✦"}</span><span class="ew-tl-dot"></span><span class="ew-tl-body"><b>${L(y != null ? t.replace(/^\s*\d+\s*г\.?\s*э\.?\s*[—–-]?\s*/i, "") : t)}</b></span></li>`; }).join("");
  return `<article class="ew-epoch" style="--ep:${esc(ep.color || "#e0b553")}">
    <section class="ew-epochhero">
      ${bg ? `<img class="ew-epochhero-bg" src="${esc(bg)}" alt="">` : ""}
      <div class="ew-epochhero-shade"></div>
      <div class="ew-epochhero-copy">
        <span class="ew-epoch-years">${esc(ep.years ?? "")}</span>
        <h1 class="ew-title-xl ew-epoch-title">${esc(ep.title)}</h1>
        ${ep.subtitle ? `<div class="ew-epochhero-s">${esc(ep.subtitle)}</div>` : ""}
        ${ep.tagline ? `<p class="ew-epochhero-t">«${esc(ep.tagline)}»</p>` : ""}
      </div>
      ${bg ? `<button type="button" class="ew-zoombtn" data-zoom="${esc(bg)}" data-cap="${esc(ep.title)}" title="Открыть арт">⤢</button>` : ""}
      ${music ? `<div class="ew-music" data-src="${esc(music)}">
        <button type="button" class="ew-music-btn" data-act="music" title="Музыка эпохи">▶</button>
        <div class="ew-music-info"><span class="ew-eyebrow">Музыка эпохи</span><span class="ew-music-bar"><i></i></span></div>
        <input type="range" class="ew-music-vol" min="0" max="1" step="0.05" value="0.5" title="Громкость">
        ${isGM() ? `<button type="button" class="ew-btn ew-music-all" data-act="musicAll" title="Включить музыку у всех игроков">♫ Всем</button>` : ""}
      </div>` : ""}
    </section>
    <div class="ew-epochbody">
      <div class="ew-epochlore">
        <div class="ew-eyebrow">Предыстория</div>
        <div class="ew-prose ew-prose-serif">${paras(ep.description).map(t => `<p>${L(t)}</p>`).join("")}</div>
      </div>
      ${events ? `<aside class="ew-epochside"><div class="ew-side-h">Ключевые события</div><ol class="ew-timeline ew-timeline-sm">${events}</ol></aside>` : ""}
    </div>
    ${chron ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Хроника</h2></div><ol class="ew-chron">${chron}</ol></section>` : ""}
    ${heroes ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Герои эпохи</h2></div><div class="ew-heroes">${heroes}</div></section>` : ""}
    ${chars ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Действующие лица</h2></div><div class="ew-people">${chars}</div></section>` : ""}
    ${gallery ? `<section class="ew-sec"><div class="ew-sec-head"><h2>Галерея</h2></div><div class="ew-gallery">${gallery}</div></section>` : ""}
    ${eps.length > 1 ? `<nav class="ew-pager">
      <button type="button" data-go="epoch:${esc(eps[(i - 1 + eps.length) % eps.length].id)}"><span>← ${esc(eps[(i - 1 + eps.length) % eps.length].title)}</span></button>
      <button type="button" data-go="chronicle">Вся летопись</button>
      <button type="button" data-go="epoch:${esc(eps[(i + 1) % eps.length].id)}"><span>${esc(eps[(i + 1) % eps.length].title)} →</span></button>
    </nav>` : `<nav class="ew-pager"><span></span><button type="button" data-go="chronicle">Вся летопись</button><span></span></nav>`}
  </article>`;
}

/* ================================================================ музыка эпохи */

const music = { audio: null, src: "" };
function playMusic(src, vol = null) {
  if (!src) return;
  if (!music.audio || music.src !== src) { stopMusic(); music.audio = new Audio(src); music.audio.loop = true; music.src = src; music.audio.volume = 0.5;
    music.audio.addEventListener("timeupdate", syncMusicUI); }
  if (vol != null) music.audio.volume = vol;
  music.audio.play().catch(() => ui.notifications?.warn("Кодекс: браузер не дал включить звук — кликни по странице и нажми ▶"));
  syncMusicUI();
}
function stopMusic() { if (music.audio) { music.audio.pause(); music.audio = null; music.src = ""; } syncMusicUI(); }
function syncMusicUI() {
  const box = document.querySelector(`#${ROOT_ID} .ew-music`);
  if (!box) return;
  const on = music.audio && !music.audio.paused && music.src === box.dataset.src;
  const btn = box.querySelector(".ew-music-btn");
  btn.textContent = on ? "❚❚" : "▶";
  box.classList.toggle("on", !!on);
  const a = music.audio;
  if (a && a.duration) box.querySelector(".ew-music-bar i").style.width = `${(a.currentTime / a.duration) * 100}%`;
}

/* ================================================================ лайтбокс */

const LB_ID = "ew-lightbox";
function openLightbox(src, caption = "", { remote = false } = {}) {
  if (!src) return;
  document.getElementById(LB_ID)?.remove();
  const lb = document.createElement("div");
  lb.id = LB_ID;
  lb.innerHTML = `<div class="ew-lb-back"></div>
    <div class="ew-lb-stage"><img src="${esc(src)}" alt=""></div>
    ${caption ? `<div class="ew-lb-cap">${esc(caption)}</div>` : ""}
    <div class="ew-lb-tools">
      ${isGM() && !remote ? `<button type="button" data-lb="share" title="Показать всем игрокам">⇪ Всем</button>` : ""}
      <button type="button" data-lb="zoom" title="Увеличить (или клик по картинке)">⊕</button>
      <button type="button" data-lb="close" title="Закрыть (Esc)">✕</button>
    </div>`;
  const stage = lb.querySelector(".ew-lb-stage"), img = stage.querySelector("img");
  const zoom = (ev) => {
    const z = !lb.classList.contains("ew-lb-zoom");
    lb.classList.toggle("ew-lb-zoom", z);
    if (z && ev) { const r = img.getBoundingClientRect(); img.style.transformOrigin = `${((ev.clientX - r.left) / r.width) * 100}% ${((ev.clientY - r.top) / r.height) * 100}%`; }
  };
  img.addEventListener("click", (ev) => { ev.stopPropagation(); zoom(ev); });
  stage.addEventListener("mousemove", (ev) => {
    if (!lb.classList.contains("ew-lb-zoom")) return;
    const r = stage.getBoundingClientRect();
    img.style.transformOrigin = `${((ev.clientX - r.left) / r.width) * 100}% ${((ev.clientY - r.top) / r.height) * 100}%`;
  });
  stage.addEventListener("wheel", (ev) => { ev.preventDefault(); const z = ev.deltaY < 0; if (z !== lb.classList.contains("ew-lb-zoom")) zoom(ev); }, { passive: false });
  lb.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lb]");
    if (b?.dataset.lb === "zoom") return zoom(null);
    if (b?.dataset.lb === "share") { emit({ action: "image", src, caption }); return ui.notifications?.info("Кодекс: картинка показана игрокам."); }
    if (!b || b.dataset.lb === "close") if (!ev.target.closest(".ew-lb-stage img")) closeLightbox();
  });
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add("ew-in"));
}
function closeLightbox() {
  const lb = document.getElementById(LB_ID);
  if (!lb) return false;
  lb.classList.remove("ew-in");
  setTimeout(() => lb.remove(), 250);
  return true;
}

/* ================================================================ окно */

const state = { route: { v: "home" }, history: [], present: false };

function routeKey(r) { return JSON.stringify(r); }

function parseGo(go) {
  const [v, ...rest] = String(go).split(":");
  const arg = rest.join(":");
  if (v === "god") return { v, id: arg };
  if (v === "entry") return { v, id: arg };
  if (v === "list") return { v, kind: arg || "country" };
  if (v === "pantheon") return arg ? { v, dom: arg } : { v };
  if (v === "chronicle") return { v };
  if (v === "epoch") return { v, id: arg };
  return { v: "home" };
}

function render(route) {
  switch (route.v) {
    case "pantheon": return viewPantheon(route);
    case "god": return viewGod(route.id);
    case "entry": return viewEntry(route.id);
    case "list": return viewList(route.kind);
    case "search": return viewSearch(route.q ?? "");
    case "chronicle": return viewChronicle();
    case "epoch": return viewEpoch(route.id);
    default: return viewHome();
  }
}

function shellHTML() {
  return `<div class="ew-backdrop"></div>
  <div class="ew-shell">
    <header class="ew-top">
      <button type="button" class="ew-iconbtn ew-back" data-act="back" title="Назад">←</button>
      <button type="button" class="ew-brand" data-go="home"><span class="ew-brand-star">✦</span><span>Кодекс Эластрии</span></button>
      <nav class="ew-tabs">
        <button type="button" data-tab="home" data-go="home">Главная</button>
        <button type="button" data-tab="list-country" data-go="list:country">Земли</button>
        <button type="button" data-tab="pantheon" data-go="pantheon">Пантеон</button>
        <button type="button" data-tab="chronicle" data-go="chronicle">Летопись</button>
        <button type="button" data-tab="list-story" data-go="list:story">Истории</button>
      </nav>
      <label class="ew-search"><span>⌕</span><input type="search" placeholder="Поиск по миру…" autocomplete="off"></label>
      ${isGM() ? `<button type="button" class="ew-btn ew-present" data-act="present" title="Режим показа: экраны игроков переключаются вслед за вами">◉ Показ</button>
      <button type="button" class="ew-iconbtn" data-act="share" title="Показать эту страницу всем игрокам">⇪</button>` : `<span class="ew-follow" hidden>Мастер ведёт показ</span>`}
      <button type="button" class="ew-iconbtn ew-close" data-act="close" title="Закрыть (Esc)">✕</button>
    </header>
    <main class="ew-main"><div class="ew-view"></div></main>
  </div>`;
}

function bindImages(scope) {
  scope.querySelectorAll("img").forEach(img => {
    if (img._ewBound) return;
    img._ewBound = true;
    img.addEventListener("error", () => img.classList.add("ew-broken"), { once: true });
  });
}

async function open(route = null, { fromSocket = false } = {}) {
  await loadDB();
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = shellHTML();
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    const input = root.querySelector(".ew-search input");
    let t;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => {
      const q = input.value.trim();
      if (q.length >= 2) go({ v: "search", q }, { replace: state.route.v === "search" });
      else if (!q && state.route.v === "search") back();
    }, 220); });
    input.addEventListener("keydown", ev => ev.stopPropagation());
    root.addEventListener("input", (ev) => { if (ev.target.matches(".ew-music-vol") && music.audio) music.audio.volume = +ev.target.value; });
    requestAnimationFrame(() => root.classList.add("ew-in"));
    syncPresentBtn();
  }
  if (fromSocket) root.querySelector(".ew-follow")?.removeAttribute("hidden");
  await go(route ?? state.route, { replace: true, silent: fromSocket });
}

function close() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.classList.remove("ew-in");
  root.classList.add("ew-out");
  if (!music.remote) stopMusic();
  setTimeout(() => root.remove(), 380);
  if (isGM() && state.present) emit({ action: "close" });
}

async function go(route, { replace = false, silent = false } = {}) {
  const root = document.getElementById(ROOT_ID);
  if (!root) return open(route);
  if (!replace && routeKey(route) !== routeKey(state.route)) state.history.push(state.route);
  state.route = route;
  const main = root.querySelector(".ew-main");
  const view = root.querySelector(".ew-view");
  view.classList.add("ew-swap");
  await sleep(140);
  if (route.v !== "epoch" && music.audio && !music.remote) stopMusic();
  view.innerHTML = render(route);
  syncMusicUI();
  bindImages(view);
  main.scrollTop = 0;
  view.classList.remove("ew-swap");
  const tab = route.v === "list" ? `list-${route.kind}` : (route.v === "epoch" ? "chronicle" : route.v === "god" ? "pantheon" : (route.v === "entry" ? `list-${DB.entries[route.id]?.kind ?? "country"}` : route.v));
  root.querySelectorAll(".ew-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  root.querySelector(".ew-back").disabled = !state.history.length;
  if (!silent && isGM() && state.present) emit({ action: "route", route });
}

function back() { const r = state.history.pop(); if (r) go(r, { replace: true }); }

function syncPresentBtn() {
  const b = document.querySelector(`#${ROOT_ID} .ew-present`);
  if (b) b.classList.toggle("on", state.present);
}

async function onClick(ev) {
  const zb = ev.target.closest("[data-zoom]");
  if (zb) { ev.preventDefault(); return openLightbox(zb.dataset.zoom, zb.dataset.cap ?? ""); }
  const el = ev.target.closest("[data-go],[data-act],[data-anchor],a.ew-link");
  const zi = ev.target.closest("img.ew-z, .ew-article img, .ew-legend img");
  if (zi && !zi.closest("[data-go],[data-act],a")) {
    ev.preventDefault();
    const cap = zi.closest("figure")?.querySelector("figcaption")?.textContent ?? zi.getAttribute("alt") ?? "";
    return openLightbox(zi.currentSrc || zi.src, cap.trim());
  }
  if (!el) return;
  ev.preventDefault();
  if (el.dataset.anchor) {
    document.getElementById(el.dataset.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (el.dataset.go) return go(parseGo(el.dataset.go));
  if (el.matches("a.ew-link") && el.dataset.uuid) {
    const r = routeFromUuid(el.dataset.uuid);
    if (r) return go(r);
    const doc = await fromUuid(el.dataset.uuid).catch(() => null);
    return doc?.sheet?.render(true);
  }
  switch (el.dataset.act) {
    case "close": return close();
    case "back": return back();
    case "present":
      state.present = !state.present; syncPresentBtn();
      ui.notifications?.info(state.present ? "Кодекс: режим показа включён, игроки видят то же, что и вы." : "Кодекс: режим показа выключен.");
      if (state.present) emit({ action: "route", route: state.route });
      return;
    case "share": emit({ action: "route", route: state.route }); return ui.notifications?.info("Кодекс: страница показана игрокам.");
    case "reveal": return api.reveal(el.dataset.id);
    case "swap": {
      const img = el.closest(".ew-portrait")?.querySelector("img");
      if (!img?.dataset.b) return;
      img.classList.add("ew-swapping");
      setTimeout(() => { img.src = img.getAttribute("src") === img.dataset.a ? img.dataset.b : img.dataset.a; img.classList.remove("ew-swapping"); }, 220);
      return;
    }
    case "music": {
      const box = el.closest(".ew-music");
      if (music.audio && !music.audio.paused && music.src === box.dataset.src) { music.audio.pause(); return syncMusicUI(); }
      return playMusic(box.dataset.src, +box.querySelector(".ew-music-vol").value);
    }
    case "musicAll": {
      const box = el.closest(".ew-music");
      const playing = music.audio && !music.audio.paused && music.src === box.dataset.src;
      emit({ action: "music", src: box.dataset.src, play: !playing });
      if (playing) music.audio.pause(); else playMusic(box.dataset.src, +box.querySelector(".ew-music-vol").value);
      syncMusicUI();
      return ui.notifications?.info(playing ? "Кодекс: музыка остановлена у всех." : "Кодекс: музыка эпохи играет у всех.");
    }
  }
}

/* ================================================================ явление бога */

function sparks(box, n, color) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "ew-spark";
    s.style.left = `${Math.random() * 100}%`;
    s.style.setProperty("--dx", `${(Math.random() * 160 - 80).toFixed(0)}px`);
    s.style.setProperty("--sz", `${(2 + Math.random() * 4).toFixed(1)}px`);
    s.style.animationDuration = `${(5 + Math.random() * 7).toFixed(1)}s`;
    s.style.animationDelay = `${(-Math.random() * 10).toFixed(1)}s`;
    s.style.background = color;
    box.appendChild(s);
  }
}

async function showReveal(id) {
  await loadDB();
  const g = DB.byId[id];
  if (!g) return;
  hideReveal(true);
  const acc = TIER[g.tier].accent;
  const el = document.createElement("div");
  el.id = REVEAL_ID;
  el.style.setProperty("--acc", acc);
  el.innerHTML = `<div class="ew-r-back"></div><div class="ew-r-sparks"></div>
    <div class="ew-r-stage">
      <div class="ew-r-halo"></div>
      <div class="ew-r-coin"><img src="${P}assets/gods/${g.id}-e.webp" alt=""></div>
      <div class="ew-r-card">
        <img src="${P}assets/gods/${g.id}.webp" alt="">
        <div class="ew-r-shine"></div>
      </div>
      <div class="ew-r-cap"><span class="ew-r-tier">✦ ${TIER[g.tier].one} бог · ${esc(g.dom.join(" · "))} ✦</span></div>
    </div>
    ${isGM() ? `<button type="button" class="ew-r-close" title="Закрыть у всех (Esc)">✕</button>` : ""}`;
  sparks(el.querySelector(".ew-r-sparks"), 46, acc);
  el.querySelector(".ew-r-close")?.addEventListener("click", () => api.hideReveal());
  el.addEventListener("click", (ev) => { if (isGM() && !ev.target.closest(".ew-r-close")) { api.hideReveal(); open({ v: "god", id }); } });
  document.body.appendChild(el);
}

function hideReveal(immediate = false) {
  const el = document.getElementById(REVEAL_ID);
  if (!el) return;
  if (immediate) return el.remove();
  el.classList.add("ew-r-out");
  setTimeout(() => el.remove(), 650);
}

/* ================================================================ API и хуки */

function emit(payload) { globalThis.game?.socket?.emit(SOCKET, payload); }

const api = {
  open: (route) => open(typeof route === "string" ? parseGo(route) : route),
  close,
  /** Открыть бога: api.god("sirius") */
  god: (id) => open({ v: "god", id }),
  /** Открыть страну/историю по названию: api.entry("Авангардия") */
  async entry(name) { await loadDB(); const e = Object.values(DB.entries).find(x => x.name.toLowerCase().includes(String(name).toLowerCase()) || x.title.toLowerCase().includes(String(name).toLowerCase())); return e ? open({ v: "entry", id: e.id }) : ui.notifications?.warn(`Кодекс: «${name}» не найдено`); },
  /** Показать страницу всем игрокам (только мастер). */
  async show(route) { if (!isGM()) return; const r = typeof route === "string" ? parseGo(route) : route; await open(r); emit({ action: "route", route: r }); },
  /** Явление бога всем игрокам с анимацией. */
  reveal(id) { if (!isGM()) return; emit({ action: "reveal", id }); showReveal(id); },
  hideReveal() { if (isGM()) emit({ action: "hideReveal" }); hideReveal(); },
  /** Режим показа: игроки следуют за мастером. */
  present(on = true) { state.present = !!on; syncPresentBtn(); if (on) emit({ action: "route", route: state.route }); },
  /** Перечитать компендиум после правок. */
  reload: async () => { await loadDB(true); if (document.getElementById(ROOT_ID)) go(state.route, { replace: true }); },
  /** Открыть эпоху летописи: api.epoch("war-of-zephrit") */
  epoch: (id) => open(id ? { v: "epoch", id } : { v: "chronicle" }),
  /** Показать картинку всем: api.image("путь", "подпись") */
  image(src, caption = "") { openLightbox(src, caption); if (isGM()) emit({ action: "image", src, caption }); },
  get db() { return DB; }
};

globalThis.ElastriaCodex = api;

Hooks.once("init", () => {
  game.keybindings?.register(MID, "open", {
    name: "Открыть Кодекс Эластрии",
    editable: [{ key: "KeyK", modifiers: ["Shift"] }],
    onDown: () => { document.getElementById(ROOT_ID) ? close() : open(); return true; }
  });
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MID);
  if (mod) mod.api = api;
  game.socket.on(SOCKET, (d) => {
    if (!d || isGM()) return;
    if (d.action === "route") open(d.route, { fromSocket: true });
    else if (d.action === "close") close();
    else if (d.action === "reveal") showReveal(d.id);
    else if (d.action === "hideReveal") hideReveal();
    else if (d.action === "image") openLightbox(d.src, d.caption, { remote: true });
    else if (d.action === "music") { if (d.play) { playMusic(d.src); music.remote = true; } else { stopMusic(); music.remote = false; } }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (closeLightbox()) { ev.stopPropagation(); return; }
    if (document.getElementById(REVEAL_ID)) { ev.stopPropagation(); return isGM() ? api.hideReveal() : null; }
    if (document.getElementById(ROOT_ID)) { ev.stopPropagation(); close(); }
  }, true);
  // правки компендиума → Кодекс перечитывает данные
  for (const h of ["updateJournalEntry", "createJournalEntry", "deleteJournalEntry", "updateJournalEntryPage", "createJournalEntryPage"]) {
    Hooks.on(h, (doc) => { if ((doc.pack ?? doc.parent?.pack) === `${MID}.wiki`) DB = null; });
  }
});

// Кнопка в боковой панели журналов
Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".ew-dir-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ew-dir-btn";
  btn.innerHTML = `<span>✦</span> Кодекс Эластрии`;
  btn.addEventListener("click", () => open());
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(btn);
});

// Ссылки на журналы вики из обычных журналов открываются в Кодексе (с зажатым Alt — как обычно)
document.addEventListener("click", async (ev) => {
  const a = ev.target.closest?.("a.content-link[data-uuid], a.elastria-link[data-uuid]");
  if (!a || ev.altKey || a.closest(`#${ROOT_ID}`)) return;
  if (!String(a.dataset.uuid).includes(`Compendium.${MID}.`)) return;
  await loadDB();
  const r = routeFromUuid(a.dataset.uuid);
  if (!r && !a.classList.contains("elastria-link")) return;
  ev.preventDefault(); ev.stopPropagation();
  open(r ?? { v: "home" });
}, true);
