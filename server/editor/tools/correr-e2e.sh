#!/usr/bin/env bash
# Prueba del Editor (solo desarrollo; necesita xvfb en Linux). Trabaja sobre una copia temporal de la campaña de ejemplo.
cd "$(dirname "$0")/.."
rm -rf /tmp/ed-camp /tmp/ed-cliente /tmp/ed-datos /tmp/shots-ed; mkdir -p /tmp/ed-camp /tmp/ed-cliente/base/tokens /tmp/ed-cliente/base/maps /tmp/ed-cliente/base/sonido/musica /tmp/ed-cliente/base/sonido/ambiente
printf x > /tmp/ed-cliente/base/sonido/musica/taberna.wav; printf x > /tmp/ed-cliente/base/sonido/musica/extra.mp3; printf x > /tmp/ed-cliente/base/sonido/ambiente/lluvia.wav
cp -r ../campanas/ejemplo /tmp/ed-camp/ejemplo
MESA_CAMPANAS=/tmp/ed-camp MESA_DATOS=/tmp/ed-datos MESA_CLIENTE=/tmp/ed-cliente MESA_EDITOR_AJUSTES=/tmp/ed-cliente/aj.json MESA_PYTHON=python3 timeout 120 xvfb-run -a -s "-screen 0 1500x950x24" node_modules/.bin/electron --no-sandbox --disable-gpu tools/e2e.js 2>&1 | grep -E "^(PASS|FAIL|ERROR|  \[|  estado|[0-9]+/[0-9]+|\s+at )"
