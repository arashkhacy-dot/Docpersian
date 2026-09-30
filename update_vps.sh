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
echo "--> ۱. دریافت آخرین تغییرات از گیت‌هاب (git pull)..."
git pull origin main || git pull

# ۲. دانلود فونت وزیرمتن در صورت عدم وجود
if [ ! -f "server/assets/fonts/persian-font.ttf" ]; then
  echo "--> ۲. بررسی و دانلود فونت وزیرمتن..."
  mkdir -p server/assets/fonts
  curl -sL https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Regular.ttf -o server/assets/fonts/persian-font.ttf || true
fi

# ۳. نصب پکیج‌های جدید احتمالی
echo "--> ۳. نصب و به‌روزرسانی وابستگی‌ها (npm install)..."
npm install

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
