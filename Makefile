# east-workspace — pnpm monorepo
# All npm deps managed by pnpm from root. pnpm -r runs workspace scripts in topological order.
#
# EAST_QUIET=1 — suppress passing test output (only show failures + summaries)
# Default: verbose in sub-lib targets, quiet in test-all

# GNU Make (and CMake/MSVC/scikit-build) can't handle spaces in the working
# path — a OneDrive-redirected Documents folder (".../OneDrive - ELARA/...") is
# the usual Windows culprit. Fail fast with a clear message instead of a cryptic
# "No rule to make target" from a path that got split mid-recipe.
ifneq ($(words $(CURDIR)),1)
$(error This checkout is at a path containing spaces: "$(CURDIR)". Clone/move it to a space-free path outside OneDrive, e.g. C:/src/east-workspace. See docs/WINDOWS_SETUP.md.)
endif

.PHONY: setup setup-browser install build link test lint clean services-up services-down services-status server-e3 server-e3-update server-e3-down server-e3-logs test-all test-export set-version check-version help check-deps

# ── Setup (one-time) ─────────────────────────────────────────────────

## Verify required external tools are on PATH. Fails fast with install
## hints if anything's missing. Used as a prereq by install / build / lint
## so a fresh-clone dev gets a clear error rather than an opaque shell
## "command not found" several layers deep.
check-deps:
	@missing=0; \
	check() { \
		if ! command -v "$$1" >/dev/null 2>&1; then \
			echo "  ✗ $$1 — not found. Install: $$2"; \
			missing=1; \
		else \
			echo "  ✓ $$1 ($$( $$1 --version 2>&1 | head -n1 ))"; \
		fi; \
	}; \
	opt() { \
		if ! command -v "$$1" >/dev/null 2>&1; then \
			echo "  ○ $$1 — not found (optional). Install: $$2"; \
		else \
			echo "  ✓ $$1 ($$( $$1 --version 2>&1 | head -n1 ))"; \
		fi; \
	}; \
	echo "Checking required tools..."; \
	check uv      "curl -LsSf https://astral.sh/uv/install.sh | sh"; \
	check pnpm    "npm install -g pnpm  (or: corepack enable && corepack prepare pnpm@latest --activate)"; \
	check node    "https://nodejs.org/  (>=22)"; \
	check cmake   "apt install cmake  /  brew install cmake"; \
	if uname -s 2>/dev/null | grep -qiE 'mingw|msys|cygwin'; then \
		check python "https://www.python.org/downloads/  (>=3.11; ensure python is on PATH)"; \
		check ninja  "winget install Ninja-build.Ninja  (or the VS 'C++ CMake tools')"; \
		echo "  o C compiler: MSVC (VS Build Tools, 'Desktop development with C++') -- run make from a"; \
		echo "                Developer PowerShell/Command Prompt so cl.exe + the Windows SDK are on PATH"; \
	else \
		check cc      "apt install build-essential  /  xcode-select --install"; \
		check python3 "apt install python3  /  brew install python"; \
	fi; \
	echo "Optional (task-specific):"; \
	opt docker  "https://docs.docker.com/engine/install/  (only needed for make services-up / test-all)"; \
	opt zip     "apt install zip  /  brew install zip  (only needed for make link / make extension-install)"; \
	if ls -d "$${PLAYWRIGHT_BROWSERS_PATH:-$$HOME/.cache/ms-playwright}"/chromium*/ >/dev/null 2>&1 \
		|| ls -d "$$HOME/Library/Caches/ms-playwright"/chromium*/ >/dev/null 2>&1 \
		|| ls -d "$${LOCALAPPDATA:-$$HOME/AppData/Local}/ms-playwright"/chromium*/ >/dev/null 2>&1 \
		|| [ -n "$${E3_UI_CHROMIUM_PATH:-}" ]; then \
		echo "  ✓ chromium (headless browser for 'e3-ui shot' showcase PNG capture)"; \
	else \
		echo "  ○ chromium — not found (optional). Install: make setup-browser  (only needed for 'e3-ui shot' / showcase PNG capture)"; \
	fi; \
	if [ -s "$${NVM_DIR:-$$HOME/.nvm}/nvm.sh" ]; then \
		echo "  ✓ nvm (installed; 'nvm use' reads .nvmrc for the pinned Node)"; \
	else \
		echo "  ○ nvm — not found (optional; any Node >=22 works). Install: https://github.com/nvm-sh/nvm"; \
	fi; \
	if [ $$missing -ne 0 ]; then \
		echo ""; \
		echo "Missing tools above. Install them and re-run."; \
		exit 1; \
	fi

