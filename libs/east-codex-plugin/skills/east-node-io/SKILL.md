---
name: east-node-io
description: "I/O platform functions for the East language on Node.js. Use when writing East programs that need SQL databases (SQLite, PostgreSQL, MySQL, Access), NoSQL databases (Redis, MongoDB), S3 storage, file transfers (FTP, SFTP), file format parsing (XLSX, XML), or compression (Gzip, Zip, Tar). Triggers for: (1) Writing East programs with @elaraai/east-node-io, (2) Database operations with SQL.SQLite, SQL.Postgres, SQL.MySQL, SQL.Access, NoSQL.Redis, NoSQL.MongoDB, (3) Cloud storage with Storage.S3, (4) File transfers with Transfer.FTP, Transfer.SFTP, (5) Format parsing with Format.XLSX, Format.XML, (6) Compression with Compression.Gzip, Compression.Zip, Compression.Tar."
---

# East Node IO

I/O platform functions for East on Node.js: databases, object storage, file
transfers, spreadsheet and XML formats, and compression. Each module is a set
of platform declarations an East function calls, with its implementation in
`Module.Implementation`; the same functions, under the same platform names,
are implemented on the python runtime (**east-py-io**).

Nearly all of them are **async** — the databases, S3, transfers, Gzip and Tar
(XLSX, XML and Zip are sync) — so a function calling them is an
`East.asyncFunction`, compiled with `East.compileAsync` and awaited. A sync
`East.function` calling one is refused at compile: `Async platform call not
allowed outside async function`.

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

```typescript
import { East, StringType, NullType, none, variant } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";
import { Env, EnvImpl } from "@elaraai/east-node-std";

const queryUser = East.asyncFunction([StringType], NullType, ($, userId) => {
    const config = $.let({
        host: "localhost", port: 5432n, database: "myapp", user: "postgres",
        password: Env.get("PGPASSWORD").unwrap(),   // from the environment, never a literal
        ssl: none, maxConnections: none,
    });
    const conn = $.let(SQL.Postgres.connect(config));
    $(SQL.Postgres.query(conn, "SELECT * FROM users WHERE id = $1", [variant("String", userId)]));
    $(SQL.Postgres.close(conn));
});

const compiled = East.compileAsync(queryUser, [...SQL.Postgres.Implementation, ...EnvImpl]);
await compiled("user123");
```

## Decision Tree: Which Module to Use

```
Task → What do you need?
    │
    ├─ SQL Database — .connect(config) → a handle · .close(handle) · .closeAll()
    │   ├─ SQL.SQLite (embedded, placeholder ?) · SQL.Postgres ($1, $2, …) · SQL.MySQL (?)
    │   │   ├─ .query(handle, sql, params) → Types.Result, a variant by statement kind
    │   │   │   (select {rows} · insert {rowsAffected, lastInsertId} · update / delete {rowsAffected})
    │   │   └─ .select([RowType], handle, sql, params) → Array<RowType> — the typed read; the type argument FIRST, in an array
    │   │       (params: an Array of Types.Parameter — variant("String", s), variant("Integer", n), …)
    │   └─ SQL.Access (read-only, .mdb / .accdb) → .open(config) · .tables(handle) · .query([RowType], handle, options) ·
    │       .close() · .closeAll()
    │
    ├─ NoSQL
    │   ├─ NoSQL.Redis (key-value) → .connect() · .get(h, key) → Option<String> · .set(h, key, value) ·
    │   │   .setex(h, key, value, seconds) · .delete(h, key) · .close() · .closeAll()
    │   └─ NoSQL.MongoDB (documents) → .connect() · .insertOne(h, doc) · .findOne(h, filter) · .findMany(h, filter, options) ·
    │       .updateOne(h, filter, update) · .deleteOne(h, filter) · .close()
    │
    ├─ Storage.S3 (S3-compatible; each call takes the config, no connection)
    │   └─ .putObject() · .getObject() · .headObject() · .deleteObject() · .listObjects() · .presignUrl()
    │
    ├─ Transfer.FTP · Transfer.SFTP → .connect() · .put(h, path, blob) · .get(h, path) · .list(h, path) · .delete(h, path) · .close()
    │
    ├─ Format (sync)
    │   ├─ Format.XLSX → .read(blob, options) (a sheet: rows of cells) · .write(sheet, options) → Blob · .info(blob)
    │   └─ Format.XML → .parse(blob, config) → a recursive Node · .serialize(node, config) → Blob
    │
    └─ Compression
        ├─ Compression.Gzip (one stream) → .compress(blob, options) · .decompress(blob)
        ├─ Compression.Zip (archive; sync) → .compress(entries, options) · .decompress(blob)
        └─ Compression.Tar (archive) → .create(entries) · .extract(blob)
```

## Compiling East Programs

```typescript
// One module
const compiled = East.compileAsync(myFunction, SQL.Postgres.Implementation);

// Several — each module's Implementation, spread together
const compiled2 = East.compileAsync(myFunction, [...SQL.Postgres.Implementation, ...Storage.S3.Implementation]);
```

The implementations are also exported flat (`PostgresImpl`, `S3Impl`,
`GzipImpl`, …).

## Accessing Types

```typescript
import { SQL, Storage, NoSQL, Format, Compression } from "@elaraai/east-node-io";

// Module.SubModule.Types.TypeName
SQL.Postgres.Types.Config        // { host, port, database, user, password, ssl: Option, maxConnections: Option }
SQL.Postgres.Types.Result        // and Parameter, Parameters, Row
Storage.S3.Types.Config          // and ObjectMetadata, ListResult
NoSQL.Redis.Types.Config
NoSQL.MongoDB.Types.FindOptions  // and Config, BsonValue, BsonDocument
Format.XLSX.Types.Sheet          // and Cell, Row, ReadOptions, WriteOptions, SheetInfo, Info
Compression.Zip.Types.Entries    // and Level, Options, Entry, Extracted
```

Option fields take `some(value)` / `none`; a config's secret comes from
`Env.get(...)` (**east-node-std**) — IR is content-addressed and replicated, so
a literal credential travels with it.

## Connection Pattern

```typescript
const conn = $.let(Module.connect(config));   // 1. connect: an opaque handle
$(Module.operation(conn, ...args));           // 2. operate
$(Module.close(conn));                        // 3. close — handles are pooled per process
```

## Related skills

- **east** — the language these platform functions plug into; compile with `East.compileAsync`.
- **east-node-std** — Console / Env / FileSystem / Fetch / Crypto / Time basics (this package is the database, cloud and format layer on top).
- **east-py-io** — the same functions on the python runtime.
- **e3** — run ingest / sync as durable, cached dataflow tasks; pair with **east-ui** / **e3-ui** to surface the results.
- **east-project** — to author your OWN custom platform function (not just use these stock ones): `East.platform(...).implement(...)` exported from your package's `./platform`, called from an e3 task via `{ runtime: 'east-node', platforms: [{ custom: '@elaraai/<project>' }] }`.
- **e3-create** — scaffold that custom platform: `--platform` for one module, or `--node-packages=<name>` for a dedicated npm workspace member (its own auto-derived e3 environment).
