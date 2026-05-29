#!/bin/bash
# Release dry-run against a local verdaccio registry.
#
# Publishes EVERY @elaraai/* npm package (the workspace JS packages via the same
# scripts/publish-npm.mjs the real release uses, plus the east-c-cli launcher +
# the host-platform per-platform package), installs them into a throwaway
# consumer exactly as a user would, and smoke-tests the result — all without
# touching the real npm registry or needing trusted-publishing / OIDC.
#
# This is the engine behind the release workflow's `validate` job; running it
# under `act` exercises the same path locally. Linux-x64 only (the host leg):
# the other 4 platform binaries can't be cross-built here, so full-matrix
# per-platform coverage stays a CI concern (each OS leg self-validates).
#
# Env:
#   SKIP_BUILD=1   reuse existing dist/ + east-c build (fast iteration)
#
# Cleans up verdaccio + tmp dirs on exit (success or failure); safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t east-release-verdaccio-XXXXXX)"
PORT=4873
# Use 127.0.0.1 (not localhost) everywhere: in containers `localhost` resolves
# to IPv6 ::1, verdaccio binds only that, and npm/pnpm connect to IPv4
# 127.0.0.1 → ECONNREFUSED. Verdaccio listens on 0.0.0.0 to cover both.
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}"
VERDACCIO_PID=

cleanup() {
  local rc=$?
  if [[ $rc -ne 0 && -d "$WORK" ]]; then
    echo "── verdaccio.stdout (tail) ──"; tail -40 "$WORK/verdaccio.stdout" 2>/dev/null || true
    echo "── verdaccio.log (tail) ──";    tail -40 "$WORK/verdaccio.log"    2>/dev/null || true
  fi
  [[ -n "$VERDACCIO_PID" ]] && kill "$VERDACCIO_PID" 2>/dev/null || true
  rm -rf "$WORK"
  exit $rc
}
trap cleanup EXIT INT TERM
log() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }

cd "$REPO_ROOT"
VERSION="$(node -p "require('./package.json').version")"
log "Release dry-run · version ${VERSION} · registry ${URL}"

# ── Host platform → east-c target ───────────────────────────────────────────
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  TARGET=linux-x64;   BIN=east-c     ;;
  Linux-aarch64) TARGET=linux-arm64; BIN=east-c     ;;
  Darwin-arm64)  TARGET=darwin-arm64; BIN=east-c    ;;
  Darwin-x86_64) TARGET=darwin-x64;  BIN=east-c     ;;
  MINGW*-x86_64|MSYS*-x86_64) TARGET=win32-x64; BIN=east-c.exe ;;
  *) echo "::error::Unsupported host: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

# ── 1. Build everything the publish needs ───────────────────────────────────
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "Building TS packages"
  make -C libs/east build
  make -C libs/east-node build
  make -C libs/e3 build
  NODE_OPTIONS=--max-old-space-size=4096 make -C libs/east-ui build
  pnpm --filter @elaraai/east-py-datascience run build
  pnpm --filter @elaraai/scaffold-core --filter @elaraai/create-e3 --filter @elaraai/create-east run build
  log "Building east-c (cmake, $TARGET)"
  # OS-aware to match publish-c-native: Ninja + MSVC on Windows; nproc has no
  # macOS equivalent so fall back to sysctl. (east-c's `make build` hardcodes
  # bare `nproc`, which fails on macOS — build cmake directly here.)
  ( mkdir -p libs/east-c/build && cd libs/east-c/build
    if [ "$TARGET" = "win32-x64" ]; then
      cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build . >/dev/null
    else
      cmake .. >/dev/null && cmake --build . -j"$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)" >/dev/null
    fi )
else
  log "SKIP_BUILD=1 — reusing existing dist/ + east-c build"
fi
test -x "libs/east-c/build/packages/east-c-cli/$BIN" \
  || { echo "::error::east-c binary missing — run without SKIP_BUILD"; exit 1; }

# ── 2. Start verdaccio ──────────────────────────────────────────────────────
# @elaraai/* is served LOCAL-only (no uplink proxy) so installs resolve the
# freshly-published versions, never the real npm ones. Publish requires an
# authenticated user — pnpm always sends its token, and verdaccio 401s a token
# it can't validate, so anonymous-publish + a dummy token does NOT work with
# pnpm; we register a real user below and use its real token instead.
log "Starting verdaccio on :${PORT}"
CONFIG="$WORK/verdaccio.yaml"
cat > "$CONFIG" <<EOF
storage: $WORK/storage
max_body_size: 100mb
auth:
  htpasswd:
    file: $WORK/htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    maxage: 60m
