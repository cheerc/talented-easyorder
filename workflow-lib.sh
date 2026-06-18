#!/bin/bash

# EasyOrder POS - 共用基礎設施 (from v1.0 Split)
# 本檔案被 workflow.sh 和 deploy.sh source，不可直接執行。

set -o pipefail

# --- 載入環境變數 ---
source .env 2>/dev/null || true

# --- 設定變數 ---
FIREBASE_PROJECT="${FIREBASE_PROJECT_ID:-demo-easyorder}"
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
