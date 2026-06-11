#!/bin/bash
# Build .bobplugin from source files
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_NAME="bob-plugin-paddleocr"
VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/info.json'))['version'])")
OUTPUT="$PROJECT_DIR/${PLUGIN_NAME}@${VERSION}.bobplugin"

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "📦 Building ${PLUGIN_NAME} v${VERSION}..."

# Copy required files
for f in info.json main.js icon.png; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    cp "$PROJECT_DIR/$f" "$TEMP_DIR/"
    echo "  ✓ $f"
  else
    echo "  ⚠ $f not found, skipping"
  fi
done

# Create .bobplugin (zip archive)
cd "$TEMP_DIR"
zip -qr "$OUTPUT" ./*
cd "$PROJECT_DIR"

SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
echo ""
echo "✅ Built: $(basename "$OUTPUT") ($SIZE)"
