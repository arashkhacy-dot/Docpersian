#!/usr/bin/env bash
# ==============================================================================
# DocuShift - اسکریپت به‌روزرسانی جامع و مستقیم از گیت‌هاب روی VPS
# ==============================================================================
set -e

echo "=========================================================="
echo "🔍 گام ۱: مکان‌یابی پوشه فعال پروژه در سرور..."
echo "=========================================================="

TARGET_DIR=""

# ۱. استعلام از PM2 (دقیق‌ترین روش برای یافتن پوشه زنده سرور)
if command -v pm2 >/dev/null 2>&1; then
  PM2_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -n "$PM2_DIR" ] && [ -f "$PM2_DIR/server.ts" ]; then
    TARGET_DIR="$PM2_DIR"
    echo "  ✓ پوشه فعال از طریق PM2 شناسایی شد: $TARGET_DIR"
  fi
fi

# ۲. استعلام از پروسه نود در حال اجرا
if [ -z "$TARGET_DIR" ]; then
  NODE_PID=$(pgrep -f "server.ts" 2>/dev/null | head -n1)
  if [ -n "$NODE_PID" ]; then
    PWDX_DIR=$(pwdx "$NODE_PID" 2>/dev/null | awk '{print $2}')
    if [ -n "$PWDX_DIR" ] && [ -f "$PWDX_DIR/server.ts" ]; then
      TARGET_DIR="$PWDX_DIR"
      echo "  ✓ پوشه فعال از طریق PID پروسه نود شناسایی شد: $TARGET_DIR"
    fi
  fi
fi

# ۳. بررسی مسیرهای استاندارد سرور
if [ -z "$TARGET_DIR" ]; then
  COMMON_DIRS=(
    "/var/www/docushift"
    "/var/www/Docpersian"
    "/var/www/docpersian"
    "/root/docushift"
    "/root/Docpersian"
    "/root/docpersian"
    "$HOME/docushift"
    "$HOME/Docpersian"
    "/opt/docushift"
    "/opt/Docpersian"
  )
  for dir in "${COMMON_DIRS[@]}"; do
    if [ -f "$dir/server.ts" ] && [ -f "$dir/package.json" ]; then
      TARGET_DIR="$dir"
      echo "  ✓ پوشه در مسیر استاندارد پیدا شد: $TARGET_DIR"
      break
    fi
  done
fi

# ۴. جستجوی عمیق
if [ -z "$TARGET_DIR" ]; then
  SEARCH_RES=$(find /var/www /home /root /opt /srv -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1)
  if [ -n "$SEARCH_RES" ]; then
    TARGET_DIR=$(dirname "$SEARCH_RES")
    echo "  ✓ پوشه با جستجوی دیسک پیدا شد: $TARGET_DIR"
  fi
fi

if [ -z "$TARGET_DIR" ] || [ ! -d "$TARGET_DIR" ]; then
  echo "❌ خطا: پوشه پروژه حاوی server.ts پیدا نشد!"
  echo "لطفاً ابتدا با دستور cd وارد مسیر پروژه خود شوید و مجدداً اسکریپت را اجرا کنید."
  exit 1
fi

cd "$TARGET_DIR"
echo "📂 پوشه کاری: $(pwd)"
echo ""

echo "=========================================================="
echo "🔄 گام ۲: دریافت آخرین کدهای گیت‌هاب (Git Fetch & Reset)..."
echo "=========================================================="

if [ -d ".git" ]; then
  echo "  • آدرس مخزن گیت‌هاب سرور شما:"
  git remote -v || true
  
  # ذخیره موقت و پاکسازی تغییرات محلی که مانع pull می‌شوند
  git stash --include-untracked 2>/dev/null || true
  
  echo "  • دریافت آخرین تغییرات از گیت‌هاب (git fetch)..."
  git fetch --all --prune
  
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  [ "$BRANCH" = "HEAD" ] || [ -z "$BRANCH" ] && BRANCH="main"
  
  echo "  • بازنشانی و اعمال قطعی کدهای جدید روی شاخه $BRANCH..."
  git reset --hard "origin/$BRANCH" 2>/dev/null || git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || git pull origin "$BRANCH" || true
  
  echo "  ✓ کدها با موفقیت به آخرین کامیت گیت‌هاب همگام شدند:"
  git log -1 --oneline || true