## One-time setup of build tools (+ the headless browser e3-ui shot needs)
setup: check-deps setup-browser
	@echo "Setup complete."

## Install the headless Chromium that `e3-ui shot` uses to render east-ui /
## e3-ui components to PNG (showcase capture / visual review). Installs the
## chromium-headless-shell build, version-matched to the CLI's playwright-core
## — the same thing `e3-ui install-browser` does. One-time and idempotent —
## re-running is a no-op once the browser is present. On Linux set
## PLAYWRIGHT_WITH_DEPS=1 to also install the OS libraries Chromium needs
## (sudo). Non-fatal: the CLI also finds a system Chrome/Chromium/Edge by
## itself, or set E3_UI_CHROMIUM_PATH explicitly; `e3-ui doctor` diagnoses.
setup-browser:
	@echo "==> Installing headless Chromium for 'e3-ui shot' (showcase PNG capture)"
	@deps=""; case "$(PLAYWRIGHT_WITH_DEPS)" in 1|true|yes) deps="--with-deps";; esac; \
	if ! pnpm --filter '@elaraai/e3-ui-cli' exec playwright-core --version >/dev/null 2>&1; then \
		echo "  ! playwright-core not resolvable yet — run 'make install' first, then 'make setup-browser'."; \
	elif pnpm --filter '@elaraai/e3-ui-cli' exec playwright-core install --only-shell $$deps chromium; then \
		:; \
	else \
		echo "  ! Chromium install failed — 'e3-ui shot' also works with a system Chrome/Chromium/Edge,"; \
		echo "    or set E3_UI_CHROMIUM_PATH to an executable. Diagnose with 'e3-ui doctor'."; \
	fi

# ── Install ──────────────────────────────────────────────────────────

## Install all dependencies (pnpm for TS, uv for Python)
install: check-deps
	pnpm install
	$(MAKE) -C $(CURDIR)/libs/east-py install

# ── Build ────────────────────────────────────────────────────────────

## Build everything: east-c native, east-py (incl. native Cython
## extensions built by scikit-build-core during install), all TS packages,
## then regenerate the Claude plugin search index + hook/MCP bundle (the
## committed artifacts CI verifies — keeps local search in sync with
## *.examples.ts).
build: check-deps
	$(MAKE) -C $(CURDIR)/libs/east-c build
	$(MAKE) -C $(CURDIR)/libs/east-py install
	pnpm build
	pnpm --filter '@elaraai/east-claude-plugin' run generate-index
	pnpm --filter '@elaraai/east-claude-plugin' run bundle

## Link all CLIs globally (e3, e3-api-server, east-node, east-py, east-c)
link:
	cd $(CURDIR)/libs/e3/packages/e3-cli && pnpm link --global
	cd $(CURDIR)/libs/e3/packages/e3-api-server && pnpm link --global
	cd $(CURDIR)/libs/east-node/packages/east-node-cli && pnpm link --global
	$(MAKE) -C $(CURDIR)/libs/east-c install-cli
	$(MAKE) -C $(CURDIR)/libs/east-py install-cli
	$(MAKE) -C $(CURDIR)/libs/east-ui extension-install
	@e3 completion install || echo "Note: run 'e3 completion install' manually to enable tab completion"

