---
name: east-py-io
description: "I/O platform functions for the East language on the Python runtime - SQL databases (SQLite, PostgreSQL, MySQL, Access), NoSQL (Redis, MongoDB), S3 storage, file transfers (FTP, SFTP), file formats (XLSX, XML), and compression (Gzip, Zip, Tar). Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_io functions (sqlite_select, mongo_find, s3_put_object, ftp_get, xlsx_read, gzip_compress, ...) from a project's own Python @East.platform_function, or inside an East.function body — the same object does both, (2) Registering the east_py_io platform list with compile() so East programs can use SQL/NoSQL/Storage/Transfer/Format/Compression on the Python runtime, (3) Building connection configs (SqliteConfigType, PostgresConfigType, RedisConfigType, S3ConfigType, FtpConfigType, ...) in Python, (4) The connect -) handle -) operate -) close connection… See the detailed scope below."
---

## Detailed skill scope

I/O platform functions for the East language on the Python runtime - SQL databases (SQLite, PostgreSQL, MySQL, Access), NoSQL (Redis, MongoDB), S3 storage, file transfers (FTP, SFTP), file formats (XLSX, XML), and compression (Gzip, Zip, Tar). Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_io functions (sqlite_select, mongo_find, s3_put_object, ftp_get, xlsx_read, gzip_compress, ...) from a project's own Python @East.platform_function, or inside an East.function body — the same object does both, (2) Registering the east_py_io platform list with compile() so East programs can use SQL/NoSQL/Storage/Transfer/Format/Compression on the Python runtime, (3) Building connection configs (SqliteConfigType, PostgresConfigType, RedisConfigType, S3ConfigType, FtpConfigType, ...) in Python, (4) The connect -> handle -> operate -> close connection lifecycle. For authoring East programs in TypeScript against these functions, use the east-node-io skill instead.

# East.py I/O Platform Functions

`east_py_io` is the Python implementation of the East I/O platform: SQL and
NoSQL databases, S3 object storage, FTP/SFTP transfers, XLSX/XML formats and
compression. Each function is **dual-mode**: a plain python callable over East
values — call it from your own `@East.platform_function` — and, the same
object, callable inside an `East.function` / `East.asyncFunction` body, where
the call IS the `Platform` node with the function's declared signature.
Nothing restates the signature: register the `platform` list at
`East.compile` / `East.compileAsync` (or let the runner) and it runs.

