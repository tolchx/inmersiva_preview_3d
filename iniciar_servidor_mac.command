#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f "index.html" ]]; then
  echo "[ERROR] No se encontro index.html en $(pwd)"
  read -r -p "Presiona Enter para salir..."
  exit 1
fi

is_port_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
  else
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  fi
}

PORT=8000
for p in $(seq 8000 8050); do
  if is_port_free "$p"; then
    PORT="$p"
    break
  fi
done

if [[ "$PORT" != "8000" ]]; then
  echo "[AVISO] El puerto 8000 esta ocupado. Usando puerto alternativo $PORT."
fi

URL="http://localhost:${PORT}/"
echo "=================================================="
echo "  Sala Inmersiva 3D - Servidor Local (macOS)"
echo "  URL: $URL"
echo "  Carpeta: $(pwd)"
echo "=================================================="
echo ""
echo "Abriendo navegador cuando el servidor este listo..."
echo "(No cierres esta ventana mientras uses la app. Ctrl+C para salir.)"
echo ""

(
  for _ in $(seq 1 50); do
    if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || curl -s -o /dev/null "$URL" >/dev/null 2>&1; then
      open "$URL"
      exit 0
    fi
    sleep 0.2
  done
) &

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT" --bind 127.0.0.1
elif command -v ruby >/dev/null 2>&1; then
  ruby -run -e httpd . -p "$PORT"
elif command -v php >/dev/null 2>&1; then
  php -S "127.0.0.1:${PORT}"
else
  echo "[ERROR] No se encontro python3, ruby ni php para levantar el servidor local."
  echo "Instala Python 3 (brew install python3 o python.org) e intenta nuevamente."
  read -r -p "Presiona Enter para salir..."
  exit 1
fi
