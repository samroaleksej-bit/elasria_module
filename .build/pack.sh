#!/bin/sh
# Пересобрать компендиум актёров: node .build/build-actors.js && sh .build/pack.sh
set -e; cd "$(dirname "$0")/.."
rm -rf packs/actors; ${FVTT:-npx -y @foundryvtt/foundryvtt-cli} package pack -n actors --in .build/actors-src --out packs; rm -f packs/actors/LOCK
