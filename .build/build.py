import json, re, os, random, string, shutil, html, glob

BASE = os.path.dirname(os.path.abspath(__file__)) + '/'
UP = BASE + 'exports/'
SP = BASE
MOD = os.path.dirname(BASE.rstrip('/')) + '/'
SRC = BASE + 'src/'
MID = 'elastria-wiki'
PACK = 'wiki'

random.seed(42)
def rid():
    return ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(16))

def uuid(jid, pid=None):
    u = f'Compendium.{MID}.{PACK}.JournalEntry.{jid}'
    return u + (f'.JournalEntryPage.{pid}' if pid else '')

def link(jid, text, pid=None):
    return f'@UUID[{uuid(jid, pid)}]{{{text}}}'

# ---------------------------------------------------------------- folders
FOLDERS = {}
def folder(key, name, sort, color):
    FOLDERS[key] = {'_id': rid(), 'name': name, 'type': 'JournalEntry', 'folder': None,
                    'sorting': 'm', 'sort': sort, 'color': color, 'description': '', 'flags': {}}
folder('home', 'Главная', 100000, '#8a6d2f')
folder('countries', 'Страны', 200000, '#2f5a4a')
folder('gods', 'Пантеон', 300000, '#5a3a7a')
folder('stories', 'Истории', 400000, '#7a2f2f')
folder('service', 'Служебное', 500000, '#444444')

ENTRIES = []

def page(name, content, sort=100000, pid=None, show=False, level=1):
    return {'_id': pid or rid(), 'name': name, 'type': 'text', 'sort': sort,
            'title': {'show': show, 'level': level}, 'image': {}, 'system': {},
            'text': {'format': 1, 'content': content}, 'video': {'controls': True, 'volume': 0.5},
            'src': None, 'category': None, 'flags': {}, 'ownership': {'default': -1}}

def entry(name, fkey, pages, sort, jid=None):
    e = {'_id': jid or rid(), 'name': name, 'folder': FOLDERS[fkey]['_id'], 'sort': sort,
         'pages': pages, 'categories': [], 'flags': {}, 'ownership': {'default': 0}}
    ENTRIES.append(e)
    return e

# ---------------------------------------------------------------- source exports
COUNTRIES = ['nekotochi', 'nebesnye-ostrova', 'motum-ainos', 'moroznye-gavani', 'maotulin_',
             'zemli-lyudoyasherov', 'atlantiya', 'tiflingi-ekzortusa', 'poleniya', 'kvilandriya',
             'avangardiya', 'tiflingi-akvirtusa', 'oazis-dyun-gor', 'oreskos']
STORIES = ['koroleva-piratov-stit-ci', 'tishina-akvirtusa', 'zharkie-zemli-oreskosa']

def load(slug):
    f = [p for p in glob.glob(UP + '*-fvtt-JournalEntry-*.json') if f'-JournalEntry-{slug}-' in p]
    assert len(f) == 1, (slug, f)
    return json.load(open(f[0], encoding='utf8'))

def import_entry(slug, fkey, sort):
    d = load(slug)
    pages = []
    for p in d['pages']:
        np_ = page(p['name'], p['text']['content'], p.get('sort', 100000), p['_id'],
                   p['title']['show'], p['title']['level'])
        pages.append(np_)
    return entry(d['name'], fkey, pages, sort, d['_stats']['exportSource']['uuid'].split('.')[-1])

country_entries = {}
order = sorted(COUNTRIES, key=lambda s: load(s)['name'])
for i, s in enumerate(order):
    country_entries[s] = import_entry(s, 'countries', (i + 1) * 100000)
story_entries = {}
for i, s in enumerate(STORIES):
    story_entries[s] = import_entry(s, 'stories', (i + 1) * 100000)

