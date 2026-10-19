# Third-party sources for east-c-datascience

The upstream release archives east-c-datascience builds from, checked in so
that no build downloads anything (`scripts/check-native-sources.mjs` at the
workspace root refuses a CMake file that does). The rules are
[`packages/east-c/third_party/README.md`](../../east-c/third_party/README.md)'s:
each archive is the upstream release's own, named with its version, pinned by
its SHA-256 in the `CMakeLists.txt` that builds it.

| Archive | Upstream | SHA-256 | License | Built |
|---|---|---|---|---|
| `xgboost-src-3.2.0.tar.gz` | [dmlc/xgboost 3.2.0](https://github.com/dmlc/xgboost/releases/download/v3.2.0/xgboost-src-3.2.0.tar.gz) (the release's source archive, with its `dmlc-core` and `gputreeshap` submodules) | `16a31dfbc0c54544c9c36ab5f696fa7b646c125f161c52c814d757a58241a404` | Apache-2.0 (`LICENSE`) | As a static library, CPU only, with `-DEAST_C_DATASCIENCE=ON` |

The version is the one `libs/east-py/uv.lock` pins for east-py-datascience,
so a model blob written by either runner is read by the other at the same
library version; bump both together.

OR-Tools is not checked in: it is linked from a prebuilt install
(`scripts/fetch-ortools.sh` fetches the pinned release archive, verifying its
SHA-256), as east-c-std links the system libcurl.
