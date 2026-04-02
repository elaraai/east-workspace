#!/usr/bin/env bash
#
# East Project Scaffolding (AGPL-3.0)
# Usage: curl -sSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/project/east.sh | bash
#    or: ./east.sh [project-name]
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
}

create_project() {
    if [ "$USE_CURRENT_DIR" = true ]; then
        PROJECT_DIR="."
    else
        [ -d "$PROJECT_NAME" ] && { echo -e "${RED}Directory '$PROJECT_NAME' exists${NC}"; exit 1; }
        PROJECT_DIR="$PROJECT_NAME"
    fi

    echo -e "${BLUE}Creating East project: $PROJECT_NAME (AGPL-3.0)${NC}"
    mkdir -p "$PROJECT_DIR/src"

    cat > "$PROJECT_DIR/package.json" << EOF
{
  "name": "@elaraai/$PROJECT_NAME",
  "version": "0.0.1",
  "description": "$DISPLAY_NAME",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "node --enable-source-maps --test 'dist/**/*.spec.js'",
    "lint": "eslint ."
  },
  "dependencies": {
    "@elaraai/east": "beta",
    "@elaraai/east-node-std": "beta",
    "@elaraai/east-node-io": "beta"
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
EOF

    cat > "$PROJECT_DIR/src/index.ts" << 'EOF'
import { East, StringType } from "@elaraai/east";

export const greet = East.function(
    [StringType],
    StringType,
    ($, name) => East.str`Hello, ${name}!`
);
EOF

    cat > "$PROJECT_DIR/src/index.spec.ts" << EOF
import { East } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { greet } from "./index.js";

describeEast("$DISPLAY_NAME", (test) => {
    test("greet returns greeting message", \$ => {
        const result = \$.let(greet("World"));
        \$(Assert.equal(result, East.value("Hello, World!")));
    });

    test("greet with custom name", \$ => {
        const result = \$.let(greet("East"));
        \$(Assert.equal(result, East.value("Hello, East!")));
    });
});
EOF

    cat > "$PROJECT_DIR/Makefile" << 'EOF'
.PHONY: install update build test lint clean

install:
	npm install

update:
	npm update $$(grep -roh '"@elaraai/[^"]*"' --include='package.json' . | tr -d '"' | sort -u | tr '\n' ' ')

build:
	npm run build

test: build
	npm run test

lint:
	npm run lint

clean:
	rm -rf dist node_modules *.tsbuildinfo
EOF

    echo "22" > "$PROJECT_DIR/.nvmrc"

    cat > "$PROJECT_DIR/README.md" << EOF
# $DISPLAY_NAME

East project (AGPL-3.0).

## Setup

\`\`\`bash
make install
\`\`\`

## Usage

\`\`\`bash
make update     # Update @elaraai packages
make build      # Build TypeScript
make test       # Build and run tests
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
