#!/usr/bin/env bash
# Start the Agents server from the repo root, inside its own Herdr pane (see docs/setup.md).
# AGENTS_ALLOWED_LOGIN is required: the one Tailscale login the server answers.
# Set it in the environment or in .env.local (git-ignored), loaded here if present:
#   AGENTS_ALLOWED_LOGIN=you@example.com
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi
exec bun server/main.ts
