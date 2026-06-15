# workflow.sh 重構 Implementation Plan (#271)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 easyorder 的 589 行單體 `workflow.sh` 拆分為 3 檔案（workflow-lib.sh + workflow.sh + deploy.sh），對齊 payroll #376/#378 重構架構，並實現 per-test 獨立 log 持久化 + t6 summary report。

**Architecture:** 三檔職責分離 — `workflow-lib.sh` 共用基礎設施（config/colors/error/gcloud+firebase switch）、`workflow.sh` 測試入口（t1-t7 + e2e + TDD single-file）、`deploy.sh` 開發/部署入口（d1-d3 dev server + p1-p5 production deploy）。每個 test step 寫獨立 log 檔（t1_latest.log ~ t5_latest.log），t6 跑完全部再印 summary report。

**Tech Stack:** Bash, Firebase CLI, Vite, Vitest, Playwright

**Refs:** GH issue [#271](https://github.com/cheerc/talented-easyorder/issues/271) / payroll [PR #376](https://github.com/cheerc/talented-payroll/pull/376) / payroll [PR #378](https://github.com/cheerc/talented-payroll/pull/378)

---

```yaml
required_reads:
  - workflow.sh                          # 現行 589 行單體腳本（全部內容）
  - /Users/cheerc/talented-payroll/workflow-lib.sh   # payroll 共用基礎設施參考
  - /Users/cheerc/talented-payroll/workflow.sh       # payroll test-only 參考（t7 summary 模式）
  - /Users/cheerc/talented-payroll/deploy.sh         # payroll deploy 參考
```

## File Structure（重構後）

| 檔案 | 職責 | 來源行範圍（現 workflow.sh） |
|------|------|---------------------------|
| `workflow-lib.sh` | 共用：config vars, colors, error handling, gcloud/firebase switch | L1-88 |
| `workflow.sh` | 測試入口：t1-t7, e2e, t4-file, t5-file, interactive menu(test) | L271-425, L537-561(CLI router test部分), L564-589(interactive test部分) |
| `deploy.sh` | Dev server + Deploy：d1-d3, p1-p5, merge_firestore_rules, interactive menu(deploy) | L90-147, L183-269, L427-535, CLI/interactive deploy部分 |

---

### Task 1: 建立 `workflow-lib.sh`（共用基礎設施）

**Files:**
- Create: `workflow-lib.sh`
- Modify: (無 — 此 task 只新建)

> 從現行 `workflow.sh` 提取共用部分。**不含** `merge_firestore_rules()`（那屬 deploy 專用，放 deploy.sh）。

- [ ] **Step 1: 建立 `workflow-lib.sh`**

```bash
#!/bin/bash

# EasyOrder POS - 共用基礎設施 (from v1.0 Split)
# 本檔案被 workflow.sh 和 deploy.sh source，不可直接執行。

set -o pipefail

# --- 載入環境變數 ---
source .env 2>/dev/null || true

# --- 設定變數 ---
FIREBASE_PROJECT="gen-lang-client-0613258198"
FIREBASE_USER="cheerc@gmail.com"
GCLOUD_USER="cheerc@talented.com.tw"
PAYROLL_DIR="$HOME/talented-payroll"
FRONTEND_DIR="./frontend"

INTERACTIVE=true

# --- 顏色定義 ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- 錯誤處理 ---
handle_error() {
    local step_name="$1"
    local log_file="${2:-}"
    echo -e "${RED}❌ $step_name 失敗！${NC}"
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo -e "${YELLOW}--- Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$log_file"
        echo -e "${YELLOW}--------------------------------------${NC}"
    fi
    return 1
}

pause() {
    if [ "$INTERACTIVE" = true ]; then
        read -p "按 Enter 返回..."
    fi
}

# --- gcloud 切換 ---
check_and_switch_gcloud() {
    local target_email="$1"
    if ! command -v gcloud &> /dev/null; then
        return 0
    fi
    local current_account=$(gcloud config get-value account 2>/dev/null)
    if [[ "$current_account" == "$target_email" ]]; then
        echo -e "${GREEN}✅ gcloud: $target_email${NC}"
        return 0
    fi
    echo -e "${CYAN}🔄 切換 gcloud → $target_email${NC}"
    gcloud config set account "$target_email" > /dev/null 2>&1
}

# --- Firebase 切換 ---
check_and_switch_firebase() {
    check_and_switch_gcloud "$GCLOUD_USER"

    echo -e "${CYAN}🔍 檢查 Firebase 帳號: $FIREBASE_USER${NC}"
    local login_list=$(firebase login:list 2>&1)

    if echo "$login_list" | grep -q "No authorized accounts"; then
        echo -e "${RED}❌ Firebase 未登入，執行 firebase login${NC}"
        firebase login
    fi

    local current_active=$(echo "$login_list" | grep -E "[✔*>]" | awk '{for(i=1;i<=NF;i++) if($i ~ /@/) print $i}' | tr -d '() ' | head -n 1)
    if [[ "$current_active" != "$FIREBASE_USER" ]]; then
        firebase login:use "$FIREBASE_USER" > /dev/null 2>&1
    fi

    if ! firebase projects:list > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  憑證過期，重新驗證...${NC}"
        firebase login --reauth
        firebase login:use "$FIREBASE_USER" > /dev/null 2>&1
    fi

    echo -e "${GREEN}✅ Firebase 帳號就緒 [$FIREBASE_USER]${NC}"
}
```

- [ ] **Step 2: 驗證 `bash -n workflow-lib.sh`**

Run: `bash -n workflow-lib.sh`
Expected: 無輸出（語法正確）

- [ ] **Step 3: 設定可執行權限**

```bash
chmod +x workflow-lib.sh
```

- [ ] **Step 4: Commit**

```bash
git add workflow-lib.sh
git commit -m "refactor: extract workflow-lib.sh shared infrastructure (#271)

Phase 1/3 of workflow.sh split — config, colors, error handling,
gcloud/firebase switching moved to shared lib."
```

---

### Task 2: 建立 `deploy.sh`（Dev Server + Production Deploy）

**Files:**
- Create: `deploy.sh`

> 包含 d1-d3（dev server）、p1-p5（production deploy）、`merge_firestore_rules()`（easyorder 獨有），以及 deploy 部分的 interactive menu 和 CLI router。

- [ ] **Step 1: 建立 `deploy.sh`**

```bash
#!/bin/bash

# EasyOrder POS - 開發與部署腳本 (from v1.0 Split)
# 用法: ./deploy.sh [d1-d3|p1-p5]
# Dev server (d1-d3) + Production deploy (p1-p5)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workflow-lib.sh"

# --- Firestore Rules 合併 (payroll + easyorder) ---
merge_firestore_rules() {
    # 完整移植現行 workflow.sh L91-147 的 merge_firestore_rules()
    # （含 python3 extract_inner 邏輯，不做任何修改）
    ...保持與現行完全一致...
}

# --- Development ---
start_emulators() {
    # 完整移植現行 workflow.sh L184-191
    ...保持與現行完全一致...
}

dev_with_emulators() {
    # 完整移植現行 workflow.sh L193-247
    ...保持與現行完全一致...
}

dev_prod() {
    # 完整移植現行 workflow.sh L249-269
    ...保持與現行完全一致...
}

# --- Production ---
confirm_prod() {
    # 完整移植現行 workflow.sh L428-438
    ...保持與現行完全一致...
}

deploy_frontend() {
    # 完整移植現行 workflow.sh L440-463
    ...保持與現行完全一致...
}

deploy_rules() {
    # 完整移植現行 workflow.sh L465-492
    ...保持與現行完全一致...
}

deploy_indexes() {
    # 完整移植現行 workflow.sh L494-505
    ...保持與現行完全一致...
}

deploy_all() {
    # 完整移植現行 workflow.sh L507-513
    ...保持與現行完全一致...
}

deploy_full_stack() {
    # 完整移植現行 workflow.sh L515-535
    # ⚠️ 注意：此函式呼叫 run_build_test/run_typecheck/run_lint/run_unit_tests
    # 重構後需改為 source workflow.sh 或直接呼叫 ./workflow.sh t1-t4
    # 建議改為：
    echo -e "${YELLOW}🚀 [p5] Full Stack (Test → Build → Deploy)...${NC}"
    echo ""
    ./workflow.sh t1 || return 1
    ./workflow.sh t2 || return 1
    ./workflow.sh t3 || return 1
    ./workflow.sh t4 || return 1
    echo ""
    echo -e "${GREEN}✅ Tests passed, starting deployment...${NC}"
    echo ""
    deploy_frontend || return 1
    deploy_rules || return 1
    deploy_indexes || return 1
    echo ""
    echo -e "${GREEN}🎉 FULL STACK DEPLOYMENT COMPLETE!${NC}"
    pause
}

# --- Interactive Menu ---
show_deploy_menu() {
    clear
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   🍜  EasyOrder POS Deploy (v1.0)  🍜${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}══════ 🟢 Development (d1-d3) ══════${NC}"
    echo -e "d1) 啟動 Firebase Emulators (Auth + Firestore)"
    echo -e "d2) Dev Server + Emulators (本地全套)"
    echo -e "d3) Dev Server (連接 Prod Firebase)"
    echo ""
    echo -e "${RED}══════ 🔴 Production (p1-p5) ══════${NC}"
    echo -e "p1) Deploy Frontend (Vercel) ${CYAN}[需 Vercel CLI]${NC}"
    echo -e "p2) Deploy Firestore Rules ${CYAN}[合併 payroll + easyorder]${NC}"
    echo -e "p3) Deploy Firestore Indexes ${CYAN}[需 $FIREBASE_USER]${NC}"
    echo -e "p4) Deploy All (p1+p2+p3)"
    echo -e "p5) Full Stack (Test → Build → Deploy All)"
    echo ""
    echo -e "q) 離開"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
}

# --- CLI Argument Handling ---
if [ -n "$1" ]; then
    INTERACTIVE=false
    case "$1" in
        d1) INTERACTIVE=true; start_emulators ;;
        d2) INTERACTIVE=true; dev_with_emulators ;;
        d3) INTERACTIVE=true; dev_prod ;;
        p1) deploy_frontend ;;
        p2) INTERACTIVE=true; deploy_rules ;;
        p3) INTERACTIVE=true; deploy_indexes ;;
        p4) INTERACTIVE=true; deploy_all ;;
        p5) INTERACTIVE=true; deploy_full_stack ;;
        *) echo -e "${RED}❌ 無效參數: $1${NC}"; echo "用法: ./deploy.sh [d1-d3|p1-p5]"; exit 1 ;;
    esac
    exit $?
fi

# --- Interactive Loop ---
while true; do
    show_deploy_menu
    read -p "請輸入選項: " choice
    case $choice in
        d1) start_emulators ;;
        d2) dev_with_emulators ;;
        d3) dev_prod ;;
        p1) deploy_frontend ;;
        p2) deploy_rules ;;
        p3) deploy_indexes ;;
        p4) deploy_all ;;
        p5) deploy_full_stack ;;
        q) exit 0 ;;
        *) echo -e "${RED}無效選項${NC}"; sleep 1 ;;
    esac
done
```

- [ ] **Step 2: 驗證 `bash -n deploy.sh`**

Run: `bash -n deploy.sh`
Expected: 無輸出（語法正確）

- [ ] **Step 3: 設定可執行權限**

```bash
chmod +x deploy.sh
```

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "refactor: extract deploy.sh for dev/deploy operations (#271)

Phase 1/3 — dev server (d1-d3) + production deploy (p1-p5) +
merge_firestore_rules() moved to dedicated file."
```

---

### Task 3: 重寫 `workflow.sh`（測試專用 + Log 持久化 + t6 Summary）

**Files:**
- Modify: `workflow.sh`（完全重寫為 test-only 入口）

> 這是核心 task，包含 Phase 1（拆檔）+ Phase 2（log 持久化 + t6 summary）兩者的 workflow.sh 部分。

- [ ] **Step 1: 重寫 `workflow.sh` — source lib + per-test log + summary**

```bash
#!/bin/bash

# EasyOrder POS - 測試腳本 (from v1.0 Split)
# 用法: ./workflow.sh [t1-t7|e2e|t4-file|t5-file]
# Testing only — dev server/deploy moved to deploy.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workflow-lib.sh"

# --- Per-test log files (persistent, not overwritten between steps) ---
T1_LOG="t1_latest.log"
T2_LOG="t2_latest.log"
T3_LOG="t3_latest.log"
T4_LOG="t4_latest.log"
T5_LOG="t5_latest.log"
E2E_LOG="e2e_latest.log"

# --- Individual test functions ---

run_t1() {
    echo -e "${CYAN}🏗️  [t1] Build Test...${NC}"
    (cd "$FRONTEND_DIR" && npm run build) > "$T1_LOG" 2>&1
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "${YELLOW}--- Build Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$T1_LOG"
        echo -e "${YELLOW}--------------------------------------------${NC}"
        echo -e "${RED}❌ t1 Build Test Failed${NC} → $T1_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ t1 Build Test Passed${NC} → $T1_LOG"
}

run_t2() {
    echo -e "${CYAN}🔍 [t2] Type Check...${NC}"
    (cd "$FRONTEND_DIR" && npx tsc --noEmit) > "$T2_LOG" 2>&1
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "${YELLOW}--- Type Check Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$T2_LOG"
        echo -e "${YELLOW}-------------------------------------------------${NC}"
        echo -e "${RED}❌ t2 Type Check Failed${NC} → $T2_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ t2 Type Check Passed${NC} → $T2_LOG"
}

run_t3() {
    echo -e "${CYAN}🧹 [t3] Lint...${NC}"
    (cd "$FRONTEND_DIR" && npm run lint) > "$T3_LOG" 2>&1
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "${YELLOW}--- Lint Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$T3_LOG"
        echo -e "${YELLOW}-------------------------------------------${NC}"
        echo -e "${RED}❌ t3 Lint Failed${NC} → $T3_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ t3 Lint Passed${NC} → $T3_LOG"
}

run_t4() {
    echo -e "${CYAN}🧪 [t4] Unit Tests...${NC}"
    (cd "$FRONTEND_DIR" && npx vitest --run --exclude '**/firestoreRules.spec.ts') > "$T4_LOG" 2>&1
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "${YELLOW}--- Unit Test Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$T4_LOG"
        echo -e "${YELLOW}------------------------------------------------${NC}"
        echo -e "${RED}❌ t4 Unit Tests Failed${NC} → $T4_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ t4 Unit Tests Passed${NC} → $T4_LOG"
    tail -n 5 "$T4_LOG"
}

run_t5() {
    echo -e "${CYAN}🔥 [t5] Integration Tests (Firestore Rules)...${NC}"

    # Kill any existing emulator on those ports
    lsof -t -i :8080 -i :9099 | xargs kill -9 2>/dev/null || true
    sleep 1

    # Start emulators in background
    firebase emulators:start --project "$FIREBASE_PROJECT" &
    local emu_pid=$!

    # Wait for emulator
    local retries=0
    while ! curl -s http://localhost:8080 > /dev/null 2>&1; do
        sleep 1
        retries=$((retries + 1))
        if [ $retries -gt 30 ]; then
            echo -e "${RED}❌ Emulator 啟動超時${NC}"
            kill $emu_pid 2>/dev/null
            return 1
        fi
    done

    # Run rules tests
    (cd "$FRONTEND_DIR" && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest --run src/firebase/__tests__/firestoreRules.spec.ts) > "$T5_LOG" 2>&1
    local test_status=$?

    # Cleanup emulator
    kill $emu_pid 2>/dev/null
    wait $emu_pid 2>/dev/null

    if [ $test_status -ne 0 ]; then
        echo -e "${YELLOW}--- Integration Test Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$T5_LOG"
        echo -e "${YELLOW}------------------------------------------------------${NC}"
        echo -e "${RED}❌ t5 Integration Tests Failed${NC} → $T5_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ t5 Integration Tests Passed${NC} → $T5_LOG"
    tail -n 5 "$T5_LOG"
}

# --- t6: Full CI — run all, don't stop on failure, summary report ---

run_t6() {
    local labels=("t1 Build Test" "t2 Type Check" "t3 Lint" "t4 Unit Tests" "t5 Integration Tests")
    local logs=("$T1_LOG" "$T2_LOG" "$T3_LOG" "$T4_LOG" "$T5_LOG")
    local funcs=(run_t1 run_t2 run_t3 run_t4 run_t5)
    local total=${#funcs[@]}
    local passed=0
    local failed=0
    local results=()

    for i in "${!funcs[@]}"; do
        echo ""
        ${funcs[$i]}
        if [ $? -eq 0 ]; then
            results+=("PASS")
            ((passed++))
        else
            results+=("FAIL")
            ((failed++))
        fi
    done

    # Print summary table
    echo ""
    echo -e "${BLUE}═══════ Test Summary (t6 Full CI) ═══════${NC}"
    for i in "${!labels[@]}"; do
        if [ "${results[$i]}" = "PASS" ]; then
            echo -e "  ${GREEN}✅${NC} ${labels[$i]}  ${GREEN}PASS${NC}"
        else
            echo -e "  ${RED}❌${NC} ${labels[$i]}  ${RED}FAIL${NC} → ${logs[$i]}"
        fi
    done
    echo -e "${BLUE}═════════════════════════════════════════${NC}"
    echo -e "  Result: ${passed}/${total} passed, ${failed}/${total} failed"
    echo ""

    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}🎉 All Tests Passed!${NC}"
        return 0
    else
        echo -e "${RED}⚠️  Some tests failed. Check logs above.${NC}"
        return 1
    fi
}

# --- t7: Preview ---

run_t7() {
    echo -e "${CYAN}👁️  [t7] Preview (Build + Serve)...${NC}"
    (cd "$FRONTEND_DIR" && npm run build) > "$T1_LOG" 2>&1
    if [ $? -ne 0 ]; then
        handle_error "Build" "$T1_LOG" || return 1
    fi
    echo -e "${GREEN}✅ Build 完成，啟動 Preview Server...${NC}"
    (cd "$FRONTEND_DIR" && npm run preview)
}

# --- E2E ---

run_e2e() {
    echo -e "${CYAN}🎭 E2E Tests (Playwright + Firebase Emulator)...${NC}"
    lsof -t -i :8080 -i :9099 | xargs kill -9 2>/dev/null || true
    sleep 1
    (cd "$FRONTEND_DIR" && npm run test:e2e) > "$E2E_LOG" 2>&1
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "${YELLOW}--- E2E Error Details (Last 80 lines) ---${NC}"
        tail -n 80 "$E2E_LOG"
        echo -e "${YELLOW}------------------------------------------${NC}"
        echo -e "${RED}❌ E2E Tests Failed${NC} → $E2E_LOG"
        return 1
    fi
    echo -e "${GREEN}✅ E2E Tests Passed${NC} → $E2E_LOG"
    tail -n 5 "$E2E_LOG"
}

# --- Targeted single-file (TDD 迭代用) ---

run_unit_file() {
    local file="$1"
    if [ -z "$file" ]; then
        echo -e "${RED}❌ 用法: ./workflow.sh t4-file <FILE_PATH（相對 frontend/）>${NC}"
        return 1
    fi
    INTERACTIVE=false
    echo -e "${CYAN}🧪 [t4-file] Unit Single File: $file${NC}"
    local rel="${file#frontend/}"
    (cd "$FRONTEND_DIR" && npx vitest --run "$rel")
}

run_integration_file() {
    local file="$1"
    if [ -z "$file" ]; then
        echo -e "${RED}❌ 用法: ./workflow.sh t5-file <FILE_PATH（相對 frontend/）>${NC}"
        return 1
    fi
    INTERACTIVE=false
    echo -e "${CYAN}🔥 [t5-file] Integration Single File: $file${NC}"
    lsof -t -i :8080 -i :9099 | xargs kill -9 2>/dev/null || true
    sleep 1
    firebase emulators:start --project "$FIREBASE_PROJECT" &
    local emu_pid=$!
    local retries=0
    while ! curl -s http://localhost:8080 > /dev/null 2>&1; do
        sleep 1
        retries=$((retries + 1))
        if [ $retries -gt 30 ]; then
            echo -e "${RED}❌ Emulator 啟動超時${NC}"
            kill $emu_pid 2>/dev/null
            return 1
        fi
    done
    local rel="${file#frontend/}"
    (cd "$FRONTEND_DIR" && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest --run "$rel")
    local test_status=$?
    kill $emu_pid 2>/dev/null
    wait $emu_pid 2>/dev/null
    return $test_status
}

# --- Interactive Menu ---

show_test_menu() {
    clear
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   🍜  EasyOrder POS Testing (v1.0)  🍜${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}══════ 🧪 Testing (t1-t7) ══════${NC}"
    echo -e "t1) Build Test (vite build)"
    echo -e "t2) Type Check (tsc --noEmit)"
    echo -e "t3) Lint (eslint)"
    echo -e "t4) Unit Tests (vitest)"
    echo -e "t5) Integration Tests (Firestore Rules + Emulator)"
    echo -e "t6) Full CI (t1-t5, no-stop + summary)"
    echo -e "t7) Preview (Build + Local Serve)"
    echo -e "e2e) E2E Tests (Playwright + Firebase Emulator)"
    echo ""
    echo -e "q) 離開"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
}

# --- CLI Argument Handling ---
if [ -n "$1" ]; then
    INTERACTIVE=false
    case "$1" in
        t1) run_t1 ;;
        t2) run_t2 ;;
        t3) run_t3 ;;
        t4) run_t4 ;;
        t5) run_t5 ;;
        t4-file) run_unit_file "$2" ;;
        t5-file) run_integration_file "$2" ;;
        t6) run_t6 ;;
        t7) INTERACTIVE=true; run_t7 ;;
        e2e) run_e2e ;;
        *) echo -e "${RED}❌ 無效參數: $1${NC}"; echo "用法: ./workflow.sh [t1-t7|e2e|t4-file|t5-file]"; exit 1 ;;
    esac
    exit $?
