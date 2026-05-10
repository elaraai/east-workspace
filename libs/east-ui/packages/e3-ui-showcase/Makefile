DIST := /tmp/east-ui-showcase
REPO := .repos
VERSION := $(shell node -p "require('./package.json').version")
CATEGORIES := buttons typography layout container display feedback forms \
              navigation disclosure overlays collections charts data diff \
              integration

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

# Per-category start: emit → import → deploy → start (e.g. `make start-buttons`)
$(CATEGORIES:%=start-%): start-%: % repo
	e3 workspace create $(REPO) e3_ui_showcase_$* 2>/dev/null || true
	e3 package import $(REPO) $(DIST)/$*.zip
	e3 workspace deploy $(REPO) e3_ui_showcase_$* east-ui-showcase-$*@$(VERSION)
	e3 start $(REPO) e3_ui_showcase_$* --force

# Start every category sequentially in its own workspace
start-all: $(CATEGORIES:%=start-%)

# Per-category watch (e.g. `make watch-charts`)
$(CATEGORIES:%=watch-%): watch-%: repo
	e3 workspace create $(REPO) e3_ui_showcase_$* 2>/dev/null || true
	e3 watch $(REPO) e3_ui_showcase_$* ./src/$*.ts --start
