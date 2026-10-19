#!/usr/bin/env bash
# Fetch the prebuilt OR-Tools C++ release east-c-datascience builds against.
#
# Usage: scripts/fetch-ortools.sh [prefix]
#   prefix  where the install lands (default: build-deps/or-tools beside this
#           script's parent, which the package's CMakeLists looks in first)
#
# OR-Tools is not checked into the tree: its C++ release archives are some
# 55 MB per platform and its source build takes most of an hour, so the
# package links a prebuilt install the way east-c-std links the system
# libcurl. This script pins one release per platform by its SHA-256 and
# refuses an archive whose bytes differ, so the build stays as reproducible as
# a checked-in source would be. A platform not listed here builds against any
# OR-Tools install named through CMAKE_PREFIX_PATH (or ortools_DIR).
#
# Set EAST_ORTOOLS_ARCHIVE to a local copy of the archive to skip the download.
set -euo pipefail

VERSION=9.15
BUILD=9.15.6755
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${1:-${HERE}/../build-deps/or-tools}"

case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
        ASSET="or-tools_amd64_ubuntu-24.04_cpp_v${BUILD}.tar.gz"
        SHA256="6f389320672cee00b78aacefb2bde33fef0bb988c3b2735573b9fffd1047fbda"
        ;;
    *)
        echo "fetch-ortools: no pinned OR-Tools ${VERSION} archive for $(uname -s)-$(uname -m)." >&2
        echo "  Install OR-Tools ${VERSION} (https://github.com/google/or-tools/releases/tag/v${VERSION})" >&2
        echo "  and configure with -DCMAKE_PREFIX_PATH=<its prefix>." >&2
        exit 1
        ;;
esac

STAMP="${PREFIX}/.east-ortools-${BUILD}"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$ASSET $SHA256" ]; then
    echo "fetch-ortools: ${PREFIX} already holds ${ASSET}"
    exit 0
fi

URL="https://github.com/google/or-tools/releases/download/v${VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -n "${EAST_ORTOOLS_ARCHIVE:-}" ]; then
    cp "$EAST_ORTOOLS_ARCHIVE" "$TMP/$ASSET"
else
    echo "fetch-ortools: downloading ${URL}"
    curl -sSfL --retry 3 -o "$TMP/$ASSET" "$URL"
fi
echo "${SHA256}  ${TMP}/${ASSET}" | sha256sum -c - >/dev/null || {
    echo "fetch-ortools: ${ASSET} does not match its pinned SHA-256" >&2
    exit 1
}
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
tar xzf "$TMP/$ASSET" -C "$PREFIX" --strip-components=1
echo "$ASSET $SHA256" > "$STAMP"
echo "fetch-ortools: installed OR-Tools ${BUILD} at ${PREFIX}"
