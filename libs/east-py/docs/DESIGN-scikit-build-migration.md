# Migrating east-py packages to `scikit-build-core`

## Status

Design proposal. Replaces all `setup.py` files in the east-py monorepo with
`pyproject.toml` + `CMakeLists.txt` per package, driven by the
`scikit-build-core` PEP 517 backend. Removes the bespoke build-orchestration
code that has accreted (the inline `build_eastc()` in setup.py, the
`east._build_info` cross-package shim, the path-counting that finds east-c
source, the per-package custom `OptionalBuildExt` classes).

## Why this needs to happen

The current build system is two layers stitched together with hand-written
glue:

1. `setup.py` (each package): discovers `.pyx` files, invokes Cython, calls
   into `east._build_info` to find east-c artifacts, sometimes invokes cmake
   directly via `subprocess.run`.
2. `cmake/CMakeLists.txt` (east-py only): builds east-c as a static lib that
   downstream packages link against.

Concrete problems this has already produced in the past few hours of work:

- east-py-std needed to add a native source from east-c-std and the
  "right" answer was reaching sideways into a sibling package's source
  tree. setuptools then mirrored the absolute source path under
  `build/temp.../../../east-c/...`, which created a rogue
  `packages/east-c/` directory that broke uv's workspace member
  detection.
- The Makefile's `build-cython-inplace` target had a long-standing bug
  (`VAR=val cd … && cmd` doesn't propagate VAR to cmd). I had to fix it
  for the new `build-cython-inplace-std` target. There's no way to
  generalise this — every new native package adds a new make target.
- `east._build_info` is a cross-package leak: east-py exposes its private
  build artifacts so other packages can find them. This is the wrong
  shape — packages should ask the build system "where is east-c", not
  "where did east-py put east-c".
- Each setup.py reimplements the same fallback-to-pure-Python pattern
  (`OptionalBuildExt`, ~25 lines per package).
- east-py's setup.py invokes cmake itself (~50 lines of subprocess
  orchestration that re-implements what cmake does natively).
- east-py-std's setup.py reads east-py's build dir (`east._build_info`)
  but east-py-datascience's setup.py is unknown — likely diverging.

The cleanup target after migration:

```
removed:
  packages/east-py/setup.py                          (~150 lines)
  packages/east-py/east/_build_info.py               (~85 lines)
  packages/east-py/cmake/CMakeLists.txt              (replaced by root cmake)
  packages/east-py-std/setup.py                      (~120 lines)
  packages/east-py-io/setup.py                       (~80 lines)
  packages/east-py-datascience/setup.py              (~80 lines, est)
  packages/east-py-cli/setup.py                      (if any)
  Makefile: build-eastc, build-cython-inplace,
            build-cython-inplace-std, clean-cython,
            clean-eastc                              (~50 lines of make)

  total: ~600 lines of build-system code deleted
```

## What `scikit-build-core` is

`scikit-build-core` is a PEP 517 build backend purpose-built for Python
packages whose native code is built via CMake. Maintained by the
scikit-hep / NumPy ecosystem. Used by:

- PyArrow, pyarrow-cffi
- RAPIDS (cuDF, cuML, etc.)
- scikit-image's compiled modules
- Many bioinformatics / scientific projects

What it does:

- Reads `pyproject.toml` for build config
- Invokes cmake on a `CMakeLists.txt` you provide
- Collects compiled artifacts (`.so` files) into the wheel
- Handles editable installs (`pip install -e .`) including incremental
  rebuilds when CMakeLists or source files change
- Discovers Cython via standard cmake mechanisms (no Python-side
  imperative invocation needed)
- Falls back gracefully if cmake fails (configurable)

What it gives us:

- One source of truth per package: the CMakeLists.txt
- No setup.py
- No `_build_info` shim — cross-package native deps via standard
  `find_package()`
- Standard `pip install` works everywhere — no special make targets
- Editable installs work properly with cmake-built artifacts
- Out-of-tree builds (no more `build/` dirs scattered through src)

