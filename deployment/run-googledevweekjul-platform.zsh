#!/bin/zsh
set -eu
umask 077

readonly NODE_BIN="/Users/coryboehne/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
readonly PROJECT_DIR="/Users/coryboehne/Server Hosting/sites/storyscrolls-googledevweekjul-frozen"

export STORYSCROLLS_SESSION_SECRET="$(
  /usr/bin/security find-generic-password \
    -a "$USER" \
    -s com.corydev.googledevweekjul-storyscrolls.session-secret \
    -w
)"
[[ ${#STORYSCROLLS_SESSION_SECRET} -ge 32 ]]

cd "$PROJECT_DIR"
exec "$NODE_BIN" "$PROJECT_DIR/server/platform-server.mjs"
