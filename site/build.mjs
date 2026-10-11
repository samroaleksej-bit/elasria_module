// Сборка сайта «Кодекс Эластрии» для GitHub Pages.
// node site/build.mjs [выходная папка=_site]
// Берёт модуль как есть (scripts, styles, assets, chronicle, data, fonts),
// вытаскивает журналы из компендиума packs/wiki в db.js и кладёт index.html.
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "_site"));
const MOD = path.join(OUT, "modules", "elastria-wiki");

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(MOD, { recursive: true });

for (const d of ["scripts", "styles", "assets", "chronicle", "data", "fonts"]) {
  await fs.cp(path.join(ROOT, d), path.join(MOD, d), { recursive: true }).catch(() => {});
}
await fs.copyFile(path.join(ROOT, "module.json"), path.join(MOD, "module.json"));

// компендиум → JSON (копия, чтобы не трогать LOCK)
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ew-"));
await fs.cp(path.join(ROOT, "packs", "wiki"), path.join(tmp, "wiki"), { recursive: true });
await fs.rm(path.join(tmp, "wiki", "LOCK"), { force: true });
await extractPack(path.join(tmp, "wiki"), path.join(tmp, "out"), { yaml: false, log: false });
const docs = [];
for (const f of await fs.readdir(path.join(tmp, "out"))) {
  if (f.endsWith(".json")) docs.push(JSON.parse(await fs.readFile(path.join(tmp, "out", f), "utf8")));
}
await fs.writeFile(path.join(OUT, "db.js"), "window.__DOCS=" + JSON.stringify(docs) + ";");
await fs.rm(tmp, { recursive: true, force: true });

const ver = JSON.parse(await fs.readFile(path.join(ROOT, "module.json"), "utf8")).version;
const html = (await fs.readFile(path.join(ROOT, "site", "index.html"), "utf8")).replaceAll("{{V}}", ver);
await fs.writeFile(path.join(OUT, "index.html"), html);
await fs.writeFile(path.join(OUT, ".nojekyll"), "");
await fs.copyFile(path.join(ROOT, "assets", "gods", "sirius-e.webp"), path.join(OUT, "favicon.webp")).catch(() => {});
console.log(`Сайт собран: ${OUT} · журналов ${docs.filter(d => d._key?.startsWith("!journal!")).length} · v${ver}`);