## The target architecture

### Per-package shape

Every package with native code follows the same structure:

```
packages/east-py-foo/
├── pyproject.toml          # backend = scikit_build_core.build, project metadata
├── CMakeLists.txt          # at root. all build logic here.
├── east_py_foo/            # Python sources + .pyx files mixed in
│   ├── __init__.py
│   ├── _foo_eastc.pyx
│   └── ...
├── tests/
└── README.md
```

**No setup.py. No setup.cfg. No build_ext customization. No
_build_info shim.**

### `pyproject.toml` template

```toml
[build-system]
requires = ["scikit-build-core>=0.10", "cython>=3.0", "numpy"]
build-backend = "scikit_build_core.build"

[project]
name = "east-py-foo"
version = "0.1.0"
# ... project metadata

[tool.scikit-build]
cmake.minimum-version = "3.16"
cmake.build-type = "Release"
wheel.packages = ["east_py_foo"]
# Allow editable installs to rebuild incrementally
editable.rebuild = true
# Pure-Python fallback when cmake is unavailable: ship sources only,
# the import shims in each module use the pure-Python path.
fail.cmake-not-found = false
```

### `CMakeLists.txt` template (per package)

```cmake
cmake_minimum_required(VERSION 3.16)
project(east_py_foo LANGUAGES C)

# ── Locate native deps via the monorepo ─────────────────────────────
# Walk up to monorepo root marker.
set(_search "${CMAKE_CURRENT_LIST_DIR}")
while(NOT EXISTS "${_search}/pnpm-workspace.yaml")
    get_filename_component(_parent "${_search}" DIRECTORY)
    if(_parent STREQUAL _search)
        message(FATAL_ERROR "Could not locate monorepo root.")
    endif()
    set(_search "${_parent}")
endwhile()
set(MONOREPO_ROOT "${_search}")

# Bring in east-c.
add_subdirectory(
    ${MONOREPO_ROOT}/libs/east-c/packages/east-c
    ${CMAKE_BINARY_DIR}/east-c
    EXCLUDE_FROM_ALL
)

# (For east-py-std also bring in east-c-std.)
add_subdirectory(
    ${MONOREPO_ROOT}/libs/east-c/packages/east-c-std
    ${CMAKE_BINARY_DIR}/east-c-std
    EXCLUDE_FROM_ALL
)

# ── Find Python + Cython ────────────────────────────────────────────
find_package(Python COMPONENTS Interpreter Development.Module REQUIRED)

# ── Compile each .pyx into a Python extension ───────────────────────
file(GLOB_RECURSE PYX_FILES CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/east_py_foo/*.pyx")
foreach(pyx ${PYX_FILES})
    get_filename_component(name ${pyx} NAME_WE)
    get_filename_component(rel_dir ${pyx} DIRECTORY)
    file(RELATIVE_PATH install_subdir
         "${CMAKE_CURRENT_SOURCE_DIR}/east_py_foo" ${rel_dir})

    # Cythonize → .c
    set(c_file "${CMAKE_CURRENT_BINARY_DIR}/${name}.c")
    add_custom_command(
        OUTPUT ${c_file}
        COMMAND ${Python_EXECUTABLE} -m cython -3 --cplus=no
                ${pyx} -o ${c_file}
        DEPENDS ${pyx}
        VERBATIM
    )

    # Build extension module
    Python_add_library(${name} MODULE ${c_file} WITH_SOABI)
    target_include_directories(${name} PRIVATE
        ${MONOREPO_ROOT}/libs/east-c/packages/east-c/include
        ${MONOREPO_ROOT}/libs/east-c/packages/east-c-std/include
    )
    target_link_libraries(${name} PRIVATE east-c east-c-std)

    install(TARGETS ${name}
            DESTINATION east_py_foo/${install_subdir})
endforeach()
```

That's it. ~50 lines per package, replacing ~150–250 lines of setup.py
+ shims + `_build_info`.

### Cross-package native dep sharing

