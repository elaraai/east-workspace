# east-ui-e2e — e3-ui surfaces end to end over a real e3: a repository on
# disk, served by e3's own server, drawn by a page as an app draws a deployed
# ui() task. No part of the showcase or its build; CI type-checks and lints it.

## Where the harness keeps its repository, the files it generates and the
## page it builds: outside the checkout, as they run to gigabytes.
LAB_DIR ?= $(HOME)/.cache/east-ui-e2e
REPO := $(LAB_DIR)/repo

## The e3 server's port and the page's, both on every interface, for a browser
## on the LAN. The page reads the server on its own host's port 3300 unless its
## address names another (`?api=http://host:port`).
API_PORT ?= 3300
PAGE_PORT ?= 4300

## plan-steps: how many steps its workspace holds. WS names the workspace:
## steps-<STEPS> unless given.
STEPS ?= 5000000

.PHONY: help plan-steps page serve-api serve-page

help:
	@echo "east-ui-e2e (e3-ui surfaces over a real e3)"
	@echo ""
	@echo "  plan-steps STEPS=n WS=name - A workspace of n steps of every kind over five years on 4,000 machines in"
	@echo "                               40 halls, one record keyed by a variant, each kind of step drawn its own"
	@echo "                               way: the steps generated once into LAB_DIR, the package deployed, the"
	@echo "                               steps seeded and the dataflow run (a workspace is seeded once: remove it"
	@echo "                               to make it again)"
	@echo "  page                       - Build the page into LAB_DIR"
	@echo "  serve-api                 - e3's server over the repository, on :$(API_PORT), no sign-in"
	@echo "  serve-page                - The built page on :$(PAGE_PORT); #<workspace> chooses one"
	@echo ""
	@echo "  LAB_DIR=$(LAB_DIR)"

## The steps are seeded as the record's first state, which builds their
## indexes: a workspace is seeded once, so remove it (`e3 workspace remove`) to
## make it again.
plan-steps: $(LAB_DIR)/steps-$(STEPS).beast2
	pnpm exec e3 repo create $(REPO) --exist-ok
	pnpm exec e3 workspace deploy $(REPO) $(or $(WS),steps-$(STEPS)) --from-source plan-steps/package.tsx
	pnpm exec e3 seed $(REPO) lab_steps $< -w $(or $(WS),steps-$(STEPS))
	pnpm exec e3 dataflow run $(REPO) $(or $(WS),steps-$(STEPS))

## A file of steps, written once for each count.
$(LAB_DIR)/steps-%.beast2:
	mkdir -p $(LAB_DIR)
	pnpm exec tsx plan-steps/generate.ts $@.part $* && mv $@.part $@

page:
	pnpm exec vite build --outDir $(LAB_DIR)/page --emptyOutDir

serve-api:
	pnpm exec e3-api-server --repo $(REPO) --host 0.0.0.0 -p $(API_PORT) --cors

serve-page:
	pnpm exec vite preview --outDir $(LAB_DIR)/page --host 0.0.0.0 --port $(PAGE_PORT) --strictPort
