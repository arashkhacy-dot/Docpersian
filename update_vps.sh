#!/usr/bin/env bash
set -e

# Auto-detect project directory if not currently inside it
if [ ! -f "server.ts" ] && [ ! -f "package.json" ]; then
  echo "--> در حال پیدا کردن خودکار پوشه پروژه روی سرور..."
  TARGET_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n1 | cut -d'"' -f4)
  if [ -z "$TARGET_DIR" ] || [ ! -f "$TARGET_DIR/server.ts" ]; then
    TARGET_DIR=$(pwdx $(pgrep -f "server.ts" | head -n1) 2>/dev/null | awk '{print $2}')
  fi
  if [ -z "$TARGET_DIR" ] || [ ! -f "$TARGET_DIR/server.ts" ]; then
    TARGET_DIR=$(find /var/www /home /root /opt /srv / -maxdepth 4 -name "server.ts" -not -path "*/node_modules/*" 2>/dev/null | head -n1 | xargs dirname 2>/dev/null)
  fi
  if [ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ]; then
    echo "--> پوشه پروژه پیدا شد: $TARGET_DIR"
    cd "$TARGET_DIR"
  else
    echo "خطا: پوشه پروژه پیدا نشد! لطفا با دستور cd وارد مسیر پروژه شوید."
    exit 1
  fi
fi

echo "========================================="
echo "  DocuShift - به‌روزرسانی سرور از گیت‌هاب"
echo "========================================="

# ۱. دریافت آخرین تغییرات از گیت‌هاب
echo "--> ۱. دریافت و همگام‌سازی آخرین تغییرات از گیت‌هاب (git fetch & pull)..."
git stash --include-untracked 2>/dev/null || true
git fetch --all --tags --prune 2>/dev/null || true

ACTIVE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
if [ "$ACTIVE_BRANCH" = "HEAD" ] || [ -z "$ACTIVE_BRANCH" ]; then
  ACTIVE_BRANCH="main"
fi

echo "--> شاخه فعال: $ACTIVE_BRANCH"
git checkout "$ACTIVE_BRANCH" 2>/dev/null || git checkout -B "$ACTIVE_BRANCH" "origin/$ACTIVE_BRANCH" 2>/dev/null || true
git pull origin "$ACTIVE_BRANCH" 2>/dev/null || git reset --hard "origin/$ACTIVE_BRANCH" 2>/dev/null || git pull origin main 2>/dev/null || git reset --hard origin/main 2>/dev/null || git pull 2>/dev/null || true

# ۲. اطمینان از نصب ابزارهای پردازش اسناد و فونت‌های سرور
echo "--> ۲. نصب ابزارهای بینایی، پایتون و پردازش اسناد (Ghostscript, Poppler, Python-PPTX, Python-DOCX)..."
sudo apt-get update -qq 2>/dev/null || true
sudo apt-get install -y -qq ghostscript poppler-utils imagemagick fonts-noto-core fonts-noto-extra fonts-sil-scheherazade python3-pip python3-setuptools 2>/dev/null || true
pip3 install --quiet --break-system-packages python-pptx python-docx 2>/dev/null || pip3 install --quiet python-pptx python-docx 2>/dev/null || true

# بررسی و دانلود فونت‌های منظم و برجسته وزیرمتن در صورت نیاز
mkdir -p server/assets/fonts
if [ ! -s "server/assets/fonts/persian-font.ttf" ] || [ $(wc -c < "server/assets/fonts/persian-font.ttf" 2>/dev/null || echo 0) -lt 20000 ]; then
  echo "--> دانلود فونت وزیرمتن عادی (Regular)..."
  curl -sL --connect-timeout 8 "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://cdnjs.cloudflare.com/ajax/libs/vazirmatn/33.0.3/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf 2>/dev/null || true
fi

if [ ! -s "server/assets/fonts/persian-font-bold.ttf" ] || [ $(wc -c < "server/assets/fonts/persian-font-bold.ttf" 2>/dev/null || echo 0) -lt 20000 ]; then
  echo "--> دانلود فونت وزیرمتن ضخیم (Bold)..."
  curl -sL --connect-timeout 8 "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Bold.ttf" -o server/assets/fonts/persian-font-bold.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://cdnjs.cloudflare.com/ajax/libs/vazirmatn/33.0.3/Vazirmatn-Bold.ttf" -o server/assets/fonts/persian-font-bold.ttf 2>/dev/null || \
  curl -sL --connect-timeout 8 "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Bold.ttf" -o server/assets/fonts/persian-font-bold.ttf 2>/dev/null || true
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

# ۶. تنظیم و ریلود Nginx برای پشتیبانی از آپلود اسناد تا ۱ گیگابایت و استریم بدون بافر
if command -v nginx >/dev/null 2>&1; then
  echo "--> ۶. پیکربندی Nginx برای پشتیبانی از آپلود نامحدود و استریم بدون بافر..."
  sudo tee /etc/nginx/sites-available/docushift >/dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 1024M;
    client_body_timeout 600s;
    client_header_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Enable buffering for incoming client upload to prevent mobile TCP stalls, disable response buffering for SSE
        proxy_request_buffering on;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
  sudo ln -sf /etc/nginx/sites-available/docushift /etc/nginx/sites-enabled/docushift 2>/dev/null || true
  sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx 2>/dev/null || true
fi

echo ""
echo "============================================================"
echo "  ✅ به‌روزرسانی سرور با موفقیت کامل انجام شد!"
echo "============================================================"
pm2 status docushift 2>/dev/null || pm2 status || true
systemctl is-active ollama 2>/dev/null && echo "  ✅ سرویس مدل محلی (Ollama) دائمی و فعال است." || true
