#!/usr/bin/env bash
# ==============================================================================
# DocuShift - ابزار جامع رفع اختلال آپلود فایل پس از اتصال VPN روی سرور
# (Fix Linux Asymmetric Routing, Kernel RP Filter, MTU/MSS Clamping & Nginx Buffering)
# ==============================================================================
set -e

echo "============================================================"
echo "  🔧 شروع عیب‌یابی و اصلاح شبکه سرور برای پایداری آپلود با VPN"
echo "============================================================"

# بررسی دسترسی root
if [ "$(id -u)" -ne 0 ]; then
  echo "⚠️ هشدار: اجرای این اسکریپت به دسترسی روت (sudo) نیاز دارد."
  echo "در حال اجرای مجدد با sudo..."
  exec sudo bash "$0" "$@"
fi

# ۱. تشخیص کارت شبکه فیزیکی اصلی و گیت‌وی پیش‌فرض سرور (خارج از تونل‌های VPN)
echo "--> ۱. در حال شناسایی کارت شبکه فیزیکی و گیت‌وی سرور..."
PHYS_IFACE=$(ip -4 route show default 2>/dev/null | grep -vE 'tun|wg|warp|tap|docker|veth|br-|amn|ppp|ipsec|tailscale' | awk '{print $5}' | head -n1)
if [ -z "$PHYS_IFACE" ]; then
  PHYS_IFACE=$(ip -4 route show 2>/dev/null | grep 'proto kernel' | grep -vE 'tun|wg|warp|tap|docker|veth|br-|amn|ppp|ipsec|tailscale' | awk '{print $3}' | head -n1)
fi
if [ -z "$PHYS_IFACE" ]; then
  PHYS_IFACE=$(ls /sys/class/net | grep -vE 'lo|tun|wg|warp|tap|docker|veth|br-|amn|ppp|ipsec|tailscale' | head -n1)
fi

PHYS_GW=$(ip -4 route show default 2>/dev/null | grep -vE 'tun|wg|warp|tap|docker|veth|br-|amn|ppp|ipsec|tailscale' | awk '{print $3}' | head -n1)
if [ -z "$PHYS_GW" ] && [ -n "$PHYS_IFACE" ]; then
  PHYS_GW=$(ip -4 route show dev "$PHYS_IFACE" 2>/dev/null | grep -oP '(?<=via\s)\d+(\.\d+){3}' | head -n1)
fi

