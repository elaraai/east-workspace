#!/usr/bin/env bash
# Stages east-c-datascience for distribution: what the per-platform npm package
# (@elaraai/east-c-datascience-<target>) ships under lib/.
#
# Usage: scripts/stage-datascience.sh <build-dir> <stage-dir>
#   build-dir  a build configured with -DEAST_C_DATASCIENCE=ON
#   stage-dir  made afresh: lib/ holds libeast-c-datascience and libeast-c-nn
#              with their installed rpaths ($ORIGIN; $ORIGIN/../libtorch/lib),
#              and every library they load that is neither the system's nor
#              libtorch's — OR-Tools' and XGBoost's OpenMP runtime — copied
#              beside them under the name they load it by (its soname), so the
#              directory is complete on any machine the runner's glibc floor
#              admits. libtorch is fetched into <package>/libtorch at install
#              (npm/fetch-libtorch.mjs), not staged.
#
# scripts/check-glibc-floor.mjs over <stage-dir>/lib then holds every library
# to the floor.
set -euo pipefail

BUILD="${1:?usage: stage-datascience.sh <build-dir> <stage-dir>}"
STAGE="${2:?usage: stage-datascience.sh <build-dir> <stage-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORTOOLS="${EAST_ORTOOLS_PREFIX:-$HERE/../build-deps/or-tools}"
LIBTORCH="${EAST_LIBTORCH_PREFIX:-$HERE/../build-deps/libtorch}"

rm -rf "$STAGE"
cmake --install "$BUILD" --component east-c-datascience --prefix "$STAGE" >/dev/null
LIB="$STAGE/lib"
test -f "$LIB/libeast-c-datascience.so" || { echo "stage-datascience: $BUILD has no east-c-datascience build" >&2; exit 1; }

# The system's, present wherever the runner itself runs.
system_lib() {
    case "$1" in
        libc.so.*|libm.so.*|libdl.so.*|libpthread.so.*|librt.so.*|libresolv.so.*|libutil.so.*|\
        libstdc++.so.*|libgcc_s.so.*|ld-linux-*) return 0 ;;
    esac
    return 1
}
# libtorch's, fetched at install.
torch_lib() { [ -e "$LIBTORCH/lib/$1" ]; }

# A soname to the file that provides it: OR-Tools' install, then the
# compiler's runtime (libgomp, XGBoost's OpenMP), then the system's cache.
resolve() {
    local n="$1" d p
    for d in "$ORTOOLS/lib64" "$ORTOOLS/lib"; do
        if [ -e "$d/$n" ]; then readlink -f "$d/$n"; return; fi
    done
    p="$(gcc -print-file-name="$n" 2>/dev/null || true)"
    if [ -n "$p" ] && [ "$p" != "$n" ] && [ -e "$p" ]; then readlink -f "$p"; return; fi
    p="$(ldconfig -p 2>/dev/null | awk -v n="$n" '$1 == n { print $NF; exit }')"
    if [ -n "$p" ] && [ -e "$p" ]; then readlink -f "$p"; return; fi
    echo "stage-datascience: no library provides $n" >&2
    exit 1
}
needed() { readelf -d "$1" | awk '/NEEDED/ { gsub(/[][]/, "", $NF); print $NF }'; }

queue=("$LIB/libeast-c-datascience.so" "$LIB/libeast-c-nn.so")
seen=" "
while [ ${#queue[@]} -gt 0 ]; do
    f="${queue[0]}"
    queue=("${queue[@]:1}")
    for n in $(needed "$f"); do
        system_lib "$n" && continue
        torch_lib "$n" && continue
        case "$seen" in *" $n "*) continue ;; esac
        seen="$seen$n "
        if [ ! -e "$LIB/$n" ]; then
            cp -L "$(resolve "$n")" "$LIB/$n"
            chmod 755 "$LIB/$n"
        fi
        queue+=("$LIB/$n")
    done
done

echo "stage-datascience: $(ls "$LIB" | wc -l) libraries, $(du -sh "$LIB" | cut -f1), at $LIB"