# ── Test / Lint (via Turbo) ──────────────────────────────────────────

## Run TS tests only (does not start services — use test-all for that)
test:
	pnpm test

## Lint all packages — TS via pnpm, Python via ruff + license headers,
## C via clang-format (installed automatically via uv tool).
lint: check-deps
	@echo "=== TypeScript ==="
	pnpm lint
	@echo ""
	@echo "=== Python (east-py) ==="
	$(MAKE) -C $(CURDIR)/libs/east-py lint
	@echo ""
	@echo "=== C (east-c) ==="
	$(MAKE) -C $(CURDIR)/libs/east-c lint

# ── Test Services (Docker) ───────────────────────────────────────────

## Start test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
services-up:
	@docker compose -f docker/services/docker-compose.yml --profile services up -d --wait 2>&1 | tail -1

## Stop test services
services-down:
	@docker compose -f docker/services/docker-compose.yml --profile services down -v 2>&1 | tail -1

## Show test services status
services-status:
	docker compose -f docker/services/docker-compose.yml --profile services ps

# ── e3 LAN server ─────────────────────────────────────────────────────
# Serve e3 repos over HTTP so LAN peers can deploy + run against them. The
# ghcr.io/elaraai/e3 image bundles every runtime (east-node/py/c) so tasks
# execute server-side.
#
# The e3 CLI requires a token for ANY http:// repo — it refuses client-side
# before it even contacts the server — so the server runs its built-in OIDC
# provider with E3_AUTH_AUTO_APPROVE=1: `e3 auth login <url> --no-browser` then
# mints a dev-user token with no prompt (a rubber stamp — fine for a trusted
# LAN, effectively no auth). `--network host` (Linux) makes the OIDC issuer URL
# (http://$(E3_HOST):<port>) match what clients type, which the login flow needs.
#
# Repos live in a real host dir ($(E3_REPOS_DIR), bind-mounted; root-owned on the
# host — sudo chown -R $$USER $(E3_REPOS_DIR) to reclaim). First free port in
# E3_PORTS (default 3000-3010) wins; pin with E3_PORT=<n>, address with E3_HOST=<ip>.
#
# Tasks run INSIDE the container, so any host files they read must be mounted in.
# E3_DATA_DIRS = space-separated host dirs exposed read-only at the SAME path
# (so a task's absolute path resolves identically locally and on the server):
#   make server-e3 E3_DATA_DIRS="/abs/path/to/data /another/dir"
# E3_MOUNTS = raw extra `docker -v` flags for anything else (rw, custom target path).
# E3_GPUS = pass GPUs to tasks (e.g. E3_GPUS=all). Requires the NVIDIA Container
# Toolkit on the host (sudo apt-get install nvidia-container-toolkit; sudo
# nvidia-ctk runtime configure --runtime=docker; sudo systemctl restart docker).
# The image's torch is a CUDA build, so cuda tasks use the GPU once this is set.
E3_PORT      ?=
E3_PORTS     ?= $(shell seq 3000 3010)
E3_HOST      ?= $(shell hostname -I 2>/dev/null | awk '{print $$1}')
E3_REPOS_DIR ?= $(HOME)/.e3/repos
E3_DATA_DIRS ?=
E3_MOUNTS    ?=
E3_GPUS      ?=
# The e3 CLI fetches ONE access token at command start and never refreshes it
# mid-command, so a long `dataflow run` fails with "Token expired" once it
# outlives the token. Make the access token outlast any pipeline (trusted-LAN
# auto-approve auth is a rubber stamp anyway). Accepts 5s/15m/1h/7d/30d style.
E3_TOKEN_EXPIRY ?= 720h

