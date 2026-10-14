"""Build compendium sources (JSON) for the Karmina module: actors, adventure journal, macros.
Run: python3 .build/build.py <artifact.html>   then pack with the Foundry CLI (see .build/pack.sh)."""
import json, os, random, string, sys, re, copy
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))
random.seed(42)
def rid(): return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(16))
STATS = {"coreVersion": "13.348", "systemId": "dnd5e", "systemVersion": "5.1.0", "createdTime": 1791900000000, "modifiedTime": 1791900000000, "lastModifiedBy": None}

def out(folder, name, doc):
    d = os.path.join(ROOT, folder); os.makedirs(d, exist_ok=True)
    json.dump(doc, open(os.path.join(d, name + ".json"), "w"), ensure_ascii=False, indent=1)

# ------------------------------------------------------------------ actors
ICON = {"feat": "icons/svg/oak.svg", "rose": "icons/svg/poison.svg", "acid": "icons/svg/acid.svg", "voice": "icons/svg/sound.svg",
        "whip": "icons/svg/net.svg", "maw": "icons/svg/blood.svg", "regen": "icons/svg/regen.svg", "spit": "icons/svg/acid.svg",
        "bud": "icons/svg/aura.svg", "blight": "icons/svg/oak.svg"}

def feat(name, html, icon="feat", act=None, legendary=None):
    iid = rid()
    item = {"_id": iid, "name": name, "type": "feat", "img": ICON.get(icon, icon),
            "system": {"description": {"value": html, "chat": ""}, "type": {"value": "monster", "subtype": ""}, "activities": {}},
            "effects": [], "flags": {}, "folder": None, "sort": 0, "ownership": {"default": 0}, "_stats": STATS}
    if act or legendary:
        aid = rid()
        item["system"]["activities"][aid] = {"_id": aid, "type": "utility",
            "activation": {"type": "legendary" if legendary else act, "value": legendary or 1, "condition": "", "override": False},
            "consumption": {"targets": [], "scaling": {"allowed": False}, "spellSlot": True}, "description": {"chatFlavor": ""},
            "duration": {"units": "inst", "concentration": False, "override": False}, "range": {"units": "self", "override": False},
            "target": {"template": {"contiguous": False, "units": "ft"}, "affects": {"choice": False}, "override": False, "prompt": True},
            "uses": {"spent": 0, "recovery": []}, "roll": {"formula": "", "name": "", "prompt": False, "visible": False}, "sort": 0}
    return item

