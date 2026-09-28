FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV HOME=/root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates util-linux tar \
    && rm -rf /var/lib/apt/lists/*
# CONFIRMED (Task 14 Step 1, live discovery on 2026-09-28): the raw single-binary
# asset assumed by the original placeholder no longer exists. The current `agy`
# (Antigravity CLI) release ships as a .tar.gz containing a binary named
# `antigravity`, published under a stable "latest" alias:
#   https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy_cli_linux_x64.tar.gz
# Verified via `curl -fsSL .../releases/latest/download/agy_cli_linux_x64.tar.gz`
# (resolves and downloads a real ELF binary) and via the GitHub releases API for
# google-antigravity/antigravity-cli (tag 1.2.12 at time of writing, asset
# agy_cli_linux_x64.tar.gz). Google also publishes an official installer at
# https://antigravity.google/cli/install.sh, but it ends with a "native setup"
# handoff (`agy install`) intended for interactive shells, so we extract the
# release asset directly here for a deterministic, non-interactive build.
RUN curl -fsSL -o /tmp/agy.tar.gz \
      "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy_cli_linux_x64.tar.gz" \
    && tar -xzf /tmp/agy.tar.gz -C /usr/local/bin antigravity \
    && mv /usr/local/bin/antigravity /usr/local/bin/agy \
    && chmod +x /usr/local/bin/agy \
    && rm /tmp/agy.tar.gz
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# The whole /root/.gemini directory is a named volume at runtime (see
# docker-compose.yml). Docker seeds an empty named volume from the image's
# content at the mount target on first attach, so mcp_config.json must be baked
# in under /root/.gemini before that happens. Note: once the volume exists,
# rebuilding the image does NOT refresh mcp_config.json inside it — remove the
# volume (or copy the file in) if mcp_config.json changes.
RUN mkdir -p /root/.gemini/antigravity-cli
COPY docker/mcp_config.json /root/.gemini/antigravity-cli/mcp_config.json
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
