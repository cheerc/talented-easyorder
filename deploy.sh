#!/bin/bash

# EasyOrder POS - 開發與部署腳本 (from v1.0 Split)
# 用法: ./deploy.sh [d1-d3|p1-p5]
# Dev server (d1-d3) + Production deploy (p1-p5)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workflow-lib.sh"

# --- Deploy-local temp log (deploy 函式仍用共用 temp log) ---
TEMP_LOG=".temp_workflow.log"

# --- Firestore Rules 合併 (payroll + easyorder) ---
merge_firestore_rules() {
    local payroll_rules="$PAYROLL_DIR/firestore.rules"
    local easyorder_rules="./firestore.rules"
    local merged_rules=".firestore.rules.merged"

    if [ ! -f "$payroll_rules" ]; then
        echo -e "${RED}❌ 找不到 $payroll_rules，無法合併 rules${NC}"
        return 1
    fi

    python3 -c "
import sys, re

def extract_inner(path):
    with open(path) as f:
        content = f.read()
    # Strip template vars like {database} so they don't affect brace counting
    cleaned = re.sub(r'\\{[a-zA-Z_]+\\}', 'X', content)
    lines = cleaned.split('\n')
    orig_lines = content.split('\n')
    depth = 0
    start = None
    end = None
    for i, line in enumerate(lines):
        depth += line.count('{') - line.count('}')
        if start is None and depth >= 2:
            start = i + 1
        if start is not None and depth < 2:
            end = i
            break
    if start and end:
        return '\n'.join(orig_lines[start:end])
    return ''

payroll = extract_inner(sys.argv[1])
easyorder = extract_inner(sys.argv[2])
output = sys.argv[3]

merged = (
    \"rules_version = '2';\n\"
    'service cloud.firestore {\n'
    '  match /databases/{database}/documents {\n\n'
    '    // Payroll Rules\n'
    + payroll + '\n\n'
    '    // EasyOrder Rules\n'
    + easyorder + '\n'
    '  }\n'
    '}\n'
)

with open(output, 'w') as f:
    f.write(merged)
print(f'Merged: {len(payroll.splitlines())} payroll + {len(easyorder.splitlines())} easyorder lines')
" "$payroll_rules" "$easyorder_rules" "$merged_rules" || return 1

    echo -e "${GREEN}✅ 已產生合併 rules: $merged_rules${NC}"
}

# --- Development ---
start_emulators() {
    echo -e "${GREEN}🔥 啟動 Firebase Emulators...${NC}"
    echo -e "${CYAN}   Auth: http://localhost:9099${NC}"
    echo -e "${CYAN}   Firestore: http://localhost:8080${NC}"
    echo -e "${CYAN}   UI: http://localhost:4000${NC}"
    echo ""
    firebase emulators:start --project "$FIREBASE_PROJECT"
}

dev_with_emulators() {
    echo -e "${GREEN}🚀 啟動 Dev Server + Emulators...${NC}"

    # Start emulators in background
    firebase emulators:start --project "$FIREBASE_PROJECT" &
    local emu_pid=$!

    # Wait for emulator to be ready
    echo -e "${CYAN}⏳ 等待 Emulator 就緒...${NC}"
    local retries=0
    while ! curl -s http://localhost:4000 > /dev/null 2>&1; do
        sleep 1
        retries=$((retries + 1))
        if [ $retries -gt 30 ]; then
            echo -e "${RED}❌ Emulator 啟動超時${NC}"
            kill $emu_pid 2>/dev/null
            return 1
        fi
    done

    echo -e "${GREEN}✅ Emulator 就緒，啟動 Dev Server...${NC}"

    # Create temp .env.local for emulator mode
    local env_file="$FRONTEND_DIR/.env.local"
    local env_backup=""
    if [ -f "$env_file" ]; then
        env_backup=$(mktemp)
        cp "$env_file" "$env_backup"
    fi

    cat > "$env_file" << EOF
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=$FIREBASE_PROJECT
VITE_FIREBASE_APP_ID=fake-app-id
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_STORAGE_BUCKET=$FIREBASE_PROJECT.appspot.com
VITE_FIREBASE_USE_EMULATOR=true
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1
VITE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
EOF

    (cd "$FRONTEND_DIR" && npm run dev)

    # Cleanup
    if [ -n "$env_backup" ]; then
        cp "$env_backup" "$env_file"
        rm "$env_backup"
    else
        rm -f "$env_file"
    fi
    kill $emu_pid 2>/dev/null
    wait $emu_pid 2>/dev/null
}

