# east-ui — UI packages
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: where east-ui's suites are exported (EAST_UI_TEST_IR)
include ../../paths.mk

## Discover every example pathKey by walking `packages/east-ui/test/`.
## A file at `test/buttons/button.examples.ts` becomes the key `buttons/button`,
## which maps 1:1 to `make east-ui-examples-html-buttons/button`. Re-evaluated
## each `make` invocation, so newly added example files appear without edits.
EAST_UI_EXAMPLE_KEYS := $(shell find packages/east-ui/test \( -name '*.examples.ts' -o -name '*.examples.tsx' \) 2>/dev/null \
                              | sed -e 's|^packages/east-ui/test/||' -e 's|\.examples\.tsx$$||' -e 's|\.examples\.ts$$||')

## Per-EXAMPLE keys — `<pathKey>--<exportName>` for every `export const` in an
## examples file, so `make east-ui-examples-html-collections/map--mapRegions`
## snapshots ONE example full-bleed (tab-completes like the per-file targets).
EAST_UI_EXAMPLE_ITEM_KEYS := $(shell for f in $$(find packages/east-ui/test \( -name '*.examples.ts' -o -name '*.examples.tsx' \) 2>/dev/null); do \
                              key=$$(echo $$f | sed -e 's|^packages/east-ui/test/||' -e 's|\.examples\.tsx$$||' -e 's|\.examples\.ts$$||'); \
                              grep -hoE '^export const [A-Za-z0-9_]+' $$f | sed -e "s|^export const |$$key--|"; done)

## Discover e3-ui example keys — top-level `packages/e3-ui/test/<key>.examples.ts`
## files (e3-task-bound components: ontology, diff, ...). Each maps 1:1 to
## `make e3-ui-examples-html-<key>`, rendered by the e3-ui-components snapshot
## harness (seeds a dataset cache from each example's e3.input defaults).
E3_UI_EXAMPLE_KEYS := $(shell find packages/e3-ui/test \( -name '*.examples.ts' -o -name '*.examples.tsx' \) 2>/dev/null \
                             | sed -e 's|^packages/e3-ui/test/||' -e 's|\.examples\.tsx$$||' -e 's|\.examples\.ts$$||')

.PHONY: build build-js build-checked check-apps test test-group test-export lint showcase build-showcase build-showcase-js design probe-slice probe-collections clean examples test-responsive \
        east-ui-examples-html-all $(EAST_UI_EXAMPLE_KEYS:%=east-ui-examples-html-%) \
        $(EAST_UI_EXAMPLE_ITEM_KEYS:%=east-ui-examples-html-%) \
        e3-ui-examples-html-all $(E3_UI_EXAMPLE_KEYS:%=e3-ui-examples-html-%) select-responsive help

## The packages: those under packages/
PACKAGES := --filter='./packages/*'

## Build all packages, in dependency order
build:
	pnpm -r $(PACKAGES) run build

## The JavaScript the tests run, and no more (#1466): east-ui and e3-ui compile
## with tsc (e3-ui against east-ui's declarations, its specs into dist), and the
## renderers bundle with no type-check and no declarations. CI's test jobs run
## on it; `build-checked` and `check-apps` type-check every package beside them.
build-js:
	pnpm --filter @elaraai/east-ui --filter @elaraai/e3-ui run build
	EAST_UI_DECLARATIONS=0 pnpm --filter @elaraai/east-ui-components --filter @elaraai/e3-ui-components exec vite build

## Every package a test or lint reads built as `build` builds it, type-checked
## and its declarations written: all but the showcase, which `check-apps`
## checks over it (#1466).
build-checked:
	pnpm -r $(PACKAGES) --filter='!@elaraai/east-ui-showcase' run build

## What no test reads, over what `build-checked` built: the showcase
## type-checked. CI checks it in a job of its own, and builds the showcase's
## bundle in another, for the browser shards (#1466). The theme's Chakra types are written first: they live
## in node_modules, which `build-checked`'s artifact does not carry.
check-apps:
	pnpm --filter @elaraai/east-ui-components run chakra:typegen
	pnpm --filter @elaraai/east-ui-showcase run typecheck

