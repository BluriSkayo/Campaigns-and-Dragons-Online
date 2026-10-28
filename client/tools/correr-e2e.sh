#!/usr/bin/env bash
# Prueba de extremo a extremo (solo desarrollo, con el repositorio completo; necesita xvfb en Linux): servidor real + dos ventanas del cliente.
cd "$(dirname "$0")/.."
rm -rf /tmp/e2e-data /tmp/e2e-client /tmp/shots; mkdir -p /tmp/e2e-data /tmp/e2e-client
python3 tools/preparar-e2e.py ../server/campanas/ejemplo /tmp/e2e-config /tmp/e2e-client/base > /dev/null || exit 1

# Si queda un servidor de una ejecución anterior, la prueba usaría su estado viejo: se aborta en vez de falsear el resultado.
if python3 - <<'PY'
import socket, sys
s = socket.socket(); s.settimeout(0.5)
sys.exit(0 if s.connect_ex(("127.0.0.1", 8765)) == 0 else 1)
PY
then echo "ERROR  Ya hay algo escuchando en el puerto 8765; ciérralo antes de lanzar la prueba."; exit 1; fi

(cd ../server && exec python3 main.py --config /tmp/e2e-config --datos /tmp/e2e-data > /tmp/srv-e2e.log 2>&1) &
SERV=$!
trap 'kill $SERV 2>/dev/null; wait $SERV 2>/dev/null' EXIT
sleep 2
MESA_DATOS=/tmp/e2e-client MESA_CREDENCIALES_PRUEBA=1 timeout 200 xvfb-run -a -s "-screen 0 2800x1000x24" node_modules/.bin/electron --no-sandbox --disable-gpu tools/e2e.js 2>&1 \
  | grep -E "^(PASS|FAIL|ERROR|  \[|Todas|[0-9]+ comprobaciones)"
