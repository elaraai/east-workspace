.PHONY: install update build test test-ts lint clean repo start watch

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
	rm -rf dist node_modules .venv uv.lock *.tsbuildinfo .repos

repo:
	e3 repo create .repos 2>/dev/null || true
	e3 workspace create .repos e3_ui_showcase 2>/dev/null || true

start: build repo
	npm run main
	e3 package import .repos /tmp/pkg.zip
	e3 workspace deploy .repos e3_ui_showcase e3-ui-showcase@1.0.0
	e3 start .repos e3_ui_showcase

watch: repo
	e3 watch .repos e3_ui_showcase ./src/button.ts --start
