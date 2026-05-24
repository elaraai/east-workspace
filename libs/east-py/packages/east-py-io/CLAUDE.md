# east-py-io

I/O platform functions for East on Python — mirror of
`@elaraai/east-node-io`. SQL/NoSQL databases, S3 storage, file
transfer, file formats, compression.

Pure Python today (no native code) — the placeholder `CMakeLists.txt`
exists only so scikit-build-core has something to consume.

## Optional dependencies

Every module that wraps a third-party native library follows the
two-layer `find_spec` + lazy-import guard pattern in
[`../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md`](../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md).
**Read that before adding a new module.**

## See also

- [`../east-py/CLAUDE.md`](../east-py/CLAUDE.md) — core Python runtime.
- [`../east-py-datascience/CLAUDE.md`](../east-py-datascience/CLAUDE.md)
  — sibling package using the same optional-deps pattern; reference for
  module structure.
- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
