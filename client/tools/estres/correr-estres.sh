#!/usr/bin/env bash
# Prueba de estrés del cliente (solo desarrollo; necesita xvfb y Pillow). Capturas en /tmp/estres/shots-cli.
cd "$(dirname "$0")/../.."
rm -rf /tmp/estres-datos /tmp/estres-cliente /tmp/estres/shots-cli; mkdir -p /tmp/estres-datos /tmp/estres-cliente
python3 tools/estres/preparar.py ../server/campanas/ejemplo /tmp/estres/campanas/estres /tmp/estres-cliente/base > /dev/null || exit 1
(cd ../server && exec python3 main.py --config /tmp/estres/campanas/estres --datos /tmp/estres-datos --puerto 8766 > /tmp/srv-estres.log 2>&1) &
SERV=$!
trap 'kill $SERV 2>/dev/null; wait $SERV 2>/dev/null' EXIT
sleep 2
MESA_DATOS=/tmp/estres-cliente timeout 300 xvfb-run -a -s "-screen 0 3400x1200x24" node_modules/.bin/electron --no-sandbox --disable-gpu tools/estres/estres.js 2>&1 | grep -E "^(foto|ERROR|  \[|Sin problemas|[0-9]+ capturas)"
