---
name: east-py-io
description: "I/O platform functions for the East language on the Python runtime - SQL databases (SQLite, PostgreSQL, MySQL, Access), NoSQL (Redis, MongoDB), S3 storage, file transfers (FTP, SFTP), file formats (XLSX, XML), and compression (Gzip, Zip, Tar). Use when writing Python (not the TypeScript DSL) that calls or registers these platform functions. Triggers for: (1) Calling east_py_io *_impl functions directly from a project's own Python @platform_function (sqlite_query_impl, mongo_find_impl, s3_put_object_impl, ftp_get_impl, xlsx_read_impl, gzip_compress_impl, ...), (2) Registering the east_py_io platform list with compile() so East programs can use SQL/NoSQL/Storage/Transfer/Format/Compression on the Python runtime, (3) Building connection configs (SqliteConfigType, PostgresConfigType, RedisConfigType, S3ConfigType, FtpConfigType, ...) in Python, (4) The connect -> handle -> operate -> close connection lifecycle. For authoring East programs in TypeScript against these functions, use the east-node-io skill instead."
---

# East.py I/O Platform Functions

`east_py_io` is the Python implementation of the East I/O platform: SQL and
NoSQL databases, S3 object storage, FTP/SFTP transfers, XLSX/XML formats, and
compression. Every `*_impl` function is a **plain Python callable taking and
returning East values** (database/network functions are `async def` - await
them) - call them directly from a project `@platform_function`, or register
the whole `platform` list so East programs running on the Python runtime can
use them.

This skill is for **Python** code. To author East programs in TypeScript that
use these functions (`SQL.SQLite.query`, `Storage.S3.putObject`, ...), load
the **east-node-io** skill - the TS surface is identical in capability.

## Quick Start

```python
from east import ArrayType, FloatType, StringType, StructType, coerce_to, platform_function
from east_py_io import SqliteConfigType, sqlite_close_impl, sqlite_connect_impl, sqlite_query_impl

OrderRow = StructType([("sku", StringType), ("qty", FloatType)])

@platform_function(inputs=[StringType], output=ArrayType(OrderRow), name="load_orders")
async def load_orders(db_path):
    config = coerce_to({"path": db_path, "readOnly": True, "memory": None}, SqliteConfigType)
    handle = await sqlite_connect_impl(config)        # connection handle: String
    try:
        result = await sqlite_query_impl(handle, "SELECT sku, qty FROM orders", [])
        return result.value["rows"]                   # SqlResultType variant
    finally:
        await sqlite_close_impl(handle)

# Or register everything for the East runtime:
from east_py_io import platform   # pass to compile_async()
```

## Connection Lifecycle

Database, transfer, and cache modules share one pattern: `*_connect_impl`
returns an opaque **connection handle** (`String` UUID, valid for the
process lifetime), every operation takes the handle, and `*_close_impl` /
`*_close_all_impl` release it. Always close - handles are pooled per process.

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
    │      `*_select` is the generic typed variant - rows decode to YOUR row struct
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
  methods, `coerce_to`, and the `@platform_function` on-ramp these direct
  calls live inside.
- **east-py-std** - the standard-library sibling on the Python runtime:
  console, filesystem, fetch, crypto, time, path, random.
- **east-py-datascience** - ML and optimization platform functions (hybrid
  TS + Python package).
- **east-node-io** - the TypeScript authoring surface for these same
  capabilities; use it when writing East programs, not Python.
- **e3** - the execution engine whose Python runner registers this platform
  list for dataflow tasks.