fi

# --- Interactive Loop ---
while true; do
    show_test_menu
    read -p "請輸入選項: " choice
    case $choice in
        t1) run_t1 ;;
        t2) run_t2 ;;
        t3) run_t3 ;;
        t4) run_t4 ;;
        t5) run_t5 ;;
        t6) run_t6 ;;
        t7) run_t7 ;;
        e2e) run_e2e ;;
        q) exit 0 ;;
        *) echo -e "${RED}無效選項${NC}"; sleep 1 ;;
    esac
    pause
done
```

- [ ] **Step 2: 驗證 `bash -n workflow.sh`**

Run: `bash -n workflow.sh`
Expected: 無輸出（語法正確）

- [ ] **Step 3: 驗證所有三檔語法**

Run: `bash -n workflow-lib.sh && bash -n workflow.sh && bash -n deploy.sh && echo "All OK"`
Expected: `All OK`

- [ ] **Step 4: Commit**

```bash
git add workflow.sh
git commit -m "refactor: rewrite workflow.sh as test-only + per-test logs + t6 summary (#271)

Phase 2+3/3 — workflow.sh now sources workflow-lib.sh, each test
step writes to its own persistent log file (t1_latest.log through
t5_latest.log + e2e_latest.log), and t6 Full CI runs all steps
without stopping, printing a summary report at the end.

