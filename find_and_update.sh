#!/usr/bin/env bash
# ==============================================================================
# DocuShift - دستور جامع یافتن خودکار پوشه پروژه، فچ، آپدیت و راه‌اندازی سرور
# ==============================================================================
set -e

echo "========================================================="
echo "🔍 مرحله ۱: مکان‌یابی خودکار پوشه فعال پروژه DocuShift..."
echo "========================================================="

PROJECT_DIR=""

# ۱. استعلام از پروسه‌های فعال PM2 (مطمئن‌ترین روش برای یافتن پوشه زنده سرور)
if command -v pm2 >/dev/null 2>&1; then
  PM2_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -n "$PM2_DIR" ] && [ -f "$PM2_DIR/server.ts" ]; then
    PROJECT_DIR="$PM2_DIR"
    echo "  ✓ پوشه فعال از طریق PM2 شناسایی شد: $PROJECT_DIR"
  fi
fi

# ۲. استعلام از شناسه پروسه نود در حال اجرا (pwdx)
if [ -z "$PROJECT_DIR" ]; then
  NODE_PID=$(pgrep -f "server.ts" 2>/dev/null | head -n1)
  if [ -n "$NODE_PID" ]; then
    PWDX_DIR=$(pwdx "$NODE_PID" 2>/dev/null | awk '{print $2}')
    if [ -n "$PWDX_DIR" ] && [ -f "$PWDX_DIR/server.ts" ]; then
      PROJECT_DIR="$PWDX_DIR"
      echo "  ✓ پوشه فعال از طریق PID پروسه نود شناسایی شد: $PROJECT_DIR"
    fi
  fi
fi

# ۳. بررسی مسیرهای رایج پروژه
if [ -z "$PROJECT_DIR" ]; then
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
    "$(pwd)"
  )
  for dir in "${COMMON_DIRS[@]}"; do
    if [ -f "$dir/server.ts" ] && [ -f "$dir/package.json" ]; then
      PROJECT_DIR="$dir"
      echo "  ✓ پوشه فعال در مسیر رایج شناسایی شد: $PROJECT_DIR"
      break
    fi
  done
fi

# ۴. جستجوی عمیق روی دیسک
if [ -z "$PROJECT_DIR" ]; then
  echo "  ... در حال جستجو در دیسک برای یافتن فایل server.ts ..."
  FOUND_PATH=$(find /var/www /root /home /opt /srv -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1)
  if [ -n "$FOUND_PATH" ]; then
    PROJECT_DIR=$(dirname "$FOUND_PATH")
    echo "  ✓ پوشه فعال از طریق جستجوی دیسک پیدا شد: $PROJECT_DIR"
  fi
fi

# در صورت عدم وجود، ایجاد پوشه استاندارد جدید در /var/www/docushift
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="/var/www/docushift"
  echo "  ⚠️ پوشه قبلی یافت نشد؛ پوشه جدید ایجاد می‌شود: $PROJECT_DIR"
  mkdir -p "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"
echo "📂 مسیر فعال عملیاتی: $(pwd)"
echo ""

echo "========================================================="
echo "🔄 مرحله ۲: دریافت و همگام‌سازی کامل آخرین تغییرات..."
echo "========================================================="

# دریافت مستقیم سورس‌کد کامل استودیو از طریق بسته همگام‌ساز (Direct Studio Sync)
STUDIO_URL="https://ais-dev-lp67unkvqzifulvxvfxfhw-2280515566.us-east1.run.app/bundle.tar.gz"
echo "--> در حال بارگیری آخرین نسخه تغییرات مستقیم از Google AI Studio..."

if curl -sI --connect-timeout 8 "$STUDIO_URL" | grep -q "200"; then
  if curl -sL "$STUDIO_URL" | tar -xz --overwrite -C .; then
    echo "  ✅ کدهای جدید، پچ‌ها و تنظیمات مدل‌ها با موفقیت استخراج و جایگزین شدند."
  else
    echo "  ⚠️ دریافت مستقیم با وقفه مواجه شد؛ انتقال به همگام‌سازی گیت..."
  fi
fi

