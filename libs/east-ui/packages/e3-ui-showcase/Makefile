DIST := /tmp/east-ui-showcase
REPO := .repos
VERSION := $(shell node -p "require('./package.json').version")

## Auto-discover categories: any name that has both a showcase emitter
## (`src/<name>.ts`) AND at least one `.examples.ts` somewhere under the
## east-ui or e3-ui `test/` trees. Adding a new emitter or example file
## picks up automatically — no edits needed here. Each example file
## contributes every path component AND its basename as a candidate key
## (so `test/bind/record/record.examples.tsx` yields both `bind` and
## `record`), and the intersection with the emitters resolves the right
## category regardless of how deep the example is nested.
SHOWCASE_KEYS := $(patsubst src/%.ts,%,$(wildcard src/*.ts))
TEST_KEYS := $(sort $(shell \
    find ../east-ui/test ../e3-ui/test \( -name '*.examples.ts' -o -name '*.examples.tsx' \) -printf '%P\n' 2>/dev/null \
    | sed -E 's|\.examples\.tsx?$$||' | tr '/' '\n' | sort -u))
CATEGORIES := $(filter $(TEST_KEYS),$(SHOWCASE_KEYS))

.PHONY: install build test test-ts lint clean repo \
        $(CATEGORIES) \
        $(CATEGORIES:%=start-%) \
        $(CATEGORIES:%=watch-%) \
        start-all

install:
	npm install

build:
	npm run build

# Run full test suite: export IR from TypeScript, then run Python
test: build
	npm run test:export

# Run TypeScript tests only (compiles and runs with Node)
test-ts: build
	npm run test

lint:
	npm run lint

clean:
	rm -rf dist node_modules .venv uv.lock *.tsbuildinfo $(REPO) $(DIST)

repo:
	e3 repo create $(REPO) 2>/dev/null || true

# Emit-only: produce one zip in $(DIST) (e.g. `make buttons`)
$(CATEGORIES): build
	@mkdir -p $(DIST)
	node --max-old-space-size=4096 dist/src/$@.js

# Per-category start: emit → deploy-from-zip → run dataflow (e.g. `make start-buttons`)
$(CATEGORIES:%=start-%): start-%: % repo
	e3 workspace deploy $(REPO) e3_ui_showcase_$* --from-zip $(DIST)/$*.zip
	e3 dataflow run $(REPO) e3_ui_showcase_$* --force

# Start every category sequentially in its own workspace
start-all: $(CATEGORIES:%=start-%)

# Per-category watch (e.g. `make watch-charts`)
$(CATEGORIES:%=watch-%): watch-%: repo
	e3 workspace create $(REPO) e3_ui_showcase_$* 2>/dev/null || true
	e3 watch ./src/$*.ts $(REPO) e3_ui_showcase_$* --start
