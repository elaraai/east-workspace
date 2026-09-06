---
name: east-py-std
description: "Standard platform functions for the East language on the Python runtime - console, environment variables, filesystem, HTTP fetch, crypto, time, path, random, large-JSON reading, testing. Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_std functions (env_get, fs_read_file, fetch_request, crypto_uuid, random_normal, ...) from python or inside an East.function body — the same object does both, (2) Registering the east_py_std platform list with compile() so East programs can use Console/Env/FileSystem/Fetch/Crypto/Time/Path/Random/Json/Test on the Python runtime, (3) Building FetchRequestConfigType requests in Python, (4) Deterministic random streams with random_seed, (5) Reading a JSON document too large to decode whole — ingesting a multi-gigabyte payload from another system — with json_open / json_more / json_next, strictly against a published contract. For authoring East programs in TypeScript against these functions, use the east-node-std skill instead."
---

# East.py Standard Platform Functions

`east_py_std` is the Python implementation of the East standard platform:
console, environment variables, filesystem, HTTP fetch, crypto, time, path,
random, large-JSON reading, and testing.
Every function is exported under its platform name (`fs_read_file`,
`fetch_get`, …) and is **dual-mode**: a plain Python callable taking
and returning East values — call it from a project `@East.platform_function`
— and, the same object, callable inside an `East.function` body, where the
call IS the `Platform` node with the function's own declared signature. No
`East.platform(name, inputs, output)` line restates it; register the
`platform` list at `East.compile` (or let the runner) and it runs.

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
from east import ArrayType, East, IntegerType, StringType
from east_py_std import fs_read_directory, fs_read_file, fs_read_file_bytes, platform

@East.platform_function(inputs=[StringType], output=ArrayType(StringType))
def first_lines(directory):
    # Direct calls - East values in, East values out, no IR round-trip
    names = fs_read_directory(directory)
    return names.map(lambda b, name: fs_read_file(East.str(directory, "/", name)).split("\n").get(0))

