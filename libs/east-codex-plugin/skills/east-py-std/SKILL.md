---
name: east-py-std
description: "Standard platform functions for the East language on the Python runtime - console, environment variables, filesystem, HTTP fetch, crypto, time, path, random, large-JSON reading, testing. Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_std functions (env_get, fs_read_file, fetch_request, crypto_uuid, random_normal, ...) from python or inside an East.function body — the same object does both, (2) Registering the east_py_std platform list with compile() so East programs can use Console/Env/FileSystem/Fetch/Crypto/Time/Path/Random/Json/Test on the Python runtime, (3) Building FetchRequestConfigType requests in Python, (4) Deterministic random streams with random_seed, (5) Reading a JSON document too large to decode whole — ingesting a multi-gigabyte payload from another system — with json_open / json_more / json_next, strictly against a published… See the detailed scope below."
---

## Detailed skill scope

Standard platform functions for the East language on the Python runtime - console, environment variables, filesystem, HTTP fetch, crypto, time, path, random, large-JSON reading, testing. Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_std functions (env_get, fs_read_file, fetch_request, crypto_uuid, random_normal, ...) from python or inside an East.function body — the same object does both, (2) Registering the east_py_std platform list with compile() so East programs can use Console/Env/FileSystem/Fetch/Crypto/Time/Path/Random/Json/Test on the Python runtime, (3) Building FetchRequestConfigType requests in Python, (4) Deterministic random streams with random_seed, (5) Reading a JSON document too large to decode whole — ingesting a multi-gigabyte payload from another system — with json_open / json_more / json_next, strictly against a published contract. For authoring East programs in TypeScript against these functions, use the east-node-std skill instead.

# East.py Standard Platform Functions

`east_py_std` is the Python implementation of the East standard platform:
console, environment variables, filesystem, HTTP fetch, crypto, time, path,
random, large-JSON reading and testing. Every function is exported under its
platform name (`fs_read_file`, `fetch_get`, …) and is **dual-mode**: a plain
python callable over East values — call it from your own
`@East.platform_function` — and, the same object, callable inside an
`East.function` body, where the call IS the `Platform` node with the
function's declared signature. Nothing restates it: register the `platform`
list at `East.compile` (or let the runner) and it runs.

This skill is for **Python**. To author East programs in TypeScript against
these functions (`Console.log`, `FileSystem.readFile`, …), load
**east-node-std** — the same functions, under the same platform names.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
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

# Direct calls — East values in, East values out, no IR round trip
@East.platform_function(inputs=[StringType], output=IntegerType)
def file_count(directory):
    return fs_read_directory(directory).size()

# The same functions inside an East body: the call is the Platform node, nothing
# restates the signature — compile with the package's list
first_lines = East.function([StringType], ArrayType(StringType), lambda b, directory:
    fs_read_directory(directory).map(
        lambda b, name: fs_read_file(East.str(directory, "/", name)).split("\n").get(0)))
East.compile(first_lines, platform=platform)("reports")

