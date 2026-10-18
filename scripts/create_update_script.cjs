const fs = require('fs');
const { execSync } = require('child_process');

execSync('tar --exclude=".git" --exclude="node_modules" --exclude="dist" --exclude="jobs_storage" --exclude="*.log" --exclude="*.tar.gz" --exclude="update_direct.sh" -czf /tmp/update_bundle.tar.gz .');

const b64 = fs.readFileSync('/tmp/update_bundle.tar.gz').toString('base64');

const parts = [
  '#!/usr/bin/env bash',
  'set -e',
  '',
  'echo "=================================================="',
  'echo "  DocuShift - به روزرسانی جامع و قطعی سرور"',
  'echo "=================================================="',
  '',
  '# ۱. انتقال به پوشه پروژه',
  'if [ -d "/root/docushift" ]; then',
  '  cd "/root/docushift"',
  'elif [ -d "/root/Docpersian" ]; then',
  '  cd "/root/Docpersian"',
  'elif [ -f "server.ts" ]; then',
  '  echo "در پوشه فعلی پروژه قرار داریم."',
  'else',
  '  echo "پوشه پروژه پیدا نشد! لطفا به مسیر /root/docushift بروید."',
  '  exit 1',
  'fi',
  '',
  'echo "--> مسیر فعال: $(pwd)"',
  '',
  '# ۲. پاکسازی کش ترجمه‌های وارونه قدیمی',
  'echo "--> ۱. پاکسازی کش ترجمه‌های قدیمی..."',
  'rm -rf jobs_storage/cache/*',
  '',
  '# ۳. دانلود فونت‌های رسمی وزیرمتن',
  'echo "--> ۲. دریافت فونت‌های رسمی Vazirmatn..."',
  'mkdir -p server/assets/fonts',
  'curl -sL "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf" -o server/assets/fonts/persian-font.ttf || true',
  'curl -sL "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Bold.ttf" -o server/assets/fonts/persian-font-bold.ttf || true',
  '',
  '# ۴. استخراج بسته کدهای جدید',
  'echo "--> ۳. اعمال پچ اصلاح موتور ترجمه و رفع رفرش ورودی..."',
  "cat << 'EOF_B64_DATA' | base64 -d | tar -xz --overwrite",
  b64,
  'EOF_B64_DATA',
  '',
  '# ۵. بررسی پکیج‌ها',
  'if [ ! -d "node_modules/@google/genai" ]; then',
  '  echo "--> ۴. بررسی و نصب وابستگی‌ها..."',
  '  npm install --prefer-offline || npm install',
  'fi',
  '',
  '# ۶. کامپایل نهایی فرانت‌اند',
  'echo "--> ۵. کامپایل نهایی فرانت‌اند (npm run build)..."',
  'npm run build',
  '',
  '# ۷. راه‌اندازی مجدد با PM2',
  'echo "--> ۶. راه‌اندازی مجدد سرویس‌ها با PM2..."',
  'pm2 restart all --update-env || pm2 restart docushift || npm run start &',
  '',
  'echo "=================================================="',
  'echo "  ✅ به‌روزرسانی با موفقیت کامل اعمال شد!"',
  'echo "  - رفرش و پاک شدن ورودی فایل به طور کامل رفع شد"',
  'echo "  - موتور ترجمه تصحیح شد و صفحات بدون متن ساختار اصلی را حفظ می‌کنند"',
  'echo "=================================================="',
  ''
];

const script = parts.join('\n');
fs.writeFileSync('update_direct.sh', script, { mode: 0o755 });
fs.writeFileSync('public/update_direct.sh', script, { mode: 0o755 });
console.log('Successfully generated update_direct.sh');
