#!/usr/bin/env bash
#
# e3 Project Scaffolding (BSL-1.1)
# Usage: curl -sSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/scaffold/e3.sh | bash
#    or: ./e3.sh [project-name]
#

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

get_project_name() {
    if [ -n "$1" ]; then
        PROJECT_NAME="$1"
    else
        echo -e "${BLUE}Enter project name (or '.' for current directory):${NC}"
        read -r PROJECT_NAME < /dev/tty
    fi
    [ -z "$PROJECT_NAME" ] && { echo -e "${RED}Project name required${NC}"; exit 1; }

    # Handle current directory case
    if [ "$PROJECT_NAME" = "." ]; then
        USE_CURRENT_DIR=true
        PROJECT_NAME=$(basename "$(pwd)")
    else
        USE_CURRENT_DIR=false
    fi

    PROJECT_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '--')
    # Title case conversion (portable)
    DISPLAY_NAME=$(echo "$PROJECT_NAME" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')
    WORKSPACE_NAME=$(echo "$PROJECT_NAME" | tr '-' '_')
}

create_project() {
    if [ "$USE_CURRENT_DIR" = true ]; then
        PROJECT_DIR="."
    else
        [ -d "$PROJECT_NAME" ] && { echo -e "${RED}Directory '$PROJECT_NAME' exists${NC}"; exit 1; }
        PROJECT_DIR="$PROJECT_NAME"
    fi

    echo -e "${BLUE}Creating e3 project: $PROJECT_NAME (BSL-1.1)${NC}"
    mkdir -p "$PROJECT_DIR/src"
    mkdir -p "$PROJECT_DIR/tests"

    cat > "$PROJECT_DIR/package.json" << EOF
{
  "name": "@elaraai/$PROJECT_NAME",
  "version": "0.0.1",
  "description": "$DISPLAY_NAME",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "main": "node --max-old-space-size=16000 ./dist/main.js",
    "test": "node --enable-source-maps --test 'dist/**/*.spec.js'",
    "test:export": "EXPORT_TEST_IR=dist/test-ir node --enable-source-maps --test 'dist/**/*.spec.js' 2>&1 | grep 'Exported test IR'",
    "lint": "eslint ."
  },
  "dependencies": {
    "@elaraai/east": "latest",
    "@elaraai/east-node-std": "latest",
    "@elaraai/east-node-io": "latest",
    "@elaraai/east-py-datascience": "latest",
    "@elaraai/e3": "latest",
    "@elaraai/e3-types": "latest"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5",
    "eslint": "^9",
    "@typescript-eslint/eslint-plugin": "^8",
    "@typescript-eslint/parser": "^8"
  },
  "engines": { "node": ">=22" }
}
EOF

    cat > "$PROJECT_DIR/pyproject.toml" << EOF
[project]
name = "$PROJECT_NAME"
description = "$DISPLAY_NAME"
requires-python = ">=3.11"
version = "0.1.0"
dependencies = [
  "elaraai-east-py",
  "elaraai-east-py-std",
  "elaraai-east-py-io",
  "elaraai-east-py-datascience",
  "elaraai-east-py-cli",
  "pytest",
  "pytest-subtests",
]
EOF

    cat > "$PROJECT_DIR/tsconfig.json" << 'EOF'
{
  "exclude": ["dist"],
  "compilerOptions": {
    "outDir": "./dist",
    "module": "nodenext",
    "target": "esnext",
    "lib": ["esnext", "es2024"],
    "types": ["node"],
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "strict": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "noErrorTruncation": true,
    "incremental": true
  }
}
EOF

    cat > "$PROJECT_DIR/.gitignore" << 'EOF'
node_modules/
dist/
*.tsbuildinfo
.venv/
__pycache__/
.e3/
.repos/
EOF

    cat > "$PROJECT_DIR/src/index.ts" << 'EOF'
import e3 from "@elaraai/e3";
import { East, StringType } from "@elaraai/east";

export const nameInput = e3.input("name", StringType, "World!");

export const greetFn = East.function(
    [StringType],
    StringType,
    ($, name) => East.str`Hello, ${name}!`
);

export const greet = e3.task("greet", [nameInput], greetFn);
EOF

    cat > "$PROJECT_DIR/src/index.spec.ts" << EOF
import { East } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { greetFn } from "./index.js";

describeEast("$DISPLAY_NAME", (test) => {
    test("greet returns greeting message", \$ => {
        const result = \$.let(greetFn("World"));
        \$(Assert.equal(result, East.value("Hello, World!")));
    });

    test("greet with custom name", \$ => {
        const result = \$.let(greetFn("East"));
        \$(Assert.equal(result, East.value("Hello, East!")));
    });
}, { exportOnly: true });
EOF

    cat > "$PROJECT_DIR/src/main.ts" << EOF
import e3 from "@elaraai/e3";
import { greet } from "./index.js";

const pkg = e3.package('$PROJECT_NAME', '1.0.0', greet);
void e3.export(pkg, '/tmp/pkg.zip');
export default pkg;
EOF

    cat > "$PROJECT_DIR/tests/test_unit.py" << EOF
"""Run TypeScript-exported IR tests through the east-c Python bridge.

Generate IR first:  make test:export   (or \`npm run test:export\`)
Then run:           uv run pytest -v
"""

