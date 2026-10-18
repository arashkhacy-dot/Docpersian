const fs = require('fs');
const { execSync } = require('child_process');

const files = [
  'server.ts',
  'server/gemini/translator.ts',
  'server/processors/pdfProcessor.ts',
  'src/components/UploadZone.tsx'
];

execSync('tar -czf /tmp/patch_files.tar.gz ' + files.join(' '));
const b64 = fs.readFileSync('/tmp/patch_files.tar.gz').toString('base64');
console.log('Patch b64 size:', b64.length);

const lines = [
  '#!/usr/bin/env bash',
  'set -e',
  '',
  'echo "=================================================="',
  'echo "  DocuShift - اعمال پچ نهایی رفع ترجمه و رفرش ورودی"',
  'echo "=================================================="',
  '',
  '# ۱. رفتن به مسیر اصلی پروژه',
  'if [ -d "/root/docushift" ]; then',
  '  cd "/root/docushift"',
  'elif [ -d "/root/Docpersian" ]; then',
  '  cd "/root/Docpersian"',
  'elif [ -f "server.ts" ]; then',
  '  echo "در پوشه فعلی پروژه هستیم."',
  'else',
  '  echo "پوشه docushift یافت نشد! لطفاً دستور cd /root/docushift را اجرا کنید."',
  '  exit 1',
  'fi',
  '',
  'echo "--> مسیر جاری: $(pwd)"',
  '',
  '# ۲. پاکسازی کش ترجمه قدیمی',
  'echo "--> ۱. پاکسازی کش ترجمه‌های ناقص قبلی..."',
  'rm -rf jobs_storage/cache/*',
  '',
  '# ۳. استخراج کدهای اصلاح‌شده',
  'echo "--> ۲. اعمال کدهای اصلاح‌شده (موتور ترجمه، عدم ایجاد جای خالی، رفع رفرش ورودی)..."',
  "cat << 'EOF_PATCH' | base64 -d | tar -xz --overwrite",
  b64,
  'EOF_PATCH',
  '',
  '# ۴. کامپایل فرانت‌اند بدون رفرش',
  'echo "--> ۳. کامپایل نهایی فرانت‌اند (npm run build)..."',
  'npm run build',
  '',
  '# ۵. راه‌اندازی مجدد سرویس با PM2',
  'echo "--> ۴. راه‌اندازی مجدد با PM2..."',
  'pm2 restart all --update-env',
  '',
  'echo "=================================================="',
  'echo "  ✅ پچ با موفقیت کامل نصب و اعمال شد!"',
  'echo "  ۱. مشکل رفرش و پاک شدن ورودی فایل برطرف شد."',
  'echo "  ۲. موتور ترجمه تصحیح شد و صفحات ناقص نمی‌شوند."',
  'echo "=================================================="',
  ''
];

const script = lines.join('\n');
fs.writeFileSync('patch_docushift.sh', script, { mode: 0o755 });
fs.writeFileSync('public/patch_docushift.sh', script, { mode: 0o755 });
console.log('Successfully created patch_docushift.sh, total bytes:', script.length);