`scikit-build-core` builds each package's `CMakeLists.txt` independently.
Each one `add_subdirectory`s east-c (and east-c-std if needed). Since CMake
deduplicates targets within a single configure run, this works fine.

The `EXCLUDE_FROM_ALL` flag means we only build the bits we actually link
against (no test binaries, no CLI, no compliance runners) — keeps wheel
build times down.

The `_build_info.py` cross-package shim disappears entirely because each
package finds east-c via the same monorepo-root-walk, not via reading
another package's build artifacts.

## Per-package change list

### `packages/east-py/`

| Action | What |
|---|---|
| **Move** | `cmake/CMakeLists.txt` → `CMakeLists.txt` (package root) |
| **Edit** | Add Cython compilation rules for the 9 .pyx files |
| **Add** | `[build-system]` + `[tool.scikit-build]` to `pyproject.toml` |
| **Delete** | `setup.py` (~150 lines) |
| **Delete** | `east/_build_info.py` (~85 lines) |
| **Delete** | `cmake/` directory (now empty) |
| **Delete** | `scripts/build_cython.py` (replaced by `pip install`) |

### `packages/east-py-std/`

| Action | What |
|---|---|
| **Add** | `CMakeLists.txt` at package root (mirrors east-py's pattern) |
| **Edit** | `pyproject.toml` — add scikit-build-core backend |
| **Edit** | `_parallel_eastc.pyx` — already binds the C symbol; no change needed |
| **Delete** | `setup.py` (~120 lines, including my recent additions for
              the parallel binding hack) |

### `packages/east-py-io/`

| Action | What |
|---|---|
| **Edit** | `pyproject.toml` — add scikit-build-core backend |
| **Add** | `CMakeLists.txt` (currently no .pyx — just a placeholder so
            future native code drops in cleanly) |
| **Delete** | `setup.py` (~80 lines) |

### `packages/east-py-datascience/`

| Action | What |
|---|---|
| **Add** | `CMakeLists.txt` for the 2 .pyx files |
| **Edit** | `pyproject.toml` — add scikit-build-core backend |
| **Delete** | `setup.py` (~80 lines, est) |

### `packages/east-py-cli/`

No native code; nothing to do.

### Top-level `Makefile`

| Action | What |
|---|---|
| **Delete** | `build-eastc` target (cmake invoked via `pip install`) |
| **Delete** | `build-cython-inplace` target (just `pip install -e .`) |
| **Delete** | `build-cython-inplace-std` target (same) |
| **Delete** | `clean-cython` target (no longer needed) |
| **Delete** | `clean-eastc` target (no longer needed) |
| **Simplify** | `install` target → just `uv sync --reinstall-package <each>` |
| **Add** | `EAST_C_SOURCE_DIR` env var goes away — cmake finds east-c
            itself via the monorepo-root walk |

## Migration plan (4 phases)

### Phase 1 — east-py + east-py-std (the hardest)

Goal: establish the pattern with the two packages we've been actively
working on.

1. Create `packages/east-py/CMakeLists.txt` based on the template above,
   including all 9 .pyx files.
2. Update `packages/east-py/pyproject.toml` to use scikit-build-core.
3. Run `uv sync --reinstall-package east-py --no-build-isolation`.
4. Run `make test-east-py` — verify all tests pass.
5. Repeat for east-py-std (.pyx + east-c-std link in CMakeLists).
6. Run `make test-east-py-std` — verify parallel tests pass with the new
   binding.
7. Delete the now-unused setup.py + _build_info + cmake/ dir from east-py.
8. Delete east-py-std's setup.py.

Risk: editable installs not rebuilding when CMakeLists changes.
Mitigation: `editable.rebuild = true` in pyproject.toml; if that fails,
add a force-rebuild fallback in the Makefile.

### Phase 2 — east-py-io

Goal: even though it has no .pyx today, normalise it so future C code
drops in cleanly.

1. Create `packages/east-py-io/CMakeLists.txt` (placeholder — can be
   empty or just `find_package(Python REQUIRED)`).
2. Update pyproject.toml.
3. Delete setup.py.
4. `make test-east-py-io` — verify nothing broke.

### Phase 3 — east-py-datascience

Goal: catch the most complex package last (has both .pyx files and TS
build via pnpm).

1. Create CMakeLists for the 2 .pyx files.
2. Update pyproject.toml.
3. Delete setup.py.
4. `make test-east-py-datascience`.

### Phase 4 — Makefile + docs cleanup

1. Delete the `build-*` and `clean-*` targets that are no longer needed.
2. Simplify `install` target.
3. Update each package's CLAUDE.md to reference the new build flow.
4. Update top-level CLAUDE.md if it mentions build system.

Total: roughly 1 focused day. Phase 1 is ~half a day; phases 2–4 are
~2 hours each.

## Verification

After each phase:

```bash
# Clean rebuild from scratch
rm -rf packages/*/build packages/*/east_py*/_*.so packages/*/east_py*/_*.c
rm -rf .venv
uv sync --all-packages --no-build-isolation

# Tests
make test                       # full test suite

# Python dev workflow
echo "from east import East; print('ok')" | uv run python  # editable import
touch packages/east-py/east/types/_values_cy.pyx
uv pip install -e packages/east-py --no-build-isolation     # incremental rebuild
echo "from east.types._values_cy import *; print('rebuilt')" | uv run python
```

Acceptance criteria:

- All Python tests pass (east-py, east-py-std, east-py-io, east-py-datascience)
- C tests still pass (east-c, east-c-std)
- WASM tests still pass (east-c-wasm)
- `pip install -e packages/east-py` works without env vars
- Touching a .pyx and re-importing picks up changes (editable rebuild)
- No `setup.py` files remain in the monorepo:
  ```bash
  find libs/east-py -name "setup.py" -not -path "*/build/*" -not -path "*/.venv/*"
  # → empty
  ```
- No `_build_info` cross-package leak:
  ```bash
  grep -r "_build_info" libs/east-py
  # → empty
  ```

## Risks

1. **Editable installs in scikit-build-core** are well-tested but have
   sharp edges around incremental rebuild detection. If `editable.rebuild`
   doesn't pick up .pyx changes, devs will need an explicit rebuild trigger.
   Mitigation: keep one `make rebuild` target that forces reinstall.

2. **Cython detection in cmake** — we need cython installed in the build
   env. scikit-build-core handles this via `[build-system].requires`, but
   IDE integration (running `pip install -e` from VS Code) needs the
   build deps available.

3. **CI build-time** — scikit-build-core uses ninja by default which is
   parallel and fast. Should be a wash or faster than current. Wheel
   builds on Linux/macOS/Windows all work natively.

4. **`uv sync` integration** — uv supports PEP 517 backends including
   scikit-build-core. The existing `uv sync --reinstall-package` flow
   continues to work; just no `-DEAST_C_SOURCE_DIR=...` needed.

5. **Cross-package CMake target name collisions** — both east-py and
   east-py-std `add_subdirectory` east-c. CMake disallows duplicate
   target names within a single configure. But each package is configured
   independently (separate cmake invocations per `pip install`), so this
   isn't an issue.

## What stays out of scope

- Migrating east-c-wasm's TS-side build (uses pnpm, no Python involved).
- Touching east-py-cli (pure Python, no native code).
- Replacing pnpm/turbo for the TS workspace.
- Migrating east-py to a different language runtime (Rust, etc.).

## Recommendation

Do this in one focused session (1 day). The migration is mechanical
once Phase 1 is established. The cleanup is significant
(~600 lines of build code deleted), the runtime behaviour is identical,
and downstream developer experience improves (just `pip install -e`).

The current session should:
1. Revert my partial east-py-std setup.py hack (the inline source
   compilation that created the rogue dir)
2. Implement Phase 1 (east-py + east-py-std)
3. Verify both packages work end-to-end
4. Defer phases 2–4 to a follow-up session OR continue if there's time.

Want me to proceed with Phase 1?
