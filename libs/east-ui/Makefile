# east-ui — UI packages and VS Code extension
# Dependencies are managed by pnpm from the monorepo root.

## Discover every example pathKey by walking `packages/east-ui/test/`.
## A file at `test/buttons/button.examples.ts` becomes the key `buttons/button`,
## which maps 1:1 to `make east-ui-examples-html-buttons/button`. Re-evaluated
## each `make` invocation, so newly added example files appear without edits.
EAST_UI_EXAMPLE_KEYS := $(shell find packages/east-ui/test \( -name '*.examples.ts' -o -name '*.examples.tsx' \) 2>/dev/null \
                              | sed -e 's|^packages/east-ui/test/||' -e 's|\.examples\.tsx$$||' -e 's|\.examples\.ts$$||')

## Per-EXAMPLE keys — `<pathKey>--<exportName>` for every `export const` in an
## examples file, so `make east-ui-examples-html-collections/schematic--schematicNets`
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

.PHONY: build test lint showcase build-showcase design probe-slice probe-collections clean extension extension-install extension-uninstall examples test-responsive test-responsive-bank \
        east-ui-examples-html-all $(EAST_UI_EXAMPLE_KEYS:%=east-ui-examples-html-%) \
        $(EAST_UI_EXAMPLE_ITEM_KEYS:%=east-ui-examples-html-%) \
        e3-ui-examples-html-all $(E3_UI_EXAMPLE_KEYS:%=e3-ui-examples-html-%) help

## Build all packages (in dependency `order)
build:
	pnpm run build

## Run tests for all packages
test:
	pnpm run test

## Run linting for all packages
lint:
	pnpm run lint

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


## Pixel-perfect audit of the Slice.Edit popover — opens each editor case in the
## snapshot harness and dumps the popover's computed CSS (content / head / body /
## foot + value-control) to diff against the retired pattern spec (git history)
## and the rendered captures (`app_design_system/components/rendered/`).
## Reads from the built renderer, so run `make build` (or the package build) first.
probe-slice:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-slice.ts

## Pixel audit of the Collections.Table examples — renders
## single examples (waiting for virtualized rows to load past skeleton),
## screenshots each to dist-examples/probe-coll-*.png, and dumps the table
## header/cell/row computed CSS to diff against the rendered captures
## (`app_design_system/components/rendered/collections/`).
## Run the package build first.
probe-collections:
	-pnpm --filter @elaraai/east-ui-components exec playwright install chromium
	pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-collections.ts

## Serve the canonical design system (`app_design_system/` — tokens, atoms,
## guidelines, and the rendered example captures under
## `components/rendered/`) statically over HTTP for visual review. Lists every
## routable IPv4 interface up front so a remote browser (Tailscale, LAN, etc.)
## can pick the right address.
design:
	@port=5174; \
	echo "Serving app_design_system/ at:"; \
	echo "  http://localhost:$$port  (rendered: /components/rendered/)"; \
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
##   make east-ui-examples-html-collections/schematic--schematicNets
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

## Build and package the VSCode extension
extension:
	@command -v zip >/dev/null 2>&1 || { echo "  ✗ 'zip' not found — needed to inject the tsserver plugin into the .vsix. Install: apt install zip  /  brew install zip"; exit 1; }
	rm -f packages/east-ui-extension/*.vsix
	cd packages/east-ui-extension && pnpm run build && pnpm run package

## Package and install the VSCode extension.
##
## The `code` CLI under Remote-SSH needs VSCODE_IPC_HOOK_CLI to point at a
## live Unix socket. If the current value is stale (e.g. inherited from a
## prior session), we fall back to the newest socket under /run/user/$UID.
extension-install: extension
	@$(MAKE) --no-print-directory _code-run ARGS="--install-extension packages/east-ui-extension/*.vsix"

## Uninstall the VSCode extension
extension-uninstall:
	@$(MAKE) --no-print-directory _code-run ARGS="--uninstall-extension elaraai.east-ui-preview" || true

## Internal: run `code` with a valid VSCODE_IPC_HOOK_CLI socket
_code-run:
	@sock="$$VSCODE_IPC_HOOK_CLI"; \
	if [ -z "$$sock" ] || [ ! -S "$$sock" ]; then \
		sock=$$(ls -t /run/user/$$(id -u)/vscode-ipc-*.sock 2>/dev/null | head -1); \
	fi; \
	if [ -z "$$sock" ] || [ ! -S "$$sock" ]; then \
		echo "error: no live VS Code IPC socket found; open a VS Code terminal and retry" >&2; \
		exit 1; \
	fi; \
	VSCODE_IPC_HOOK_CLI="$$sock" code $(ARGS)

## Clean build artifacts
clean:
	rm -rf packages/*/dist packages/east-ui-extension/*.vsix

## Show available targets
help:
	@echo "east-ui (UI packages + VS Code extension)"
	@echo ""
	@echo "  build             - Build all packages"
	@echo "  test              - Run tests"
	@echo "  lint              - Run linters"
	@echo "  showcase          - Run showcase dev server"
	@echo "  design            - Serve app_design_system/ (canonical design system) on :5174"
	@echo "  examples              - Rebuild east-ui + e3-ui (example sources)"
	@echo "  east-ui-examples-html-all     - Snapshot every east-ui example to standalone HTML"
	@echo "  test-responsive               - Playwright responsive sweep (desktop + mobile) over the showcase catalog"
	@echo "  test-responsive-bank          - Bank/refresh the per-component visual goldens (committed)"
	@echo "  east-ui-examples-html-<pathKey> - Snapshot a single example (e.g. east-ui-examples-html-disclosure/tabs)"
	@echo "  extension         - Build and package VS Code extension"
	@echo "  extension-install - Install VS Code extension"
	@echo "  extension-uninstall - Uninstall VS Code extension"
	@echo "  clean             - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."

## Responsive validation suite (#357, epic #345) — Playwright drives the
## built showcase over every catalog page at desktop + mobile viewports.
## On hosts Playwright can't provision a browser for (non-LTS Ubuntu), set
## E3_UI_CHROMIUM_PATH (or PW_EXECUTABLE_PATH) to a Chrome/Chromium binary.
test-responsive:
	-pnpm --filter @elaraai/east-ui-showcase exec playwright install chromium
	pnpm --filter @elaraai/east-ui-showcase run test:responsive

## Bank / refresh the per-component visual goldens the responsive suite
## compares against (tests/responsive/__goldens__/ — committed). Run after
## an INTENTIONAL visual change, review the diff, commit the updated PNGs.
test-responsive-bank:
	-pnpm --filter @elaraai/east-ui-showcase exec playwright install chromium
	pnpm --filter @elaraai/east-ui-showcase run test:responsive:bank
