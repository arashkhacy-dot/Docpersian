#!/usr/bin/env bash
set -e

# Auto-detect project directory if not currently inside it
if [ ! -f "server.ts" ] && [ ! -f "package.json" ]; then
  echo "--> در حال پیدا کردن پوشه پروژه روی سرور..."
  TARGET_DIR=$(pwdx $(pgrep -f "server.ts" | head -n1) 2>/dev/null | awk '{print $2}')
  if [ -z "$TARGET_DIR" ] || [ ! -f "$TARGET_DIR/server.ts" ]; then
    TARGET_DIR=$(find / -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1 | xargs dirname)
  fi
  if [ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ]; then
    echo "--> ورود به پوشه پروژه: $TARGET_DIR"
    cd "$TARGET_DIR"
  else
    echo "خطا: پوشه پروژه پیدا نشد! لطفا ابتدا با دستور cd وارد پوشه پروژه شوید."
    exit 1
  fi
fi

echo "========================================="
echo "  DocuShift - به‌روزرسانی سرور از گیت‌هاب"
echo "========================================="

# ۱. دریافت آخرین تغییرات از گیت‌هاب
echo "--> ۱. دریافت آخرین تغییرات از گیت‌هاب (git fetch & reset)..."
git fetch --all 2>/dev/null || git fetch origin main 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || git pull origin main || git pull

# ۲. اطمینان از نصب فونت‌های استاندارد فارسی در اوبونتو (بدون فیلتر)
echo "--> ۲. نصب و بررسی فونت‌های رسمی فارسی (Noto Sans Arabic)..."
sudo apt-get update -qq 2>/dev/null || true
sudo apt-get install -y -qq fonts-noto-core fonts-noto-extra fonts-sil-scheherazade 2>/dev/null || true

# بررسی و دانلود فونت وزیرمتن در صورت نیاز
mkdir -p server/assets/fonts
if [ ! -s "server/assets/fonts/persian-font.ttf" ] || [ $(wc -c < "server/assets/fonts/persian-font.ttf" 2>/dev/null || echo 0) -lt 20000 ]; then
  echo "--> دانلود فونت وزیرمتن از شبکه CDN..."
  curl -sL "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || true
fi

# ۳. نصب و به‌روزرسانی وابستگی‌ها
echo "--> ۳. نصب پکیج‌ها (npm install)..."
npm install --legacy-peer-deps

# ۴. بیلد مجدد فرانت‌اند
echo "--> ۴. کامپایل و ساخت فرانت‌اند (npm run build)..."
npm run build

# ۵. ری‌استارت سرویس PM2
echo "--> ۵. راه‌اندازی مجدد سرور (PM2 restart)..."
pm2 restart docushift || pm2 start "npx tsx server.ts" --name docushift
pm2 save

echo ""
echo "============================================================"
echo "  ✅ به‌روزرسانی سرور با موفقیت کامل انجام شد!"
echo "============================================================"
pm2 status docushift 2>/dev/null || pm2 status || true
