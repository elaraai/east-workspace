# east-c-cli

This directory holds **both** parts of the east-c CLI:

- **The native C binary source.** `CMakeLists.txt`, `src/main.c`, etc.
  Built by the lib's CMake; links `east-c` (core) and `east-c-std`
  (platform) to execute East IR files from a terminal. Released as a
  tarball on every GitHub Release.
- **The npm launcher** (`@elaraai/east-c-cli`). `package.json` +
  `bin/east-c.mjs`: a tiny Node script that `require.resolve`s a
  per-platform package (`@elaraai/east-c-cli-<target>`) and `spawn`s
  the native binary it contains. The per-platform packages are
  generated from the CMake build at release time (one per target) and
  pulled in as `optionalDependencies` gated on `os` / `cpu`.

`package.json`'s `files: ["bin", "README.md", ...]` allowlist keeps the
CMake / `src/` content out of the npm tarball. The CMake build ignores
`package.json`. They coexist in the same directory without stepping on
each other.

See `../../docs/npm-runner-distribution.md` for the launcher + per-platform
distribution model, and `../../docs/windows-msvc-build.md` for the Windows
build that enables the `win32-x64` target.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../east-c/CLAUDE.md`](../east-c/CLAUDE.md) — core runtime.
- [`../east-c-std/CLAUDE.md`](../east-c-std/CLAUDE.md) — platform
  functions linked in.
