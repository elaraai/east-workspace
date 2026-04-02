#!/usr/bin/env bash
#
# e3 Project Scaffolding (BSL-1.1)
# Usage: curl -sSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/project/e3.sh | bash
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
    "test:export": "EXPORT_TEST_IR=/tmp/$PROJECT_NAME-tests node --enable-source-maps --test 'dist/**/*.spec.js' 2>&1 | grep 'Exported test IR'",
    "lint": "eslint ."
  },
  "dependencies": {
    "@elaraai/east": "beta",
    "@elaraai/east-node-std": "beta",
    "@elaraai/east-node-io": "beta",
    "@elaraai/east-py-datascience": "beta",
    "@elaraai/e3": "beta",
    "@elaraai/e3-types": "beta"
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
  "east-py @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py",
  "east-py-std @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-std",
  "east-py-io @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-io",
  "east-py-datascience @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-datascience",
  "east-py-cli @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-cli",
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
"""Tests that run TypeScript-exported IR tests.

This module loads IR test files exported from TypeScript via \`npm run test:export\`
and executes them in Python to verify cross-implementation compatibility.

To generate the test IR files:
    npm run test:export
"""

import asyncio
from pathlib import Path
from typing import Any

import pytest
from east.runtime.compiler import compile, compile_async
from east.runtime.platform import PlatformFunction
from east.serialization.json import decode_json_for
from east.types.type_of_type import IRType
from east.types.types import FunctionType, NullType, StringType

from east_py_std import platform as std_platform
from east_py_io import platform as io_platform

# Path where TypeScript exports test IR
TEST_IR_DIR = Path("/tmp/$PROJECT_NAME-tests")


def get_test_ir_files():
    """Get list of exported test IR JSON files."""
    if not TEST_IR_DIR.exists():
        return []
    files = list(TEST_IR_DIR.glob("*.json"))
    return sorted(files)


@pytest.fixture
def test_platforms(subtests):
    """Platform functions for tests - combines platform with test tracking."""
    executed_tests = []
    failures = []
    current_test_stack = []

    async def describe_impl(name: str, test_fn: Any) -> None:
        executed_tests.append(("describe", name))
        current_test_stack.append(("describe", name))
        with subtests.test(msg=f"[{name}]"):
            try:
                if callable(test_fn):
                    result = test_fn()
                    if asyncio.iscoroutine(result):
                        await result
            finally:
                current_test_stack.pop()

    async def test_impl_fn(name: str, test_fn: Any) -> None:
        test_path = " > ".join(n for _, n in current_test_stack) + f" > {name}"
        executed_tests.append(("test", name, test_path))
        current_test_stack.append(("test", name))
        with subtests.test(msg=test_path):
            try:
                if callable(test_fn):
                    result = test_fn()
                    if asyncio.iscoroutine(result):
                        await result
            except Exception as e:
                failures.append({"path": test_path, "error": str(e)})
                raise
            finally:
                current_test_stack.pop()

    def test_pass_impl() -> None:
        pass

    def test_fail_impl(message: str) -> None:
        raise AssertionError(message)

    test_platform_fns = [
        PlatformFunction(
            name="describe",
            inputs=[StringType, FunctionType([], NullType)],
            output=NullType,
            type="async",
            fn=describe_impl,
        ),
        PlatformFunction(
            name="test",
            inputs=[StringType, FunctionType([], NullType)],
            output=NullType,
            type="async",
            fn=test_impl_fn,
        ),
        PlatformFunction(
            name="testPass",
            inputs=[],
            output=NullType,
            type="sync",
            fn=test_pass_impl,
        ),
        PlatformFunction(
            name="testFail",
            inputs=[StringType],
            output=NullType,
            type="sync",
            fn=test_fail_impl,
        ),
    ]

    test_fn_names = {"describe", "test", "testPass", "testFail"}
    combined_platform = [
        pf for pf in std_platform if pf["name"] not in test_fn_names
    ] + [
        pf for pf in io_platform if pf["name"] not in test_fn_names
    ] + test_platform_fns

    return combined_platform, executed_tests, failures


@pytest.mark.parametrize(
    "test_file",
    get_test_ir_files(),
    ids=lambda p: p.stem,
)
def test_typescript_exported_ir(test_file, test_platforms):
    """Test that TypeScript-exported IR executes correctly in Python."""
    platform_fns, executed_tests, failures = test_platforms

    with open(test_file, "rb") as f:
        json_data = f.read()

    decoder = decode_json_for(IRType)
    ir = decoder(json_data)

    is_async_ir = ir.type == "AsyncFunction"
    compiled_test = (
        compile_async(ir, platform_fns) if is_async_ir else compile(ir, platform_fns)
    )

    print(f"\n{test_file.stem} test cases:", flush=True)
    if is_async_ir:
        asyncio.run(compiled_test())
    else:
        compiled_test()

    assert len(executed_tests) > 0, f"Test {test_file.stem} didn't execute any tests"

    test_count = sum(1 for t in executed_tests if t[0] == "test")
    if failures:
        pytest.fail(f"{len(failures)}/{test_count} test(s) failed")


def test_typescript_test_ir_directory_exists():
    """Verify that TypeScript test IR directory exists."""
    if not TEST_IR_DIR.exists():
        pytest.skip(
            f"Test IR directory {TEST_IR_DIR} not found. "
            "Run 'npm run test:export' to generate test files."
        )
    files = get_test_ir_files()
    assert len(files) > 0, f"No test IR files found in {TEST_IR_DIR}"
EOF

    cat > "$PROJECT_DIR/Makefile" << EOF
.PHONY: install update build test test-ts test-py lint clean repo start watch

install:
	npm install
	uv sync

update:
	npm install -g @elaraai/e3-cli@beta
	npm update \$\$(grep -roh '"@elaraai/[^"]*"' --include='package.json' . | tr -d '"' | sort -u | tr '\n' ' ')
	rm -rf ~/.cache/uv/git-v0
	uv lock --upgrade-package east-py --upgrade-package east-py-std --upgrade-package east-py-io --upgrade-package east-py-cli --upgrade-package east-py-datascience
	uv sync --reinstall-package east-py --reinstall-package east-py-std --reinstall-package east-py-io --reinstall-package east-py-cli --reinstall-package east-py-datascience
	uv sync --all-extras --all-packages

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
	e3 package import .repos /tmp/pkg.zip
	e3 workspace deploy .repos $WORKSPACE_NAME $PROJECT_NAME@1.0.0
	e3 start .repos $WORKSPACE_NAME

watch: repo
	e3 watch .repos $WORKSPACE_NAME ./src/index.ts --start
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