size = East.function([StringType], IntegerType, lambda b, path: fs_read_file_bytes(path).size())
East.compile(size, platform=platform)("data.bin")
```

An EAGER callback — `names.map(lambda b, name: fs_read_file(…))` on a value
in python — cannot call a platform function: it compiles with no platform, so
the capture refuses it (`it references fs_read_file, which has no East form`).
Put the loop in an East function compiled with `platform`, as above.

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Console → console_log(msg) · console_error(msg) · console_write(msg) (no newline)
    │
    ├─ Environment (runtime credentials and config — never literals in source)
    │   └─ env_get(name) -> Option<String> (some when set, none when not)
    │
    ├─ Filesystem
    │   ├─ Text → fs_read_file(path) · fs_write_file(path, text) · fs_append_file(path, text)
    │   ├─ Bytes → fs_read_file_bytes(path) -> Blob · fs_write_file_bytes(path, blob)
    │   ├─ A huge beast2 collection file → fs_open_beast(T, path) in a body (FileSystem.openBeast's twin, the type FIRST):
    │   │   a FROZEN paged value over a mapping — size / keyed reads / iteration decode one segment
    │   ├─ Inspect → fs_exists · fs_is_file · fs_is_directory · fs_read_directory(path) -> Array<String>
    │   └─ Manage → fs_create_directory · fs_delete_file
    │
    ├─ JSON too large to decode whole
    │   ├─ Open → json_open(path, pointer) · json_open_text(text, pointer) -> a handle (a String)
    │   │   (pointer is RFC 6901: "" for the whole document, "/data" for an envelope's array)
    │   ├─ Iterate → json_more(handle) then json_next(T, handle) in a body — the type FIRST;
    │   │   from python the factory: json_next(None, T)(handle)
    │   ├─ One subtree → json_value(T, path, pointer) — the small members beside a huge array
    │   └─ Release → json_close(handle)
    │
    ├─ HTTP (ASYNC: await a direct call; in a body, East.asyncFunction + East.compileAsync)
    │   ├─ Convenience → fetch_get(url) -> String · fetch_get_bytes(url) -> Blob · fetch_post(url, body) -> String
    │   └─ Full control → fetch_request(FetchRequestConfigType) -> FetchResponseType
    │
    ├─ Crypto → crypto_uuid() · crypto_random_bytes(n) -> Blob · crypto_hash_sha256(text) -> hex String ·
    │           crypto_hash_sha256_bytes(blob) -> Blob (the 32-byte digest)
    │
    ├─ Time → time_now() -> Integer (Unix milliseconds) · time_sleep(ms) (async) ·
    │         time_get_timezone_offset(dt, zone) -> Integer (minutes ahead of UTC for an IANA zone at that instant)
    │
    ├─ Path → path_join(parts: Array<String>) · path_resolve(path) (absolute) · path_dirname(path) ·
    │         path_basename(path) · path_extname(path)
    │
    ├─ Random (one stream; seed it for reproducibility)
    │   ├─ Seed → random_seed(seed)
    │   ├─ Uniform → random_uniform() in [0, 1) · random_range(min, max) -> Integer in [min, max]
    │   ├─ Continuous → random_normal() (N(0, 1)) · random_log_normal(mu, sigma) · random_exponential(rate) ·
    │   │               random_weibull(shape) · random_pareto(alpha) · random_bates(n) · random_irwin_hall(n)
    │   └─ Discrete (-> Integer) → random_bernoulli(p) · random_binomial(n, p) · random_geometric(p) · random_poisson(rate)
    │
    └─ Testing (the harness the compliance runner overrides with its own) → the platform functions
        testPass / testFail(msg) / test(name, body) / describe(name, body); in python test_pass · test_fail ·
        test_impl_fn · describe, with reset_counters()
```

`platform` is every function; each family's list is exported too
(`console_impl`, `env_impl`, `fs_impl`, `fetch_impl`, `crypto_impl`,
`time_impl`, `path_impl`, `random_impl`, `json_impl`, `test_impl`) when a
program should get only some of them.

## East Type Definitions

| Type | Shape |
|------|-------|
| `FetchMethodType` | `Variant<GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS>` (Null payloads) |
| `FetchRequestConfigType` | `Struct{url: String, method: FetchMethodType, headers: Dict<String, String>, body: Option<String>}` |
| `FetchResponseType` | `Struct{status: Integer, statusText: String, headers: Dict<String, String>, body: String, ok: Boolean}` |

All three are importable from `east_py_std`. Build a request with
`coerce_to({...}, FetchRequestConfigType)` — the method with
`variant("POST", None, FetchMethodType)`, the body with `some(text)` or `none`
(a plain string is not an Option).

## Key Patterns

### Full-control HTTP request

```python
import asyncio
from east import coerce_to, some, variant
from east_py_std import FetchMethodType, FetchRequestConfigType, fetch_request

request = coerce_to({
    "url": "https://api.example.com/items",
    "method": variant("POST", None, FetchMethodType),
    "headers": {"content-type": "application/json"},
    "body": some('{"name": "widget"}'),
}, FetchRequestConfigType)
response = asyncio.run(fetch_request(request))   # a direct call returns the coroutine
response["status"], response["body"]              # plain int / str
```

Inside a body the fetch functions need `East.asyncFunction` and
`East.compileAsync` (a sync body refuses them at build time). Run such a
program through the runner — `east-py run`, an e3 task: the bridge runs async
implementations on its own event loop, so the compiled coroutine cannot be
awaited under `asyncio.run` once it calls one.

### Deterministic random streams

```python
from east_py_std import random_normal, random_range, random_seed

random_seed(42)                    # same seed -> same draws
noise = random_normal()            # N(0, 1); scale and shift it yourself
die = random_range(1, 6)
```

### Open a huge beast2 collection file lazily

`fs_open_beast` is the std family's one generic platform function — the
implementation behind `FileSystem.openBeast(T, path)` on every runtime. In a
body it reads as TypeScript does, the type argument first. The value is a
frozen paged proxy (the value a large task input opens as): size, keyed reads
and iteration decode one segment from a mapping of the file, mutation raises
`cannot mutate a frozen value`, and a file whose header carries another type
raises `Failed to open beast file <path>: beast2: cannot open a blob of type
<wire> as <T>`.

```python
from east import DictType, East, IntegerType, StringType, StructType
from east_py_std import fs_open_beast, platform

Table = DictType(IntegerType, StructType([("id", IntegerType), ("name", StringType)]))

name_of = East.function([StringType], StringType,
                        lambda b, path: fs_open_beast(Table, path).get(7).name)
East.compile(name_of, platform=platform)("rows.beast2")
```

