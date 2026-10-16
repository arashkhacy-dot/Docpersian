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
PHYS_IFACE=$(ip -4 route show default 2>/dev/null | grep -vE 'tun|wg|warp|tap|docker|veth|br-' | awk '{print $5}' | head -n1)
if [ -z "$PHYS_IFACE" ]; then
  PHYS_IFACE=$(ip -4 route show 2>/dev/null | grep 'proto kernel' | grep -vE 'tun|wg|warp|tap|docker|veth|br-' | awk '{print $3}' | head -n1)
fi
if [ -z "$PHYS_IFACE" ]; then
  PHYS_IFACE=$(ls /sys/class/net | grep -vE 'lo|tun|wg|warp|tap|docker|veth|br-' | head -n1)
fi

PHYS_GW=$(ip -4 route show default 2>/dev/null | grep -vE 'tun|wg|warp|tap|docker|veth|br-' | awk '{print $3}' | head -n1)
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
  echo "    ✅ جدول روت ۱۰0 و قوانین ip rule با موفقیت برقرار شد."
fi

# ۳. حل مشکل فیلترینگ معکوس کرنل لینوکس (Reverse Path Filtering - rp_filter)
# حالت Strict (1) باعث دور انداختن بسته‌های آپلود ورودی روی eth0 در زمان فعال بودن تونل VPN می‌شود
echo "--> ۳. تنظیم rp_filter به حالت Loose (2) برای جلوگیری از Drop شدن پکت‌های آپلود..."
sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.rp_filter=2 >/dev/null 2>&1 || true
for f in /proc/sys/net/ipv4/conf/*/rp_filter; do
  [ -f "$f" ] && echo 2 > "$f" 2>/dev/null || true
done

# دائمی‌سازی تنظیمات کرنل در /etc/sysctl.d/
tee /etc/sysctl.d/99-docushift-vpn-network.conf >/dev/null << 'EOF'
# بهینه‌سازی شبکه DocuShift برای عبور آپلود از VPN بدون تداخل
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF
sysctl --system >/dev/null 2>&1 || true
echo "    ✅ تنظیمات کرنل اعمال و دائمی شدند."

# ۴. حل مشکل MTU و اعمال TCP MSS Clamping در فایروال iptables
# تونل‌های VPN سایز MTU کمتری دارند (معمولاً ۱۲۸۰ تا ۱۴۲۰). کلمپ کردن MSS مانع گیر کردن بسته‌های بزرگ آپلود می‌شود.
if command -v iptables >/dev/null 2>&1; then
  echo "--> ۴. اعمال TCP MSS Clamping برای جلوگیری از قفل شدن یا قطعی پکت‌های بزرگ..."
  iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
  iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

  iptables -t mangle -D OUTPUT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
  iptables -t mangle -A OUTPUT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

  iptables -t mangle -D PREROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
  iptables -t mangle -A PREROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
  echo "    ✅ قوانین TCP MSS Clamping فعال شدند."
fi

# ۵. بهینه‌سازی Nginx برای استریم مستقیم پکت‌های آپلود به Node.js بدون تاخیر بافر
if command -v nginx >/dev/null 2>&1; then
  echo "--> ۵. پیکربندی پیشرفته Nginx (لغو بافر درخواست‌ها جهت انتقال بی‌درنگ قطعات آپلود)..."
  tee /etc/nginx/sites-available/docushift >/dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 1024M;
    client_body_buffer_size 1M;
    client_body_timeout 300s;
    client_header_timeout 300s;
    send_timeout 300s;
    keepalive_timeout 300s;

    # استریم مستقیم قطعات آپلود بدون بافرینگ دیسک (جلوگیری از تایم‌اوت در VPN)
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

        # لغو بافرینگ درخواست و پاسخ برای پایداری کامل استریم آپلود
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_max_body_size 1024M;
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

# ۶. ری‌استارت سرویس PM2 در صورت وجود
if command -v pm2 >/dev/null 2>&1; then
  echo "--> ۶. بررسی و تازه‌سازی سرویس DocuShift در PM2..."
  pm2 reload docushift --update-env 2>/dev/null || pm2 restart docushift --update-env 2>/dev/null || true
fi

echo ""
echo "============================================================"
echo "  ✅ کلیه تنظیمات رفع اختلال آپلود در حالت VPN با موفقیت اعمال شد!"
echo "============================================================"
echo "💡 نکته معماری مهم:"
echo "اگر VPN را صرفاً برای دسترسی سرور به هوش مصنوعی Google Gemini نصب کرده‌اید:"
echo "پیشنهاد طلایی: از حالت پروکسی داخلی (مانند warp-cli mode proxy روی پورت 40000"
echo "یا SOCKS5 روی 127.0.0.1:10808) استفاده کنید و متغیر زیر را در فایل .env قرار دهید:"
echo "    HTTPS_PROXY=http://127.0.0.1:40000"
echo "در این حالت ارتباطات کاربران برای آپلود کاملاً روی شبکه پرسرعت محلی و بدون"
echo "هیچ‌گونه وابستگی به وی‌پی‌ان پردازش شده و فقط فراخوانی جمنای از تونل پروکسی می‌گذرد."
echo "============================================================"