# ---------------------------------------------------------------- pantheon
data = json.load(open(BASE + 'gods.json', encoding='utf8'))
G, TIES = data['G'], data['TIES']
BY = {g['id']: g for g in G}
TIER = {'F': ('Фундаментальные', 'Фундаментальный'), 'M': ('Средние', 'Средний'), 'S': ('Малые', 'Малый')}
TIER_DESC = {
    'F': 'Основа мира. Четверо создали Эластрию, поглотив четыре великие души старого мира; пятый, Кишин, был всегда. '
         'Их нельзя убить без катастрофы, поэтому они «на пенсии» и вмешиваются, только когда кто-то собрался уничтожить мир.',
    'M': 'Боги с Искрой — осколком божественности, который даёт силу жрецам где угодно. Как получить Искру, не знает никто, '
         'даже сами боги. За этой тайной охотятся малые боги, культы и амбициозные смертные.',
    'S': 'Вознесённые без Искры. Герой, дошедший до 20+ уровня и закрывший свою историю, становится легендой, и вера делает '
         'его богом. Список растёт с каждым законченным кампейном.'}
IMG = f'modules/{MID}/assets/gods/'
PANTH_ID = rid()
FIXED_PID = {'tszinlun': 'TszinlunGodPage1'}
GOD_PID = {g['id']: rid() for g in G if g['id'] not in FIXED_PID}
GOD_PID.update({k: v for k, v in FIXED_PID.items() if k in BY})
OVERVIEW_PID = rid()

e = html.escape
HR = '<div style="height:1px;background:linear-gradient(90deg, transparent, rgba(200,170,110,0.65), transparent);margin:1.25rem 0"></div>'
H2 = 'style="margin:0 0 0.6rem;font-size:1.25em;letter-spacing:0.03em"'

def coin(g, size=56):
    return (f'<img src="{IMG}{g["id"]}-e.webp" alt="{e(g["n"])}" width="{size}" height="{size}" '
            f'style="width:{size}px;height:{size}px;border-radius:50%;border:none;margin:0;display:inline-block;vertical-align:middle;box-shadow:none">')

def coin_link(g, size=44):
    return (f'<a class="elastria-link" data-uuid="{uuid(PANTH_ID, GOD_PID[g["id"]])}" data-tooltip="{e(g["n"])}" '
            f'style="display:inline-block;margin:2px;cursor:pointer">{coin(g, size)}</a>')

def god_link(gid, text=None):
    return link(PANTH_ID, text or BY[gid]['n'], GOD_PID[gid])

def god_page(g):
    facts = [('Ярус', TIER[g['tier']][1]), ('Сфера', g['sph']), ('Домены', ', '.join(g['dom'])),
             ('Мировоззрение', g['al']), ('Кто молится', g['who']), ('Символ', g['sym'])]
    rows = ''.join(f'<tr><th style="text-align:left;padding:0.3rem 0.6rem;white-space:nowrap;opacity:0.8">{k}</th>'
                   f'<td style="padding:0.3rem 0.6rem">{e(v)}</td></tr>' for k, v in facts)
    body = ''.join(f'<p>{e(t)}</p>' for t in g['txt'])
    ties = [t for t in TIES if g['id'] in (t[0], t[1])]
    ties_html = ''
    if ties:
        li = []
        for a, b, txt in ties:
            other = b if a == g['id'] else a
            who = god_link(other) if other else 'Фундаментальные'
            li.append(f'<li style="margin:0.25rem 0"><strong>{who}</strong> — {e(txt)}</li>')
        ties_html = f'{HR}<h2 {H2}>Связи</h2><ul style="margin:0.5rem 0 0.9rem 1.25rem">{"".join(li)}</ul>'
    leg = ''
    if g.get('leg'):
        L = g['leg']
        leg = f'{HR}<h2 {H2}>Легенда • {e(L["h"])}</h2>' + ''.join(f'<p>{e(p)}</p>' for p in L['p'])
        if L.get('c'):
            leg += (f'<blockquote style="margin:1rem 0;padding:0.9rem 1rem;border-left:4px solid rgba(200,170,110,0.8);'
                    f'background:rgba(0,0,0,0.12);border-radius:8px"><p style="margin:0"><em>{e(L["c"])}</em></p></blockquote>')
    death = ''
    if g.get('death'):
        death = (f'<blockquote style="margin:1rem 0;padding:0.9rem 1rem;border-left:4px solid rgba(200,80,80,0.85);'
                 f'background:rgba(0,0,0,0.12);border-radius:8px"><p style="margin:0"><strong>Если умрёт:</strong> {e(g["death"])}</p></blockquote>')
    return f'''<section class="elastria-lore elastria-god" style="max-width:900px;margin:0 auto;padding:0.25rem 0.25rem 1rem;line-height:1.7">
<header style="margin:0.25rem 0 1rem;text-align:center"><div style="font-variant:small-caps;letter-spacing:0.12em;opacity:0.85;font-size:0.95em"><p>Пантеон Эластрии • {TIER[g["tier"]][0]}</p></div>
<p style="margin:0.5rem 0">{coin(g, 96)}</p>
<h1 style="margin:0.35rem 0 0.35rem;font-size:1.9em;letter-spacing:0.02em">{e(g["n"])}</h1>
<div style="opacity:0.75;font-style:italic"><p><em>{e(g["t"])}</em></p></div></header>
<img src="{IMG}{g["id"]}.webp" alt="{e(g["n"])}">
{HR}<article>
<table style="width:100%;border-collapse:collapse;margin:0 0 1rem;background:rgba(0,0,0,0.08);border-radius:8px">{rows}</table>
{body}{death}{ties_html}{leg}
</article><footer style="margin-top:1.25rem;text-align:center;opacity:0.75;font-size:0.95em"><p>{link(PANTH_ID, "← к обзору пантеона", OVERVIEW_PID)}</p></footer></section>'''