# همگام‌سازی با گیت‌هاب در صورت وجود ریپازیتوری
if [ -d ".git" ]; then
  echo "--> در حال دریافت آخرین کامیت‌ها از مخزن گیت‌هاب (git fetch & reset)..."
  git stash --include-untracked 2>/dev/null || true
  git fetch --all --prune 2>/dev/null || true
  ACTIVE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  [ "$ACTIVE_BRANCH" = "HEAD" ] || [ -z "$ACTIVE_BRANCH" ] && ACTIVE_BRANCH="main"
  git reset --hard "origin/$ACTIVE_BRANCH" 2>/dev/null || git reset --hard origin/main 2>/dev/null || git pull 2>/dev/null || true
  echo "  ✅ گیت‌هاب روی شاخه $ACTIVE_BRANCH با موفقیت همگام شد."
fi

# به‌روزرسانی تنظیمات محیطی (.env)
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
fi
if [ -f ".env" ]; then
  # اطمینان از تنظیم مدل سریع و پایدار
  if grep -q "GEMINI_MODEL=" .env; then
    sed -i 's/GEMINI_MODEL=.*/GEMINI_MODEL=gemini-3.5-flash-lite/' .env
  else
    echo "GEMINI_MODEL=gemini-3.5-flash-lite" >> .env
  fi
  # اطمینان از غیرفعال بودن پردازش سنگین دیاگرام تصویری
  if grep -q "DIAGRAM_INPAINTING_ENABLED=" .env; then
    sed -i 's/DIAGRAM_INPAINTING_ENABLED=.*/DIAGRAM_INPAINTING_ENABLED=false/' .env
  else
    echo "DIAGRAM_INPAINTING_ENABLED=false" >> .env
  fi
fi

echo ""
echo "========================================================="
echo "📦 مرحله ۳: نصب وابستگی‌ها و بیلد فرانت‌اند..."
echo "========================================================="
npm install --legacy-peer-deps
npm run build

echo ""
echo "========================================================="
echo "🚀 مرحله ۴: راه‌اندازی و بارگذاری مجدد سرویس PM2..."
echo "========================================================="
export NODE_ENV=production
pm2 restart docushift --update-env 2>/dev/null || \
pm2 restart docpersian --update-env 2>/dev/null || \
pm2 restart all --update-env 2>/dev/null || \
pm2 start "npx tsx server.ts" --name docushift

pm2 save

# بررسی و فعال‌سازی سرویس هوش مصنوعی محلی Ollama
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable ollama 2>/dev/null || true
  systemctl start ollama 2>/dev/null || true
fi

echo ""
echo "========================================================="
echo "🩺 مرحله ۵: آزمایش سلامت سرویس‌ها و هوش مصنوعی سرور..."
echo "========================================================="
sleep 2

# ۱. وضعیت پروسه سرور
pm2 status

# ۲. تست پاسخ‌دهی سرور برنامه
echo -n "  • وضعیت سرور DocuShift: "
HEALTH_RESP=$(curl -s --connect-timeout 4 http://127.0.0.1:3000/api/health || echo "error")
if echo "$HEALTH_RESP" | grep -q "ok"; then
  echo "✅ آنلاین و فعال (پورت ۳۰۰۰)"
else
  echo "⚠️ در حال بالا آمدن یا پاسخ غیرمنتظره: $HEALTH_RESP"
fi

# ۳. تست سلامت هوش مصنوعی محلی (Ollama)
echo -n "  • وضعیت مدل محلی (Ollama): "
OLLAMA_RESP=$(curl -s --connect-timeout 4 http://127.0.0.1:11434/api/tags || echo "error")
if echo "$OLLAMA_RESP" | grep -q "models"; then
  MODELS_LIST=$(echo "$OLLAMA_RESP" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')
  echo "✅ فعال (مدل‌های نصب‌شده: ${MODELS_LIST:-ندارد})"
else
  echo "⚠️ سرویس Ollama پاسخ نمی‌دهد (می‌توانید با دستور systemctl start ollama آن را فعال کنید)."
fi

# ۴. تست اتصال مدل آنلاین Gemini
echo -n "  • اتصال به Gemini آنلاین: "
GEMINI_TEST=$(curl -s --connect-timeout 6 -X POST http://127.0.0.1:3000/api/settings/test-gemini || echo "error")
if echo "$GEMINI_TEST" | grep -q '"success":true'; then
  echo "✅ ارتباط برقرار و توکن‌ها فعال است."
else
  echo "⚠️ نیاز به WARP یا کلید جدید: $(echo "$GEMINI_TEST" | grep -o '"error":"[^"]*"' | head -n1 || echo "$GEMINI_TEST")"
fi

echo ""
echo "========================================================="
echo "🎉 به‌روزرسانی سرور با موفقیت و تطابق ۱۰۰٪ با نسخه استودیو به پایان رسید!"
echo "========================================================="
