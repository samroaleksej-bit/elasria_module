#!/usr/bin/env bash
# Новый патч: ./release.sh 2.2.0 "что изменилось"
# Поднимает версию в module.json, коммитит и пушит в main.
# Foundry видит новую версию по raw-манифесту и скачивает архив ветки main.
set -e
V="$1"; MSG="${2:-патч}"
[ -z "$V" ] && { echo "usage: ./release.sh X.Y.Z \"описание\""; exit 1; }
python3 - "$V" <<'PY'
import json,sys
m=json.load(open('module.json')); m['version']=sys.argv[1]
json.dump(m,open('module.json','w'),ensure_ascii=False,indent=2)
PY
git add -A
git commit -qm "v$V: $MSG"
git push origin main
echo "Выпущено: v$V"