def tier_block(tk):
    gs = [g for g in G if g['tier'] == tk]
    items = ''.join(f'<li style="margin:0.35rem 0;list-style:none">{coin_link(g, 40)} <strong>{god_link(g["id"])}</strong>'
                    f' — {e(g["t"])}</li>' for g in gs)
    return f'<h2 {H2}>{TIER[tk][0]}</h2><p>{e(TIER_DESC[tk])}</p><ul style="margin:0.5rem 0 0.9rem 0;padding:0">{items}</ul>'

overview = f'''<section class="elastria-lore elastria-pantheon" style="max-width:900px;margin:0 auto;padding:0.25rem 0.25rem 1rem;line-height:1.7">
<header style="margin:0.25rem 0 1rem;text-align:center"><div style="font-variant:small-caps;letter-spacing:0.12em;opacity:0.85;font-size:0.95em"><p>Эластрия • Боги</p></div>
<h1 style="margin:0.35rem 0 0.35rem;font-size:1.9em;letter-spacing:0.02em">Пантеон Эластрии</h1>
<div style="opacity:0.75;font-style:italic"><p><em>{len(G)} богов на трёх ярусах. Ярус решает не сила, а то, что держит бог: сам мир, Искру или веру смертных.</em></p></div></header>
<p style="text-align:center;line-height:2.4">{" ".join(coin_link(g, 44) for g in G)}</p>
{HR}<article>
<h2 {H2}>Правила веры</h2>
<ul style="margin:0.5rem 0 0.9rem 1.25rem">
<li>Сила бога растёт от числа верующих и силы их веры. Забытый бог слабеет.</li>
<li>Малые боги дают полный домен, но сильнее всего там, где их помнят.</li>
<li>Малые боги ходят по миру и встречаются как NPC.</li>
<li>Класс опасности персонажа = уровень / 2.</li></ul>
{HR}{tier_block("F")}{HR}{tier_block("M")}{HR}{tier_block("S")}{HR}
<h2 {H2}>Главная угроза эпохи</h2>
<p>Общий план злых богов: освободить {god_link("kishin", "Кишина")} и убить {god_link("simori")}. Тогда в мир вырвутся страх и Плеть одновременно.</p>
<h2 {H2}>Крючки для кампейнов</h2>
<ul style="margin:0.5rem 0 0.9rem 1.25rem">
<li><strong>Освобождение Кишина.</strong> Клетка рушится, Ноктира слабеет, в Авангардии ползут вампиры. Орден Маркуса фон Блейда получает послания через сны.</li>
<li><strong>Охота за грехами.</strong> Гнев, Зависть, Алчность, Чревоугодие и Похоть бродят по миру. Вейрон собирает их, чтобы стать Люцифером. Каждый грех — босс или квест.</li>
<li><strong>Чумной город.</strong> Культ Морны запускает эпидемию, приюты Кайрона закрываются на карантин.</li>
<li><strong>Восхождение Стит Ци.</strong> Финал кампейна «Королева Пиратов Мертва!» решает, появится ли в пантеоне богиня моря.</li>
<li><strong>Новые малые боги.</strong> Каждый законченный кампейн на 20+ уровне добавляет в пантеон бога.</li>
<li><strong>Тайна Искры.</strong> Как получить Искру, не знает никто. Возможно, знает Панцерфауст. Возможно, Эйлин получила её по праву рождения.</li></ul>
</article></section>'''

