#!/usr/bin/env bash
# Новый патч: ./release.sh 2.2.0  → правит версию и ссылку download, коммитит, ставит тег и пушит.
# Foundry скачивает zip, который GitHub сам собирает по тегу.
set -e
V="$1"; [ -z "$V" ] && { echo "usage: ./release.sh X.Y.Z"; exit 1; }
python3 - "$V" <<'PY'
import json,sys
v=sys.argv[1]; m=json.load(open('module.json'))
m['version']=v
m['download']=f"https://github.com/samroaleksej-bit/elasria_module/archive/refs/tags/v{v}.zip"
json.dump(m,open('module.json','w'),ensure_ascii=False,indent=2)
PY
git add -A
git commit -qm "Кодекс Эластрии v$V"
git tag "v$V"
git push origin main "v$V"
echo "Выпущено: v$V"
