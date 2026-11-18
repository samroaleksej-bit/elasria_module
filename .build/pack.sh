#!/bin/sh
# Пересобрать компендиум: sh .build/pack.sh (папку packs/actors перед этим убрать)
set -e; cd "$(dirname "$0")/.."
${FVTT:-npx -y @foundryvtt/foundryvtt-cli} package pack -n actors --in .build/actors-src --out packs
${FVTT:-npx -y @foundryvtt/foundryvtt-cli} package pack -n scenes --in .build/scenes-src --out packs
