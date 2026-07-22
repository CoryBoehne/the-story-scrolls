#!/bin/zsh
set -eu
umask 077

readonly NODE_BIN="/Users/coryboehne/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
readonly PROJECT_DIR="/Users/coryboehne/Server Hosting/sites/thestoryscrolls-workspace"

export STORYSCROLLS_SESSION_SECRET="$(
  /usr/bin/security find-generic-password \
    -a "coryboehne" \
    -s com.corydev.thestoryscrolls.session-secret \
    -w
)"
[[ ${#STORYSCROLLS_SESSION_SECRET} -ge 32 ]]

if [[ "${STORYSCROLLS_REQUIRE_AUTH:-false}" == "true" ]]; then
  export GOOGLE_CLIENT_ID="$(
    /usr/bin/security find-generic-password \
      -a "coryboehne@gmail.com" \
      -s com.corydev.thestoryscrolls.google-client-id \
      -w
  )"
  export GOOGLE_CLIENT_SECRET="$(
    /usr/bin/security find-generic-password \
      -a "coryboehne@gmail.com" \
      -s com.corydev.thestoryscrolls.google-client-secret \
      -w
  )"
  [[ -n "$GOOGLE_CLIENT_ID" ]]
  [[ -n "$GOOGLE_CLIENT_SECRET" ]]
fi

cd "$PROJECT_DIR"
exec "$NODE_BIN" "$PROJECT_DIR/server/platform-server.mjs"