pp = [page('Обзор пантеона', overview, 100000, OVERVIEW_PID)]
s = 200000
for tk in 'FMS':
    for g in [g for g in G if g['tier'] == tk]:
        pp.append(page(g['n'], god_page(g), s, GOD_PID[g['id']]))
        s += 100000
entry('Пантеон Эластрии', 'gods', pp, 100000, PANTH_ID)

# ---------------------------------------------------------------- template
TEMPLATE = f'''<section class="elastria-lore" style="max-width:900px;margin:0 auto;padding:0.25rem 0.25rem 1rem;line-height:1.7">
<header style="margin:0.25rem 0 1rem;text-align:center"><div style="font-variant:small-caps;letter-spacing:0.12em;opacity:0.85;font-size:0.95em"><p>Эластрия • Лор государства</p></div>
<h1 style="margin:0.35rem 0 0.35rem;font-size:1.9em;letter-spacing:0.02em">Название страны</h1>
<div style="opacity:0.75;font-style:italic"><p><em>Подзаголовок: народ, суть, настроение</em></p></div></header>
{HR}<article>
<h2 {H2}>История</h2><p>Текст. Картинку вставляй отдельной строкой — модуль сам растянет её по ширине и скруглит углы.</p>
{HR}<h2 {H2}>Культура</h2><p>Текст.</p>
<blockquote style="margin:1rem 0;padding:0.9rem 1rem;border-left:4px solid rgba(200,170,110,0.8);background:rgba(0,0,0,0.12);border-radius:8px"><p style="margin:0">Цитата или важная врезка.</p></blockquote>
{HR}<h2 {H2}>Архитектура</h2><p>Текст.</p>
{HR}<h2 {H2}>Правитель</h2><p>Текст.</p>
</article><footer style="margin-top:1.25rem;text-align:center;opacity:0.75;font-size:0.95em"><p><span style="font-variant:small-caps;letter-spacing:0.10em">Название</span> • <em>короткий девиз</em></p></footer></section>'''
entry('Шаблон: новая страна', 'service',
      [page('Как пользоваться', '<p>Дублируй этот журнал (ПКМ → Дублировать) или импортируй его в мир, затем меняй текст. '
            'Чтобы правки сохранились прямо в вики, открой компендиум и сними замок (ПКМ на компендиуме → Toggle Edit Lock).</p>'
            '<p>Ссылка на бога или страну: перетащи нужную страницу из компендиума в текст — Foundry вставит @UUID-ссылку.</p>', 100000),
       page('Шаблон', TEMPLATE, 200000)], 100000)

