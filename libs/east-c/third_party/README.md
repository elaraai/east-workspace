# Third-party sources for the root build

The upstream release archives that only the root build
(`libs/east-c/CMakeLists.txt`) needs, checked in so that no build downloads
anything. The east-c library's own sources, why they are checked in and how to
update one are in
[`packages/east-c/third_party/`](../packages/east-c/third_party/README.md); the
same rules apply here.

| Archive | Upstream | SHA-256 | License | Built |
|---|---|---|---|---|
| `curl-8.11.1.tar.xz` | [curl 8.11.1](https://curl.se/download/curl-8.11.1.tar.xz) | `c7ca7db48b0909743eaef34250da02c19bc61d4f1dcedd6603f109409536ab56` | curl (`COPYING`) | On Windows, which has no system libcurl for east-c-std |
| `mimalloc-2.1.7.tar.gz` | [microsoft/mimalloc v2.1.7](https://github.com/microsoft/mimalloc/archive/refs/tags/v2.1.7.tar.gz) | `0eed39319f139afde8515010ff59baf24de9e47ea316a315398e8027d198202d` | MIT (`LICENSE`) | With `-DEAST_USE_MIMALLOC=ON` |
