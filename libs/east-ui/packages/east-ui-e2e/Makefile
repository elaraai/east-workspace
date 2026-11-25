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

## plan-scale: how many print jobs its workspace holds. plan-nested: how many
## works its workspace holds. WS names the workspace: jobs-<JOBS> or
## nested-<WORKS> unless given.
JOBS ?= 1000000
WORKS ?= 1000

.PHONY: help plan-scale plan-nested page serve-api serve-page

help:
	@echo "east-ui-e2e (e3-ui surfaces over a real e3)"
	@echo ""
	@echo "  plan-scale JOBS=n WS=name  - A workspace of n print jobs on 4,000 presses over five years, the"
	@echo "                               presses narrowed by the rail's filters: the jobs generated once into"
	@echo "                               LAB_DIR, the package deployed, the jobs seeded and the dataflow run"
	@echo "  plan-nested WORKS=n WS=name - A workspace of n works, each some 1,600 items over five years, drawn"
	@echo "                               by every series kind, with child rows: generated, deployed, seeded, run"
	@echo "                               (a workspace is seeded once: remove it to make it again)"
	@echo "  page                       - Build the page into LAB_DIR"
	@echo "  serve-api                 - e3's server over the repository, on :$(API_PORT), no sign-in"
	@echo "  serve-page                - The built page on :$(PAGE_PORT); #<workspace> chooses one"
	@echo ""
	@echo "  LAB_DIR=$(LAB_DIR)"

## The jobs are seeded as the record's first state, which builds its indexes:
## a workspace is seeded once, so remove it (`e3 workspace remove`) to make it
## again.
plan-scale: $(LAB_DIR)/jobs-$(JOBS).beast2
	pnpm exec e3 repo create $(REPO) --exist-ok
	pnpm exec e3 workspace deploy $(REPO) $(or $(WS),jobs-$(JOBS)) --from-source plan-scale/package.tsx
	pnpm exec e3 seed $(REPO) lab_jobs $< -w $(or $(WS),jobs-$(JOBS))
	pnpm exec e3 dataflow run $(REPO) $(or $(WS),jobs-$(JOBS))

## The works are seeded as the record's first state, which builds their nested
## series index.
plan-nested: $(LAB_DIR)/works-$(WORKS).beast2
	pnpm exec e3 repo create $(REPO) --exist-ok
	pnpm exec e3 workspace deploy $(REPO) $(or $(WS),nested-$(WORKS)) --from-source plan-nested/package.tsx
	pnpm exec e3 seed $(REPO) lab_works $< -w $(or $(WS),nested-$(WORKS))
	pnpm exec e3 dataflow run $(REPO) $(or $(WS),nested-$(WORKS))

## A file of jobs, written once for each count.
$(LAB_DIR)/jobs-%.beast2:
	mkdir -p $(LAB_DIR)
	pnpm exec tsx plan-scale/generate.ts $@.part $* && mv $@.part $@

## A file of works, written once for each count.
$(LAB_DIR)/works-%.beast2:
	mkdir -p $(LAB_DIR)
	pnpm exec tsx plan-nested/generate.ts $@.part $* && mv $@.part $@

page:
	pnpm exec vite build --outDir $(LAB_DIR)/page --emptyOutDir

serve-api:
	pnpm exec e3-api-server --repo $(REPO) --host 0.0.0.0 -p $(API_PORT) --cors

serve-page:
	pnpm exec vite preview --outDir $(LAB_DIR)/page --host 0.0.0.0 --port $(PAGE_PORT) --strictPort