else
  echo "⚠️ در این پوشه مخزن گیت (.git) شناسایی نشد."
fi

echo ""
echo "=========================================================="
echo "⚙️ گام ۳: تنظیم فایل محیطی (.env) با مدل پایدار و بدون وقفه..."
echo "=========================================================="

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
fi

if [ -f ".env" ]; then
  # مدل سریع و کم‌مصرف gemini-3.5-flash-lite
  if grep -q "GEMINI_MODEL=" .env; then
    sed -i 's/GEMINI_MODEL=.*/GEMINI_MODEL=gemini-3.5-flash-lite/' .env
  else
    echo "GEMINI_MODEL=gemini-3.5-flash-lite" >> .env
  fi

  # غیرفعال کردن بررسی معطل‌کننده تصاویر و دیاگرام‌ها
  if grep -q "DIAGRAM_INPAINTING_ENABLED=" .env; then
    sed -i 's/DIAGRAM_INPAINTING_ENABLED=.*/DIAGRAM_INPAINTING_ENABLED=false/' .env
  else
    echo "DIAGRAM_INPAINTING_ENABLED=false" >> .env
  fi

  # پورت پیش‌فرض ۳۰۰۰
  if grep -q "PORT=" .env; then
    sed -i 's/PORT=.*/PORT=3000/' .env
  else
    echo "PORT=3000" >> .env
  fi
  echo "  ✓ فایل .env با موفقیت با تنظیمات پایدار به‌روز شد."
fi

echo ""
echo "=========================================================="
echo "📦 گام ۴: نصب وابستگی‌ها و بیلد فرانت‌اند (Build)..."
echo "=========================================================="
npm install --legacy-peer-deps
npm run build
echo "  ✓ فایل‌های کامپایل‌شده فرانت‌اند در پوشه dist با موفقیت ساخته شدند."

echo ""
echo "=========================================================="
echo "🚀 گام ۵: ری‌استارت سرویس سرور در PM2..."
echo "=========================================================="
export NODE_ENV=production
pm2 restart docushift --update-env 2>/dev/null || \
pm2 restart docpersian --update-env 2>/dev/null || \
pm2 restart all --update-env 2>/dev/null || \
pm2 start "npx tsx server.ts" --name docushift

pm2 save

# فعال‌سازی و استارت Ollama در صورت نصب بودن
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable ollama 2>/dev/null || true
  systemctl start ollama 2>/dev/null || true
fi

echo ""
echo "=========================================================="
echo "🩺 گام ۶: تست سلامت و تایید سرویس‌های سرور..."
echo "=========================================================="
sleep 2

pm2 status

echo -n "  • وضعیت سرور DocuShift: "
HEALTH=$(curl -s --connect-timeout 4 http://127.0.0.1:3000/api/health || echo "error")
if echo "$HEALTH" | grep -q "ok"; then
  echo "✅ آنلاین و فعال (پورت ۳۰۰۰)"
else
  echo "⚠️ وضعیت: $HEALTH"
fi

echo -n "  • وضعیت مدل محلی (Ollama): "
OLLAMA=$(curl -s --connect-timeout 4 http://127.0.0.1:11434/api/tags || echo "error")
if echo "$OLLAMA" | grep -q "models"; then
  MODELS=$(echo "$OLLAMA" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')
  echo "✅ فعال (مدل‌های موجود: ${MODELS:-ندارد})"
else
  echo "⚠️ سرویس Ollama در حال اجرا نیست یا آفلاین است."
fi

echo -n "  • وضعیت مدل آنلاین Gemini: "
GEMINI=$(curl -s --connect-timeout 6 -X POST http://127.0.0.1:3000/api/settings/test-gemini || echo "error")
if echo "$GEMINI" | grep -q '"success":true'; then
  echo "✅ ارتباط برقرار و سالم است."
else
  echo "⚠️ وضعیت: $(echo "$GEMINI" | grep -o '"error":"[^"]*"' | head -n1 || echo "$GEMINI")"
fi

echo ""
echo "=========================================================="
echo "🎉 به‌روزرسانی سرور با موفقیت به پایان رسید!"
echo "=========================================================="