def weapon(name, html, n, die, dtype, reach, ability="str", icon="whip"):
    iid, aid = rid(), rid()
    return {"_id": iid, "name": name, "type": "weapon", "img": ICON[icon],
            "system": {"description": {"value": html, "chat": ""}, "type": {"value": "natural", "baseItem": ""},
                       "damage": {"base": {"number": n, "denomination": die, "bonus": "", "types": [dtype], "custom": {"enabled": False}, "scaling": {"number": 1}}, "versatile": {}},
                       "range": {"value": None, "long": None, "reach": reach, "units": "ft"}, "equipped": True, "proficient": 1,
                       "activities": {aid: {"_id": aid, "type": "attack", "activation": {"type": "action", "value": 1, "override": False},
                           "attack": {"ability": ability, "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "melee", "classification": "weapon"}},
                           "damage": {"critical": {"bonus": ""}, "includeBase": True, "parts": []},
                           "consumption": {"targets": [], "scaling": {"allowed": False}, "spellSlot": True}, "description": {"chatFlavor": ""},
                           "duration": {"units": "inst", "concentration": False, "override": False}, "range": {"override": False},
                           "target": {"template": {"contiguous": False, "units": "ft"}, "affects": {"choice": False}, "override": False, "prompt": True},
                           "uses": {"spent": 0, "recovery": []}, "sort": 0}}},
            "effects": [], "flags": {}, "folder": None, "sort": 0, "ownership": {"default": 0}, "_stats": STATS}

def actor(name, img, size, cr, ac, hp, formula, speed, ab, saves, skills, dr, di, ci, senses, lang, bio, items, folder=None, legact=0, legres=0, dv=()):
    aid = rid()
    abilities = {k: {"value": v, "proficient": 1 if k in saves else 0, "bonuses": {"check": "", "save": ""}} for k, v in zip(["str", "dex", "con", "int", "wis", "cha"], ab)}
    for it in items: it["_key"] = f"!actors.items!{aid}.{it['_id']}"
    return {"_id": aid, "_key": f"!actors!{aid}", "name": name, "type": "npc", "img": img, "folder": folder,
            "system": {"abilities": abilities,
                       "attributes": {"ac": {"flat": ac, "calc": "natural"}, "hp": {"value": hp, "max": hp, "temp": 0, "formula": formula},
                                      "movement": {"walk": speed, "units": "ft", "hover": False},
                                      "senses": {**senses, "units": "ft", "special": ""}},
                       "details": {"cr": cr, "type": {"value": "plant", "subtype": "", "custom": ""}, "alignment": "нейтральное зло",
                                   "biography": {"value": bio, "public": ""}},
                       "traits": {"size": size, "dr": {"value": list(dr), "custom": ""}, "di": {"value": list(di), "custom": ""},
                                  "dv": {"value": list(dv), "custom": ""}, "ci": {"value": list(ci), "custom": ""},
                                  "languages": {"value": [], "custom": lang}},
                       "skills": {k: {"value": 1, "ability": a} for k, a in skills},
                       "resources": {"legact": {"max": legact, "spent": 0}, "legres": {"max": legres, "spent": 0}}},
            "prototypeToken": {"name": name, "actorLink": False, "disposition": -1, "displayName": 20, "displayBars": 20,
                               "bar1": {"attribute": "attributes.hp"}, "width": {"huge": 3, "lg": 2}.get(size, 1), "height": {"huge": 3, "lg": 2}.get(size, 1),
                               "texture": {"src": img}, "sight": {"enabled": False}},
            "items": items, "effects": [], "flags": {"karmina": {"role": name}}, "sort": 0, "ownership": {"default": 0}, "_stats": STATS}

KARMINA_BIO = ("<p><b>Кармина, Мать тысячи ртов</b> (<i>Regina carminis</i>). Двадцать футов сомкнутого багрового бутона, укоренённого в сцену затонувшего амфитеатра. "
  "Выделяет лунный нектар — приманку. Экспедиция Мендосы не погибла: она пущена в рост.</p>"
  "<p><b>Фаза 2 — «Она встаёт» (126 хитов).</b> Вырывает корни из сцены. Скорость 40 фт, размер Громадный, «Корневая сеть» пропадает, регенерация 10. "
  "Два Боевых Действия за раунд. Дно чаши поднимается на 1 фут в раунд, нижний ярус затоплен на 4-м раунде фазы.</p>"
  "<p><b>Усиленная версия</b> (если партия идёт с ящиком экспедиции): 310 хитов (27к12+162), регенерация 25 / 15, аура пыльцы 15 фт, реакция «Шипастый ответ», "
  "третья фаза «Последняя песня» на 78 хитах.</p>"
  "<p><b>Боевые Действия</b> — на пульте модуля (Shift+K): Багровый Хор, Нектарный прилив, Корни-рыбаки, Жажда, Танец тысячи лепестков (2-я фаза), Последний Венец (3-я фаза). "
  "Сигнал — в конце её хода, Разрешение — в начале следующего. Раунды 1–2 — одно Действие, с 3-го и во 2-й фазе — два.</p>")

karmina = actor("Кармина, Мать тысячи ртов", "icons/svg/oak.svg", "huge", 12, 17, 253, "22d12+132", 10,
  (22, 12, 22, 10, 18, 22), ("con", "wis", "cha"), [("prc", "wis"), ("dec", "cha")],
  ("piercing", "bludgeoning"), ("poison",), ("poisoned", "charmed", "frightened", "exhaustion"),
  {"blindsight": 60, "tremorsense": 90}, "понимает все языки, которые знали съеденные; говорит только их голосами", KARMINA_BIO, [
    feat("Регенерация", "<p>В начале своего хода Кармина восстанавливает <b>20 хитов</b>, если не получала урона огнём с начала своего прошлого хода. Она умирает на 0 хитах, только если последний урон был огнём или кислотой; иначе сворачивается и через минуту поднимается с 50 хитами.</p>", "regen"),
    feat("Корневая сеть", "<p>Пока Кармина укоренена, она знает положение каждого существа, касающегося земли в пределах 120 футов. Во 2-й фазе черта пропадает.</p>"),
    feat("Аура пыльцы", "<p>В конце своего хода каждое существо в 10 футах от Кармины совершает спасбросок Телосложения СЛ 18 или получает состояние Отравлен до конца своего следующего хода.</p>", "rose"),
    feat("Стойкость корня (3/день)", "<p>Провалив спасбросок, Кармина может вместо этого его преуспеть.</p>"),
    feat("Мультиатака", "<p>Три атаки «Лоза-коса»; или две атаки «Лоза-коса» и одна «Пасть сердцевины».</p>", act="action"),
    weapon("Лоза-коса", "<p><i>Попадание:</i> рубящий урон, и цель совершает спасбросок Силы СЛ 18 или притягивается на 10 футов к Кармине.</p>", 2, 10, "slashing", 20),
    weapon("Пасть сердцевины", "<p><i>Попадание:</i> колющий урон. Цель Среднего размера или меньше получает состояние Схвачен (СЛ высвобождения 18) и в конце следующего хода Кармины проглатывается: 21 (6к6) кислотного урона в начале каждого хода Кармины, слепа и опутана. Проглоченный освобождается, если Кармина получает 30+ урона огнём за один ход.</p>", 3, 10, "piercing", 10, icon="maw"),
    feat("Плевок нектара (перезарядка 5–6)", "<p>Конус 30 футов. Спасбросок Телосложения СЛ 18: 36 (8к8) урона ядом при провале, половина при успехе. Провалившее существо получает состояние Очарован до конца своего следующего хода и обязано двигаться к Кармине.</p>", "spit", act="action"),
    feat("Смена лица", "<p>Бонусное действие. Кармина раскрывает новый бутон и обращается к существу в 60 футах голосом того, кого оно потеряло. Спасбросок Мудрости СЛ 18 или помеха на первую атаку по Кармине до конца его следующего хода.</p>", "voice", act="bonus"),
    feat("Хлёст", "<p>Кармина совершает одну атаку «Лоза-коса».</p>", "whip", legendary=1),
    feat("Прорастание", "<p>Куб 10 футов в пределах 60 футов зарастает шипами: труднопроходимая местность, существо, входящее в область, получает 7 (2к6) колющего урона.</p>", legendary=1),
    feat("Вопль хора (стоит 2 действия)", "<p>Каждое враждебное существо в 30 футах совершает спасбросок Мудрости СЛ 18 или получает состояние Испуган до конца своего следующего хода.</p>", "voice", legendary=2),
  ], legact=3, legres=3)

bud = actor("Бутон на ярусе", ICON["bud"], "med", 0, 14, 25, "", 0, (1, 1, 14, 1, 10, 1), (), [], (), ("poison",), ("charmed", "frightened", "prone"),
  {"blindsight": 10}, "", "<p>Одиннадцать бутонов по кромке скамей. <b>Трое из одиннадцати живы</b> — на пульте модуля они отмечены точкой.</p>"
  "<p>Уничтоженный бутон: Кармина получает 10 психического урона и теряет одно легендарное действие в этом раунде. Спасти — действие и Медицина СЛ 18; провал — срезан не тот слой.</p>", [
    feat("Поёт её голосом", "<p>Пока идёт Сигнал «Багрового Хора», три бутона поют. Назвать бутон по имени (действие, нужна улика «Хор») — он замолкает.</p>", "voice")],
  dv=("fire",))

blight = actor("Пасынок", ICON["blight"], "med", 0.5, 12, 26, "4d8+8", 10, (15, 8, 14, 5, 10, 3), (), [("ste", "dex")], (), (), ("blinded", "deafened"),
  {"blindsight": 60}, "понимает голоса тех, кого съела Кармина",
  "<p>Порча из лиан, выросшая из тел носильщиков. Зовёт по именам их голосами. Обожжённый — не встаёт: первая половина главного секрета.</p>", [
    feat("Голос мёртвого", "<p>Первый раз, когда Пасынок обращается к существу, оно совершает спасбросок Мудрости СЛ 13 или Ошеломлено до конца своего следующего хода.</p>", "voice"),
    feat("Живучесть", "<p>В начале хода Пасынок восстанавливает 5 хитов, если не получал урона огнём с начала своего прошлого хода.</p>", "regen"),
    weapon("Удушающая лоза", "<p><i>Попадание:</i> цель Схвачена (СЛ высвобождения 12), пока схвачена — опутана.</p>", 2, 6, "slashing", 10),
  ])

for a in (karmina, bud, blight): out("actors-src", "actor_" + a["_id"], a)

# ------------------------------------------------------------------ journal
html = open(sys.argv[1]).read()
soup = BeautifulSoup(html, "html.parser")
jid = rid(); pages = []
hero = soup.select_one("header.hero")
intro = f"<p><i>{hero.select_one('.binom').get_text(strip=True)}</i></p><p>{hero.select_one('.pitch').get_text(strip=True)}</p>"
intro += "<p><b>8 уровень · 4–5 игроков · 4–5 часов · пульп · Боевые Действия.</b> Пульт модуля открывается по <b>Shift+K</b> или кнопкой ✿ слева внизу.</p>"
pages.append(("Обложка", intro))
for sec in soup.select("section[id]"):
    h2 = sec.select_one(".sechead h2"); sub = sec.select_one(".sechead .sub"); num = sec.select_one(".sechead .num")
    title = h2.get_text(" ", strip=True) if h2 else sec["id"]
    n = num.get_text(strip=True) if num else ""
    n = ("Акт " + n.split()[1]) if n.startswith("АКТ") else n.capitalize()
    name = f"{n} · {title}" if n else title
    subt = sub.get_text(strip=True) if sub else ""
    sec.select_one(".sechead").decompose()
    for d in sec.select("div.read"):
        lbl = d.select_one(".lbl"); lbl and lbl.decompose(); d.name = "blockquote"; d.attrs = {}
        d.insert(0, BeautifulSoup("<p><b>Прочитать вслух</b></p>", "html.parser"))
    for d in sec.select("div.note"):
        lbl = d.select_one(".lbl"); t = lbl.get_text(strip=True) if lbl else ""; lbl and lbl.decompose()
        d.name = "aside"; d.attrs = {}; d.insert(0, BeautifulSoup(f"<p><b>{t}</b></p>", "html.parser"))
    for d in sec.select("div.rule, footer"): d.unwrap() if d.name == "footer" else d.decompose()
    body = (f"<p><i>{subt}</i></p>" if subt else "") + sec.decode_contents()
    body = re.sub(r'\s+class="[^"]*"', "", body); body = re.sub(r"\n\s*\n+", "\n", body)
    pages.append((name, body))
journal = {"_id": jid, "_key": f"!journal!{jid}", "name": "Багровый Хор · ваншот", "folder": None, "flags": {}, "sort": 0,
           "ownership": {"default": 0}, "_stats": STATS, "categories": [], "pages": []}
for i, (name, body) in enumerate(pages):
    pid = rid()
    journal["pages"].append({"_id": pid, "_key": f"!journal.pages!{jid}.{pid}", "name": name, "type": "text", "sort": (i + 1) * 100000,
        "title": {"show": True, "level": 1}, "text": {"format": 1, "content": body}, "image": {}, "video": {"controls": True, "volume": 0.5},
        "src": None, "system": {}, "ownership": {"default": -1}, "flags": {}, "_stats": STATS, "category": None})
out("journal-src", "journal_" + jid, journal)

# ------------------------------------------------------------------ macros
MACROS = [
  ("Кармина · пульт", "icons/svg/oak.svg", "game.modules.get('karmina')?.api?.panel();"),
  ("Кармина · часы +1", "icons/svg/clockwork.svg", "const K = game.modules.get('karmina').api;\nconst s = game.settings.get('karmina', 'state');\nK.clock(Math.min(4, (s.clock ?? 0) + 1));"),
  ("Кармина · Разрешить текущий Сигнал", "icons/svg/hazard.svg", "game.modules.get('karmina').api.resolve(null, 'full');"),
  ("Кармина · прогнать эффекты", "icons/svg/lightning.svg", "game.modules.get('karmina').api.demo();"),
]
for name, img, cmd in MACROS:
    mid = rid()
    out("macros-src", "macro_" + mid, {"_id": mid, "_key": f"!macros!{mid}", "name": name, "type": "script", "img": img, "command": cmd,
        "scope": "global", "author": None, "folder": None, "sort": 0, "flags": {}, "ownership": {"default": 0}, "_stats": STATS})
print("actors 3, journal pages", len(pages), "macros", len(MACROS))