Every function but `xlsx_*`, `xml_*`, `zip_*` and `ftp_close` is **async**: a
direct call returns a coroutine to `await`, and a body calling one is an
`East.asyncFunction`. Exported names are the platform names, except MongoDB's,
exported as `mongo_*` (`mongo_find` is the platform's `mongodb_find_many`).

This skill is for **Python**. To author East programs in TypeScript against
these functions (`SQL.SQLite.query`, `Storage.S3.putObject`, …), load
**east-node-io** — the same functions, under the same platform names.

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
from east import ArrayType, BlobType, East, FloatType, StringType, StructType, coerce_to, none, some
from east_py_io import (GzipOptionsType, SqliteConfigType, gzip_compress, platform,
                        sqlite_close, sqlite_connect, sqlite_select)

OrderRow = StructType([("sku", StringType), ("qty", FloatType)])

@East.platform_function(inputs=[StringType], output=ArrayType(OrderRow))
async def load_orders(db_path):
    # An Option field takes some(x) / none — a plain value (or None) is refused
    config = coerce_to({"path": db_path, "readOnly": some(True), "memory": none}, SqliteConfigType)
    handle = await sqlite_connect(config)              # a connection handle: String
    try:
        select = sqlite_select(None, OrderRow)         # the typed read — rows decode to YOUR struct
        return await select(handle, "SELECT sku, qty FROM orders", [])
    finally:
        await sqlite_close(handle)

# The same functions inside an East body — the call is the Platform node, the
# package's own named types spell the options; an async implementation needs an
# East.asyncFunction body, compiled with East.compileAsync and the package's list
packed = East.asyncFunction([BlobType], BlobType,
                            lambda b, data: gzip_compress(data, East.value({"level": some(9)}, GzipOptionsType)))
East.compileAsync(packed, platform=platform)
```

Run a compiled async body through the runner (`east-py run`, an e3 task): the
bridge runs async implementations on its own event loop, so the compiled
coroutine cannot be awaited under `asyncio.run` once it calls one.

## Connection Lifecycle

Databases, transfers and caches share one pattern: `*_connect` (Access:
`access_open`) takes a config and returns an opaque **connection handle** (a
`String`, valid for the process lifetime), every operation takes the handle,
and `*_close(handle)` / `*_close_all()` release it — always close, since
handles are pooled per process. S3 has no connection: each call takes the
`S3ConfigType`.

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ SQL — sqlite_* (apsw) · postgres_* (asyncpg) · mysql_* (aiomysql): connect / query / select / close / close_all
    │   ├─ Typed rows → *_select, generic: in a body sqlite_select(Row, handle, sql, params) (the row type FIRST, as
    │   │   TypeScript reads); from python the factory sqlite_select(None, Row)(handle, sql, params)
    │   ├─ Anything else → *_query(handle, sql, params) -> SqlResultType, a variant by statement kind:
    │   │   select {rows: each a Dict<String, LiteralValue>} · insert {rowsAffected, lastInsertId: Option} ·
    │   │   update / delete {rowsAffected}
    │   ├─ params → an Array of LiteralValueType (Variant<Blob, Boolean, DateTime, Float, Integer, Null, String>)
    │   └─ MS Access, read-only (access-parser) → access_open(config) · access_tables(handle) -> {tables} ·
    │       access_query(Row, handle, AccessQueryOptionsType{table, columns, rowOffset, rowLimit: Options}) — a table
    │       read, generic like *_select (the factory from python) · access_close / access_close_all
    │
    ├─ NoSQL
    │   ├─ MongoDB (motor; python names mongo_*) → mongo_connect(MongoConfigType{uri, database, collection}) ·
    │   │   mongo_insert_one(h, doc) -> id String · mongo_find_one(h, filter) -> Option<doc> ·
    │   │   mongo_find(h, filter, MongoFindOptionsType{limit, skip}) -> Array<doc> · mongo_update_one(h, filter, update) ·
    │   │   mongo_delete_one / mongo_delete_many(h, filter) -> count · mongo_close / mongo_close_all
    │   │   (a document is a Dict<String, BsonValueType>; _id comes back as a String)
    │   └─ Redis (redis) → redis_connect · redis_get(h, key) -> Option<String> · redis_set(h, key, value) ·
    │       redis_setex(h, key, value, seconds) · redis_del(h, key) -> count · redis_close / redis_close_all
    │
    ├─ Object storage (boto3; each call takes the S3ConfigType first)
    │   └─ s3_put_object(cfg, key, blob) · s3_get_object(cfg, key) -> Blob · s3_head_object(cfg, key) ·
    │      s3_delete_object(cfg, key) · s3_list_objects(cfg, prefix, max_keys, continuation_token: Option) -> S3ListResultType ·
    │      s3_presign_url(cfg, key, expires_in_seconds) -> String
    │
    ├─ File transfer — ftp_* (aioftp) · sftp_* (asyncssh)
    │   └─ connect · list(h, path) -> FileListType · get(h, path) -> Blob · put(h, path, blob) · delete(h, path) · close / close_all
    │
    ├─ File formats (sync)
    │   ├─ XLSX (openpyxl) → xlsx_read(blob, XlsxReadOptionsType{sheetName: Option}) -> Array<Array<LiteralValue>>, the
    │   │   sheet as a grid of cells · xlsx_write(grid, options) -> Blob · xlsx_info(blob) -> {sheets: [{name, rowCount, columnCount}]}
    │   └─ XML (defusedxml) → xml_parse(blob, XmlParseConfigType) -> XmlNodeType (recursive) · xml_serialize(node, XmlSerializeConfigType) -> Blob
    │
    └─ Compression (core — the standard library, no extra)
        ├─ Gzip → gzip_compress(blob, GzipOptionsType{level: Option}) · gzip_decompress(blob)           (async)
        ├─ Zip → zip_compress(ZipEntriesType, ZipOptionsType) -> Blob · zip_decompress(blob) -> Dict<name, Blob> (sync)
        └─ Tar → tar_create(TarEntriesType) -> Blob · tar_extract(blob) -> Dict<name, Blob>               (async)
            (entries: Array<{name, data: Blob}>)
```

## Optional Dependencies

Each driver is an extra named after its module; a function whose extra is
missing raises `NotImplementedError` naming it (`SQLite support requires the
'sqlite' extra. Add east-py-io[sqlite] to your pyproject.toml dependencies.`):

| Extra | Driver | Extra | Driver |
|-------|--------|-------|--------|
| `sqlite` | apsw | `redis` | redis |
| `postgres` | asyncpg | `mongodb` | motor |
| `mysql` | aiomysql | `xlsx` | openpyxl |
| `access` | access-parser | `xml` | defusedxml |
| `s3` | boto3 | `ftp` / `sftp` | aioftp / asyncssh |

Convenience groups: `sql`, `nosql`, `all`. Compression is core (the standard
library).

## East Type Definitions

Every config and result type is importable from `east_py_io`. The ones you
build:

| Type | Fields |
|------|--------|
| `SqliteConfigType` | `path`, `readOnly: Option<Boolean>`, `memory: Option<Boolean>` |
| `PostgresConfigType` / `MySqlConfigType` | `host`, `port`, `database`, `user`, `password`, `ssl: Option<Boolean>`, `maxConnections: Option<Integer>` |
| `AccessConfigType` | `path`, `password: Option<String>` |
| `RedisConfigType` | `host`, `port`, `password: Option<String>`, `db: Option<Integer>`, `keyPrefix: Option<String>` |
| `MongoConfigType` | `uri`, `database`, `collection` |
| `S3ConfigType` | `region`, `bucket`, `accessKeyId: Option<String>`, `secretAccessKey: Option<String>`, … |
| `FtpConfigType` / `SftpConfigType` | `host`, `port`, `user`, `password`, `secure: Boolean` / `host`, `port`, `username`, `password: Option<String>`, `privateKey: Option<String>` |
| `XlsxReadOptionsType` · `XmlParseConfigType` · `XmlSerializeConfigType` | `sheetName: Option<String>` · `preserveWhitespace`, `decodeEntities` · `indent: Option<String>`, `includeXmlDeclaration`, `encodeEntities`, `selfClosingTags` |
| `GzipOptionsType` / `ZipOptionsType` · `ZipEntriesType` / `TarEntriesType` | `level: Option<Integer>` · `Array<{name, data: Blob}>` |

Results come back as the documented types — `SqlResultType`, `BsonValueType`
documents, `S3ListResultType` (`objects`, `isTruncated`,
`continuationToken`), `FileListType` (`name`, `path`, `size`, `isDirectory`,
`modifiedTime`), `XmlNodeType`, `LiteralValueType` cells. Build a config with
`coerce_to({...}, ConfigType)`: an `Option` field takes `some(value)` or
`none`, never a plain value or `None`.

## Related skills

- **east-py** — the python runtime: East values as plain data, eager methods,
  `coerce_to`, and the `@East.platform_function` on-ramp these calls live
  inside (and the dual-mode rule that makes them callable in a body).
- **east-py-std** — the standard-library sibling: console, filesystem, fetch,
  crypto, time, path, random, large JSON.
- **east-py-datascience** — ML and optimisation platform functions.
- **east-node-io** — the TypeScript authoring surface for the same functions.
- **e3** — the execution engine whose python runner registers this list for
  dataflow tasks.
