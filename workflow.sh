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
