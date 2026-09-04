---
name: east-py-std
description: "Standard platform functions for the East language on the Python runtime - console, environment variables, filesystem, HTTP fetch, crypto, time, path, random, testing. Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_std *_impl functions directly from a project's own Python @platform_function (env_get_impl, fs_read_file_impl, fetch_request_impl, crypto_uuid_impl, random_normal_impl, ...), (2) Registering the east_py_std platform list with compile() so East programs can use Console/Env/FileSystem/Fetch/Crypto/Time/Path/Random/Test on the Python runtime, (3) Building FetchRequestConfigType requests in Python, (4) Deterministic random streams with random_seed. For authoring East programs in TypeScript against these functions, use the east-node-std skill instead."
---

# East.py Standard Platform Functions

`east_py_std` is the Python implementation of the East standard platform:
console, environment variables, filesystem, HTTP fetch, crypto, time, path,
random, and testing.
Every `*_impl` function is a **plain Python callable taking and returning East
values** - call them directly from a project `@platform_function`, or register
the whole `platform` list so East programs running on the Python runtime can
use them.

This skill is for **Python** code. To author East programs in TypeScript that
use these functions (`Console.log`, `FileSystem.readFile`, ...), load the
**east-node-std** skill - the TS surface is identical in capability.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Quick Start

```python
from east import ArrayType, StringType, platform_function
from east_py_std import fs_read_directory_impl, fs_read_file_impl

@platform_function(inputs=[StringType], output=ArrayType(StringType))
def first_lines(directory):
    # Direct calls - East values in, East values out, no IR round-trip
    names = fs_read_directory_impl(directory)
    return names.map(lambda name: fs_read_file_impl(f"{directory}/{name}").split("\n").get(0))

# Or register everything for the East runtime:
from east_py_std import platform   # pass to compile() / compile_async()
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Console output
    │   └─ console_log_impl(msg) · console_error_impl(msg) · console_write_impl(msg)
    │
    ├─ Environment variables (runtime credentials/config — never literals in source)
    │   └─ env_get_impl(name) -> Option<String> (some when set, none when not)
    │
    ├─ Filesystem
    │   ├─ Text → fs_read_file_impl(path) · fs_write_file_impl(path, text) · fs_append_file_impl(path, text)
    │   ├─ Bytes → fs_read_file_bytes_impl(path) -> Blob · fs_write_file_bytes_impl(path, blob)
    │   ├─ Huge beast2 collection file → fs_open_beast_impl(platform, T)(path) — the factory behind FileSystem.openBeast (fs_open_beast<T>):
    │   │   a FROZEN paged value over a mapping of the file; size / keyed reads / iteration decode one segment
    │   ├─ Inspect → fs_exists_impl · fs_is_file_impl · fs_is_directory_impl · fs_read_directory_impl
    │   └─ Manage → fs_create_directory_impl · fs_delete_file_impl
    │
    ├─ HTTP
    │   ├─ Convenience → fetch_get_impl(url) -> String · fetch_get_bytes_impl(url) -> Blob ·
    │   │                fetch_post_impl(url, body) -> String
    │   └─ Full control → fetch_request_impl(FetchRequestConfigType) -> FetchResponseType
    │                     (method variant get/post/put/delete/patch/head, headers Dict, Option body)
    │
    ├─ Crypto
    │   └─ crypto_uuid_impl() · crypto_random_bytes_impl(n) -> Blob ·
    │      crypto_hash_sha256_impl(text) · crypto_hash_sha256_bytes_impl(blob)
    │
    ├─ Time
    │   └─ time_now_impl() -> DateTime · time_sleep_impl(ms) · time_get_timezone_offset_impl(tz)
    │
    ├─ Path
    │   └─ path_join_impl(parts) · path_resolve_impl(parts) · path_dirname_impl ·
    │      path_basename_impl · path_extname_impl
    │
    ├─ Random (all draw from one stream; seed it for reproducibility)
    │   ├─ Seed → random_seed_impl(seed)
    │   ├─ Uniform/range → random_uniform_impl(lo, hi) · random_range_impl(min, max) -> Integer
    │   ├─ Continuous → random_normal_impl(mean, std) · random_log_normal_impl · random_exponential_impl ·
    │   │               random_weibull_impl · random_pareto_impl · random_bates_impl · random_irwin_hall_impl
    │   └─ Discrete → random_bernoulli_impl(p) · random_binomial_impl(n, p) ·
    │                 random_geometric_impl(p) · random_poisson_impl(lambda)
    │
    └─ Testing (the harness the compliance runner overrides with its own)
        └─ testPass / testFail / test / describe
```

