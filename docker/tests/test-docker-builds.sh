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

# holds_pins <image>: for a named release, the image holds the build of
# everything its release pins (e3: a project and its tier resolve the same
# torch). Its own tier manifest says what it holds, and the pins it was
# installed under are in it. Unpinned, an image installs `latest` under no
# pins, and there is nothing to hold it to.
holds_pins() {
    local image="$1"
    if [ -z "${EAST_RELEASE_VERSION:-}" ]; then
        return 0
    fi
    echo "  holds its release's pins"
    docker run --rm -v "$SCRIPT_DIR/check-tier-pins.py:/tmp/check-tier-pins.py:ro" "$image" \
        python3 /tmp/check-tier-pins.py /opt/e3/tier-manifest.json /opt/e3/east-py-constraints.txt
}

echo "=== Testing Docker builds ==="
if [ -n "${EAST_RELEASE_VERSION:-}" ]; then
    echo "(every image pinned to ${EAST_RELEASE_VERSION})"
fi

# Test 1: east-node image: East's AGPL Node packages alone. No e3 (its core,
# CLI and API packages are BUSL), which e3-cloud's node-tier runner, built on
# this image, bundles itself; no east-c; no Python.
echo "[1/5] Building Dockerfile.east-node..."
# shellcheck disable=SC2046 # `pin` emits whitespace-separated --build-arg pairs
docker build -f docker/images/Dockerfile.east-node $(pin $NODE_ARGS) -t test-east-node-$$ . --progress=plain
runs test-east-node-$$ east-node --version
runs test-east-node-$$ sh -c '! ls "$(npm root -g)/@elaraai" | grep -q "^e3"'
docker rmi test-east-node-$$ > /dev/null
echo "[OK] Dockerfile.east-node (builds + east-node runs, and it carries no e3)"

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
# Its tier manifest names what it holds, for an environment built over it
runs test-east-py-$$ python3 -c "import json; m = json.load(open('/opt/e3/tier-manifest.json')); names = [d['name'] for d in m['distributions']]; assert m['version'] == 1 and m['python']['executable'] == '/opt/venv/bin/python' and m['python']['base'].startswith('/usr/') and isinstance(m['namespaces'], list) and 'east' not in m['namespaces'] and 'elaraai-east-py-std' in names and 'elaraai-east-py-datascience' not in names, names"
holds_pins test-east-py-$$
echo "[OK] Dockerfile.east-py (builds + east-py runs + tier manifest)"

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
# torch and xgboost load in one process: each brings an NCCL library of its
# own, which install the same file
runs test-east-py-ds-$$ python3 -c "import torch, xgboost"
# Its manifest is its own, written again once the datascience packages are in
runs test-east-py-ds-$$ python3 -c "import json; m = json.load(open('/opt/e3/tier-manifest.json')); names = [d['name'] for d in m['distributions']]; assert 'elaraai-east-py-datascience' in names and 'elaraai-east-py-std' in names, names"
holds_pins test-east-py-ds-$$
if [ -n "${EAST_RELEASE_VERSION:-}" ]; then
    # The torch a project gets by asking for the package's extras is the
    # image's: the extras pin it exactly, at the version installed here
    runs test-east-py-ds-$$ python3 -c "from importlib.metadata import requires, version; pins = [r.split(';')[0].replace(' ', '') for r in requires('elaraai-east-py-datascience') if r.replace(' ', '').startswith('torch')]; assert pins and all(pin == 'torch==' + version('torch') for pin in pins), (pins, version('torch'))"
fi
docker rmi test-east-py-ds-$$ test-east-py-$$ > /dev/null
echo "[OK] Dockerfile.east-py-datascience (builds + its platform imports + tier manifest)"

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
