# Windows developer setup

How to build, test, and run the East monorepo on Windows **the same way
CI does** — through the existing `make` targets, with no per-command
improvisation.

## The one idea that makes this work

Every `Makefile` in this repo is written with **bash** recipes
(`rm -rf`, `find … -exec`, `command -v`, `cd … && …`). They run
unchanged under **Git Bash**, and only break under `cmd.exe` /
PowerShell. So the rule on Windows is:

> **Do all development in Git Bash, with every tool on its PATH and the
> MSVC compiler environment loaded into it.**

Git Bash *inherits the Windows PATH*, so anything installed to a normal
PATH location (winget/installers do this) becomes visible **after you
restart the shell**. The only thing that is *not* a PATH entry is the
MSVC toolchain — that's a set of environment variables produced by
`vcvars`, which Step 5 loads for you.

Once set up, the entire interface is:

```bash
make install      # one-time: deps (pnpm + uv) + native east-py
make build        # east-c + east-py + all TS + plugin artifacts
make test         # all TypeScript tests
make -C libs/e3 test          # just e3
make -C libs/east-py test     # just east-py
make test-all     # services + every suite (needs Docker)
```

No hand-crafted `node --test …` / `cmake …` / `uv …` invocations for
normal work. (The one documented exception — running a *single* test by
name — is in the Troubleshooting section.)

---

## Conventions for stepping through

Run each step **in Git Bash** unless it says otherwise. After installing
anything, **close and reopen Git Bash** before the "verify" command, so
the new PATH is picked up. Each step lists what you should see; if you
see something else, stop and report it.

> **Clone to a short, space-free path *outside* OneDrive** — e.g.
> `C:\src\east-workspace`, **not** `…\OneDrive - ELARA\Documents\…`. GNU
> Make and CMake/MSVC can't build from a path with spaces (the OneDrive
> "Documents" redirect is the usual offender), and OneDrive syncing a build
> tree (`node_modules`, `.venv`, `build/`) causes file-lock and churn
> problems. This is a hard requirement — the root Makefile refuses to run
> from a spaced path. If you already cloned under OneDrive, move it:
> `mv "<onedrive>/…/east-workspace" /c/src/east-workspace` (then update the
> `source` line in `~/.bashrc` from Step 4 to the new path).

---

## Step 0 — Git line endings (do this before/at clone)

The repo is LF. Git for Windows defaults to `autocrlf=true`, which
rewrites files to CRLF on checkout and produces "CRLF will be replaced by
LF" warnings and noisy diffs. Set the input policy globally:

```bash
git config --global core.autocrlf input
```

Verify:

```bash
git config --global core.autocrlf      # → input
```

If you already cloned with the default, renormalize the working tree
after setting this:

```bash
cd /path/to/east-workspace
git add --renormalize .
git checkout -- .
```

---

## Step 1 — Git for Windows (the shell)

If you can read this in Git Bash you already have it. Otherwise install
it (it provides `bash`, `git`, and the coreutils the Makefiles call):

```bash
winget install Git.Git
```

Verify (new Git Bash window):

```bash
uname -s        # → MINGW64_NT-…
git --version   # → git version 2.x
```

> **"MINGW64" is just the shell label, not the compiler.** Git Bash is
> built on MSYS2 and self-identifies as `MINGW64` on 64-bit Windows — every
> Git Bash window does. This is unrelated to the MinGW-w64 **GCC** toolchain
> that `east-c` used to build with: that was retired in favour of **MSVC
> (`cl.exe`)** (loaded in Step 4). You drive the MSVC build *from* this
> MINGW64-labeled shell — the two are independent.

---

## Step 2 — Toolchain (Node, pnpm, uv, CMake, Ninja, Python, Make)

Run these in **PowerShell or Git Bash** (winget works from either). These
all install to standard PATH locations.

```powershell
winget install Schniz.fnm               # Node version manager (reads .nvmrc)
winget install astral-sh.uv             # Python project/runner manager
winget install Kitware.CMake            # east-c / east-py native build
winget install Ninja-build.Ninja        # CMake generator used on Windows
winget install Python.Python.3.12       # `python` on PATH (uv also manages its own)
winget install ezwinports.make          # GNU Make
```

