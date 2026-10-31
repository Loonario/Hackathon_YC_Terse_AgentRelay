#!/usr/bin/env bash
# Starts the Agent Relay MCP server (stdio) with the workspace key from apps/web/.env.local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/apps/web/.env.local"; set +a
: "${RELAY_WORKSPACE_KEY:?RELAY_WORKSPACE_KEY missing in apps/web/.env.local}"
# Startup registration fails if the agent name already exists (registerOrRotate doesn't
# rotate in agent-relay 14.0.0), so use a fresh name per launch.
export RELAY_AGENT_NAME="${RELAY_AGENT_NAME:-claude-code-$(date +%m%d%H%M%S)}"
exec "$ROOT/scripts/node_modules/.bin/agent-relay" mcp
