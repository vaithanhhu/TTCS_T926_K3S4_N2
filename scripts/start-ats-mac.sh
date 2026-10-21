#!/bin/bash
set -euo pipefail

# Compatible with macOS's system Bash 3.2; no Homebrew-specific absolute paths.
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js >=22.13.0 is required. Install Node and reopen Terminal.' >&2
  exit 1
fi
exec node "$SCRIPT_DIR/start-ats-mac.cjs" "$@"
