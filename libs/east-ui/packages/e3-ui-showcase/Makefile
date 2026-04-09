.PHONY: build clean repo start watch

REPO := .repos
WORKSPACE := showcase
PACKAGE := e3-ui-showcase@0.0.1

build:
	pnpm run build

clean:
	rm -rf dist *.tsbuildinfo $(REPO)

repo:
	e3 repo create $(REPO) 2>/dev/null || true
	e3 workspace create $(REPO) $(WORKSPACE) 2>/dev/null || true

start: build repo
	node --enable-source-maps dist/index.js
	e3 package import $(REPO) /tmp/e3-ui-showcase.zip
	e3 workspace deploy $(REPO) $(WORKSPACE) $(PACKAGE)
	e3 start $(REPO) $(WORKSPACE)

watch: repo
	e3 watch $(REPO) $(WORKSPACE) ./src/index.ts --start