## Run tests for all packages
test:
	pnpm -r $(PACKAGES) run test

## The CI groups together run every package's tests once, each over what is
## built, never building first (#1466): `components`; `ir`, east-ui's and
## e3-ui's, side by side, since neither keeps a runner's cores busy alone; `node`, the e3 renderer's Node specs; `showcase`, the showcase
## package's; `e3-components`, the renderer's Vitest files, sharded; `rest`,
## every other package, the CLI's specs among them, which read the renderers'
## declarations; and `queries`, the CLI's query-equivalence spec, which CI asks
## in parts side by side. New packages land in `rest` automatically.
TEST_GROUP_rest := --filter='./packages/*' \
                   --filter='!@elaraai/east-ui-components' --filter='!@elaraai/east-ui' --filter='!@elaraai/e3-ui' \
                   --filter='!@elaraai/e3-ui-components' --filter='!@elaraai/east-ui-showcase' --filter='!@elaraai/e3-ui-cli'

## The CLI's built specs, relative to its package, but its query equivalence:
## the `queries` group's.
CLI_SPECS = $(patsubst packages/e3-ui-cli/%,%,$(filter-out %/query-equivalence.spec.js,$(shell find packages/e3-ui-cli/dist -name '*.spec.js')))

ifneq ($(filter test-group,$(MAKECMDGOALS)),)
ifeq ($(filter components ir node showcase e3-components rest queries,$(GROUP)),)
$(error test-group needs GROUP=components, ir, node, showcase, e3-components, rest or queries)
endif
endif

## Run one CI group. SHARD=n/count applies to GROUP=e3-components only, its
## shards split by recorded time (#1466); REPORT=file writes its JSON report
## too, the times `scripts/vitest-timings.ts` refreshes them from. PART=k/n
## applies to GROUP=queries only: every n-th query from the k-th (#1466).
test-group:
ifeq ($(GROUP),e3-components)
	pnpm --filter @elaraai/e3-ui-components run test:components $(if $(SHARD),--shard=$(SHARD)) \
		$(if $(REPORT),--reporter=default --reporter=json --outputFile.json=$(REPORT))
else ifeq ($(GROUP),components)
	pnpm --filter @elaraai/east-ui-components run test
else ifeq ($(GROUP),ir)
	@logs=$$(mktemp -d); \
	pnpm --filter @elaraai/east-ui run test:built > $$logs/east-ui.log 2>&1 & east=$$!; \
	pnpm --filter @elaraai/e3-ui run test > $$logs/e3-ui.log 2>&1; e3=$$?; \
	wait $$east; east=$$?; \
	cat $$logs/east-ui.log $$logs/e3-ui.log; rm -rf $$logs; \
	exit $$((east | e3))
else ifeq ($(GROUP),node)
	pnpm --filter @elaraai/e3-ui-components run test:node
else ifeq ($(GROUP),showcase)
	pnpm --filter @elaraai/east-ui-showcase run test
else ifeq ($(GROUP),queries)
	E3_UI_QUERY_PART=$(PART) pnpm --filter @elaraai/e3-ui-cli run test:queries
else
	pnpm -r $(TEST_GROUP_rest) run test
	pnpm --filter @elaraai/e3-ui-cli exec node --enable-source-maps --test-reporter=spec --test $(CLI_SPECS)
endif

## Export east-ui's suites as IR to EAST_UI_TEST_IR, this checkout's
## tmp/east-ui-tests
test-export:
	pnpm --filter @elaraai/east-ui run test:export

## Run linting for all packages
lint:
	pnpm -r $(PACKAGES) run lint

## Run the showcase dev server. The renderer (east-ui-components) resolves
## from its source via a dev-only Vite alias — no prebuilt dist, and
## component/theme edits hot-reload. The IR package is built first, since the
## dev server loads `@elaraai/east-ui` from dist. That rebuild changes the dist
## without a version bump, which Vite's dep cache keys on — so it would serve a
## stale prebundle. `vite --force` re-optimizes against the fresh dist on every
## start, keeping the showcase in sync with IR-layer edits.
showcase:
	pnpm --filter @elaraai/east-ui run build && pnpm --filter @elaraai/east-ui-showcase exec vite --force

