#!/usr/bin/env bash
# P17: explicit project, frozen release, no shared project or implicit alias.
set -euo pipefail
EASYORDER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$EASYORDER_ROOT/scripts/easyorder-release.mjs" "$@"
