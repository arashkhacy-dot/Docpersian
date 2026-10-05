#!/usr/bin/env bash
# DocuShift - Restore to checkpoint v1.0 (قبل از افزودن ویرایش متن دیاگرام)
set -e

echo "--> در حال بازگردانی به چک‌پوینت پایدار (checkpoint-v1.0)..."
git checkout checkpoint-v1.0 2>/dev/null || git reset --hard checkpoint-v1.0

echo "--> بیلد مجدد برنامه..."
npm run build

echo "--> ری‌استارت سرویس PM2..."
pm2 restart docushift --update-env 2>/dev/null || pm2 restart all 2>/dev/null || true

echo "✅ برنامه با موفقیت به نقطه چک‌پوینت پایدار بازگردانده شد!"