## Build east-ui-showcase for production deployment (used by GitHub Pages workflow)
build-showcase:
	# east-py-datascience first: e3-ui's experiment spec imports its types, so its
	# dist .d.ts must exist before e3-ui compiles (pnpm topo-orders the filter set).
	pnpm --filter @elaraai/east-py-datascience --filter @elaraai/east-ui --filter @elaraai/east-ui-components --filter @elaraai/e3-ui --filter @elaraai/e3-ui-components run build
	pnpm --filter @elaraai/east-ui-showcase run build

## The showcase's bundle alone, over what `build-js` built: what CI's browser
## shards serve (#1466). `build-showcase` type-checks it first.
build-showcase-js:
	pnpm --filter @elaraai/east-ui-showcase exec vite build


## Pixel-perfect audit of the Slice.Edit popover — opens each editor case in the
## snapshot harness and dumps the popover's computed CSS (content / head / body /
## foot + value-control) to compare with the design system's spec card
## (`app_design_system/guidelines/cards/parts-slice-edit.html`).
## Reads from the built renderer, so run `make build` (or the package build) first.
probe-slice:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-slice.ts

## Pixel audit of the Collections.Table examples — renders
## single examples (waiting for virtualized rows to load past skeleton),
## screenshots each to dist-examples/probe-coll-*.png, and dumps the table
## header/cell/row computed CSS to compare with the design system's spec cards
## (`app_design_system/guidelines/cards/parts-header-cell.html`, `parts-row.html`).
## Run the package build first.
probe-collections:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-collections.ts

## Serve the design system's read-only download (`app_design_system/` — the
## East Design System from claude.ai/design: tokens, base styles, guidelines and
## spec cards) statically over HTTP for review. Lists every routable IPv4
## interface up front so a remote browser (Tailscale, LAN, etc.) can pick the
## right address.
design:
	@port=5174; \
	echo "Serving app_design_system/ at:"; \
	echo "  http://localhost:$$port  (spec cards: /guidelines/cards/)"; \
	ip -4 -o addr show scope global 2>/dev/null \
	    | awk '{print $$4}' | cut -d/ -f1 \
	    | sed "s|.*|  http://&:$$port|"; \
	echo ""; \
	npx --yes serve@latest app_design_system -l $$port --no-clipboard --no-port-switching

## Rebuild only the example-source packages (east-ui + e3-ui)
examples:
	pnpm --filter @elaraai/east-ui --filter @elaraai/e3-ui run build

## Snapshot every east-ui example into a standalone HTML file via headless
## Playwright.
##
## Produces one self-contained .html per example under
## `packages/east-ui-showcase/dist-examples/` — each file opens directly in
## any browser and contains the rendered DOM with all stylesheets inlined.
## Used for offline visual inspection / spec-alignment review.
##
## First run downloads the Chromium binary (~150 MB). Subsequent runs are
## just the snapshot pass (~30-60 s). The install step is NON-FATAL (`-`):
## offline boxes fall back to any cached / system chromium via the capture
## harness's acquisition cascade (scripts/snapshot-capture.mts).
east-ui-examples-html-all:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components run snapshot

## Snapshot a single east-ui example source file. Usage:
##   make east-ui-examples-html-disclosure/tabs
## The suffix after `east-ui-examples-html-` matches a discovered pathKey from
## `packages/east-ui/test/<pathKey>.examples.ts` (e.g. buttons/button,
## container/card, charts/area). Tab-completes from the auto-derived list.
$(EAST_UI_EXAMPLE_KEYS:%=east-ui-examples-html-%): east-ui-examples-html-%:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/snapshot.ts --file=$*

## Snapshot a SINGLE example (full-bleed) from an examples file. Usage:
##   make east-ui-examples-html-collections/map--mapRegions
## `<pathKey>--<exportName>` maps to `snapshot.ts --file=<pathKey>:<exportName>`;
## the list is re-derived each invocation, so new `export const` examples
## tab-complete without Makefile edits.
$(EAST_UI_EXAMPLE_ITEM_KEYS:%=east-ui-examples-html-%): east-ui-examples-html-%:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/snapshot.ts --file=$(subst --,:,$*)