# The same functions inside an East body: the call is the Platform node,
# nothing restates the signature — compile with the package's list.
size = East.function([StringType], IntegerType, lambda b, path: fs_read_file_bytes(path).size())
East.compile(size, platform=platform)("data.bin")
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Console output
    │   └─ console_log(msg) · console_error(msg) · console_write(msg)
    │
    ├─ Environment variables (runtime credentials/config — never literals in source)
    │   └─ env_get(name) -> Option<String> (some when set, none when not)
    │
    ├─ Filesystem
    │   ├─ Text → fs_read_file(path) · fs_write_file(path, text) · fs_append_file(path, text)
    │   ├─ Bytes → fs_read_file_bytes(path) -> Blob · fs_write_file_bytes(path, blob)
    │   ├─ Huge beast2 collection file → fs_open_beast(T, path) in a body (FileSystem.openBeast's twin: the type argument FIRST);
    │   │   from python, the factory: fs_open_beast(platform, T)(path) — a FROZEN paged value over a mapping of the file;
    │   │   size / keyed reads / iteration decode one segment
    │   ├─ Inspect → fs_exists · fs_is_file · fs_is_directory · fs_read_directory
    │   └─ Manage → fs_create_directory · fs_delete_file
    │
    ├─ JSON too large to decode whole
    │   ├─ Open → json_open(path, pointer) · json_open_text(text, pointer) -> handle
    │   │   (pointer is RFC 6901: "" for the whole document, "/data" for an envelope's array)
    │   ├─ Iterate → json_more(handle) then json_next(T, handle) in a body — the type FIRST;
    │   │   from python the factory: json_next(None, T)(handle)
    │   ├─ One subtree → json_value(T, path, pointer) — the small members beside a huge array
    │   └─ Release → json_close(handle)
    │
    ├─ HTTP
    │   ├─ Convenience → fetch_get(url) -> String · fetch_get_bytes(url) -> Blob ·
    │   │                fetch_post(url, body) -> String
    │   └─ Full control → fetch_request(FetchRequestConfigType) -> FetchResponseType
    │                     (method variant get/post/put/delete/patch/head, headers Dict, Option body)
    │
    ├─ Crypto
    │   └─ crypto_uuid() · crypto_random_bytes(n) -> Blob ·
    │      crypto_hash_sha256(text) · crypto_hash_sha256_bytes(blob)
    │
    ├─ Time
    │   └─ time_now() -> DateTime · time_sleep(ms) · time_get_timezone_offset(tz)
    │
    ├─ Path
    │   └─ path_join(parts) · path_resolve(parts) · path_dirname ·
    │      path_basename · path_extname
    │
    ├─ Random (all draw from one stream; seed it for reproducibility)
    │   ├─ Seed → random_seed(seed)
    │   ├─ Uniform/range → random_uniform(lo, hi) · random_range(min, max) -> Integer
    │   ├─ Continuous → random_normal(mean, std) · random_log_normal · random_exponential ·
    │   │               random_weibull · random_pareto · random_bates · random_irwin_hall
    │   └─ Discrete → random_bernoulli(p) · random_binomial(n, p) ·
    │                 random_geometric(p) · random_poisson(lambda)
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
from east_py_std import FetchMethodType, FetchRequestConfigType, fetch_request

response = fetch_request(coerce_to({
    "url": "https://api.example.com/items",
    "method": variant("post", None, FetchMethodType),
    "headers": {"content-type": "application/json"},
    "body": '{"name": "widget"}',
}, FetchRequestConfigType))
response["status"], response["body"]   # plain int / str
```

### Deterministic random streams

```python
from east_py_std import random_normal, random_seed

random_seed(42)                    # same seed -> same draws
noise = random_normal(0.0, 1.0)
```

### Open a huge beast2 collection file lazily

`fs_open_beast` is the std family's one generic platform function — the
implementation behind `FileSystem.openBeast(T, path)` on every runtime.
Inside an East body it reads as the TypeScript does, the type argument
first: `fs_open_beast(Table, path)`. From python it is the factory: called
with the resolved type argument it returns the opener. Either way the value
is a frozen paged proxy (the same value a large task input opens as): size,
keyed reads and iteration decode one segment from a mapping of the file,
mutation raises `cannot mutate a frozen value`, and a file whose header
carries another type raises
`Failed to open beast file <path>: beast2: cannot open a blob of type <wire> as <T>`.

```python
from east import DictType, East, IntegerType, StringType, StructType
from east_py_std import fs_open_beast, platform

Table = DictType(IntegerType, StructType([("id", IntegerType), ("name", StringType)]))

# In a body — the call itself, nothing declared
total = East.function([StringType], IntegerType,
                      lambda b, path: fs_open_beast(Table, path).get(7).id)
East.compile(total, platform=platform)("rows.beast2")

# From python — the factory: (platform list, T) -> open(path)
open_table = fs_open_beast(None, Table)
table = open_table("rows.beast2")               # mapped, nothing decoded yet
table[7]["name"]                                 # one segment decoded
```

An index-less file (what `East.Blob.encode_beast` writes) decodes whole,
frozen, with the same value; for bytes already in hand use
`EastBlob.open_beast(T)` / `blob.open_beast(T)` in a body (the **east-py**
skill), and for a file you hold in python `open_beast2_file` gives the
richer read surface. The value keeps its mapping of the file for as long as
it lives: don't hold thousands of opened files at once, and don't truncate
or rewrite a file while a value over it is alive.

### Read a JSON document too large to decode whole

`json_open` positions a reader on the array or object an RFC 6901 pointer
names; `json_next` reads ONE element against a type. `json_next` and
`json_value` are generic, so they read as `fs_open_beast` does — the type
argument first in a body, the factory from python.

```python
from east import East, IntegerType, StringType, StructType
from east_py_std import json_close, json_more, json_next, json_open_text, platform

Row = StructType([("id", IntegerType)])

# From python — the factory: (platform list, T) -> read(handle)
handle = json_open_text('[{"id":"1"},{"id":"2"}]', "")
read = json_next(None, Row)
rows = []
while json_more(handle):
    rows.append(read(handle))
json_close(handle)                      # [{'id': 1}, {'id': 2}]

# In a body — the call itself, the type argument first
def body(b, text):
    h = b.let(json_open_text(text, ""))
    acc = b.let(0)
    b.while_(json_more(h), lambda b: b.assign(acc, acc + json_next(Row, h)["id"]))
    b.do(json_close(h))
    return acc

summed = East.function([StringType], IntegerType, body)
East.compile(summed, platform=platform)('[{"id":"10"},{"id":"20"}]')   # 30
```

- **`{"meta": {…}, "data": [10M rows]}` is the ordinary shape.** Never type the
  whole document as one value — a `Struct` holding the array materialises it
  however good the reader is. Point at the array, and read the envelope
  separately with `json_value(MetaType, path, "/meta")`; a member AFTER the
  array costs a scan, not a parse.
- **It is strict, and deliberately stricter than `parse_json`.** It accepts
  exactly what `json_schema_for(T)` describes — what the ENCODER emits — so a
  producer validating against the published schema cannot send something that
  is then rejected. An `Integer` must be a quoted decimal in i64 range: not
  `"0x10"`, `"0b101"`, `" 7 "`, `"007"`, `"-0"`, nor a bare JSON number. A
  `DateTime` must carry an explicit `+00:00` — where `parse_json` takes `Z` or
  any numeric offset — and a day its month does not have (`2026-02-30`) is
  refused rather than rolled forward. A `Blob`'s hex must be lowercase, where
  `parse_json` takes either case.
- **Errors name the offending node** by RFC 6901 pointer:
  `json_next: /1/id: "not-an-integer" is not a 64-bit integer in East JSON's form`
  — the same text `east-node-std` and `east-c-std` produce.
- **`json_more` is a predicate, `json_next` advances.** They need not
  alternate, and asking `json_more` twice is harmless.
- **A JSON object iterates as entries**: pass a `Struct` of exactly `key` and
  `value` (the key must be `String`), which is what a `Dict` output needs.
- Handles are held until closed, as a database connection is.
- **Deep nesting is refused everywhere, at a bound the host sets.** This reader
  recurses per level and python's own stack gives out nearer 150, where
  east-node and east-c refuse past 2048. All three refuse with the same kind of
  error rather than a stack overflow, but a document nested hundreds deep is
  not portable.
- **Three things the schema cannot say.** A `Ref` the encoder wrote as
  `{"$ref": ...}` for a repeated target is not readable, so a value with shared
  references does not validate against its own published schema. A `Dict` whose
  entries repeat a key satisfies `uniqueItems` and is still refused. A
  `Variant` must carry `"type"` before `"value"`; struct fields may arrive in
  any order.

Scalars cross the boundary as plain Python (`str`/`int`/`float`/`bool`/
`datetime`); `Blob` is `EastBlob`, `Array<String>` is `EastArray` with eager
methods - see the **east-py** skill for the value API.

## Related skills

- **east-py** - the Python runtime itself: East values as plain data, eager
  methods, `coerce_to`, and the `@East.platform_function` on-ramp these
  direct calls live inside (and the dual-mode rule that makes them callable
  in a body).
- **east-py-io** - the I/O sibling on the Python runtime: SQL/NoSQL databases,
  S3, FTP/SFTP, XLSX/XML, compression.
- **east-py-datascience** - ML and optimization platform functions (hybrid
  TS + Python package).
- **east-node-std** - the TypeScript authoring surface for these same
  capabilities; use it when writing East programs, not Python.
- **e3** - the execution engine whose Python runner registers this platform
  list for dataflow tasks.