From python it is the factory — `fs_open_beast(None, Table)` returns the
opener, and `opener(path)` a HOLD, not a python-readable value: pass it into a
compiled call, `.bind` it, or return it from your own
`@East.platform_function` declared with that type, and it crosses by pointer.
To read a file in python, use `open_beast2_file` (the **east-py** skill), whose
value has the whole read surface. An index-less file (what
`East.Blob.encode_beast` writes) decodes whole, frozen; for bytes in hand use
`blob.open_beast(T)`. The value keeps its mapping for as long as it lives:
don't hold thousands open, and don't truncate or rewrite a file under one.

### Read a JSON document too large to decode whole

`json_open` positions a reader on the array or object an RFC 6901 pointer
names; `json_next` reads ONE element against a type. `json_next` and
`json_value` are generic, so they read as `fs_open_beast` does — the type
first in a body, the factory from python.

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

- **`{"meta": {…}, "data": [10M rows]}` is the ordinary shape.** Never type
  the whole document as one value — a `Struct` holding the array materialises
  it however good the reader is. Point at the array, and read the envelope
  with `json_value(MetaType, path, "/meta")`; a member AFTER the array costs a
  scan, not a parse.
- **It is strict: it accepts exactly what `json_schema_for(T)` describes**, so
  a producer validating against the published schema cannot send what is then
  rejected. An `Integer` is a quoted i64 decimal — not `"0x10"`, `"0b101"`,
  `" 7 "`, `"007"`, `"-0"`, nor a bare number. A `DateTime` is any RFC 3339
  date-time (`Z` or any offset, read as the UTC instant; `t`/`z` in either case;
  any fractional digits, past the millisecond dropped; a leap second as the
  Unix time its fields add up to); a day its month lacks (`2026-02-30`) or a
  year outside 0001–9999 is refused, and `parse_json` reads DateTimes through
  the same parser. A `Blob` is lowercase hex (`parse_json` takes either case).
- **An `Option<T>` is `null` or `T`'s own encoding** wherever `T` can never
  encode as `null` (`"note": null` → none, `"note": "x"` → some), and the tagged
  `{"type": "some", "value": "x"}` there is refused (`expected a String, got an
  object`). Only `Option<Null>` and `Option<Option<T>>` keep the tagged object,
  so a bare `null` there is refused (`expected an object, got null`). The same
  on every runtime, nothing to configure; `json_schema_for` describes a flat
  Option as `oneOf [null, T]`.
- **Errors name the offending node** by RFC 6901 pointer (`~` and `/` escaped
  as `~0` / `~1`): `json_next: /1/id: "not-an-integer" is not a 64-bit integer
  in East JSON's form` — the text `east-node-std` and `east-c-std` produce,
  pinned by the shared compliance corpus; a quoted value is clipped at 200
  characters.
- **`json_more` is a predicate, `json_next` advances** — they need not
  alternate. **A JSON object iterates as entries**: a `Struct` of exactly `key`
  (a `String`) and `value`, in either order, which a `Dict` output needs; the
  entry type is checked before anything is consumed, so a refused call leaves
  the reader where it was. Handles are held until closed, like a database
  connection; `json_open` maps the file rather than reading it, Windows
  included.
- **The reader is east-c's**, reached through the Cython bridge, so the accepted
  forms, the 2048 nesting bound, UTF-8 validation (a malformed sequence is
  `invalid UTF-8 in string`, never repaired), surrogate-pair joining and the
  error text are shared with `east-c-std`. What is skipped is still JSON: a
  fault before the pointer target or inside an unmodelled field is refused at
  open with a read's text. A `Float` reads the same under any locale.
- **What the schema cannot say**: a `DateTime` instant must fall in years
  0001–9999 and loses digits past the millisecond; a `Ref` the encoder wrote as
  `{"$ref": ...}` for a repeated target is not readable; a `Dict` whose entries
  repeat a key satisfies `uniqueItems` and is still refused; a `Variant` must
  carry `"type"` before `"value"` (struct fields may come in any order).

Scalars cross as plain python (`str`/`int`/`float`/`bool`/`datetime`); a
`Blob` is an `EastBlob`, an `Array<String>` an `EastArray` with eager methods —
the **east-py** skill has the value API.

## Related skills

- **east-py** — the python runtime: East values as plain data, eager methods,
  `coerce_to`, `open_beast2_file`, and the `@East.platform_function` on-ramp
  these calls live inside (and the dual-mode rule that makes them callable in a
  body).
- **east-py-io** — the I/O sibling: SQL/NoSQL databases, S3, FTP/SFTP,
  XLSX/XML, compression.
- **east-py-datascience** — ML and optimisation platform functions.
- **east-node-std** — the TypeScript authoring surface for the same functions.
- **e3** — the execution engine whose python runner registers this list for
  dataflow tasks.
