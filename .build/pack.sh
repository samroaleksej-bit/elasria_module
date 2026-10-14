#!/bin/sh
# Пересобрать компендиумы из JSON: npx @foundryvtt/foundryvtt-cli
set -e; cd "$(dirname "$0")/.."
for p in actors journal macros; do rm -rf packs/$p; ${FVTT:-npx @foundryvtt/foundryvtt-cli} package pack -n $p --in .build/$p-src --out packs; rm -f packs/$p/LOCK; done
