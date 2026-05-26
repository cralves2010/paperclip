#!/usr/bin/env bash
# One-time setup for the claude-runner container on the VPS.
# Generates an SSH keypair, installs the public key into the runner volume so
# the Paperclip server can SSH in, and prints the private key once for the
# operator to paste into the Paperclip Environment configuration (or Secret).
#
# Idempotent: rerun is safe — it skips key generation if the keypair already
# exists.
#
# Usage on VPS (must be run as root):
#   cd /opt/apps/paperclip
#   bash docker/claude-runner/setup.sh

set -euo pipefail

APP_DIR="/opt/apps/paperclip"
RUNNER_HOME_HOST="/opt/data/claude-runner-home"
KEYS_DIR="/opt/data/claude-runner-keys"
KEY_NAME="paperclip-server-to-claude-runner"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: this script must run as root" >&2
  exit 1
fi

cd "$APP_DIR"

# 1. Ensure host directories exist with the right ownership.
mkdir -p "$RUNNER_HOME_HOST" "$KEYS_DIR"
chown 1001:1001 "$RUNNER_HOME_HOST"
chmod 700 "$KEYS_DIR"

# 2. Generate the SSH keypair if missing. Ed25519 keys are tighter than RSA.
if [[ ! -f "$KEYS_DIR/${KEY_NAME}" ]]; then
  ssh-keygen -t ed25519 -N "" -C "paperclip-server@m42ai.tech" -f "$KEYS_DIR/${KEY_NAME}"
  chmod 600 "$KEYS_DIR/${KEY_NAME}" "$KEYS_DIR/${KEY_NAME}.pub"
  echo "--- KEYPAIR generated at $KEYS_DIR/${KEY_NAME}{,.pub} ---"
else
  echo "--- KEYPAIR already exists at $KEYS_DIR/${KEY_NAME} — skipping generation ---"
fi

# 3. Install the public key into the runner volume's authorized_keys.
mkdir -p "$RUNNER_HOME_HOST/.ssh"
PUB_KEY=$(cat "$KEYS_DIR/${KEY_NAME}.pub")
if ! grep -qF "$PUB_KEY" "$RUNNER_HOME_HOST/.ssh/authorized_keys" 2>/dev/null; then
  echo "$PUB_KEY" >> "$RUNNER_HOME_HOST/.ssh/authorized_keys"
  echo "--- Public key appended to $RUNNER_HOME_HOST/.ssh/authorized_keys ---"
else
  echo "--- Public key already authorised — skipping ---"
fi
chown 1001:1001 "$RUNNER_HOME_HOST/.ssh" "$RUNNER_HOME_HOST/.ssh/authorized_keys"
chmod 700 "$RUNNER_HOME_HOST/.ssh"
chmod 600 "$RUNNER_HOME_HOST/.ssh/authorized_keys"

# 4. Build and start the claude-runner container.
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build claude-runner

# 5. Wait for SSH to come up.
echo "--- Waiting for claude-runner SSH to accept connections ---"
for _ in $(seq 1 20); do
  if docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T server \
       sh -c "command -v ssh-keyscan >/dev/null && ssh-keyscan -t ed25519 -p 22 claude-runner 2>/dev/null | head -1" \
       | grep -q '^claude-runner'; then
    echo "--- claude-runner is reachable from paperclip-server ---"
    break
  fi
  sleep 2
done

# 6. Smoke test: does ssh from server actually authenticate?
echo "--- Smoke test: ssh from server to runner ---"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T server \
  sh -c "mkdir -p /tmp/runner-key && chmod 700 /tmp/runner-key" || true
docker cp "$KEYS_DIR/${KEY_NAME}" "$(docker compose --env-file .env.prod -f docker-compose.prod.yml ps -q server)":/tmp/runner-key/id || true
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T server \
  sh -c "chmod 600 /tmp/runner-key/id && ssh -i /tmp/runner-key/id -o StrictHostKeyChecking=no -o BatchMode=yes runner@claude-runner 'whoami && claude --version || true' 2>&1" || true
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T server \
  sh -c "rm -rf /tmp/runner-key" || true

# 7. Print the private key once. Operator must paste it into Paperclip:
#    Settings → Environments → New environment → driver SSH
#       host: claude-runner
#       port: 22
#       username: runner
#       private key: (the block below)
#       remote workspace path: /home/runner/workspace
echo
echo "============================================================"
echo "PRIVATE KEY — paste into Paperclip Environment SSH config"
echo "(also saved at $KEYS_DIR/${KEY_NAME} — chmod 600, do not leak)"
echo "============================================================"
cat "$KEYS_DIR/${KEY_NAME}"
echo "============================================================"
echo
echo "Suggested environment values:"
echo "  host:                  claude-runner"
echo "  port:                  22"
echo "  username:              runner"
echo "  remote workspace path: /home/runner/workspace"
echo "  strict host key check: ON (use known_hosts below)"
echo
echo "known_hosts entry (paste into the Environment 'Known hosts' field):"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T server \
  sh -c "ssh-keyscan -t ed25519 -p 22 claude-runner 2>/dev/null" || true
