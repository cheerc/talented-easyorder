# Implement scripts/preflight-worktree.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate worktree environment checks, branch protection checks, and staleness-gated npm dependency installations to align developer/agent state.

**Architecture:** Create a standalone bash script at `scripts/preflight-worktree.sh` that checks if the caller is inside a valid git worktree, guards against working directly on `dev` or `main`, checks for prunable worktree entries, copies gitignored `.env*` files from the source repo, runs a staleness-gated `npm ci` for the frontend directory, and exports standard git editor settings.

**Tech Stack:** Bash, Git, Node.js / npm

---

### Task 1: Create scripts/preflight-worktree.sh

**Files:**
- Create: `scripts/preflight-worktree.sh`

- [ ] **Step 1: Create the directory and write scripts/preflight-worktree.sh**

Create the file `scripts/preflight-worktree.sh` with the following contents:

```bash
#!/usr/bin/env bash

# Detect sourced vs exec'd. When sourced, save caller's options and restore on exit
# to avoid polluting the interactive shell with -euo pipefail.
_preflight_sourced=0
(return 0 2>/dev/null) && _preflight_sourced=1

if [ "$_preflight_sourced" -eq 1 ]; then
  _preflight_saved_opts="$(set +o)"
  _preflight_saved_pipefail=""
  # pipefail state varies by shell; save it explicitly
  if set -o | grep -q 'pipefail'; then
    _preflight_saved_pipefail="$(set -o | grep pipefail)"
  fi
fi

set -euo pipefail

# Cleanup function: restore caller's shell options when sourced
_preflight_cleanup() {
  if [ "$_preflight_sourced" -eq 1 ]; then
    eval "$_preflight_saved_opts"
    if [ -n "${_preflight_saved_pipefail:-}" ]; then
      case "$_preflight_saved_pipefail" in
        *nopipefail*) set +o pipefail 2>/dev/null || true ;;
        *pipefail*)   set -o pipefail 2>/dev/null || true ;;
      esac
    fi
  fi
}

# --- #1 Guard: not a worktree / detached / dev|main / prunable ---

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "preflight-worktree: not inside a git worktree" >&2
  _preflight_cleanup
  return 1 2>/dev/null || exit 1
fi

current_branch="$(git branch --show-current)"
if [ -z "$current_branch" ]; then
  echo "preflight-worktree: detached HEAD is not allowed for shared preflight" >&2
  _preflight_cleanup
  return 1 2>/dev/null || exit 1
fi

if [ "$current_branch" = "dev" ] || [ "$current_branch" = "main" ]; then
  echo "preflight-worktree: current branch must not be dev/main" >&2
  _preflight_cleanup
  return 1 2>/dev/null || exit 1
fi

# Suppress stderr: agend-git shim blocks `git worktree list` in fleet mode; prunable check is redundant
if ! git worktree list 2>/dev/null | awk '$NF == "prunable" { found = 1 } END { exit found ? 0 : 1 }'; then
  :
else
  echo "preflight-worktree: found prunable worktree entries; run 'git worktree prune' before continuing" >&2
  _preflight_cleanup
  return 1 2>/dev/null || exit 1
fi

# --- #2 + #3: env secrets + npm dependencies ---
source_repo="/Users/cheerc/talented-easyorder"
worktree_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "preflight-worktree: failed to get worktree root" >&2
  _preflight_cleanup
  return 1 2>/dev/null || exit 1
}

# Ensure env files and dependencies are aligned if running inside a worktree
if [ "$worktree_root" != "$source_repo" ]; then
  cd "$worktree_root"

  # Sync all local .env files (excluding .env.example) from source repo frontend/ to worktree frontend/
  if [ -d "$source_repo/frontend" ]; then
    find "$source_repo/frontend" -maxdepth 1 -name ".env*" ! -name ".env.example" 2>/dev/null | while read -r env_file; do
      filename=$(basename "$env_file")
      echo "preflight-worktree: copying $filename to worktree..."
      cp "$env_file" "$worktree_root/frontend/$filename"
    done
  fi
fi

# Staleness-gated npm ci check for frontend/
lockfile="$worktree_root/frontend/package-lock.json"
package_manifest="$worktree_root/frontend/package.json"
install_marker="$worktree_root/frontend/node_modules/.package-lock.json"

if [ -f "$lockfile" ] && [ -f "$package_manifest" ]; then
  if [ ! -f "$install_marker" ] || [ "$lockfile" -nt "$install_marker" ] || [ "$package_manifest" -nt "$install_marker" ]; then
    echo "preflight-worktree: installing frontend dependencies with npm ci..."
    (cd "$worktree_root/frontend" && npm ci) || {
      echo "preflight-worktree: npm ci failed" >&2
      _preflight_cleanup
      return 1 2>/dev/null || exit 1
    }
  fi
fi

# --- #4 Git env ---
export GIT_EDITOR=true
export GIT_PAGER=cat
export GIT_TERMINAL_PROMPT=0

echo "preflight-worktree: ok ($current_branch)"

# Restore caller's options after successful completion
_preflight_cleanup
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/preflight-worktree.sh`

- [ ] **Step 3: Verify execution under dev branch (expected fail)**

Run:
```bash
git checkout dev 2>/dev/null || true
./scripts/preflight-worktree.sh
```
Expected: Script prints `preflight-worktree: current branch must not be dev/main` and exits with code 1.

- [ ] **Step 4: Verify execution under a test worktree branch (expected pass)**

Run:
```bash
git checkout -b test/preflight-test-branch 2>/dev/null || true
./scripts/preflight-worktree.sh
```
Expected: Script prints `preflight-worktree: ok (test/preflight-test-branch)` and exits with code 0. (If `node_modules` is stale or missing, it will install dependencies first.)

- [ ] **Step 5: Clean up test branch and commit**

Run:
```bash
git checkout - 2>/dev/null || true
git branch -d test/preflight-test-branch 2>/dev/null || true
git add scripts/preflight-worktree.sh
git commit -m "feat: add scripts/preflight-worktree.sh for automated worktree preflight guards"
```
