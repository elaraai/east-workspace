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
# network trained on one runner runs on the other on the same kernels. Only
# the CPU build's hash is pinned here: a CUDA build is chosen by
# EAST_LIBTORCH_VARIANT (cu126, cu128, ...) and must be given its SHA-256,
# which the script prints after a first download so it can be pinned by the
# caller (a CI secret, a Makefile variable).
set -euo pipefail

VERSION="2.10.0"
VARIANT="${EAST_LIBTORCH_VARIANT:-cpu}"
# libtorch-shared-with-deps-2.10.0+cpu.zip, Linux x86_64
CPU_SHA256="c5bf8efda9224a2d971b19d1ef6cf3ba6fee8ab53e69c49427db003d1d300496"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

if [ "$VARIANT" = "cpu" ]; then
    expected="$CPU_SHA256"
else
    expected="${EAST_LIBTORCH_SHA256:-}"
fi

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
