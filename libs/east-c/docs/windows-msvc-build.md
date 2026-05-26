# Design: build east-c on Windows with MSVC (one toolchain for the CLI *and* the east-py link)

> **For a fresh Claude Code session on Windows: start here.** This document is
> self-contained. Read it, then `libs/east-c/CLAUDE.md`,
> `libs/east-c/docs/npm-runner-distribution.md`, and
> `libs/east-py/packages/east-py-datascience/CMakeLists.txt`. The decisions in
> "Decisions (resolved)" were settled deliberately — don't relitigate them
> without a reason.

## Goal

east-c must build on Windows in **one consistent way** that serves both
consumers of the C runtime:

1. The **standalone `east-c` CLI / release binary** (`win32-x64`, the missing
   target in `npm-runner-distribution.md`).
2. The **static library that `east-py-datascience` links in-process** — its
   `CMakeLists.txt` builds east-c via `add_subdirectory(east-c)` and
   `target_link_libraries(<cython_ext> PRIVATE east-c m)`, so the East runtime
   runs *inside* the Python extension module.

Today these would use two different Windows toolchains (MinGW for the
standalone build added on `feat/east-c-windows-build`; MSVC for the east-py
extension, since that's what scikit-build-core / CPython default to). Two
compilers building the same library is the problem this design removes.

## Why MSVC, and why one toolchain

The deciding constraint is consumer (2). The east-c objects get linked into a
**CPython extension that shares a process with MSVC-built CPython, NumPy, and
Torch**. One process cannot cleanly mix C runtimes/ABIs, so the compiler that
builds east-c on Windows **must emit the MSVC ABI**.

- **MinGW cannot be the shared toolchain** — a MinGW-built static lib does not
  link cleanly into an MSVC-built CPython extension. MinGW was a fine choice for
  a standalone `.exe` (it cross-compiles from Linux and produces a
  self-contained static binary), but that property doesn't transfer to the
  in-process-link requirement.
- **MSVC (`cl.exe`) is the native Windows default.** scikit-build-core / CMake
  already pick it on Windows, so consumer (2) builds east-c with MSVC **with no
  compiler override** once east-c compiles under MSVC. Pointing the standalone
  build at the same compiler then gives genuinely *one* method — the platform
  default — with the least special-casing.

The cost: MinGW silently backfilled a POSIX layer (`unistd.h`, `dirent.h`,
`pthreads`, `clock_gettime`, `strdup`, …). MSVC provides none of it, so the work
is to supply that layer explicitly. See "What MSVC requires".

## Decisions (resolved)

- **Target MSVC (`cl.exe`), built natively on Windows.** Not clang-cl: its only
  advantages were cross-compiling from Linux (moot — we build on Windows) and
  tolerating GNU extensions with zero source change (moot — the core lib's only
  GNU-ism in a normal build is one printf attribute). MSVC is the native default
  and carries zero ABI risk against the CPython/NumPy/Torch the extension links.
- **east-py keeps linking east-c in-process.** Spawning the east-c runner as a
  separate process (as e3 does) was considered and rejected — east-py's value is
  fast in-process East evaluation interleaved with Python ML libraries.
- **Removing the east-c dependency from east-py is not on the table.**
- **One toolchain for all Windows east-c.** Once MSVC builds clean, the MinGW
  Windows path (`cmake/mingw-w64-x86_64.toolchain.cmake` and the
  `choco install mingw` / `-G "MinGW Makefiles"` CI steps) is retired, not kept
  in parallel.
- **Cross-compiling from Linux is dropped for Windows.** MSVC needs the Windows
  SDK; the Windows artifact is built on a Windows runner (where the east-py wheel
  must be built regardless). Linux/macOS artifacts are unaffected.

## What MSVC requires

The surface splits cleanly. Re-derive the current call sites with the grep
commands below rather than trusting a snapshot — the code moves.

### Core `east-c` (consumer 2's dependency) — near-trivial

This is what `east-py-datascience` links, so getting *this* clean is the entire
east-py unblock. It is already nearly MSVC-ready:

- C11, `int64_t` integers (no `__int128`), no `pthread_*`, no computed gotos, no
  inline asm, no `__builtin_*`.
- `compat.h` already shims several POSIX gaps using **MSVCRT** functions
  (`_mkgmtime`, `_putenv_s`, `_mkdir`) under `#ifdef _WIN32`.
- The `typeof` uses in `src/serialization/beast2/dedup.c` are inside
  `#ifdef BEAST2_PROFILE_DEDUP`, which **no build sets** — they don't compile.

The one GNU extension compiled in a normal build:

- `src/values.c` — `__attribute__((format(printf, 4, 5)))` on `buf_append`.
  Replace with a portable macro, e.g. in a shared header:

  ```c
  #if defined(__GNUC__) || defined(__clang__)
  #  define EAST_PRINTF_FMT(fmt_idx, va_idx) __attribute__((format(printf, fmt_idx, va_idx)))
  #else
  #  define EAST_PRINTF_FMT(fmt_idx, va_idx)
  #endif
  ```

  This keeps the diagnostic on GCC/Clang and compiles clean on MSVC. (If
  `BEAST2_PROFILE_DEDUP` is ever wanted on MSVC, also name the anonymous
  `type_stats` struct in `src/serialization/beast2/internal.h` and drop the two
  `typeof`s in `dedup.c` — not needed for a normal build.)

Find the GNU-isms that compile by default:

```bash
grep -rnE '__attribute__|\btypeof\b' libs/east-c/packages/east-c/src libs/east-c/packages/east-c/include | grep -v build
```

### `east-c-std` + CLI (the standalone `.exe`, compliance-std, release tarball) — the real port

This code uses raw POSIX that MinGW backfilled and MSVC does not provide. The
job is to extend `compat.h` (and force-include it on Windows) so these resolve.
Representative call sites:

```bash
grep -rhoE '#include <(unistd|dirent|sys/[a-z]+|pthread|fcntl|strings)\.h>' \
  libs/east-c/packages/east-c-std/src libs/east-c/packages/east-c-cli/src | sort | uniq -c
grep -rhoE '\b(opendir|readdir|closedir|clock_gettime|getrusage|gettimeofday|stat|lstat|mkdir|rmdir|unlink|realpath|setenv|strdup|strndup|strcasecmp|ssize_t)\b' \
  libs/east-c/packages/east-c-std/src libs/east-c/packages/east-c-cli/src | sort | uniq -c | sort -rn
```

Known MSVC mappings (build the missing ones in `compat.h`):

| POSIX | MSVC / Windows |
|---|---|
| `strdup`, `strndup` | `_strdup`; hand-roll `strndup` |
| `strcasecmp` | `_stricmp` |
| `clock_gettime(CLOCK_MONOTONIC/REALTIME)` | `QueryPerformanceCounter` / `GetSystemTimePreciseAsFileTime` |
| `opendir`/`readdir`/`closedir` (`dirent.h`) | `FindFirstFileW`/`FindNextFileW`/`FindClose` (a small dirent shim) |
| `stat`/`lstat` (`sys/stat.h`) | `_stat64` / `GetFileAttributesEx` |
| `mkdir(path, mode)` | already shimmed (`east_mkdir` → `_mkdir`) |
| `rmdir`, `unlink` | `_rmdir`, `_unlink` |
| `setenv`/`unsetenv` | already shimmed (`_putenv_s`) |
| `ssize_t` | `typedef` to `SSIZE_T` (`BaseTsd.h`) or `ptrdiff_t` |
| `realpath` | `_fullpath` / `GetFullPathNameW` |
| `sys/wait.h` (process wait in the CLI) | `_cwait` / `GetExitCodeProcess` over the spawn path |

`compat.h` is currently `#include`d in only one translation unit
(`builtins/datetime_ops.c`). For the shims to apply runtime-wide, **force-include
it on Windows** from CMake rather than editing every file:

```cmake
if(WIN32)
  if(MSVC)
    add_compile_options(/FI "${EAST_C_DIR}/include/east/compat.h")
  else()
    add_compile_options(-include "${EAST_C_DIR}/include/east/compat.h")
  endif()
endif()
```

### CMake changes (`libs/east-c/CMakeLists.txt` and `packages/east-c/CMakeLists.txt`)

The existing `if(WIN32)` blocks assume the GNU toolchain — split MinGW vs MSVC:

- **Stack reserve** (root `CMakeLists.txt`, the `add_link_options(-Wl,--stack,1073741824)`
  block): `-Wl,--stack,N` is GNU-linker syntax. MSVC equivalent is
  `/STACK:1073741824` (link.exe). Branch on `if(MSVC)`. The 1 GiB reserve is
  needed for the deeply-recursive patch/diff suites on both.
- **Warning flags**: `-Wall -Wextra -Wpedantic` is already gated on `GNU|Clang`.
  Audit any *unconditional* flags (e.g. the `-w` on the pcre2 static targets) for
  MSVC acceptance; prefer gating per `CMAKE_C_COMPILER_ID`.
- **curl + Schannel** (root `if(WIN32)` FetchContent): curl builds under MSVC;
  verify the static-lib + Schannel options carry over.
- **`Threads::Threads` for `test_compliance`** (`packages/east-c/CMakeLists.txt`
  `if(WIN32)`): was for `clock_gettime` via winpthreads under MinGW. Under MSVC
  `clock_gettime` comes from the `compat.h` shim instead; reassess whether the
  Threads link is still needed.
- **PCRE2** FetchContent builds under MSVC; verify.

## Task order (do it locally first)

Iterate on the **local Windows machine**, not CI — toolchain bring-up wants a
seconds-long edit/build loop, not a 5–10 min CI round-trip. Encode the working
recipe into CI only once it's green locally.

1. **Prereqs**: Visual Studio Build Tools (the "Desktop development with C++"
   workload, which includes `cl.exe` + the Windows SDK), CMake ≥ 3.18, and
   Ninja (or use the Visual Studio generator). Run cmake from a **Developer
   Command Prompt / Developer PowerShell** so the MSVC env is set.

2. **Core lib under MSVC** — get `east-c` (the library target) compiling:
   ```bat
   cmake -S libs\east-c -B libs\east-c\build-msvc -G Ninja -DCMAKE_BUILD_TYPE=Release
   cmake --build libs\east-c\build-msvc --target east-c
   ```
   Fix the printf attribute; add `compat.h` force-include; resolve whatever std
   POSIX the `east-c` target itself pulls (should be little). This is the east-py
   unblock.

3. **Full build** — `east-c-std`, `test_compliance`, `test_std_compliance`, CLI.
   This surfaces the bulk of the POSIX port (dirent, clock_gettime, strdup, …).
   Extend `compat.h` until it links.

4. **Run compliance on Windows** (the fuzz-filename fix on this branch already
   keeps IR filenames under `MAX_PATH`):
   ```bat
   :: export IR on any box: cd libs/east && make test-export   (writes /tmp/east-test-ir)
   libs\east-c\build-msvc\packages\east-c\test_compliance.exe <ir-dir>\Array.json
   :: or the whole suite via the portable runner under Git Bash:
   ./packages/east-c/scripts/run_compliance.sh build-msvc/ir-east build-msvc/packages/east-c/test_compliance
   ```

5. **Prove the east-py link under MSVC** — the actual point:
   ```bat
   cd libs\east-py
   make install                      :: scikit-build-core builds east-c via add_subdirectory with MSVC
   make test-east-py-datascience
   ```
   Confirm the built `.pyd` imports and runs alongside NumPy/Torch.

6. **Retire MinGW** for Windows: delete `cmake/mingw-w64-x86_64.toolchain.cmake`
   and the MinGW steps in `.github/workflows/test-east-c.yml`; update the stack-
   reserve comment that references MinGW.

## CI wiring (after local green)

- **`test-east-c.yml`** — Windows leg builds with MSVC (drop `choco install
  mingw` and `-G "MinGW Makefiles"`; use the default VS generator or Ninja in an
  MSVC env via e.g. `ilammy/msvc-dev-cmd`).
- **`test-east-py.yml`** — add `windows-latest` (and `macos-latest`) to:
  - **`core`** and **`datascience`** — no services needed; just per-OS C-deps
    (replace the `sudo apt-get` step).
  - **`std`** — connects to **httpbin only** (`localhost:8085`); drop the
    `docker compose` step and start **go-httpbin** natively, exactly as
    `test-east-c.yml` does (`go install … go-httpbin`). Cross-OS for free.

  - **`io`** — **builds on Windows with no servers** (east-node-io is pure TS;
    east-py-io's native part is the shared east-c core, and its drivers —
    `asyncpg`, `aiomysql`, `motor`, `redis`, `boto3`, `aioftp`, `asyncssh`,
    `openpyxl` — are pure-Python / have Windows wheels). The test suite is split
    by service, so on Windows: **build everything + run the service-free specs**
    — `compression` (Gzip/Zip/Tar), `format` (XLSX/XML), `sql/sqlite` (embedded),
    `sql/access` (file) — and **exclude the server-backed specs** (`sql/postgres`,
    `sql/mysql`, `nosql`, `storage`, `transfer`), which stay on `ubuntu-latest`
    with Docker. Specs are per-engine files, so subset selection is mechanical.

  GitHub's Windows/macOS runners can't run Linux service containers (and Actions
  `services:` are Linux-only too), which is why the server-backed io specs stay
  on Linux. Replacing Docker with native servers to lift that — easy for
  MinIO/SFTP/Postgres/MySQL, rough on Windows for Redis/MongoDB/FTP — is a
  separate, optional effort, not a prerequisite here.
- **`test-e3.yml`** — already runs `ubuntu-latest` + `macos-14`. Adding
  `windows-latest` was blocked only by `make install-cli` (the east-py native
  build); once east-py builds on Windows, this unblocks. Alternatively run the
  Windows e3 leg against the **east-c** or **east-node** runner and skip the
  python runner. Update the comment at the top of the `test` job once done.
- **`release.yml` (`publish-c-native`)** — add the `win32-x64` target built with
  MSVC; this is the missing Windows release package called out in
  `npm-runner-distribution.md`.

## Verification checklist

- [ ] `east-c` library target compiles under MSVC with no GNU-extension errors.
- [ ] `east-c-std`, both compliance runners, and the CLI build and link under MSVC.
- [ ] Core + std compliance suites pass on Windows (MSVC binary).
- [ ] `east-py-datascience` builds via scikit-build-core (MSVC) and
      `make test-east-py-datascience` passes; the `.pyd` loads with NumPy/Torch.
- [ ] MinGW toolchain file and CI steps removed; no second Windows toolchain remains.
- [ ] CI: east-c (Windows/MSVC), east-py core+datascience (+win/+mac), e3 (+win)
      green; `publish-c-native` produces a `win32-x64` tarball.

## Cross-references

- `libs/east-c/docs/npm-runner-distribution.md` — the parent design (this is the
  Windows-build prerequisite for its `win32-x64` package; supersedes its
  "Windows east-c build" section's MinGW direction).
- `libs/east-c/CLAUDE.md` — east-c architecture and commands.
- `libs/east-py/packages/east-py-datascience/CMakeLists.txt` — how east-c is
  fetched + linked into the extension (mirrors `packages/east-py/CMakeLists.txt`).
- `libs/east-c/packages/east-c/include/east/compat.h` — the POSIX/Windows shim
  layer to extend.
- Branch `feat/east-c-windows-build` (PR #10) — the MinGW Windows build this
  supersedes, plus the fuzz IR-filename `MAX_PATH` fix.
