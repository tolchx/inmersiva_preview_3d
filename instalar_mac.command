#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Applications/SalaInmersiva"
APP_BUNDLE="$HOME/Applications/Sala Inmersiva 3D.app"
DESKTOP_CMD="$HOME/Desktop/Sala Inmersiva 3D.command"

echo "=================================================="
echo "  Instalador Sala Inmersiva 3D (macOS)"
echo "=================================================="
echo ""

if [[ ! -f "$SRC_DIR/index.html" ]]; then
  echo "[ERROR] No se encontro index.html en $SRC_DIR"
  read -r -p "Presiona Enter para salir..."
  exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

cp "$SRC_DIR/index.html" "$INSTALL_DIR/"
cp "$SRC_DIR/iniciar_servidor_mac.command" "$INSTALL_DIR/"
if [[ -f "$SRC_DIR/README.md" ]]; then
  cp "$SRC_DIR/README.md" "$INSTALL_DIR/"
fi
cp -R "$SRC_DIR/assets" "$INSTALL_DIR/"
cp -R "$SRC_DIR/pixelmap" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/iniciar_servidor_mac.command"

# Crear acceso directo en el Escritorio
cat > "$DESKTOP_CMD" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/iniciar_servidor_mac.command"
EOF
chmod +x "$DESKTOP_CMD"

# Crear app bundle en ~/Applications para Spotlight / Launchpad
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
cat > "$APP_BUNDLE/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Sala Inmersiva 3D</string>
  <key>CFBundleDisplayName</key>
  <string>Sala Inmersiva 3D</string>
  <key>CFBundleIdentifier</key>
  <string>com.tolchx.salainmersiva3d</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
EOF

cat > "$APP_BUNDLE/Contents/MacOS/launcher" <<EOF
#!/usr/bin/env bash
open -a Terminal "$INSTALL_DIR/iniciar_servidor_mac.command"
EOF
chmod +x "$APP_BUNDLE/Contents/MacOS/launcher"

echo "Instalacion completada en: $INSTALL_DIR"
echo "Acceso directo en Escritorio: $DESKTOP_CMD"
echo "Aplicacion creada en: $APP_BUNDLE"
echo ""
read -r -p "Deseas abrir Sala Inmersiva 3D ahora? [S/n]: " REPLY
if [[ -z "${REPLY:-}" || "$REPLY" =~ ^[SsYy]$ ]]; then
  exec "$INSTALL_DIR/iniciar_servidor_mac.command"
fi
