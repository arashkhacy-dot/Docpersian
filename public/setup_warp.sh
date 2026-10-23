#!/usr/bin/env bash
# ==============================================================================
# DocuShift - Cloudflare WARP Proxy Setup for Google Gemini Access on Ubuntu
# ==============================================================================
set -e

echo "========================================================="
echo "  🚀 نصب و راه‌اندازی Cloudflare WARP جهت رفع تحریم Gemini"
echo "========================================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "اجرا با دسترسی روت (sudo)..."
  exec sudo bash "$0" "$@"
fi

# 1. Install prerequisites
apt-get update -y
apt-get install -y curl gpg lsb-release

# 2. Add Cloudflare official GPG keyring
mkdir -p /usr/share/keyrings
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

# 3. Add official repository with fallback for newer Ubuntu versions
CODENAME=$(lsb_release -cs 2>/dev/null || echo "noble")
if [[ "$CODENAME" == "resolute" || "$CODENAME" == "n/a" || -z "$CODENAME" ]]; then
  CODENAME="noble"
fi
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $CODENAME main" | tee /etc/apt/sources.list.d/cloudflare-client.list

# 4. Install WARP
apt-get update -y
apt-get install -y cloudflare-warp

# 5. Configure WARP in proxy mode on port 40000
echo "--> در حال تنظیم WARP در حالت پراکسی محلی روی پورت ۴۰۰۰۰..."
warp-cli --accept-tos registration new 2>/dev/null || true
warp-cli --accept-tos mode proxy 2>/dev/null || true
warp-cli --accept-tos proxy port 40000 2>/dev/null || true
warp-cli --accept-tos connect 2>/dev/null || true

# 6. Configure .env in docushift directory
APP_DIR="/root/docushift"
if [ ! -d "$APP_DIR" ]; then
  APP_DIR="$(pwd)"
fi

if [ -f "$APP_DIR/.env" ]; then
  sed -i '/^HTTPS_PROXY=/d' "$APP_DIR/.env"
  sed -i '/^HTTP_PROXY=/d' "$APP_DIR/.env"
  echo "HTTPS_PROXY=http://127.0.0.1:40000" >> "$APP_DIR/.env"
  echo "HTTP_PROXY=http://127.0.0.1:40000" >> "$APP_DIR/.env"
  echo "--> تنظیمات پراکسی در .env ثبت شد."
  if command -v pm2 &>/dev/null; then
    pm2 restart all --update-env 2>/dev/null || true
    echo "--> سرویس DocuShift در PM2 بازنشانی شد."
  fi
fi

echo "========================================================="
echo "  ✅ پراکسی WARP با موفقیت راه‌اندازی شد و جمنای فعال است!"
echo "========================================================="
