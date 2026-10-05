#!/usr/bin/env bash
# ==============================================================================
# DocuShift - دستور جامع یافتن خودکار پوشه پروژه، فچ، آپدیت و راه‌اندازی سرور
# ==============================================================================
set -e

echo "🔍 در حال جستجو و مکان‌یابی پوشه پروژه DocuShift روی سرور..."

PROJECT_DIR=""

# ۱. بررسی مسیر جاری
if [ -f "server.ts" ] && [ -f "package.json" ]; then
  PROJECT_DIR=$(pwd)
fi

# ۲. استعلام از پروسه‌های فعال PM2
if [ -z "$PROJECT_DIR" ]; then
  PM2_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -n "$PM2_DIR" ] && [ -f "$PM2_DIR/server.ts" ]; then
    PROJECT_DIR="$PM2_DIR"
  fi
fi

# ۳. استعلام از پروسه نود فعال (pwdx بر اساس server.ts)
if [ -z "$PROJECT_DIR" ]; then
  NODE_PID=$(pgrep -f "server.ts" 2>/dev/null | head -n1)
  if [ -n "$NODE_PID" ]; then
    PWDX_DIR=$(pwdx "$NODE_PID" 2>/dev/null | awk '{print $2}')
    if [ -n "$PWDX_DIR" ] && [ -f "$PWDX_DIR/server.ts" ]; then
      PROJECT_DIR="$PWDX_DIR"
    fi
  fi
fi

# ۴. جستجوی عمیق در پوشه‌های رایج سرورهای لینوکس (/var/www, /home, /root, /opt, /srv)
if [ -z "$PROJECT_DIR" ]; then
  SEARCH_CANDIDATES=$(find /var/www /home /root /opt /srv -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null)
  for c in $SEARCH_CANDIDATES; do
    d=$(dirname "$c")
    if [ -f "$d/package.json" ]; then
      PROJECT_DIR="$d"
      break
    fi
  done
fi

# ۵. آخرین شانس جستجو در ریشه دیسک
if [ -z "$PROJECT_DIR" ]; then
  ROOT_CANDIDATE=$(find / -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1)
  if [ -n "$ROOT_CANDIDATE" ]; then
    PROJECT_DIR=$(dirname "$ROOT_CANDIDATE")
  fi
fi

if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ خطا: پوشه پروژه پیدا نشد! لطفا دستی با دستور cd وارد مسیر پروژه شوید."
  exit 1
fi

echo "✅ پوشه پروژه با موفقیت پیدا شد: $PROJECT_DIR"
cd "$PROJECT_DIR"

# اطمینان از دسترسی اجرایی به اسکریپت به‌روزرسانی
if [ -f "update_vps.sh" ]; then
  chmod +x update_vps.sh
  ./update_vps.sh
else
  echo "--> دریافت آخرین تغییرات با git fetch..."
  git stash --include-untracked 2>/dev/null || true
  git fetch --all --tags --prune
  ACTIVE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  [ "$ACTIVE_BRANCH" = "HEAD" ] && ACTIVE_BRANCH="main"
  git pull origin "$ACTIVE_BRANCH" 2>/dev/null || git reset --hard "origin/$ACTIVE_BRANCH"
  npm install --legacy-peer-deps
  npm run build
  pm2 restart docushift --update-env 2>/dev/null || pm2 restart all 2>/dev/null || pm2 start "npx tsx server.ts" --name docushift
  pm2 save
fi