# ---------------------------------------------------------------- auto links
E_ = r'(?:а|я|у|ю|ом|ем|ой|ей|е|ы|и|ь|ью|ём)?'
NB = r'(?<![А-Яа-яЁё])'
NA = r'(?![А-Яа-яЁё])'
GOD_STEMS = {'dreiven': 'Дрейвен', 'avrora': 'Аврор', 'melodia': 'Мелоди', 'simori': 'Симори', 'kishin': 'Кишин',
             'sirius': 'Сириус', 'amatus': 'Аматус', 'noktira': 'Ноктир', 'eilin': 'Эйлин', 'panzer': 'Панцерфауст',
             'morna': 'Морн', 'veiron': 'Вейрон', 'fina': 'Фин', 'kairon': 'Кайрон', 'pinki': 'Пинки',
             'michaio': 'Мичайо', 'rosko': 'Роско', 'lozarito': 'Лозарито', 'baragon': 'Барагон',
             'zeinariel': 'Зейнариэл', 'henk': 'Хенк', 'stitci': 'Стит Ци', 'torgrim': 'Торгрим', 'tszinlun': 'Цзиньлун'}
TARGETS = []  # (regex, jid, pid)
for gid, st in GOD_STEMS.items():
    TARGETS.append((re.compile(NB + re.escape(st) + E_ + NA), PANTH_ID, GOD_PID[gid]))
C_PAT = {'avangardiya': r'Авангарди[яиюей]+', 'kvilandriya': r'Квиландри[яиюей]+', 'maotulin_': r'Маотулин[ьяеюи]*',
         'oazis-dyun-gor': r'Оазис(?:а|у|е|ом)? Дюн Гор', 'oreskos': r'Орескос(?:а|у|е|ом)?', 'poleniya': r'Полени[яиюей]+',
         'atlantiya': r'Атлanti'.replace('anti', 'анти') + r'[яиюей]+', 'moroznye-gavani': r'Морозн(?:ые|ых|ым) Гаван[ьиямх]+',
         'nekotochi': r'Некоточи', 'motum-ainos': r'Мотум Аинос', 'nebesnye-ostrova': r'Небесн(?:ые|ых|ым|ыми) остров[аов]*',
         'tiflingi-ekzortusa': r'Экзорт(?:и)?ус[ауе]?', 'tiflingi-akvirtusa': r'Аквиртус[ауе]?'}
for slug, pat in C_PAT.items():
    TARGETS.append((re.compile(NB + pat + NA), country_entries[slug]['_id'], None))

TARGETS.append((re.compile(NB + r'Золот(?:ой|ого|ому|ым|ом) [Дд]ракон(?:а|у|ом|е)?' + NA), PANTH_ID, GOD_PID['tszinlun']))
TARGETS.append((re.compile(NB + r'Каал(?:а|ом|е|у)? Таар(?:а|ом|е|у)?(?: Ура?гаа?ра?| Ураг)?' + NA), story_entries['zharkie-zemli-oreskosa']['_id'], None))
SKIP = {'h1', 'h2', 'h3', 'h4', 'a', 'figcaption', 'header', 'footer'}
TAG = re.compile(r'(<[^>]+>)')

def autolink(content, self_jid, self_pid):
    used = set()
    parts = TAG.split(content)
    stack = []
    out = []
    for part in parts:
        if part.startswith('<'):
            m = re.match(r'<(/?)([a-zA-Z0-9]+)', part)
            if m:
                name = m.group(2).lower()
                if name in SKIP:
                    if m.group(1):
                        if name in stack: stack.remove(name)
                    elif not part.endswith('/>'):
                        stack.append(name)
            out.append(part)
            continue
        if stack or not part.strip():
            out.append(part); continue
        for rx, jid, pid in TARGETS:
            key = (jid, pid)
            if key in used or jid == self_jid and (pid is None or pid == self_pid):
                continue
            m = rx.search(part)
            if m and '@UUID[' not in part[max(0, m.start() - 80):m.start()]:
                part = part[:m.start()] + link(jid, m.group(0), pid) + part[m.end():]
                used.add(key)
        out.append(part)
    return ''.join(out)

for en in ENTRIES:
    if en['folder'] == FOLDERS['service']['_id']:
        continue
    for p in en['pages']:
        if p['_id'] == OVERVIEW_PID:
            continue
        p['text']['content'] = autolink(p['text']['content'], en['_id'], p['_id'])