We don't pin Node here: `fnm` (just installed) reads the repo's `.nvmrc`
and switches Node automatically — wired up in Step 4. pnpm comes from
Corepack (bundled with Node), also in Step 4.

> If any `winget install` reports "No package found", tell me the ID that
> failed — IDs drift, and there are `choco`/`scoop`/installer fallbacks
> (e.g. `choco install make`, `scoop install make`).

> **Python App-Execution-Alias gotcha:** Windows ships a `python.exe` stub
> that opens the Microsoft Store. Disable it: *Settings → Apps → Advanced
> app settings → App execution aliases* → turn **off** `python.exe` and
> `python3.exe`. (The Step 4 script also prepends the real interpreter
> ahead of the stub, but disabling it removes any ambiguity.)

**Don't verify in Git Bash yet.** winget added these to the *User* PATH,
which already-running shells — and the Git Bash they spawn — don't pick up
until a logout, so they'll still look "not found". **Step 4 puts them on
the Git Bash PATH deterministically** (no logout needed); we install the
pinned Node and verify everything *there*, once.

---

## Step 3 — MSVC C++ toolchain (Build Tools for Visual Studio)

`east-c` and the `east-py` native extensions compile with `cl.exe`. If
you have Visual Studio 2022 with the C++ workload, skip the install.
Otherwise install the standalone Build Tools with the C++ workload:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