## Build the e3 image + start the OIDC LAN server (auto-approve; logs in this machine)
server-e3:
	@mkdir -p $(E3_REPOS_DIR)
	@test -n "$(E3_HOST)" || { echo "could not detect a LAN IP — set E3_HOST=<ip>" >&2; exit 1; }
	@docker compose -f docker/images/docker-compose.yml build e3
	@mounts=""; for d in $(E3_DATA_DIRS); do \
	  test -e "$$d" || { echo "E3_DATA_DIRS: $$d does not exist on this host" >&2; exit 1; }; \
	  mounts="$$mounts -v $$d:$$d:ro"; \
	done; \
	echo "starting e3-server (scanning for a free port)…" >&2; \
	ok=; for port in $(if $(E3_PORT),$(E3_PORT),$(E3_PORTS)); do \
	  docker rm -f e3-server >/dev/null 2>&1 || true; \
	  docker run -d --name e3-server --restart unless-stopped --network host $(if $(E3_GPUS),--gpus $(E3_GPUS)) \
	    -e E3_AUTH_AUTO_APPROVE=1 -v $(E3_REPOS_DIR):/data/repos $$mounts $(E3_MOUNTS) \
	    ghcr.io/elaraai/e3:latest \
	    e3-api-server --repos /data/repos --host $(E3_HOST) --port $$port --oidc --token-expiry $(E3_TOKEN_EXPIRY) >/dev/null 2>&1 || true; \
	  for i in 1 2 3 4 5 6 7 8; do \
	    curl -s --connect-timeout 1 --max-time 2 http://$(E3_HOST):$$port/.well-known/openid-configuration 2>/dev/null \
	      | grep -q device_authorization_endpoint && { ok=$$port; break; }; \
	    [ "$$(docker inspect -f '{{.State.Status}}' e3-server 2>/dev/null)" = restarting ] && break; \
	    sleep 0.5; \
	  done; \
	  [ -n "$$ok" ] && break; \
	done; \
	if [ -z "$$ok" ]; then \
	  docker rm -f e3-server >/dev/null 2>&1 || true; \
	  echo "no free port in: $(if $(E3_PORT),$(E3_PORT),$(E3_PORTS)) — set E3_PORT=<n> or widen E3_PORTS" >&2; \
	  exit 1; \
	fi; \
	url="http://$(E3_HOST):$$ok"; \
	command -v e3 >/dev/null 2>&1 && timeout 30 e3 auth login "$$url" --no-browser >/dev/null 2>&1 \
	  && logged="  (this machine: logged in as dev-user)" || logged=""; \
	echo "e3-api-server → $$url   (repos dir: $(E3_REPOS_DIR))$$logged"; \
	echo "login another client:  e3 auth login $$url --no-browser   then deploy against $$url"

## Refresh the image to the latest PUBLISHED @elaraai packages, then restart.
## The image bakes npm/PyPI @latest, NOT your local monorepo source — a plain
## rebuild reuses the cached install layer, so --no-cache --pull is required.
server-e3-update:
	@docker compose -f docker/images/docker-compose.yml build --no-cache --pull e3
	@$(MAKE) --no-print-directory server-e3

## Stop and remove the e3 server container (repos dir is preserved)
server-e3-down:
	@docker rm -f e3-server >/dev/null 2>&1 && echo "e3-server stopped" || echo "e3-server not running"

## Follow the e3 server logs
server-e3-logs:
	@docker logs -f e3-server

# ── Test IR Export ────────────────────────────────────────────────────

## Export all test IR (required before east-py and east-c compliance tests)
test-export:
	@echo "Exporting test IR..."
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east test-export 2>&1 | tail -1
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-node test-export 2>&1 | tail -1
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-py test-export 2>&1 | tail -1

# ── Full Test Run ────────────────────────────────────────────────────