## Snapshot every e3-task-bound east-ui example (ontology, diff, ...) to a
## paired .html + .png under `packages/e3-ui-components/dist-examples/`. The
## harness seeds a reactive-dataset cache from each example's e3.input
## defaults, then renders via the same Playwright capture east-ui uses.
##
## First run downloads the Chromium binary (~150 MB).
e3-ui-examples-html-all:
	-pnpm --filter @elaraai/e3-ui-components exec playwright install chromium
	pnpm --filter @elaraai/e3-ui-components run snapshot

## Snapshot a single e3-ui example file. Usage:
##   make e3-ui-examples-html-ontology
## The suffix matches a discovered key from
## `packages/e3-ui/test/<key>.examples.ts` (e.g. ontology, diff).
$(E3_UI_EXAMPLE_KEYS:%=e3-ui-examples-html-%): e3-ui-examples-html-%:
	-pnpm --filter @elaraai/e3-ui-components exec playwright install chromium
	pnpm --filter @elaraai/e3-ui-components exec tsx scripts/snapshot.ts --file=$*

## Clean build artifacts
clean:
	rm -rf packages/*/dist

## Show available targets
help:
	@echo "east-ui (UI packages)"
	@echo ""
	@echo "  build             - Build all packages"
	@echo "  build-js          - The JavaScript the tests run: no type-check, no declarations (CI's test build)"
	@echo "  build-checked     - Every package a test or lint reads, type-checked with its declarations (CI's check)"
	@echo "  check-apps        - Over build-checked: the showcase type-checked (CI's apps check)"
	@echo "  build-showcase-js - The showcase's bundle alone, over build-js (CI's browser shards)"
	@echo "  test              - Run tests"
	@echo "  test-group GROUP=components|ir|node|showcase|e3-components|rest - Run a CI group over what is built (e3-components takes SHARD=n/count and REPORT=file)"
	@echo "  test-export       - Export east-ui's suites as IR to this checkout's tmp/east-ui-tests"
	@echo "  lint              - Run linters"
	@echo "  showcase          - Run showcase dev server"
	@echo "  design            - Serve the design system's download (app_design_system/, read-only) on :5174"
	@echo "  examples              - Rebuild east-ui + e3-ui (example sources)"
	@echo "  east-ui-examples-html-all     - Snapshot every east-ui example to standalone HTML"
	@echo "  test-responsive               - The showcase's Playwright suite (desktop + mobile); SHARD=n/total and TEST_LIST=file optional"
	@echo "  select-responsive BASE=ref OUTPUT_DIR=dir - Select browser checks from the complete diff to HEAD"
	@echo "  east-ui-examples-html-<pathKey> - Snapshot a single example (e.g. east-ui-examples-html-disclosure/tabs)"
	@echo "  clean             - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."

## The responsive suite (#357, #833): Playwright drives the BUILT showcase
## over every catalog page at desktop + mobile viewports. These are DOM specs
## (packages/east-ui-showcase/tests/responsive/) with no pixel comparisons.
## CI runs this target across at most 24 jobs, the selected TEST_LIST split by
## the times CI recorded (packages/east-ui-showcase/responsive.timings.json).
##
## It serves what `make build` built, building the showcase only when its
## dist is missing, so rebuild after a change. A failing spec leaves its
## DOM/network trace under packages/east-ui-showcase/test-results/. On
## hosts Playwright can't provision a browser for (non-LTS Ubuntu), set
## E3_UI_CHROMIUM_PATH (or PW_EXECUTABLE_PATH) to a Chrome/Chromium binary.
test-responsive:
	-pnpm --filter @elaraai/east-ui-showcase exec playwright install chromium
	@test -f packages/east-ui-showcase/dist/index.html || $(MAKE) --no-print-directory build-showcase
	pnpm --filter @elaraai/east-ui-showcase run test:responsive $(if $(SHARD),--shard=$(SHARD)) $(if $(TEST_LIST),--test-list="$(TEST_LIST)")

## Select responsive cases after the shared build; missing BASE runs everything.
select-responsive:
	pnpm --filter @elaraai/east-ui-showcase exec tsx scripts/responsive-impact.ts --base="$(BASE)" --output="$(OUTPUT_DIR)"
