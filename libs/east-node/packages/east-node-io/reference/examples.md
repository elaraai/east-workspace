# East Node IO Examples

Working code examples for common I/O use cases.

---

## Table of Contents

- [Quick Start](#quick-start)
- [SQL Databases](#sql-databases)
  - [SQLite](#sqlite)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
- [Storage (S3)](#storage-s3)
- [File Transfer](#file-transfer)
  - [FTP](#ftp)
  - [SFTP](#sftp)
- [NoSQL Databases](#nosql-databases)
  - [Redis](#redis)
  - [MongoDB](#mongodb)
- [File Formats](#file-formats)
  - [XLSX (Excel)](#xlsx-excel)
  - [XML](#xml)
- [Compression](#compression)
  - [Gzip](#gzip)
  - [Zip](#zip)
  - [Tar](#tar)

---

## Quick Start

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { SQL, Storage } from "@elaraai/east-node-io";

// Define East function using SQL platform functions
const queryDatabase = East.function([StringType], NullType, ($, userId) => {
    const config = $.let({
        host: "localhost",
        port: 5432n,
        database: "myapp",
        user: "postgres",
        password: "secret",
        ssl: East.variant('none', null),
        maxConnections: East.variant('none', null),
    });

    const conn = $.let(SQL.Postgres.connect(config));
    $(SQL.Postgres.query(
        conn,
        "SELECT * FROM users WHERE id = $1",
        [East.variant("Integer", 42n)]
    ));
    $(SQL.Postgres.close(conn));
    return $.return(null);
});

// Compile with specific module Implementation
const compiled = East.compileAsync(queryDatabase.toIR(), SQL.Postgres.Implementation);
await compiled("user123");

// Or combine multiple implementations
const multiFunction = East.function([StringType], NullType, ($, key) => {
    // Use both SQL and Storage
    const s3Config = $.let({
        region: "us-east-1",
        bucket: "my-bucket",
        accessKeyId: East.variant('none', null),
        secretAccessKey: East.variant('none', null),
        endpoint: East.variant('none', null),
    });

    const data = $.let(Storage.S3.getObject(s3Config, key));
    // ... process data
    return $.return(null);
});

const compiled2 = East.compileAsync(
    multiFunction.toIR(),
    [...SQL.Postgres.Implementation, ...Storage.S3.Implementation]
);
```

---

## SQL Databases

### SQLite

```typescript
import { East, NullType } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const createAndInsertUser = East.function([], NullType, $ => {
    const config = $.let({
        path: ":memory:",
        readOnly: East.variant('none', null),
        memory: East.variant('some', true),
    });

    const conn = $.let(SQL.SQLite.connect(config));

    // Create table
    $(SQL.SQLite.query(conn, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)", []));

    // Insert a user
    $(SQL.SQLite.query(
        conn,
        "INSERT INTO users (name) VALUES (?)",
        [East.variant("String", "Alice")]
    ));

    $(SQL.SQLite.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(createAndInsertUser.toIR(), SQL.SQLite.Implementation);
await compiled();
```

---

### PostgreSQL

```typescript
import { East, IntegerType, NullType } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const insertUser = East.function([IntegerType], NullType, ($, userId) => {
    const config = $.let({
        host: "localhost",
        port: 5432n,
        database: "myapp",
        user: "postgres",
        password: "secret",
        ssl: East.variant('none', null),
        maxConnections: East.variant('none', null),
    });

    const conn = $.let(SQL.Postgres.connect(config));
    const result = $.let(SQL.Postgres.query(
        conn,
        "INSERT INTO users (id, name) VALUES ($1, $2)",
        [East.variant("Integer", userId), East.variant("String", "Alice")]
    ));
    $(SQL.Postgres.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(insertUser.toIR(), SQL.Postgres.Implementation);
await compiled(123n);
```

---

### MySQL

```typescript
import { East, IntegerType, NullType } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const updateUser = East.function([IntegerType], NullType, ($, userId) => {
    const config = $.let({
        host: "localhost",
        port: 3306n,
        database: "myapp",
        user: "root",
        password: "secret",
        ssl: East.variant('none', null),
        maxConnections: East.variant('none', null),
    });

    const conn = $.let(SQL.MySQL.connect(config));
    $(SQL.MySQL.query(
        conn,
        "UPDATE users SET last_login = NOW() WHERE id = ?",
        [East.variant("Integer", userId)]
    ));
    $(SQL.MySQL.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(updateUser.toIR(), SQL.MySQL.Implementation);
await compiled(456n);
```

---

## Storage (S3)

```typescript
import { East, StringType, BlobType, NullType } from "@elaraai/east";
import { Storage } from "@elaraai/east-node-io";

const uploadAndShare = East.function([StringType, BlobType], StringType, ($, filename, data) => {
    const config = $.let({
        region: "us-east-1",
        bucket: "my-bucket",
        accessKeyId: East.variant('none', null),
        secretAccessKey: East.variant('none', null),
        endpoint: East.variant('none', null),
    });

    // Upload file
    $(Storage.S3.putObject(config, filename, data));

    // Generate pre-signed URL valid for 1 hour
    const url = $.let(Storage.S3.presignUrl(config, filename, 3600n));

    return $.return(url);
});

const compiled = East.compileAsync(uploadAndShare.toIR(), Storage.S3.Implementation);
const shareUrl = await compiled("report.pdf", pdfData);
```

---

## File Transfer

### FTP

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { Transfer } from "@elaraai/east-node-io";

const uploadToFTP = East.function([StringType], NullType, ($, filename) => {
    const config = $.let({
        host: "ftp.example.com",
        port: East.variant('none', null),
        user: East.variant('some', "ftpuser"),
        password: East.variant('some', "secret"),
        secure: false,
    });

    const conn = $.let(Transfer.FTP.connect(config));
    $(Transfer.FTP.put(conn, filename, East.str`/uploads/${filename}`));
    $(Transfer.FTP.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(uploadToFTP.toIR(), Transfer.FTP.Implementation);
await compiled("data.csv");
```

---

### SFTP

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { Transfer } from "@elaraai/east-node-io";

const downloadFromSFTP = East.function([StringType, StringType], NullType, ($, remotePath, localPath) => {
    const config = $.let({
        host: "sftp.example.com",
        port: East.variant('none', null),
        username: "sftpuser",
        password: East.variant('some', "secret"),
        privateKey: East.variant('none', null),
    });

    const conn = $.let(Transfer.SFTP.connect(config));
    $(Transfer.SFTP.get(conn, remotePath, localPath));
    $(Transfer.SFTP.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(downloadFromSFTP.toIR(), Transfer.SFTP.Implementation);
await compiled("/remote/data.csv", "./local/data.csv");
```

---

## NoSQL Databases

### Redis

```typescript
import { East, StringType, OptionType, NullType } from "@elaraai/east";
import { NoSQL } from "@elaraai/east-node-io";

const cacheUserData = East.function([StringType, StringType], NullType, ($, userId, data) => {
    const config = $.let({
        host: "localhost",
        port: 6379n,
        password: East.variant('none', null),
        db: East.variant('none', null),
        keyPrefix: East.variant('some', "user:"),
    });

    const conn = $.let(NoSQL.Redis.connect(config));

    // Cache data with 1 hour expiration
    $(NoSQL.Redis.setex(conn, userId, 3600n, data));

    $(NoSQL.Redis.close(conn));
    return $.return(null);
});

const compiled = East.compileAsync(cacheUserData.toIR(), NoSQL.Redis.Implementation);
await compiled("123", JSON.stringify({ name: "Alice", email: "alice@example.com" }));
```

---

### MongoDB

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { NoSQL } from "@elaraai/east-node-io";

const storeUser = East.function([StringType, StringType], StringType, ($, username, email) => {
    const config = $.let({
        uri: "mongodb://localhost:27017",
        database: "myapp",
        collection: "users",
    });

    const conn = $.let(NoSQL.MongoDB.connect(config));

    // Create BSON document
    const document = $.let(new Map([
        ["username", East.variant('String', username)],
        ["email", East.variant('String', email)],
    ]), NoSQL.MongoDB.Types.BsonDocument);

    // Insert user document and get ID
    const insertedId = $.let(NoSQL.MongoDB.insertOne(conn, document));

    $(NoSQL.MongoDB.close(conn));
    return $.return(insertedId);
});

const compiled = East.compileAsync(storeUser.toIR(), NoSQL.MongoDB.Implementation);
const id = await compiled("alice", "alice@example.com");  // "507f1f77bcf86cd799439011"
```

---

## File Formats

### XLSX (Excel)

```typescript
import { East, BlobType, IntegerType } from "@elaraai/east";
import { Format } from "@elaraai/east-node-io";

const countRowsInExcel = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
    const options = $.let({
        sheetName: East.variant('none', null),
    });

    const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
    return $.return(sheet.size());
});

const compiled = East.compile(countRowsInExcel.toIR(), Format.XLSX.Implementation);
const rowCount = compiled(xlsxBlob);  // e.g., 100n
```

---

### XML

```typescript
import { East, BlobType, StringType } from "@elaraai/east";
import { Format } from "@elaraai/east-node-io";

const extractXMLTag = East.function([BlobType], StringType, ($, xmlBlob) => {
    const config = $.let({
        preserveWhitespace: false,
        decodeEntities: true,
    });

    const doc = $.let(Format.XML.parse(xmlBlob, config));
    return $.return(doc.tag);
});

const compiled = East.compile(extractXMLTag.toIR(), Format.XML.Implementation);
const tagName = compiled(xmlBlob);  // e.g., "book"
```

---

## Compression

### Gzip

```typescript
import { East, BlobType, StringType } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

const compressAndDecompress = East.function([StringType], StringType, ($, text) => {
    const data = $.let(text.encodeUtf8());
    const options = $.let({
        level: East.variant('some', 9n),
    });

    // Compress the data
    const compressed = $.let(Compression.Gzip.compress(data, options));

    // Decompress it back
    const decompressed = $.let(Compression.Gzip.decompress(compressed));
    const result = $.let(decompressed.decodeUtf8());

    return $.return(result);
});

const compiled = East.compileAsync(compressAndDecompress.toIR(), Compression.Gzip.Implementation);
await compiled("Hello, World!");  // "Hello, World!"
```

---

### Zip

```typescript
import { East, BlobType, StringType, DictType } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

const createAndExtractZip = East.function([StringType, StringType], DictType(StringType, BlobType), ($, file1, file2) => {
    // Create entries array
    const entries = $.let([
        { name: "file1.txt", data: file1.encodeUtf8() },
        { name: "file2.txt", data: file2.encodeUtf8() },
    ]);

    const options = $.let({
        level: East.variant('some', 9n),
    });

    // Create ZIP archive
    const zipBlob = $.let(Compression.Zip.compress(entries, options));

    // Extract ZIP archive
    const files = $.let(Compression.Zip.decompress(zipBlob));

    return $.return(files);
});

const compiled = East.compileAsync(createAndExtractZip.toIR(), Compression.Zip.Implementation);
const extracted = await compiled("Hello", "World");  // {"file1.txt": <Blob>, "file2.txt": <Blob>}
```

---

### Tar

```typescript
import { East, BlobType, StringType, DictType } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

const createAndExtractTar = East.function([StringType, StringType], DictType(StringType, BlobType), ($, file1, file2) => {
    // Create entries array
    const entries = $.let([
        { name: "file1.txt", data: file1.encodeUtf8() },
        { name: "file2.txt", data: file2.encodeUtf8() },
    ]);

    // Create TAR archive
    const tarBlob = $.let(Compression.Tar.create(entries));

    // Extract TAR archive
    const files = $.let(Compression.Tar.extract(tarBlob));

    return $.return(files);
});

const compiled = East.compileAsync(createAndExtractTar.toIR(), Compression.Tar.Implementation);
const extracted = await compiled("Hello", "World");  // {"file1.txt": <Blob>, "file2.txt": <Blob>}
```