deploy/dev functions moved to deploy.sh."
```

---

### Task 4: 功能驗證

- [ ] **Step 1: 驗證 `./workflow.sh t1` 正常執行**

Run: `./workflow.sh t1`
Expected: Build 成功 + `t1_latest.log` 產生

- [ ] **Step 2: 驗證 `./workflow.sh t2` 正常執行**

Run: `./workflow.sh t2`
Expected: Type check 成功 + `t2_latest.log` 產生

- [ ] **Step 3: 驗證 log 持久化**

Run: `ls -la t1_latest.log t2_latest.log`
Expected: 兩個 log 檔存在且有內容

- [ ] **Step 4: 驗證 `./deploy.sh d1` 可啟動**

Run: `./deploy.sh d1`
Expected: Firebase Emulators 啟動（手動 Ctrl+C 停止）

- [ ] **Step 5: 驗證 `bash -n` 三檔皆通過**

Run: `bash -n workflow-lib.sh && bash -n workflow.sh && bash -n deploy.sh && echo "All syntax OK"`
Expected: `All syntax OK`

---

## Key Design Decisions

1. **`handle_error()` 改為接受 log_file 參數**：不再依賴全域 `$TEMP_LOG`，每個 test function 傳入自己的 log 檔路徑。`$TEMP_LOG` 全域變數從 lib 中移除。

2. **`deploy_full_stack()` 的 test 呼叫改為 `./workflow.sh t1`-`t4`**：避免 deploy.sh 需要 source workflow.sh 造成循環依賴。使用子進程方式乾淨分離。

3. **t6 summary 對齊 payroll t7 模式**：使用 array 存 labels/logs/funcs/results，跑完全部再印表格。

4. **e2e 維持現狀**：獨立 `e2e` 指令，不納入 t* 序列（issue #271 Phase 3 建議維持）。但新增 `E2E_LOG="e2e_latest.log"` 持久 log。

5. **`$TEMP_LOG` 移除**：不再使用共享 temp log。每個 test 有獨立 log，deploy 相關函式（`deploy_frontend` 等）可考慮也用獨立 log 但 issue 未要求，保持現行 `$TEMP_LOG` 在 deploy.sh 內部（若 deploy 函式仍用 `$TEMP_LOG`，在 deploy.sh 頂部定義 `TEMP_LOG=".temp_workflow.log"` 即可）。

6. **不引入 `--source-only`、worktree env self-heal**：issue #271 明確標註暫不引入。

## Acceptance Criteria Mapping

| Criteria | Task |
|----------|------|
| workflow.sh 拆成 3 檔 | Task 1-3 |
| t1-t5 各有獨立持久 log | Task 3 (per-test log vars + 各 run_tN 函式) |
| t6 不中斷 + summary report | Task 3 (run_t6 函式) |
| `bash -n` 三檔皆通過 | Task 4 Step 5 |
| `./workflow.sh t1`, `./workflow.sh t2` 正常執行 | Task 4 Step 1-2 |
| `./deploy.sh d1` 正常執行 | Task 4 Step 4 |
| e2e 行為不變 | Task 3 (run_e2e 函式保持現行邏輯) |
