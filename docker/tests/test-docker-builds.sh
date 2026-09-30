#!/usr/bin/env bash
# Test: Docker image builds
# Verifies: every published image Dockerfile builds, and every runtime it
# carries starts in it (east-node, east-c, east-py, east-py-datascience
# FROM-chained, e3)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

# Pin every lockstep package the images install to ONE version when
# EAST_RELEASE_VERSION is set — the docker workflow sets it from the release
# tag, after waiting for npm and PyPI to serve that version — so the test
# builds exactly what the publish jobs will build. Unset, every image installs
# `latest`, as a local run wants. Each image is given only the ARGs its
# Dockerfile declares.
pin() {
    local arg
    if [ -n "${EAST_RELEASE_VERSION:-}" ]; then
        for arg in "$@"; do
            printf -- '--build-arg %s=%s ' "$arg" "$EAST_RELEASE_VERSION"
        done
    fi
    return 0
}
NODE_ARGS="EAST_VERSION EAST_NODE_STD_VERSION EAST_NODE_IO_VERSION EAST_NODE_CLI_VERSION EAST_UI_VERSION"
E3_ARGS="E3_VERSION E3_TYPES_VERSION E3_CORE_VERSION E3_CLI_VERSION E3_API_CLIENT_VERSION E3_API_SERVER_VERSION"

# runs <image> <command...>: the command starts in the built image and exits
# 0. Building is not enough: a runtime that cannot start builds fine — e3 and
# east-node crashed on start beside TypeScript 7 in images these builds passed
# (#1042), and the east-c prebuilt once lacked a shared library the slim base
# does not ship (#336).
runs() {
    local image="$1"
    shift
    echo "  runs: $*"
    docker run --rm "$image" "$@" > /dev/null
}

# The builds print their output (--progress=plain), not just an image id
# (--quiet): a failure inside the image is then in this job's log, which
# v1.0.71's and v1.0.83's were not.

echo "=== Testing Docker builds ==="
if [ -n "${EAST_RELEASE_VERSION:-}" ]; then
    echo "(every image pinned to ${EAST_RELEASE_VERSION})"
fi

# Test 1: east-node image. Its install carries e3's node packages too.
echo "[1/5] Building Dockerfile.east-node..."
# shellcheck disable=SC2046 # `pin` emits whitespace-separated --build-arg pairs
docker build -f docker/images/Dockerfile.east-node $(pin $NODE_ARGS $E3_ARGS) -t test-east-node-$$ . --progress=plain
runs test-east-node-$$ east-node --version
runs test-east-node-$$ e3 --version
docker rmi test-east-node-$$ > /dev/null
echo "[OK] Dockerfile.east-node (builds + east-node and e3 run)"

# Test 2: east-c image (tiny — just the prebuilt evaluator).
echo "[2/5] Building Dockerfile.east-c..."
# shellcheck disable=SC2046
docker build -f docker/images/Dockerfile.east-c $(pin EAST_C_CLI_VERSION) -t test-east-c-$$ . --progress=plain
runs test-east-c-$$ east-c version
docker rmi test-east-c-$$ > /dev/null
echo "[OK] Dockerfile.east-c (builds + evaluator runs)"

# Test 3: east-py image (python runtime, no datascience). Kept for test 4's
# FROM chain, removed after. `east-py version` exits 0 when east cannot
# import, so the import is checked on its own.
echo "[3/5] Building Dockerfile.east-py..."
# shellcheck disable=SC2046
docker build -f docker/images/Dockerfile.east-py $(pin EAST_PY_VERSION) -t test-east-py-$$ . --progress=plain
runs test-east-py-$$ east-py version
runs test-east-py-$$ python3 -c "import east, east_py_std, east_py_io"
echo "[OK] Dockerfile.east-py (builds + east-py runs)"

# Test 4: east-py-datascience FROM the image test 3 just built (BASE_IMAGE
# override — the ghcr base doesn't exist for unpublished versions). Proves
# the FROM chain and the single-layer datascience delta.
echo "[4/5] Building Dockerfile.east-py-datascience (FROM local east-py)..."
# shellcheck disable=SC2046
docker build -f docker/images/Dockerfile.east-py-datascience \
    --build-arg BASE_IMAGE=test-east-py-$$ $(pin EAST_PY_VERSION) \
    -t test-east-py-ds-$$ . --progress=plain
runs test-east-py-ds-$$ east-py version
runs test-east-py-ds-$$ python3 -c "import east, east_py_datascience"
docker rmi test-east-py-ds-$$ test-east-py-$$ > /dev/null
echo "[OK] Dockerfile.east-py-datascience (builds + its platform imports)"

# Test 5: e3 image (the everything / local-dev image)
echo "[5/5] Building Dockerfile.e3..."
# shellcheck disable=SC2046
docker build -f docker/images/Dockerfile.e3 \
    $(pin $NODE_ARGS $E3_ARGS EAST_C_CLI_VERSION EAST_PY_VERSION) \
    -t test-e3-$$ . --progress=plain
runs test-e3-$$ e3 --version
runs test-e3-$$ east-node --version
runs test-e3-$$ east-c version
runs test-e3-$$ east-py version
runs test-e3-$$ python3 -c "import east, east_py_std, east_py_io, east_py_datascience"
docker rmi test-e3-$$ > /dev/null
echo "[OK] Dockerfile.e3 (builds + e3, east-node, east-c and east-py run)"

echo "=== Docker builds PASSED ==="
