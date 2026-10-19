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
        # The AlmaLinux 9 build: glibc 2.34 and GCC 11's libstdc++
        # (GLIBCXX_3.4.29), the floor the published runner holds
        # (scripts/check-glibc-floor.mjs), so the libraries the package ships
        # load wherever the runner does — Debian 12's node:22-slim included.
        # Its libraries sit under lib64/.
        ASSET="or-tools_amd64_almalinux-9_cpp_v${BUILD}.tar.gz"
        SHA256="269f46be850a30dee9390f01a909a0155788b028e7e0340631e1a48763f1181e"
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