## East Type Definitions

| Type | Shape |
|------|-------|
| `FetchMethodType` | `Variant<get, post, put, delete, patch, head>` (Null payloads) |
| `FetchRequestConfigType` | `Struct{url: String, method: FetchMethodType, headers: Dict<String, String>, body: Option<String>}` |
| `FetchResponseType` | `Struct{status: Integer, statusText: String, headers: Dict<String, String>, body: String, ok: Boolean}` |

All three are importable from `east_py_std` and carry attribute docstrings;
build values with `coerce_to({...}, FetchRequestConfigType)` or
`variant("get", None, FetchMethodType)`.

## Key Patterns

### Full-control HTTP request

```python
from east import coerce_to, variant
from east_py_std import FetchMethodType, FetchRequestConfigType, fetch_request_impl

response = fetch_request_impl(coerce_to({
    "url": "https://api.example.com/items",
    "method": variant("post", None, FetchMethodType),
    "headers": {"content-type": "application/json"},
    "body": '{"name": "widget"}',
}, FetchRequestConfigType))
response["status"], response["body"]   # plain int / str
```

### Deterministic random streams

```python
from east_py_std import random_normal_impl, random_seed_impl

random_seed_impl(42)                    # same seed -> same draws
noise = random_normal_impl(0.0, 1.0)
```

### Open a huge beast2 collection file lazily

`fs_open_beast` is the std family's one generic platform function — the
implementation behind `FileSystem.openBeast(T, path)` on every runtime. The
factory takes the resolved type argument and returns the opener; the value
it returns is a frozen paged proxy (the same value a large task input opens
as): size, keyed reads and iteration decode one segment from a mapping of
the file, mutation raises `cannot mutate a frozen value`, and a file whose
header carries another type raises
`Failed to open beast file <path>: beast2: cannot open a blob of type <wire> as <T>`.

```python
from east import DictType, IntegerType, StringType, StructType
from east_py_std import fs_open_beast_impl

Table = DictType(IntegerType, StructType([("id", IntegerType), ("name", StringType)]))
open_table = fs_open_beast_impl(None, Table)    # the factory: (platform list, T) -> open(path)
table = open_table("rows.beast2")               # mapped, nothing decoded yet
table[7]["name"]                                 # one segment decoded

# In a body: the declaration, then `platform` (or fs_impl) at East.compile
open_beast = East.genericPlatform("fs_open_beast", ["T"], [StringType], "T")
total = East.function([StringType], IntegerType,
                      lambda b, path: open_beast([Table], path).get(7).id)
East.compile(total, platform=fs_impl)("rows.beast2")
```

An index-less file (what `East.Blob.encode_beast` writes) decodes whole,
frozen, with the same value; for bytes already in hand use
`EastBlob.open_beast(T)` / `blob.open_beast(T)` in a body (the **east-py**
skill), and for a file you hold in python `open_beast2_file` gives the
richer read surface. The value keeps its mapping of the file for as long as
it lives: don't hold thousands of opened files at once, and don't truncate
or rewrite a file while a value over it is alive.

Scalars cross the boundary as plain Python (`str`/`int`/`float`/`bool`/
`datetime`); `Blob` is `EastBlob`, `Array<String>` is `EastArray` with eager
methods - see the **east-py** skill for the value API.

## Related skills

- **east-py** - the Python runtime itself: East values as plain data, eager
  methods, `coerce_to`, and the `@platform_function` on-ramp these direct
  calls live inside.
- **east-py-io** - the I/O sibling on the Python runtime: SQL/NoSQL databases,
  S3, FTP/SFTP, XLSX/XML, compression.
- **east-py-datascience** - ML and optimization platform functions (hybrid
  TS + Python package).
- **east-node-std** - the TypeScript authoring surface for these same
  capabilities; use it when writing East programs, not Python.
- **e3** - the execution engine whose Python runner registers this platform
  list for dataflow tasks.