dev_prod() {
    echo -e "${YELLOW}⚠️  Dev Server 連接 Production Firebase${NC}"
    echo -e "${CYAN}   Project: $FIREBASE_PROJECT${NC}"

    local env_file="$FRONTEND_DIR/.env.local"
    if [ ! -f "$env_file" ]; then
        echo -e "${YELLOW}⚠️  $env_file 不存在，從 payroll 複製 Firebase config...${NC}"
        cat > "$env_file" << EOF
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY:-<your-firebase-api-key>}
VITE_FIREBASE_AUTH_DOMAIN=${FIREBASE_PROJECT}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT}
VITE_FIREBASE_APP_ID=1:704294644197:web:3c2d159fe167478d47e70c
VITE_FIREBASE_MESSAGING_SENDER_ID=704294644197
VITE_FIREBASE_STORAGE_BUCKET=${FIREBASE_PROJECT}.firebasestorage.app
VITE_FIREBASE_USE_EMULATOR=false
EOF
        echo -e "${GREEN}✅ 已建立 $env_file${NC}"
    fi

    (cd "$FRONTEND_DIR" && npm run dev)
}

# --- Production ---
confirm_prod() {
    if [ "$INTERACTIVE" = false ]; then
        return 0
    fi
    echo -e "${RED}🛑 即將操作正式環境 ($FIREBASE_PROJECT)${NC}"
    read -p "輸入 'yes' 確認: " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo -e "${RED}❌ 已取消${NC}"
        return 1
    fi
}

deploy_frontend() {
    echo -e "${YELLOW}🚀 [p1] Deploying Frontend to Vercel...${NC}"

    # Build first
    (cd "$FRONTEND_DIR" && npm run build) > "$TEMP_LOG" 2>&1
    if [ $? -ne 0 ]; then
        handle_error "Frontend Build" "$TEMP_LOG" || return 1
    fi

    # Deploy
    if [ -n "$VERCEL_TOKEN" ]; then
        vercel deploy --prod --token="$VERCEL_TOKEN"
    else
        vercel deploy --prod
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Frontend Deployed to Vercel!${NC}"
    else
        echo -e "${RED}❌ Vercel deploy 失敗${NC}"
        return 1
    fi
    pause
}

deploy_rules() {
    check_and_switch_firebase || return 1
    confirm_prod || return 1

    echo -e "${YELLOW}🚀 [p2] Deploying Firestore Rules...${NC}"
    echo -e "${YELLOW}⚠️  注意：此專案與 Payroll 共用 Firebase Project${NC}"
    echo -e "${CYAN}   將合併 payroll + easyorder rules 後部署${NC}"
    echo ""

    merge_firestore_rules || return 1

    # Swap rules file: backup original, deploy merged, restore
    cp ./firestore.rules ./firestore.rules.bak
    cp .firestore.rules.merged ./firestore.rules

    firebase deploy --only firestore:rules --project "$FIREBASE_PROJECT" > "$TEMP_LOG" 2>&1
    local deploy_status=$?

    # Restore original
    cp ./firestore.rules.bak ./firestore.rules
    rm -f ./firestore.rules.bak .firestore.rules.merged

    if [ $deploy_status -ne 0 ]; then
        handle_error "Firestore Rules Deploy" "$TEMP_LOG" || return 1
    fi
    echo -e "${GREEN}✅ Firestore Rules Deployed (merged payroll+easyorder)!${NC}"
    pause
}

deploy_indexes() {
    check_and_switch_firebase || return 1
    confirm_prod || return 1

    echo -e "${YELLOW}🚀 [p3] Deploying Firestore Indexes...${NC}"
    firebase deploy --only firestore:indexes --project "$FIREBASE_PROJECT" > "$TEMP_LOG" 2>&1
    if [ $? -ne 0 ]; then
        handle_error "Firestore Indexes Deploy" "$TEMP_LOG" || return 1
    fi
    echo -e "${GREEN}✅ Firestore Indexes Deployed!${NC}"
    pause
}

deploy_all() {
    echo -e "${YELLOW}🚀 [p4] Deploy All...${NC}"
    deploy_frontend || return 1
    deploy_rules || return 1
    deploy_indexes || return 1
    echo -e "${GREEN}🎉 All Deployments Complete!${NC}"
}

deploy_full_stack() {
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
