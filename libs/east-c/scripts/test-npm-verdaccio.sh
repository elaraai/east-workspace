#!/bin/bash
# End-to-end test of the east-c npm distribution against a local verdaccio
# registry. Repeatable: builds the binary fresh, spins up verdaccio, publishes
# all 6 packages, installs them as a real consumer would, invokes east-c.
#
# Run via `make test-npm-verdaccio` from libs/east-c. Cleans up its own
# verdaccio + tmp dirs on exit (success or failure).
#
# Limitation: only validates the current host's platform (we can't build
# the other 4 binaries locally). For full matrix coverage, run this on
# each OS leg of CI, or extend release.yml to also publish to verdaccio
# pre-merge.
set -euo pipefail

# ── Layout / config ────────────────────────────────────────────────────────
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$LIB_ROOT/../.." && pwd)"
WORK="$(mktemp -d -t east-c-verdaccio-XXXXXX)"
VERDACCIO_PORT=4873
VERDACCIO_URL="http://localhost:${VERDACCIO_PORT}"
VERDACCIO_PID=

trap 'rc=$?; [[ -n "$VERDACCIO_PID" ]] && kill "$VERDACCIO_PID" 2>/dev/null || true; rm -rf "$WORK"; exit $rc' EXIT INT TERM

log() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }

# ── 1. Detect platform ─────────────────────────────────────────────────────
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  TARGET=linux-x64;    BIN=east-c     ;;
  Linux-aarch64) TARGET=linux-arm64;  BIN=east-c     ;;
  Darwin-arm64)  TARGET=darwin-arm64; BIN=east-c     ;;
  Darwin-x86_64) TARGET=darwin-x64;   BIN=east-c     ;;
  MINGW*-x86_64|CYGWIN*-x86_64|MSYS*-x86_64) TARGET=win32-x64; BIN=east-c.exe ;;
  *) echo "::error::Unsupported host: $(uname -s)-$(uname -m)"; exit 1 ;;
esac
log "Target = $TARGET"

# ── 2. Build the native binary ─────────────────────────────────────────────
log "Building east-c (cmake)"
make -C "$LIB_ROOT" build >/dev/null
test -x "$LIB_ROOT/build/packages/east-c-cli/$BIN" \
  || { echo "::error::Built binary missing: $LIB_ROOT/build/packages/east-c-cli/$BIN"; exit 1; }

# ── 3. Stage the per-platform package + launcher ───────────────────────────
log "Staging per-platform npm package + launcher"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
PLAT="$WORK/plat" && mkdir -p "$PLAT"
cp "$LIB_ROOT/build/packages/east-c-cli/$BIN" "$PLAT/"
cp "$LIB_ROOT/packages/east-c-cli/LICENSE.md" "$PLAT/"
node "$REPO_ROOT/scripts/emit-east-c-platform-manifest.mjs" \
  --target "$TARGET" --version "$VERSION" --out "$PLAT/package.json"
node "$REPO_ROOT/scripts/emit-east-c-platform-readme.mjs" \
  --target "$TARGET" --version "$VERSION" --out "$PLAT/README.md"
( cd "$PLAT" && npm pack --pack-destination "$WORK" >/dev/null )

# Launcher: inject the per-platform optionalDependencies (same step
# release.yml runs before pnpm publish — keeps the committed package.json
# clean and the published one functional).
LAUNCHER="$WORK/launcher"
cp -r "$LIB_ROOT/packages/east-c-cli" "$LAUNCHER"
node "$REPO_ROOT/scripts/inject-east-c-platform-deps.mjs" \
  --version "$VERSION" --file "$LAUNCHER/package.json"
( cd "$LAUNCHER" && npm pack --pack-destination "$WORK" >/dev/null )

# ── 4. Start verdaccio with anonymous publish ──────────────────────────────
log "Starting verdaccio on :${VERDACCIO_PORT}"
VERDACCIO_CONFIG="$WORK/verdaccio.yaml"
cat > "$VERDACCIO_CONFIG" <<EOF
storage: $WORK/verdaccio-storage
auth:
  htpasswd:
    file: $WORK/htpasswd
packages:
  '@elaraai/east-c-cli':
    access: \$anonymous
    publish: \$anonymous
    unpublish: \$anonymous
  '@elaraai/east-c-cli-*':
    access: \$anonymous
    publish: \$anonymous
    unpublish: \$anonymous
  '@*/*':
    access: \$all
    proxy: npmjs
  '**':
    access: \$all
    proxy: npmjs
logs:
  - { type: file, format: pretty, path: $WORK/verdaccio.log, level: warn }
EOF
npx --yes verdaccio --config "$VERDACCIO_CONFIG" --listen "$VERDACCIO_PORT" \
  > "$WORK/verdaccio.stdout" 2>&1 &
VERDACCIO_PID=$!
for _ in {1..30}; do
  curl -sf "$VERDACCIO_URL/-/ping" >/dev/null 2>&1 && break || sleep 1
done
curl -sf "$VERDACCIO_URL/-/ping" >/dev/null || { echo "::error::verdaccio failed to start"; cat "$WORK/verdaccio.stdout"; exit 1; }

# ── 5. Publish all packages to verdaccio ───────────────────────────────────
log "Publishing to verdaccio"
NPMRC="$WORK/.npmrc"
echo "registry=$VERDACCIO_URL/" > "$NPMRC"
echo "//localhost:${VERDACCIO_PORT}/:_authToken=anon" >> "$NPMRC"
for tgz in "$WORK"/elaraai-east-c-cli-*.tgz; do
  echo "  → $(basename "$tgz")"
  npm publish "$tgz" --userconfig "$NPMRC" --access public >/dev/null
done

# ── 6. Real consumer install ───────────────────────────────────────────────
log "Installing in throwaway consumer project"
PROJ="$WORK/consumer" && mkdir -p "$PROJ"
cp "$NPMRC" "$PROJ/.npmrc"
( cd "$PROJ" && npm init -y >/dev/null && \
    npm install --no-fund --no-audit @elaraai/east-c-cli >/dev/null )

# ── 7. Invoke east-c through the symlinked bin ─────────────────────────────
log "Invoking east-c via consumer's node_modules/.bin"
"$PROJ/node_modules/.bin/east-c" version
echo
ls -la "$PROJ/node_modules/.bin/east-c" \
       "$PROJ/node_modules/@elaraai/east-c-cli" \
       "$PROJ/node_modules/@elaraai/east-c-cli-${TARGET}" 2>&1 | head -10

log "PASS — full @elaraai/east-c-cli → @elaraai/east-c-cli-${TARGET} install + invoke green on verdaccio"