packages:
  '@elaraai/*':
    access: \$all
    publish: \$authenticated
    unpublish: \$authenticated
  '@*/*':
    access: \$all
    proxy: npmjs
  '**':
    access: \$all
    proxy: npmjs
logs:
  - { type: file, format: pretty, path: $WORK/verdaccio.log, level: info }
EOF
npx --yes verdaccio --config "$CONFIG" --listen "0.0.0.0:$PORT" > "$WORK/verdaccio.stdout" 2>&1 &
VERDACCIO_PID=$!
for _ in $(seq 1 30); do curl -sf "$URL/-/ping" >/dev/null 2>&1 && break || sleep 1; done
curl -sf "$URL/-/ping" >/dev/null || { echo "::error::verdaccio failed to start"; cat "$WORK/verdaccio.stdout"; exit 1; }

# ── 3. Register a user and capture its real token ───────────────────────────
log "Registering verdaccio user"
# Password must satisfy verdaccio's minimum-strength validation (newer
# versions reject short passwords), hence the longer literal.
RESP="$(curl -s -H 'Content-Type: application/json' -X PUT \
  "$URL/-/user/org.couchdb.user:ci" \
  -d '{"name":"ci","password":"dry-run-ci-pass"}')"
TOKEN="$(node -e "try{process.stdout.write(JSON.parse(process.argv[1]).token||'')}catch{}" "$RESP")"
[[ -n "$TOKEN" ]] || { echo "::error::could not obtain verdaccio token; response: $RESP"; exit 1; }

NPMRC="$WORK/.npmrc"
cat > "$NPMRC" <<EOF
registry=$URL/
@elaraai:registry=$URL/
//${HOST}:${PORT}/:_authToken=$TOKEN
EOF
export NPM_CONFIG_USERCONFIG="$NPMRC"

# ── 4. Publish the workspace JS packages (real publish path, local registry) ─
log "Publishing @elaraai/* JS packages to verdaccio"
node scripts/publish-npm.mjs beta --registry "$URL/"

# ── 5. Publish east-c-cli launcher + host-platform package ──────────────────
log "Publishing east-c-cli (launcher + ${TARGET})"
PLAT="$WORK/plat" && mkdir -p "$PLAT"
cp "libs/east-c/build/packages/east-c-cli/$BIN" "$PLAT/"
cp "libs/east-c/packages/east-c-cli/LICENSE.md" "$PLAT/"
node scripts/emit-east-c-platform-manifest.mjs --target "$TARGET" --version "$VERSION" --out "$PLAT/package.json"
node scripts/emit-east-c-platform-readme.mjs   --target "$TARGET" --version "$VERSION" --out "$PLAT/README.md"
( cd "$PLAT" && npm pack --pack-destination "$WORK" >/dev/null && npm publish "$WORK"/elaraai-east-c-cli-*.tgz --access public >/dev/null )

LAUNCHER="$WORK/launcher"
cp -r "libs/east-c/packages/east-c-cli" "$LAUNCHER"
node scripts/inject-east-c-platform-deps.mjs --version "$VERSION" --file "$LAUNCHER/package.json"
( cd "$LAUNCHER" && npm publish --access public >/dev/null )

# ── 6. Install into a throwaway consumer and smoke-test ─────────────────────
log "Installing published packages into a throwaway consumer"
PROJ="$WORK/consumer" && mkdir -p "$PROJ"
cp "$NPMRC" "$PROJ/.npmrc"
# A real consumer project: deps + npm scripts that invoke each CLI by bare
# name. `npm run` puts node_modules/.bin on PATH, so this proves the published
# bins resolve and run the way a user actually invokes them — not via a hand-
# built path. east-c-cli is the high-risk one: its bin resolves a per-platform
# binary (@elaraai/east-c-cli-<target>) via optionalDependencies and spawns it.
cat > "$PROJ/package.json" <<EOF
{
  "name": "east-release-dryrun-consumer",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@elaraai/east-c-cli": "$VERSION",
    "@elaraai/east-node-cli": "$VERSION",
    "@elaraai/e3-cli": "$VERSION",
    "@elaraai/east": "$VERSION",
    "@elaraai/east-node-std": "$VERSION"
  },
  "scripts": {
    "smoke": "east-c version && east-node version && e3 --version"
  }
}
EOF
( cd "$PROJ" && npm install --no-fund --no-audit >/dev/null )

log "Smoke tests (each CLI via npm run, resolved from node_modules/.bin)"
( cd "$PROJ" && npm run smoke )
echo -n "  require @elaraai/east: "; ( cd "$PROJ" && node -e "require('@elaraai/east'); console.log('ok')" )

log "PASS — full @elaraai/* release installs + runs from verdaccio (${TARGET})"
