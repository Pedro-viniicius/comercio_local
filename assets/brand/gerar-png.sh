#!/usr/bin/env bash
# Gera os PNG de assets/brand/png/ a partir dos SVG, sem instalar nada.
# Precisa de google-chrome (modo headless) e python3 com Pillow.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p png
PNG_DIR="$PWD/png"

# exportar <svg> <tamanho> <saida> [sem-alfa]
exportar() {
  google-chrome --headless=new --hide-scrollbars --default-background-color=00000000 \
    --screenshot="$PNG_DIR/$3" --window-size="$2,$2" "file://$PWD/$1" >/dev/null 2>&1
  if [ "${4:-}" = "sem-alfa" ]; then
    python3 -I -c 'import sys; from PIL import Image; p=sys.argv[1]; Image.open(p).convert("RGB").save(p)' "$PNG_DIR/$3"
  fi
}

exportar bairrin-icone-ios-1024.svg 1024 icone-ios-1024.png sem-alfa
exportar bairrin-icone-ios-1024.svg 512 icone-play-512.png
exportar bairrin-icone-android-frente.svg 1024 icone-android-frente-1024.png
exportar bairrin-icone-android-mono.svg 1024 icone-android-mono-1024.png
exportar bairrin-splash.svg 1024 splash-1024.png sem-alfa
exportar bairrin-lojista-icone-ios-1024.svg 1024 lojista-icone-ios-1024.png sem-alfa
exportar bairrin-lojista-icone-ios-1024.svg 512 lojista-icone-play-512.png
exportar bairrin-lojista-icone-android-frente.svg 1024 lojista-icone-android-frente-1024.png
echo "PNG gerados em $PNG_DIR"