import time
from pathlib import Path

from east.runtime.compiler import compile_from_json
from east.runtime.platform import PlatformFunction
from east.runtime._compiler_eastc import _eastc_call
from east.types.types import FunctionType, NullType, StringType

try:
    from east_py_std import platform as std_platform
except ImportError:
    std_platform = []

try:
    from east_py_io import platform as io_platform
except ImportError:
    io_platform = []

TEST_IR_DIR = Path("dist/test-ir")


def _get_ir_files():
    if not TEST_IR_DIR.exists():
        return []
    return sorted(TEST_IR_DIR.glob("*.json"))


def run_one(ir_file: Path) -> tuple[int, int]:
    """Compile and run one IR test file. Returns (passed, failed)."""
    data = ir_file.read_bytes()
    is_async = b'"AsyncFunction"' in data[:100]

    passed = 0
    failed = 0

    def describe_impl(name, test_fn):
        if callable(test_fn):
            try:
                test_fn()
            except Exception:
                pass

    def test_impl(name, test_fn):
        nonlocal passed, failed
        try:
            if callable(test_fn):
                test_fn()
            passed += 1
        except Exception:
            failed += 1

    def test_pass():
        pass

    def test_fail(msg):
        raise AssertionError(msg)

    test_names = {"describe", "test", "testPass", "testFail"}
    platform = [
        pf for pf in std_platform if pf["name"] not in test_names
    ] + [
        pf for pf in io_platform if pf["name"] not in test_names
    ] + [
        PlatformFunction(name="describe", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=describe_impl),
        PlatformFunction(name="test", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=test_impl),
        PlatformFunction(name="testPass", inputs=[], output=NullType, type="sync", fn=test_pass),
        PlatformFunction(name="testFail", inputs=[StringType], output=NullType, type="sync", fn=test_fail),
    ]

    compiled = compile_from_json(data, platform, is_async=is_async)
    handle = compiled._eastc_handle
    _eastc_call(handle._compiled, handle._input_types, handle._output_type, ())
    return passed, failed


# ── pytest integration ────────────────────────────────────────────────────────

def pytest_generate_tests(metafunc):
    if "ir_file" in metafunc.fixturenames:
        files = _get_ir_files()
        metafunc.parametrize("ir_file", files, ids=[f.stem for f in files])


def test_ir(ir_file):
    passed, failed = run_one(ir_file)
    assert failed == 0, f"{failed} test(s) failed in {ir_file.stem}"
    assert passed > 0, f"No tests ran in {ir_file.stem}"
EOF

    cat > "$PROJECT_DIR/Makefile" << EOF
.PHONY: install update build test test-ts test-py lint clean repo start watch

install:
	npm install
	uv sync

update:
	npm install -g @elaraai/e3-cli@latest
	e3 completion install 2>/dev/null || true
	npm update \$\$(grep -roh '"@elaraai/[^"]*"' --include='package.json' . | tr -d '"' | sort -u | tr '\n' ' ')
	uv lock --upgrade-package elaraai-east-py --upgrade-package elaraai-east-py-std --upgrade-package elaraai-east-py-io --upgrade-package elaraai-east-py-cli --upgrade-package elaraai-east-py-datascience
	uv sync

build:
	npm run build

# Run full test suite: export IR from TypeScript, then run Python
test: build
	npm run test:export
	uv run pytest -v

# Run TypeScript tests only (compiles and runs with Node)
test-ts: build
	npm run test

# Run Python tests only (requires IR to be exported first)
test-py:
	uv run pytest -v

lint:
	npm run lint

clean:
	rm -rf dist node_modules .venv uv.lock *.tsbuildinfo .repos

repo:
	e3 repo create .repos 2>/dev/null || true
	e3 workspace create .repos $WORKSPACE_NAME 2>/dev/null || true

start: build repo
	npm run main
	e3 workspace deploy .repos $WORKSPACE_NAME --from-zip /tmp/pkg.zip
	e3 dataflow run .repos $WORKSPACE_NAME

watch: repo
	e3 watch ./src/index.ts .repos $WORKSPACE_NAME --start
EOF

    echo "22" > "$PROJECT_DIR/.nvmrc"
    echo "3.11" > "$PROJECT_DIR/.python-version"

    cat > "$PROJECT_DIR/README.md" << EOF
# $DISPLAY_NAME

e3 project (BSL-1.1).

## Setup

\`\`\`bash
make install
\`\`\`

## Usage

\`\`\`bash
make update     # Update @elaraai packages and e3 CLI
make build      # Build TypeScript
make test       # Run full test suite (exports IR, runs Python tests)
make test-ts    # Run TypeScript tests only
make test-py    # Run Python tests only (requires IR exported first)
make repo       # Create e3 repository and workspace
make start      # Build, package, import, deploy and run
make watch      # Watch mode (auto-deploy on changes)
\`\`\`
EOF

    echo -e "${GREEN}Created $PROJECT_NAME${NC}"
    if [ "$USE_CURRENT_DIR" = true ]; then
        echo "  make install"
    else
        echo "  cd $PROJECT_NAME && make install"
    fi
}

get_project_name "$1"
create_project
