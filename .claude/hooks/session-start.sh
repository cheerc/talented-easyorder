#!/bin/bash
# Claude Code 雲端 session 啟動時安裝 frontend 依賴；本機 session 不執行。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Node 主版本以 .nvmrc 為準；容器預設版本不符時，安裝該主版本的最新版到 /opt/node<major>。
node_major="$(tr -d '[:space:]v' < .nvmrc)"
node_dir="/opt/node${node_major}"
if [ "$(node -v 2>/dev/null | cut -d. -f1)" != "v${node_major}" ]; then
  if [ ! -x "${node_dir}/bin/node" ]; then
    version="$(curl -fsSL https://nodejs.org/dist/index.json \
      | python3 -I -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v${node_major}.')))")"
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp}"' EXIT
    curl -fsSL "https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.xz" -o "${tmp}/node.tar.xz"
    # 先解壓到暫存目錄，完整成功後才搬到正式位置，避免殘缺安裝被當成已安裝。
    mkdir "${tmp}/node"
    tar -xJf "${tmp}/node.tar.xz" -C "${tmp}/node" --strip-components=1
    rm -rf "${node_dir}"
    mv "${tmp}/node" "${node_dir}"
  fi
  export PATH="${node_dir}/bin:${PATH}"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"${node_dir}/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE}"
  fi
fi

# 只有 hook、lockfile 或 Node 版本變動時才重跑 npm ci；hash 檔放在被 git 忽略的 node_modules 內。
hashes=frontend/node_modules/.session-start.sha256
if ! { sha256sum --check --status "$hashes" 2>/dev/null && grep -qx "node $(node -v)" "${hashes}.node" 2>/dev/null; }; then
  rm -f "$hashes" "${hashes}.node"
  (cd frontend && npm ci --no-audit --no-fund)
  sha256sum .claude/hooks/session-start.sh frontend/package.json frontend/package-lock.json > "$hashes"
  echo "node $(node -v)" > "${hashes}.node"
fi
