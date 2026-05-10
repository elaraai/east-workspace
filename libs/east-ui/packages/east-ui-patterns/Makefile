# @elaraai/east-ui-patterns-showcase — Makefile
#
# All common workflows in one place. Run `make help` for the menu.
#
# `dev` and `watch` are long-running; in two terminals do
#   terminal 1:  make dev
#   terminal 2:  make watch
# or run them backgrounded with `make dev-bg` / `make watch-bg`.

PKG_DIR := $(shell pwd)
DB      := $(PKG_DIR)/data/feedback.db
DEV_LOG := /tmp/east-ui-patterns-showcase-dev.log
WATCH_LOG := /tmp/east-ui-patterns-showcase-watch.log
SPEC_DIR  := $(PKG_DIR)/docs/pattern_spec
SPEC_PORT := 8091
SPEC_LOG  := /tmp/east-ui-patterns-spec.log

.DEFAULT_GOAL := help

# ─── Help ────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@echo ""
	@echo "  @elaraai/east-ui-patterns-showcase"
	@echo "  ─────────────────────────"
	@echo ""
	@echo "  Setup"
	@echo "    install       Install workspace deps (run from monorepo root)"
	@echo ""
	@echo "  Run"
	@echo "    dev           Vite dev server (foreground)        http://localhost:5173"
	@echo "    dev-bg        Vite dev server (background)        log: $(DEV_LOG)"
	@echo "    dev-stop      Kill any running vite/dev server"
	@echo "    dev-log       Tail the dev-server log"
	@echo ""
	@echo "  Pattern spec (static HTML at ../east-ui-patterns/docs/pattern_spec)"
	@echo "    spec          npx serve, foreground, LAN-reachable on 0.0.0.0:$(SPEC_PORT)"
	@echo "    spec-bg       Same in background  log: $(SPEC_LOG)"
	@echo "    spec-stop     Kill the spec server"
	@echo "    spec-log      Tail the spec-server log"
	@echo ""
	@echo "  Feedback (SQLite at data/feedback.db)"
	@echo "    watch         Stream new feedback rows as they arrive (foreground)"
	@echo "    watch-bg      Stream new feedback rows in background  log: $(WATCH_LOG)"
	@echo "    watch-stop    Kill the background watcher"
	@echo "    list          Print all OPEN feedback"
	@echo "    list-all      Print all feedback (any status)"
	@echo "    list-actioned Print all ACTIONED feedback"
	@echo "    resolve ID=42 NOTE='how it was addressed'"
	@echo "                  Mark feedback row #ID actioned with a resolution note"
	@echo "    reopen ID=42  Move feedback #ID back to OPEN"
	@echo "    rm ID=42      Delete feedback row #ID"
	@echo "    db-shell      Open sqlite3 against the feedback DB"
	@echo "    db-reset      DROP and recreate the feedback table  (destructive)"
	@echo ""
	@echo "  Build & lint"
	@echo "    build         Vite production build"
	@echo "    typecheck     tsc --noEmit"
	@echo "    clean         rm dist/ and Vite cache"
	@echo ""

# ─── Setup ───────────────────────────────────────────────────────────────

.PHONY: install
install:
	cd ../../../.. && pnpm install --filter '@elaraai/east-ui-patterns-showcase...'

# ─── Run ─────────────────────────────────────────────────────────────────

.PHONY: dev
dev:
	pnpm dev

.PHONY: dev-bg
dev-bg: dev-stop
	@nohup pnpm dev > $(DEV_LOG) 2>&1 &
	@echo "vite started in background, log: $(DEV_LOG)"
	@sleep 3
	@grep -E "Local|Network" $(DEV_LOG) || echo "(check log)"

.PHONY: dev-stop
dev-stop:
	@pkill -f 'vite.*5173' 2>/dev/null || true
	@pkill -f 'pnpm dev'   2>/dev/null || true
	@echo "vite stopped (if running)"

.PHONY: dev-log
dev-log:
	@tail -f $(DEV_LOG)

# ─── Pattern spec (static HTML, served via `npx serve`) ──────────────────
#
# `npx serve` defaults to localhost-only, so we pass `-l tcp://0.0.0.0:PORT`
# to bind every interface — that's what makes the URL reachable from another
# machine on the LAN. Print the LAN IPs at startup so the URL is obvious.

.PHONY: spec
spec:
	@cd $(SPEC_DIR) && npx --yes serve -l tcp://0.0.0.0:$(SPEC_PORT) -n .

.PHONY: spec-bg
spec-bg: spec-stop
	@nohup sh -c 'cd $(SPEC_DIR) && npx --yes serve -l tcp://0.0.0.0:$(SPEC_PORT) -n .' > $(SPEC_LOG) 2>&1 &
	@echo "pattern-spec server starting in background, log: $(SPEC_LOG)"
	@sleep 2
	@echo "  Local:    http://localhost:$(SPEC_PORT)/"
	@for ip in $$(hostname -I); do echo "  Network:  http://$$ip:$(SPEC_PORT)/"; done

.PHONY: spec-stop
spec-stop:
	@pkill -f "serve.*$(SPEC_PORT)" 2>/dev/null || true
	@echo "pattern-spec server stopped (if running)"

.PHONY: spec-log
spec-log:
	@tail -f $(SPEC_LOG)

# ─── Feedback ────────────────────────────────────────────────────────────

.PHONY: watch
watch:
	node scripts/feedback-watch.mjs

.PHONY: watch-bg
watch-bg: watch-stop
	@nohup node scripts/feedback-watch.mjs > $(WATCH_LOG) 2>&1 &
	@echo "watcher started in background, log: $(WATCH_LOG)"

.PHONY: watch-stop
watch-stop:
	@pkill -f 'feedback-watch.mjs' 2>/dev/null || true
	@echo "watcher stopped (if running)"

.PHONY: list
list:
	@node scripts/feedback-list.mjs open

.PHONY: list-all
list-all:
	@node scripts/feedback-list.mjs all

.PHONY: list-actioned
list-actioned:
	@node scripts/feedback-list.mjs actioned

.PHONY: resolve
resolve:
ifndef ID
	$(error ID is required — usage: make resolve ID=42 NOTE='how it was addressed')
endif
	@node scripts/feedback-resolve.mjs $(ID) "$(NOTE)"

.PHONY: reopen
reopen:
ifndef ID
	$(error ID is required — usage: make reopen ID=42)
endif
	@sqlite3 $(DB) "UPDATE feedback SET status='open', actioned_at=NULL, resolution=NULL WHERE id=$(ID);"
	@echo "↺ reopened #$(ID)"

.PHONY: rm
rm:
ifndef ID
	$(error ID is required — usage: make rm ID=42)
endif
	@sqlite3 $(DB) "DELETE FROM feedback WHERE id=$(ID);"
	@echo "✗ deleted #$(ID)"

.PHONY: db-shell
db-shell:
	sqlite3 $(DB)

.PHONY: db-reset
db-reset:
	@rm -f $(DB) $(DB)-shm $(DB)-wal
	@echo "✗ feedback DB removed (will be recreated on next dev start)"

# ─── Build / lint ────────────────────────────────────────────────────────

.PHONY: build
build:
	pnpm build

.PHONY: typecheck
typecheck:
	pnpm exec tsc --noEmit

.PHONY: clean
clean:
	@rm -rf dist .vite node_modules/.vite
	@echo "build artefacts removed"