# ---------------------------------------------------------------- home
def card(en, sub):
    return (f'<li style="margin:0.35rem 0"><strong>{link(en["_id"], en["name"])}</strong>'
            f'{" — " + e(sub) if sub else ""}</li>')
def subtitle(en):
    c = en['pages'][0]['text']['content']
    m = re.search(r'<em>([^<]{3,90})</em>', c)
    return html.unescape(m.group(1)) if m else ''
c_list = ''.join(card(country_entries[s], subtitle(country_entries[s])) for s in order)
s_list = ''.join(card(story_entries[s], subtitle(story_entries[s])) for s in STORIES)
coins = ' '.join(coin_link(g, 40) for g in G)
HOME = f'''<section class="elastria-lore elastria-home" style="max-width:900px;margin:0 auto;padding:0.25rem 0.25rem 1rem;line-height:1.7">
<header style="margin:0.25rem 0 1rem;text-align:center"><div style="font-variant:small-caps;letter-spacing:0.12em;opacity:0.85;font-size:0.95em"><p>Подмастерье Мастера • авторский сеттинг</p></div>
<h1 style="margin:0.35rem 0 0.35rem;font-size:2.1em;letter-spacing:0.02em">Эластрия</h1>
<div style="opacity:0.75;font-style:italic"><p><em>Вики мира: страны, боги и истории</em></p></div></header>
<p style="text-align:center;line-height:2.2">{coins}</p>
{HR}<article>
<h2 {H2}>Пантеон</h2>
<p>{link(PANTH_ID, "Пантеон Эластрии", OVERVIEW_PID)} — {len(G)} богов на трёх ярусах: фундаментальные, средние с Искрой и малые вознесённые герои. У каждого бога своя страница с артом, эмблемой, доменами, связями и легендами.</p>
{HR}<h2 {H2}>Страны и народы</h2><ul style="margin:0.5rem 0 0.9rem 1.25rem">{c_list}</ul>
{HR}<h2 {H2}>Истории Эластрии</h2><p style="opacity:0.8"><em>Рассказы Verlierboy. «Королева Пиратов» — 18+.</em></p><ul style="margin:0.5rem 0 0.9rem 1.25rem">{s_list}</ul>
{HR}<h2 {H2}>Как пополнять вики</h2>
<ul style="margin:0.5rem 0 0.9rem 1.25rem"><li>Сними замок с компендиума, чтобы править прямо здесь.</li>
<li>Новая страна — дублируй «Шаблон: новая страна» из папки «Служебное».</li>
<li>Имена богов и стран в текстах уже кликабельны. Новые ссылки — перетаскиванием страницы в текст.</li></ul>
</article></section>'''
entry('Эластрия — Главная', 'home', [page('Главная', HOME)], 100000)

# ---------------------------------------------------------------- write sources
shutil.rmtree(SRC, ignore_errors=True); os.makedirs(SRC)
for f in FOLDERS.values():
    f['_key'] = f'!folders!{f["_id"]}'
    json.dump(f, open(SRC + f'folder_{f["_id"]}.json', 'w', encoding='utf8'), ensure_ascii=False)
for en in ENTRIES:
    en['_key'] = f'!journal!{en["_id"]}'
    for p in en['pages']:
        p['_key'] = f'!journal.pages!{en["_id"]}.{p["_id"]}'
    json.dump(en, open(SRC + f'journal_{en["_id"]}.json', 'w', encoding='utf8'), ensure_ascii=False)

# report links
tot = sum(p['text']['content'].count('@UUID[') for en in ENTRIES for p in en['pages'])
print('entries', len(ENTRIES), 'folders', len(FOLDERS), 'links', tot)

# ---------------------------------------------------------------- codex data
os.makedirs(MOD + 'data', exist_ok=True)
gd = {'packId': f'{MID}.{PACK}', 'pantheonId': PANTH_ID, 'overviewPageId': OVERVIEW_PID,
      'tierDesc': TIER_DESC,
      'gods': [dict(g, pageId=GOD_PID[g['id']]) for g in G], 'ties': TIES}
json.dump(gd, open(MOD + 'data/gods.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('gods.json ok')
