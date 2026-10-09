#!/usr/bin/env bash
# Сборка архива релиза: module.json в корне архива (так требует Foundry)
set -e
V=$(python3 -c "import json;print(json.load(open('module.json'))['version'])")
python3 - <<PY
import json; m=json.load(open('module.json'))
m['download']=f"{m['url']}/releases/download/v{m['version']}/elastria-wiki.zip"
json.dump(m,open('module.json','w'),ensure_ascii=False,indent=2)
PY
rm -f elastria-wiki.zip
zip -qr elastria-wiki.zip module.json README.txt scripts styles fonts assets data chronicle packs -x "packs/**/LOCK"
echo "v$V -> elastria-wiki.zip ($(du -h elastria-wiki.zip | cut -f1))"
