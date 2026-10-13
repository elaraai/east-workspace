# Third-party sources

The upstream release archives east-c builds from, checked in so that no build
downloads anything: a build that fetches its sources fails whenever the host
serving them does. Each archive is the upstream file byte for byte. Every CMake
file that builds one names it here and pins its SHA-256 with `URL_HASH`, so
CMake refuses a copy that differs. `scripts/check-native-sources.mjs`, which
`make check-version` runs on every PR, refuses a CMake file that downloads.

They live in the east-c package, not at `libs/east-c`'s root, so the copy of
the package that east-py's packaged builds stage
(`libs/east-py/scripts/vendor-native.py`) carries them too. The two sources only
the root build needs, curl and mimalloc, are in
[`libs/east-c/third_party/`](../../../third_party/README.md).

| Archive | Upstream | SHA-256 | License |
|---|---|---|---|
| `pcre2-10.44.tar.gz` | [PCRE2 10.44](https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz) | `86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b` | BSD, with PCRE2's exemption for binaries (`LICENCE`) |
| `btree.c-0.6.4.tar.gz` | [tidwall/btree.c v0.6.4](https://github.com/tidwall/btree.c/archive/refs/tags/v0.6.4.tar.gz) | `6a7635c52d8ce632712f9eb6ae485c3cc05a4514f780e990b4f25116fb65f9d4` | MIT (`LICENSE`) |
| `miniz-3.0.2.zip` | [miniz 3.0.2](https://github.com/richgel999/miniz/releases/download/3.0.2/miniz-3.0.2.zip) | `ada38db0b703a56d3dd6d57bf84a9c5d664921d870d8fea4db153979fb5332c5` | MIT (`LICENSE`) |
| `libdeflate-1.26.tar.gz` | [libdeflate v1.26](https://github.com/ebiggers/libdeflate/archive/refs/tags/v1.26.tar.gz) | `bba03fffc5538576213675ce6968fcff6ce2e67d82e4d5febea2d05f9f13cf85` | MIT (`COPYING`) |

## Updating one

1. Download the new upstream release archive and check it in here in place of
   the old one.
2. In every CMake file that names the old archive (`git grep <its name>`), name
   the new one and its SHA-256 (`sha256sum <archive>`).
3. Update its row above.
