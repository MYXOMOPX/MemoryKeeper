#!/bin/sh
set -e

if ! mountpoint -q "$VAULT_PATH" 2>/dev/null && [ -z "$(ls -A "$VAULT_PATH" 2>/dev/null)" ]; then
  echo "VAULT_PATH ($VAULT_PATH) is empty or not mounted — refusing to start until the host mount is ready." >&2
  exit 1
fi

exec "$@"
