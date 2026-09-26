#!/usr/bin/env bash
set -e

# DocuShift VPS Automated Installer
# Supported OS: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12

echo "========================================="
echo "  DocuShift Translation Engine - VPS Setup"
echo "========================================="

# 1. Update system packages
echo "--> Updating system packages..."
sudo apt-get update -y
sudo apt-get install -y curl git ufw nginx

# 2. Install Node.js 22 LTS
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | sed 's/v//') -lt 20 ]]; then
  echo "--> Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "--> Node version: $(node -v)"
echo "--> NPM version: $(npm -v)"

# 3. Install PM2 process manager
sudo npm install -g pm2 tsx

# 4. Install project dependencies & build frontend
echo "--> Installing application dependencies..."
npm install

echo "--> Building production frontend..."
npm run build

# 5. Create environment file if missing
if [ ! -f .env ]; then
  echo "--> Creating .env file..."
  read -p "Enter your Google Gemini API Key: " api_key
  echo "GEMINI_API_KEY=$api_key" > .env
  echo "NODE_ENV=production" >> .env
  echo "PORT=3000" >> .env
fi

# 6. Start/Restart application with PM2
echo "--> Starting DocuShift daemon with PM2..."
pm2 delete docushift 2>/dev/null || true
pm2 start "npx tsx server.ts" --name docushift
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# 7. Configure Nginx Reverse Proxy with 1GB upload support
echo "--> Configuring Nginx reverse proxy..."
sudo tee /etc/nginx/sites-available/docushift << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 1024M;
    client_body_timeout 300s;
    client_header_timeout 300s;

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

        # SSE stream configuration for real-time progress updates
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/docushift /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "============================================================"
echo "  DocuShift is successfully deployed and running!"
echo "  Access it at: http://$(curl -s ifconfig.me)"
echo "============================================================"
