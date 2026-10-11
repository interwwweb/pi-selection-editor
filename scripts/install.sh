#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if ! command -v pi >/dev/null 2>&1; then
  printf '%s\n' 'Install Pi first and ensure pi is on PATH.' >&2
  exit 1
fi
VERSION="$(pi --version)"
case "$VERSION" in
  0.87.0) printf '%s\n' 'Requires Pi 0.87.1 or a tested later 0.87.x release.' >&2; exit 1 ;;
  0.87.*) ;;
  *) printf 'Pi %s has not been validated by this release; native editor left unchanged.\n' "$VERSION" >&2; exit 1 ;;
esac
# Provide a stable path for launchers that deliberately disable extension discovery.
STABLE="${PI_SELECTION_EDITOR_DIR:-$HOME/.local/share/pi-selection-editor}"
if [[ -e "$STABLE" || -L "$STABLE" ]]; then
  CURRENT="$(cd -- "$STABLE" && pwd -P)"
  if [[ "$CURRENT" != "$ROOT" ]]; then
    printf 'Stable path already belongs to another installation: %s. Nothing overwritten.\n' "$STABLE" >&2
    exit 1
  fi
else
  mkdir -p -- "$(dirname -- "$STABLE")"
  ln -s -- "$ROOT" "$STABLE"
fi
pi install "$ROOT"
printf '%s\n' 'Installed. Standard Pi: /reload. Launchers with --no-extensions must explicitly add this extension and restart; see README.md.'
