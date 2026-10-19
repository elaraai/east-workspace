#!/usr/bin/env bash
# Fetch the pinned libtorch release east-c-datascience's neural-network family
# builds against (docs/neural-networks.md; east-workspace#1357), into
# build-deps/libtorch (gitignored), verified by SHA-256. CMake never downloads
# (scripts/check-native-sources.mjs); this script is the one place that does.
#
#   scripts/fetch-libtorch.sh                 # the CPU build, Linux x86_64
#   EAST_LIBTORCH_VARIANT=cu128 \
#   EAST_LIBTORCH_SHA256=<hex> scripts/fetch-libtorch.sh   # a CUDA build, its hash supplied
#   EAST_LIBTORCH_ARCHIVE=/path/libtorch.zip scripts/fetch-libtorch.sh   # an archive already fetched
#
# The version matches the torch python pins (libs/east-py/uv.lock), so a
# network trained on one runner runs on the other on the same kernels. The
# builds pinned are those in libtorch-pins.json; another variant
# (EAST_LIBTORCH_VARIANT=cu126, ...) must be given its SHA-256, which the
# script prints after a first download so it can be pinned there.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The pins — the version and each variant's SHA-256 — are libtorch-pins.json
# beside this script, which the npm package's fetch (packages/east-c-datascience/
# npm/fetch-libtorch.mjs) reads too, so a build and an install take one build.
PINS="$here/libtorch-pins.json"
VERSION="$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$PINS")"
VARIANT="${EAST_LIBTORCH_VARIANT:-cpu}"
PINNED_SHA256="$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["variants"].get(sys.argv[2], {}).get("sha256", ""))' "$PINS" "$VARIANT")"

prefix="${1:-$here/../build-deps/libtorch}"
stamp="$prefix/.east-libtorch-$VERSION-$VARIANT"

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
    echo "fetch-libtorch: only Linux x86_64 is pinned here; install libtorch $VERSION yourself and point EAST_LIBTORCH_PREFIX at it" >&2
    exit 1
fi

if [ -f "$stamp" ]; then
    echo "fetch-libtorch: libtorch $VERSION ($VARIANT) already at $prefix"
    exit 0
fi

expected="${PINNED_SHA256:-${EAST_LIBTORCH_SHA256:-}}"

archive="${EAST_LIBTORCH_ARCHIVE:-}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -z "$archive" ]; then
    url="https://download.pytorch.org/libtorch/$VARIANT/libtorch-shared-with-deps-$VERSION%2B$VARIANT.zip"
    echo "fetch-libtorch: downloading $url"
    archive="$tmp/libtorch.zip"
    curl -fsSL --retry 3 -o "$archive" "$url"
fi

actual="$(sha256sum "$archive" | cut -d' ' -f1)"
if [ -z "$expected" ]; then
    echo "fetch-libtorch: the $VARIANT build's SHA-256 is $actual" >&2
    echo "fetch-libtorch: pass it as EAST_LIBTORCH_SHA256 to accept this build" >&2
    exit 1
fi
if [ "$actual" != "$expected" ]; then
    echo "fetch-libtorch: SHA-256 mismatch for libtorch $VERSION ($VARIANT): expected $expected, got $actual" >&2
    exit 1
fi

rm -rf "$prefix"
mkdir -p "$(dirname "$prefix")"
python3 -I -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$archive" "$tmp/extract"
mv "$tmp/extract/libtorch" "$prefix"
touch "$stamp"
echo "fetch-libtorch: libtorch $VERSION ($VARIANT) at $prefix"
