#!/usr/bin/env bash
# Bootstraps the runner home directory on first boot when the persistent volume
# is empty. Ensures .ssh exists with correct perms and authorized_keys is in
# place. Generates SSH host keys on first run. Idempotent.

set -euo pipefail

RUNNER_HOME=/home/runner
SSH_DIR="$RUNNER_HOME/.ssh"

mkdir -p "$SSH_DIR" "$RUNNER_HOME/.claude" "$RUNNER_HOME/.codex" "$RUNNER_HOME/workspace"
chown -R runner:runner "$RUNNER_HOME"
chmod 700 "$SSH_DIR"

if [ -f "$SSH_DIR/authorized_keys" ]; then
  chmod 600 "$SSH_DIR/authorized_keys"
  chown runner:runner "$SSH_DIR/authorized_keys"
fi

# Generate host keys on first boot if not present
ssh-keygen -A

exec "$@"
