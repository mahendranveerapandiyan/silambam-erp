#!/usr/bin/env bash
# One-time install on a fresh Ubuntu/Debian server. Run from the repository folder:
#   sudo bash deploy/setup.sh                       # asks for the domain
#   sudo bash deploy/setup.sh erp.myschool.in       # or pass it
#   sudo bash deploy/setup.sh "" --demo             # free <ip>.sslip.io address + demo data
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Please run with sudo."; exit 1; }

DOMAIN_ARG="${1:-}"
DEMO="${2:-}"

# 1. swap (lets the app build on 1 GB servers)
if [ "$(swapon --show | wc -l)" = 0 ]; then
  echo ">> Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Docker
if ! command -v docker >/dev/null; then
  echo ">> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# 3. firewall (if ufw is present)
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# 4. settings
if [ ! -f .env ]; then
  DOMAIN="$DOMAIN_ARG"
  if [ -z "$DOMAIN" ] && [ -t 0 ]; then
    read -rp "Domain for the app (e.g. erp.myschool.in). Leave empty to use a free <server-ip>.sslip.io address: " DOMAIN
  fi
  if [ -z "$DOMAIN" ]; then
    IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
    DOMAIN="${IP//./-}.sslip.io"
  fi
  cat > .env <<ENV
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
TZ=Asia/Kolkata
BACKUP_KEEP_DAYS=14
BACKUP_TIME=0 2 * * *
ENV
  chmod 600 .env
  echo ">> Wrote deploy/.env (keep it private; it holds the passwords)"
fi
mkdir -p backups
set -a; . ./.env; set +a

# 5. start everything
echo ">> Building and starting (first build takes a few minutes)"
docker compose up -d --build
echo ">> Waiting for the database"
until docker compose exec -T db pg_isready -U silambam >/dev/null 2>&1; do sleep 2; done
docker compose exec -T app node scripts/migrate.mjs
docker compose exec -T app node scripts/seed.mjs $DEMO || echo "(already seeded - skipped)"

echo
echo "=========================================================="
echo " caMpus dAy is running at:  https://$DOMAIN"
echo " First login: admin / admin123  (you will be asked to change it)"
echo " Backups: deploy/backups (daily at 02:00, kept $BACKUP_KEEP_DAYS days)"
echo " Update later with: sudo bash deploy/deploy.sh"
echo "=========================================================="