(Or run the **Visual Studio Installer** GUI and check **"Desktop
development with C++"**.)

Verify the install is discoverable (Git Bash):

```bash
"/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" \
  -latest -products '*' \
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
  -property installationPath
```

Expected: a path like `…/2022/BuildTools` (or `…/Community`). Report if
it prints nothing.

---

## Step 4 — Wire your shell (once, version-controlled)

Everything the environment needs — the winget tools (uv, fnm, make,
ninja), CMake, and the real Python all on PATH; fnm's Node switching; the
MSVC compiler env (`cl.exe`, SDK, `INCLUDE`, `LIB` — none of which are
plain PATH entries); and
`CMAKE_GENERATOR=Ninja` — lives in one committed, idempotent script:
[`scripts/windows-dev-env.sh`](../scripts/windows-dev-env.sh). Each block
is a no-op until its tool is installed, so it's safe to wire in now;
updates arrive through normal `git pull`. You hand-edit only a one-line
`source`.

**1. Fix paste first — *type* (don't paste) this, then reopen Git Bash.**
Older Git Bash leaks bracketed-paste markers (`[200~`) into pasted
commands; this turns it off so the rest of this step pastes cleanly:

```bash
echo 'set enable-bracketed-paste off' >> ~/.inputrc
```

**2. Wire the script into your shell startup** (you never run it by hand —
it's sourced automatically on every shell open). Git Bash login shells
read `~/.bash_profile`, so point that at `~/.bashrc`, and have `~/.bashrc`
`source` the script. **Run these from your clone's root** — `$(pwd)`
captures the correct Git-Bash path, so you hand-type nothing:

```bash
echo '[ -f ~/.bashrc ] && . ~/.bashrc' >> ~/.bash_profile
echo "source \"$(pwd)/scripts/windows-dev-env.sh\"" >> ~/.bashrc
```

From here on, every Git Bash you open sources the script automatically.

> Prefer not to paste? Open `~/.bashrc` in an editor (`notepad ~/.bashrc`)
> and add the line `source "<your-clone>/scripts/windows-dev-env.sh"` —
> GUI paste isn't affected by the terminal bug.

**3. Close every shell, open a fresh Git Bash, install the pinned Node +
pnpm** (Corepack is per-Node-install, so enable it on the fnm Node):

```bash
fnm install 22 && fnm use 22       # 22 = the .nvmrc pin; auto-selected on cd hereafter
corepack enable && corepack enable pnpm
```

**4. Verify the whole toolchain — the real checkpoint:**

```bash
for t in node pnpm uv cmake ninja python make; do \
  printf '%-7s ' "$t"; command -v "$t" >/dev/null && "$t" --version 2>&1 | head -1 || echo MISSING; \
done
which cl     # → …/VC/Tools/MSVC/…/bin/Hostx64/x64/cl  (appears once Step 3 is done)
```

Expected: **node v22.x**, pnpm 10.8.1, uv, cmake, ninja, **python 3.12.x**,
make — plus a `cl` path. Report anything `MISSING`, or a `python` that
still opens the Store.

> The script loads the MSVC env via `vswhere` + `vcvars64.bat` — no
> Developer-prompt dance, every Git Bash is build-ready. If you ever need a
> one-off without it, launch Git Bash from the **"x64 Native Tools Command
> Prompt for VS 2022"** instead.

---

## Step 5 — Corporate TLS (only if behind an inspecting proxy)

On an ELARA-managed network, package downloads may fail with certificate
errors. If and only if you hit those, **uncomment** the two TLS lines at
the bottom of `scripts/windows-dev-env.sh`:

```bash
export NODE_OPTIONS=--use-system-ca   # pnpm/Node trust the Windows cert store
export UV_NATIVE_TLS=1                # uv trusts the Windows cert store
```

and set git to use the native TLS backend:

```bash
git config --global http.sslBackend schannel
```

Skip this entirely if your installs in Steps 2–3 succeeded without cert
errors.

---

## Step 6 — Clone (if you haven't)

Clone to a **short, space-free path outside OneDrive** (see the callout
above — Make and the C toolchain can't handle spaces, and OneDrive
shouldn't sync a build tree). With Step 0 already applied globally, a fresh
clone also lands with correct line endings:

```bash
git clone https://github.com/elaraai/east-workspace.git /c/src/east-workspace
cd /c/src/east-workspace
```

---

## Step 7 — Verify prerequisites, then install

`make` checks tools first and fails fast with hints if any are missing:

```bash
make check-deps     # ✓/✗ per tool
make install        # pnpm install + native east-py (uses MSVC from Step 4)
```

`make install` is where the MSVC env matters — `east-py`'s Cython +
`east-c` extensions compile here. Expect a few minutes the first time.

If `make check-deps` flags something, it's a Step 2/3 gap — fix and
report which tool.

---

## Step 8 — Put the `east-py` CLI on PATH

The e3 dataflow runner spawns `east-py`; several e3 tests need it
installed (a missing one shows as `spawn east-py ENOENT`). Install it as
a uv tool:

```bash
make -C libs/east-py install-cli
```

This lands `east-py` in `~/.local/bin`, which the Step 4 env script
already prepends — so just **reopen Git Bash** and verify:

```bash
which east-py        # → …/.local/bin/east-py
east-py --version
```

(For non-Git-Bash shells, `uv tool update-shell` adds that dir to the
Windows User PATH.)

---

## Step 9 — Build

```bash
make build
```

Builds `east-c` (Ninja + MSVC), `east-py` (native), all TypeScript
packages, and regenerates the Claude-plugin artifacts.

> **pnpm bin-shim note:** on Windows, pnpm writes a workspace bin's
> launcher at *install* time and it can go stale if the bin's `dist` was
> built afterwards. If a workspace CLI (`e3`, `east-node`) isn't found
> after a build, refresh the shims with `pnpm install` (or `make link`),
> then reopen the shell.

---

## Step 10 — Test

```bash
make test                      # all TS suites
make -C libs/e3 test           # just e3
make -C libs/east-py test      # just east-py (compliance)
make test-all                  # everything + Docker services (see below)
```

`make test-all` and `make services-up` need **Docker Desktop**
(`winget install Docker.DockerDesktop`) running; the service-backed
suites (Postgres/MySQL/Mongo/Redis/MinIO/FTP/SFTP) use it. The plain
`make test` does not.

---

## Claude Code CLI

Claude Code (the `claude` CLI, if you use it) installs separately from the
monorepo toolchain. Native installer (PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

It drops `claude.exe` in `%USERPROFILE%\.local\bin` and adds that dir to
your User PATH, and it auto-updates in the background. Alternatives:
`winget install Anthropic.ClaudeCode` (no auto-update) or
`npm install -g @anthropic-ai/claude-code`.

That `~/.local/bin` is the **same dir** `uv tool install` uses for
`east-py` (Step 8), and the Step 4 env script prepends it — so once your
shell is wired, both `claude` and `east-py` resolve in Git Bash with no
extra work. If a brand-new **PowerShell** can't find `claude`, that's just
User-PATH propagation lag from a stale parent process (a sign-out/in
clears it); Git Bash with the env script sourced sees it immediately.

```bash
claude --version     # check it
claude update        # manual update (also happens automatically)
```

---

## Troubleshooting / known gotchas

| Symptom | Cause & fix |
|---|---|
| `make: command not found` (Git Bash) | Step 2 Make not installed or shell not restarted. `command -v make`. |
| `make … No rule to make target 'ELARA/…'` (or any split path) | Repo is at a path with spaces (OneDrive Documents). Move it to a space-free path like `C:/src/east-workspace`; update the `~/.bashrc` `source` line. |
| Tool installed but `command -v` says missing | Windows PATH not refreshed — **reopen Git Bash**. |
| `spawn east-py ENOENT` in e3 tests | Step 8 not done / uv tool bin not on PATH. `which east-py`. |
| `claude` not found in a new shell | `~/.local/bin` not propagated — the Step 4 script covers Git Bash; for PowerShell, sign out/in. |
| `cl : command not found` / CMake "no C compiler" | Step 4 not applied in *this* shell. `which cl`. |
| CMake picks "Visual Studio" generator / `MAX_PATH` errors | `CMAKE_GENERATOR` not set to `Ninja` (Step 4) or `ninja` missing (Step 2). |
| `Compatibility with CMake < 3.5 has been removed` (CMake 4.x, in a FetchContent'd dep) | add `export CMAKE_POLICY_VERSION_MINIMUM=3.5` to `scripts/windows-dev-env.sh`, or pin CMake 3.31. |
| `python` opens Microsoft Store | App-execution-alias stub — disable it (Step 2 note). |
| Cert / TLS errors during install | Apply Step 5. |
| "CRLF will be replaced by LF" warnings | Step 0 (`core.autocrlf input` + `git add --renormalize .`). |
| Workspace CLI (`e3`) not found after build | Stale pnpm bin shim — re-run `pnpm install` (Step 9 note). |

### Run a single test by name (repeatable)

Tests run from compiled `dist/`. After rebuilding the package you changed
and the test package, filter by name with the stock Node flag — e.g. one
e3 integration test:

```bash
pnpm --filter @elaraai/e3-core build           # if you edited e3-core
cd libs/e3/test/integration && pnpm run build  # build the test
node --enable-source-maps --test-reporter=spec --test-concurrency=1 \
     --test-name-pattern="round-trip local" --test 'dist/**/*.spec.js'
```

---

## Tool reference

| Tool | Why | Install (Step) |
|---|---|---|
| Git for Windows | Git Bash shell + coreutils | 1 |
| Node 22 | TS runtime; `.nvmrc` = 22 | 2 |
| pnpm 10.8.1 | TS workspace package manager (via Corepack) | 2 |
| uv | east-py deps, runner, `east-py` CLI | 2 |
| CMake | east-c / east-py native build | 2 |
| Ninja | CMake generator on Windows (avoids MAX_PATH) | 2 |
| Python 3.12 | `python` on PATH for `check-deps`/scripts | 2 |
| GNU Make | the canonical command interface | 2 |
| MSVC Build Tools | `cl.exe` + Windows SDK for native code | 3 |
| Docker Desktop | service-backed integration tests only | 10 (optional) |

See [`conventions/MAKEFILE_TARGETS.md`](conventions/MAKEFILE_TARGETS.md)
for the full target list, and each `libs/<lib>/` `make help` for
lib-specific extras.
