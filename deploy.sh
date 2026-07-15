#!/usr/bin/env bash
#
# Deploy CallFlow CRM on the VPS: build the frontend, install backend deps,
# fix ownership, and reload services.
#
# This script does NOT touch git. The GitHub Actions workflow
# (.github/workflows/deploy.yml) runs `git fetch` + `git reset --hard origin/main`
# before calling it, so the working tree is already at the target commit.
# For a MANUAL deploy, pull first:  git pull && bash deploy.sh
#
set -euo pipefail

ROOT=/var/www/crm_dash/crm

echo "==> Building frontend..."
cd "$ROOT/client"
# `npm install`, not `npm ci`: the lockfile is generated on Windows (dev box) and
# omits Linux-only optional native deps (e.g. @emnapi/*, pulled in by Vite/rolldown),
# which makes strict `npm ci` abort with "Missing ... from lock file". `npm install`
# reconciles those on the Linux VPS instead of failing.
npm install                              # tolerant, cross-platform-safe install (incl. dev deps needed to build)
npm run build

echo "==> Installing backend deps..."
cd "$ROOT/server"
composer install --no-dev --optimize-autoloader

echo "==> Fixing ownership & reloading services..."
chown -R www-data:www-data "$ROOT"       # needs root (or a deploy user with sudo)
systemctl reload php8.4-fpm              # apply backend code / clear opcache
systemctl reload nginx                   # pick up any nginx-served changes

echo "==> Health check:"
curl -fsS https://crm.keozx.com/api/health; echo
echo "==> Deploy complete."