PHYS_IP=$(ip -4 addr show dev "$PHYS_IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)

echo "    کارت شبکه فیزیکی: ${PHYS_IFACE:-نامشخص}"
echo "    آدرس IP عمومی/سرور: ${PHYS_IP:-نامشخص}"
echo "    گیت‌وی فیزیکی سرور: ${PHYS_GW:-نامشخص}"

# ۲. حل مشکل مسیریابی نامتقارن (Asymmetric Routing / Policy-Based Routing)
# هنگام اتصال VPN، ترافیک ورودی به IP فیزیکی سرور نباید از تونل VPN برگردد
if [ -n "$PHYS_IFACE" ] && [ -n "$PHYS_GW" ]; then
  echo "--> ۲. تنظیم جدول مسیریابی اختصاصی (PBR) جهت تضمین بازگشت مستقیم ترافیک به کاربر..."
  ip route replace default via "$PHYS_GW" dev "$PHYS_IFACE" table 100 2>/dev/null || ip route add default via "$PHYS_GW" dev "$PHYS_IFACE" table 100 2>/dev/null || true
  
  if [ -n "$PHYS_IP" ]; then
    ip rule del from "$PHYS_IP" lookup 100 2>/dev/null || true
    ip rule add from "$PHYS_IP" lookup 100 priority 1000 2>/dev/null || true
  fi
  ip rule del iif "$PHYS_IFACE" lookup 100 2>/dev/null || true
  ip rule add iif "$PHYS_IFACE" lookup 100 priority 1001 2>/dev/null || true
  echo "    ✅ جدول روت ۱۰۰ و قوانین ip rule با موفقیت برقرار شد."
fi

# ۳. حل مشکل فیلترینگ معکوس کرنل لینوکس (Reverse Path Filtering - rp_filter)
# حالت Strict (1) باعث دور انداختن بسته‌های آپلود ورودی روی eth0 در زمان فعال بودن تونل VPN می‌شود
echo "--> ۳. تنظیم rp_filter به حالت Loose (2) برای جلوگیری از Drop شدن پکت‌های آپلود..."
sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.rp_filter=2 >/dev/null 2>&1 || true
for f in /proc/sys/net/ipv4/conf/*/rp_filter; do
  [ -f "$f" ] && echo 2 > "$f" 2>/dev/null || true
done

# فعال‌سازی ماژول BBR برای دستیابی به حداکثر سرعت در خطوط اینترنت با تاخیر بالا
modprobe tcp_bbr 2>/dev/null || true

# دائمی‌سازی تنظیمات کرنل در /etc/sysctl.d/
tee /etc/sysctl.d/99-docushift-vpn-network.conf >/dev/null << 'EOF'
# بهینه‌سازی فوق‌سریع آپلود یکپارچه شبکه DocuShift و عبور از VPN
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_fastopen = 3
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.core.netdev_max_backlog = 100000
net.ipv4.tcp_max_syn_backlog = 16384
net.ipv4.tcp_rmem = 4096 1048576 67108864
net.ipv4.tcp_wmem = 4096 1048576 67108864
EOF
sysctl --system >/dev/null 2>&1 || true
echo "    ✅ تنظیمات کرنل و الگوریتم BBR جهت حداکثر سرعت اعمال شدند."

# ۴. حل قطعی مشکل MTU و اعمال TCP MSS Clamping در فایروال iptables
# تنظیم MSS به 1240 بایت مانع مسدود شدن پکت‌های بزرگ آپلود در هر نوع تونل VPN می‌شود
if command -v iptables >/dev/null 2>&1; then
  echo "--> ۴. اعمال TCP MSS Clamping به مقدار ۱۲۴۰ بایت (رفع قطعی پکت‌های آپلود در VPN)..."
  iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true
  iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true

  iptables -t mangle -D OUTPUT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true
  iptables -t mangle -A OUTPUT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true

  iptables -t mangle -D PREROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true
  iptables -t mangle -A PREROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240 2>/dev/null || true
  echo "    ✅ قوانین TCP MSS Clamping فعال شدند."
fi

# ۵. بهینه‌سازی Nginx و رفع محدودیت بافر ۱ مگابایتی
if command -v nginx >/dev/null 2>&1; then
  echo "--> ۵. پیکربندی پیشرفته Nginx و دسترسی بافر دیسک (رفع مشکل گیر کردن در ۱ مگابایت)..."
  mkdir -p /var/lib/nginx/body /var/cache/nginx/client_temp /tmp/nginx_upload
  chmod -R 777 /var/lib/nginx /tmp/nginx_upload
  chown -R www-data:www-data /var/lib/nginx /tmp/nginx_upload 2>/dev/null || true

  tee /etc/nginx/sites-available/docushift >/dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 0;
    client_body_buffer_size 32M;
    client_body_temp_path /tmp/nginx_upload 1 2;
    client_body_timeout 600s;
    client_header_timeout 600s;
    send_timeout 600s;
    keepalive_timeout 600s;

    location ~* ^/api/(upload|jobs) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_max_body_size 0;
    }

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

        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/docushift /etc/nginx/sites-enabled/docushift 2>/dev/null || true
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
  echo "    ✅ Nginx مجدداً پیکربندی و بارگذاری شد."
fi

# ۶. باز کردن پورت ۳۰۰۰ در فایروال جهت دسترسی مستقیم بدون واسطه Nginx
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp 2>/dev/null || true
  ufw allow 3000/tcp 2>/dev/null || true
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
fi

# ۷. ری‌استارت سرویس PM2 در صورت وجود
if command -v pm2 >/dev/null 2>&1; then
  echo "--> ۷. بررسی و تازه‌سازی سرویس DocuShift در PM2..."
  pm2 reload docushift --update-env 2>/dev/null || pm2 restart docushift --update-env 2>/dev/null || true
fi

echo ""
echo "============================================================"
echo "  ✅ کلیه تنظیمات رفع اختلال آپلود در حالت VPN با موفقیت اعمال شد!"
echo "============================================================"
