#!/usr/bin/env bash
# Run inside the codespace: installs and starts the real Zetaris platform.
# Usage: ZETARIS_BUNDLE_URL='<fresh signed url>' bash codespace-zetaris-setup.sh
set -euo pipefail
cd /workspaces
if [ ! -d /workspaces/zetaris-platform ]; then
  curl -sL -o /tmp/zp.zip "$ZETARIS_BUNDLE_URL"
  unzip -q /tmp/zp.zip -d /tmp
  mv /tmp/zetaris-platform /workspaces/zetaris-platform
fi
cd /workspaces/zetaris-platform
# registry login (creds passed via env, never committed)
echo "$ZETARIS_REGISTRY_PASSWORD" | docker login zetarishackathon.azurecr.io -u "$ZETARIS_REGISTRY_USER" --password-stdin
# admin account (first start only)
sed -i "s|^ZETARIS_ADMIN_EMAIL=.*|ZETARIS_ADMIN_EMAIL=adityakulkarnicoding@gmail.com|" .env
sed -i "s|^ZETARIS_ADMIN_PASSWORD=.*|ZETARIS_ADMIN_PASSWORD=$ZETARIS_ADMIN_PASSWORD|" .env
sed -i "s|^ZETARIS_ADMIN_ORG=.*|ZETARIS_ADMIN_ORG=DoYouCare|" .env
chmod 600 .env
./preflight.sh || true
docker compose pull
docker compose up -d
echo "Zetaris starting; watch: docker compose logs --tail=80 driver api bootstrap"
