---
name: east-py-io
description: "I/O platform functions for the East language on the Python runtime - SQL databases (SQLite, PostgreSQL, MySQL, Access), NoSQL (Redis, MongoDB), S3 storage, file transfers (FTP, SFTP), file formats (XLSX, XML), and compression (Gzip, Zip, Tar). Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_io functions (sqlite_query, mongo_find, s3_put_object, ftp_get, xlsx_read, gzip_compress, ...) from a project's own Python @East.platform_function, or inside an East.function body — the same object does both, (2) Registering the east_py_io platform list with compile() so East programs can use SQL/NoSQL/Storage/Transfer/Format/Compression on the Python runtime, (3) Building connection configs (SqliteConfigType, PostgresConfigType, RedisConfigType, S3ConfigType, FtpConfigType, ...) in Python, (4) The connect -> handle -> operate -> close connection lifecycle. For authoring East programs in TypeScript against these functions, use the east-node-io skill instead."
---

# East.py I/O Platform Functions

`east_py_io` is the Python implementation of the East I/O platform: SQL and
NoSQL databases, S3 object storage, FTP/SFTP transfers, XLSX/XML formats, and
compression. Every function is exported under its platform name
(`sqlite_query`, `gzip_compress`, …) and is **dual-mode** (#667): a plain
Python callable taking and returning East values (database/network functions
are `async def` - await them) — call it from a project
`@East.platform_function` — and, the same object, callable inside an
`East.function` / `East.asyncFunction` body, where the call IS the
`Platform` node with the function's declared signature. Nothing restates
the signature; register the `platform` list at `East.compile` /
`East.compileAsync` (or let the runner) and it runs.

This skill is for **Python** code. To author East programs in TypeScript that
use these functions (`SQL.SQLite.query`, `Storage.S3.putObject`, ...), load
the **east-node-io** skill - the TS surface is identical in capability.

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
from east import ArrayType, BlobType, East, FloatType, StringType, StructType, coerce_to, some
from east_py_io import GzipOptionsType, SqliteConfigType, gzip_compress, platform, sqlite_close, sqlite_connect, sqlite_query

OrderRow = StructType([("sku", StringType), ("qty", FloatType)])

@East.platform_function(inputs=[StringType], output=ArrayType(OrderRow), name="load_orders")
async def load_orders(db_path):
    config = coerce_to({"path": db_path, "readOnly": True, "memory": None}, SqliteConfigType)
    handle = await sqlite_connect(config)        # connection handle: String
    try:
        result = await sqlite_query(handle, "SELECT sku, qty FROM orders", [])
        return result.value["rows"]                   # SqlResultType variant
    finally:
        await sqlite_close(handle)

# The same functions inside an East body — the call is the Platform node, the
# package's own named types spell the options; compile with its `platform` list
# (an async implementation needs an East.asyncFunction body):
packed = East.asyncFunction([BlobType], BlobType,
                            lambda b, data: gzip_compress(data, East.value({"level": some(9)}, GzipOptionsType)))
East.compileAsync(packed, platform=platform)
```

## Connection Lifecycle

Database, transfer, and cache modules share one pattern: `*_connect`
returns an opaque **connection handle** (`String` UUID, valid for the
process lifetime), every operation takes the handle, and `*_close` /
`*_close_all` release it. Always close - handles are pooled per process.

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ SQL database
    │   ├─ SQLite (apsw) → sqlite_connect/query/select/close/close_all
    │   ├─ PostgreSQL (asyncpg) → postgres_connect/query/select/close/close_all
    │   ├─ MySQL (aiomysql) → mysql_connect/query/select/close/close_all
    │   ├─ MS Access read-only (access-parser) → access_open/query/tables/close/close_all
    │   └─ `*_query` -> SqlResultType variant (select.rows / rowsAffected / lastInsertId);
    │      `*_select` is the generic typed variant - rows decode to YOUR row struct:
    │      in a body sqlite_select(Row, handle, sql, params) (the row type FIRST, as the
    │      TypeScript reads); from python the factory sqlite_select(None, Row)(handle, sql, params)
    │
    ├─ NoSQL
    │   ├─ MongoDB (motor) → mongodb_connect/insert_one/find_one/find_many/
    │   │                    update_one/delete_one/delete_many/close/close_all
    │   │   (documents are BsonValueType variants; _id coerces to String)
    │   └─ Redis (redis) → redis_connect/get/set/setex/del/close/close_all
    │
    ├─ Object storage (boto3)
    │   └─ s3_put_object · s3_get_object · s3_head_object · s3_list_objects ·
    │      s3_delete_object · s3_presign_url   (payloads are Blob)
    │
    ├─ File transfer
    │   ├─ FTP (aioftp) → ftp_connect/list/get/put/delete/close/close_all
    │   └─ SFTP (asyncssh) → sftp_connect/list/get/put/delete/close/close_all
    │
    ├─ File formats
    │   ├─ XLSX (openpyxl) → xlsx_read (rows as Dict<String, LiteralValue>) ·
    │   │                    xlsx_write · xlsx_info (sheet names/dimensions)
    │   └─ XML (defusedxml) → xml_parse -> recursive XmlNodeType · xml_serialize
    │
    └─ Compression
        ├─ Gzip → gzip_compress(blob, options) · gzip_decompress(blob)
        ├─ Zip (multi-entry) → zip_compress(entries) · zip_decompress -> entries
        └─ Tar (+gzip) → tar_create(entries) · tar_extract -> entries
```

## Optional Dependencies

Each driver is an extra named after the module - functions raise
`NotImplementedError` naming the extra when it's missing:

| Extra | Driver | Extra | Driver |
|-------|--------|-------|--------|
| `sqlite` | apsw | `redis` | redis |
| `postgres` | asyncpg | `mongodb` | motor |
| `mysql` | aiomysql | `xlsx` | openpyxl |
| `access` | access-parser | `xml` | defusedxml |
| `s3` | boto3 | `ftp` / `sftp` | aioftp / asyncssh |

Convenience groups: `sql`, `nosql`, `all`. Compression is core (stdlib).

## East Type Definitions

All config/result types are importable from `east_py_io` (and their
subpackages) and carry attribute docstrings. The ones you build by hand:

| Type | Purpose |
|------|---------|
| `SqliteConfigType` / `PostgresConfigType` / `MySqlConfigType` / `AccessConfigType` | connection configs (host/port/credentials/ssl or path flags) |
| `RedisConfigType` / `MongoConfigType` | NoSQL connection configs |
| `S3ConfigType` | endpoint/region/credentials/bucket |
| `FtpConfigType` / `SftpConfigType` | transfer connection configs |
| `XlsxReadOptionsType` / `XmlParseConfigType` / `XmlSerializeConfigType` | format options |
| `GzipOptionsType` / `ZipOptionsType` / `ZipEntriesType` / `TarEntriesType` | compression options and entry lists |

Results come back as documented structs/variants (`SqlResultType`,
`MongoDocumentType`, `S3ListResultType`, `FileListType`,
`ZipExtractedType`, ...). Build configs with `coerce_to({...}, ConfigType)` -
plain `None` coerces into `Option` fields.

## Related skills

- **east-py** - the Python runtime itself: East values as plain data, eager
  methods, `coerce_to`, and the `@East.platform_function` on-ramp these
  direct calls live inside (and the dual-mode rule that makes them callable
  in a body).
- **east-py-std** - the standard-library sibling on the Python runtime:
  console, filesystem, fetch, crypto, time, path, random.
- **east-py-datascience** - ML and optimization platform functions (hybrid
  TS + Python package).
- **east-node-io** - the TypeScript authoring surface for these same
  capabilities; use it when writing East programs, not Python.
- **e3** - the execution engine whose Python runner registers this platform
  list for dataflow tasks.
