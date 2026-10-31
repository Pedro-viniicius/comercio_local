#!/usr/bin/env bash
# Gera os PNG de assets/brand/png/ a partir dos SVG, sem instalar nada.
# Precisa de google-chrome (modo headless) e python3 com Pillow.
# Os PNG ficam versionados: o CI não tem Chrome, e o antialiasing muda com a versão dele. O
# formato (tamanho e canal alfa) é conferido em scripts/assets-brand.test.mjs.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p png
PNG_DIR="$PWD/png"

# exportar <svg> <tamanho> <saida> [sem-alfa]
exportar() {
  local saida="$PNG_DIR/$3"
  # Sem o PNG velho no lugar, um Chrome que sai com 0 sem gravar não passa despercebido.
  rm -f "$saida"
  local log
  if ! log=$(google-chrome --headless=new --hide-scrollbars --default-background-color=00000000 \
    --screenshot="$saida" --window-size="$2,$2" "file://$PWD/$1" 2>&1); then
    printf '%s\n' "$log" >&2
    echo "erro: o Chrome falhou ao gerar $3" >&2
    exit 1
  fi
  # Confere que o arquivo saiu com o tamanho pedido e, no "sem-alfa", tira o canal alfa.
  python3 -I -c '
import os, sys
from PIL import Image
caminho, lado, modo = sys.argv[1], int(sys.argv[2]), sys.argv[3]
if not os.path.isfile(caminho):
    sys.exit(f"erro: o Chrome não gravou {caminho}")
imagem = Image.open(caminho)
if imagem.size != (lado, lado):
    sys.exit(f"erro: {caminho} saiu com {imagem.size[0]}x{imagem.size[1]}, esperado {lado}x{lado}")
if modo == "sem-alfa":
    imagem.convert("RGB").save(caminho)
' "$saida" "$2" "${4:-com-alfa}" || {
    echo "erro: $3 não foi gerado como esperado" >&2
    exit 1
  }
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