## Start services, run ALL tests (TS + C + Python), stop services
## Requires: make setup (one-time), make install, make build
## Sets EAST_QUIET=1 so each runner only outputs failures + summaries.
test-all: services-up test-export
	@exit_code=0; \
	echo ""; \
	echo "=== TypeScript ==="; \
	EAST_QUIET=1 pnpm -r --no-bail run test > /tmp/east-ts-test.log 2>&1 || exit_code=1; \
	tail -12 /tmp/east-ts-test.log; \
	echo ""; \
	echo "=== east-c ==="; \
	EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-c test-all || exit_code=1; \
	echo ""; \
	echo "=== east-py ==="; \
	EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-py test || exit_code=1; \
	echo ""; \
	$(MAKE) --no-print-directory services-down; \
	exit $$exit_code

# ── Versioning ───────────────────────────────────────────────────────

## Set version across all manifests: npm (incl. root), Python, VSIX, plugin
## Usage: make set-version VERSION=1.2.3  or  make set-version VERSION=1.2.3-beta.0
set-version:
	@test -n "$(VERSION)" || (echo "Usage: make set-version VERSION=x.y.z"; exit 1)
	node scripts/set-npm-version.mjs $(VERSION)
	node scripts/set-python-version.mjs $(VERSION)
	node scripts/set-vsix-version.mjs $(VERSION)
	node scripts/set-plugin-version.mjs $(VERSION)
	node scripts/check-version-drift.mjs

## Check that all manifests are aligned (no version drift)
check-version:
	node scripts/check-version-drift.mjs
	node scripts/check-wire-compat.mjs

# ── Clean ────────────────────────────────────────────────────────────

## Remove all build artifacts
clean:
	rm -rf libs/east/dist
	rm -rf libs/east-node/packages/*/dist
	rm -rf libs/e3/packages/*/dist libs/e3/test/*/dist
	rm -rf libs/east-ui/packages/*/dist
	rm -rf libs/east-c/build
	cd libs/east-py && make clean
	rm -rf node_modules/.cache

# ── Help ─────────────────────────────────────────────────────────────

help:
	@echo "east-workspace (pnpm monorepo)"
	@echo ""
	@echo "First time:"
	@echo "  check-deps       - Verify required tools (uv, pnpm, cmake, cc, ...)"
	@echo "  setup            - Verify build tools + install the e3-ui shot browser (one-time)"
	@echo "  setup-browser    - Install headless Chromium for 'e3-ui shot' (showcase PNG capture)"
	@echo "  install          - Install deps (pnpm + uv)"
	@echo "  build            - Build everything (east-c + east-py + TS)"
	@echo "  link             - Link CLIs globally"
	@echo ""
	@echo "Development:"
	@echo "  build            - Rebuild everything"
	@echo "  test             - Run TS tests (pnpm -r)"
	@echo "  lint             - Lint all (TS + Python + C)"
	@echo ""
	@echo "Test services (Docker):"
	@echo "  services-up      - Start test services (Postgres, Redis, etc.)"
	@echo "  services-down    - Stop test services"
	@echo "  services-status  - Show test services status"
	@echo ""
	@echo "e3 LAN server (Docker, Linux):"
	@echo "  server-e3        - Serve e3 repos over HTTP + OIDC auto-approve (auto-picks free port 3000-3010)"
	@echo "  server-e3-update - Rebuild image at latest published packages (--no-cache) + restart"
	@echo "  server-e3-down   - Stop the e3 server (repos dir preserved)"
	@echo "  server-e3-logs   - Follow the e3 server logs"
	@echo ""
	@echo "Full test run:"
	@echo "  test-export      - Export all test IR"
	@echo "  test-all         - services + export + TS + C + Python (quiet mode)"
	@echo ""
	@echo "Environment:"
	@echo "  EAST_QUIET=1     - Only show failures + summaries (default in test-all)"
	@echo ""
	@echo "Maintenance:"
	@echo "  set-version      - Bump all manifests: make set-version VERSION=1.2.3"
	@echo "  check-version    - Verify all manifests are aligned"
	@echo "  clean            - Remove all build artifacts"
