#!/bin/sh
set -e

# Best-effort SECONDARY sanity check only. The primary guard is the host-side
# `ExecStartPre=/usr/bin/mountpoint -q /mnt/memory-vault` in
# deploy/memory-keeper.service, which refuses to start the container unless the
# rclone FUSE mount is actually live on the host.
#
# From inside the container this check cannot tell a FUSE-backed bind mount
# from a bind mount of an empty local host directory: any bind mount shows up
# as a mountpoint in the container's own mount namespace. What it DOES still
# catch is $VAULT_PATH not being bind-mounted into the container at all (e.g. a
# docker-compose misconfiguration) while also being empty.
if ! mountpoint -q "$VAULT_PATH" 2>/dev/null && [ -z "$(ls -A "$VAULT_PATH" 2>/dev/null)" ]; then
  echo "VAULT_PATH ($VAULT_PATH) is empty and not a mount point — refusing to start (check the docker-compose volume for the vault)." >&2
  exit 1
fi

exec "$@"
