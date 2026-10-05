#!/usr/bin/env bash
set -e

# Auto-detect project directory if not currently inside it
if [ ! -f "server.ts" ] && [ ! -f "package.json" ]; then
  echo "--> در حال پیدا کردن پوشه پروژه روی سرور..."
  TARGET_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -z "$TARGET_DIR" ] || [ ! -f "$TARGET_DIR/server.ts" ]; then
    TARGET_DIR=$(pwdx $(pgrep -f "server.ts" | head -n1) 2>/dev/null | awk '{print $2}')
  fi
  if [ -z "$TARGET_DIR" ] || [ ! -f "$TARGET_DIR/server.ts" ]; then
    TARGET_DIR=$(find /root /home /var/www / -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1 | xargs dirname 2>/dev/null)
  fi
  if [ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ]; then
    echo "--> ورود به پوشه پروژه: $TARGET_DIR"
    cd "$TARGET_DIR"
  else
    echo "خطا: پوشه پروژه پیدا نشد! لطفا با دستور cd وارد پوشه پروژه شوید."
    exit 1
  fi
fi

echo "========================================="
echo "  DocuShift - به‌روزرسانی سرور از گیت‌هاب"
echo "========================================="

# ۱. دریافت آخرین تغییرات از گیت‌هاب
echo "--> ۱. دریافت آخرین تغییرات از گیت‌هاب (git fetch & reset)..."
git fetch --all --tags 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || git pull

# ۲. اطمینان از نصب ابزارهای پردازش اسناد اسکن‌شده و فونت‌های فارسی
echo "--> ۲. نصب ابزارهای بینایی و پردازش اسکن و دیاگرام (Ghostscript, Poppler & ImageMagick)..."
sudo apt-get update -qq 2>/dev/null || true
sudo apt-get install -y -qq ghostscript poppler-utils imagemagick fonts-noto-core fonts-noto-extra fonts-sil-scheherazade 2>/dev/null || true

# بررسی و دانلود فونت وزیرمتن در صورت نیاز
mkdir -p server/assets/fonts
if [ ! -s "server/assets/fonts/persian-font.ttf" ] || [ $(wc -c < "server/assets/fonts/persian-font.ttf" 2>/dev/null || echo 0) -lt 20000 ]; then
  echo "--> دانلود فونت وزیرمتن از شبکه CDN..."
  curl -sL --connect-timeout 8 "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://cdnjs.cloudflare.com/ajax/libs/vazirmatn/33.0.3/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://unpkg.com/vazirmatn@33.0.3/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || true
fi

# ۳. نصب و به‌روزرسانی وابستگی‌ها
echo "--> ۳. نصب پکیج‌ها (npm install)..."
npm install --legacy-peer-deps

# ۴. بیلد مجدد فرانت‌اند
echo "--> ۴. کامپایل و ساخت فرانت‌اند نهایی بدون رفرش (npm run build)..."
npm run build

# ۵. ری‌استارت سرویس PM2 در مد پروداکشن و دائمی‌سازی سرویس Ollama
echo "--> ۵. راه‌اندازی و دائمی‌سازی سرویس‌ها در مد Production (PM2 & Ollama)..."
systemctl enable ollama 2>/dev/null || true
systemctl start ollama 2>/dev/null || true

export NODE_ENV=production
pm2 restart docushift --update-env 2>/dev/null || NODE_ENV=production pm2 start "npx tsx server.ts" --name docushift
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "============================================================"
echo "  ✅ به‌روزرسانی سرور با موفقیت کامل انجام شد!"
echo "============================================================"
pm2 status docushift 2>/dev/null || pm2 status || true
systemctl is-active ollama 2>/dev/null && echo "  ✅ سرویس مدل محلی (Ollama) دائمی و فعال است." || true
