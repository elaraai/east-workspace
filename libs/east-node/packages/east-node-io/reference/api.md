# East Node IO API Reference

Complete function signatures, types, and arguments for all I/O platform modules.

---

## Table of Contents

- [SQL Databases](#sql-databases)
  - [SQLite](#sqlite)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
  - [Microsoft Access](#microsoft-access)
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

## SQL Databases

### SQLite

**Import:**
```typescript
import { SQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Placeholder | Example |
|-----------|-------------|-------------|---------|
| `connect(config: Expr<SqliteConfigType>): StringExpr` | Open SQLite database connection | - | `SQL.SQLite.connect(config)` |
| `query(handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<SqlResultType>` | Execute SQL query | `?` | `SQL.SQLite.query(conn, "SELECT * FROM users WHERE id = ?", [id])` |
| `select<T>(typeArgs: [T], handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<ArrayType<T>>` | Execute SELECT with typed results | `?` | `SQL.SQLite.select([UserRowType], conn, "SELECT * FROM users", [])` |
| `close(handle: StringExpr): NullExpr` | Close database connection | - | `SQL.SQLite.close(conn)` |

**Types:**

Access types via `SQL.SQLite.Types`:
```typescript
SQL.SQLite.Types.Config        // StructType({ path, readOnly?, memory? })
SQL.SQLite.Types.Parameter     // LiteralValueType (String, Integer, Float, Boolean, Null, Blob)
SQL.SQLite.Types.Parameters    // ArrayType(SqlParameterType)
SQL.SQLite.Types.Row           // DictType(String -> SqlParameterType)
SQL.SQLite.Types.Result        // VariantType({ select, insert, update, delete })
```

---

### PostgreSQL

**Import:**
```typescript
import { SQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Placeholder | Example |
|-----------|-------------|-------------|---------|
| `connect(config: Expr<PostgresConfigType>): StringExpr` | Create PostgreSQL connection pool | - | `SQL.Postgres.connect(config)` |
| `query(handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<SqlResultType>` | Execute SQL query | `$1`, `$2`, etc. | `SQL.Postgres.query(conn, "SELECT * FROM users WHERE id = $1", [id])` |
| `select<T>(typeArgs: [T], handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<ArrayType<T>>` | Execute SELECT with typed results | `$1`, `$2`, etc. | `SQL.Postgres.select([UserRowType], conn, "SELECT * FROM users", [])` |
| `close(handle: StringExpr): NullExpr` | Close connection pool | - | `SQL.Postgres.close(conn)` |

**Types:**

Access types via `SQL.Postgres.Types`:
```typescript
SQL.Postgres.Types.Config      // StructType({ host, port, database, user, password, ssl?, maxConnections? })
SQL.Postgres.Types.Parameter   // LiteralValueType
SQL.Postgres.Types.Parameters  // ArrayType(SqlParameterType)
SQL.Postgres.Types.Row         // DictType(String -> SqlParameterType)
SQL.Postgres.Types.Result      // VariantType({ select, insert, update, delete })
```

---

### MySQL

**Import:**
```typescript
import { SQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Placeholder | Example |
|-----------|-------------|-------------|---------|
| `connect(config: Expr<MySqlConfigType>): StringExpr` | Create MySQL connection pool | - | `SQL.MySQL.connect(config)` |
| `query(handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<SqlResultType>` | Execute SQL query | `?` | `SQL.MySQL.query(conn, "SELECT * FROM users WHERE id = ?", [id])` |
| `select<T>(typeArgs: [T], handle: StringExpr, sql: StringExpr, params: Expr<SqlParametersType>): Expr<ArrayType<T>>` | Execute SELECT with typed results | `?` | `SQL.MySQL.select([UserRowType], conn, "SELECT * FROM users", [])` |
| `close(handle: StringExpr): NullExpr` | Close connection pool | - | `SQL.MySQL.close(conn)` |

**Types:**

Access types via `SQL.MySQL.Types`:
```typescript
SQL.MySQL.Types.Config         // StructType({ host, port, database, user, password, ssl?, maxConnections? })
SQL.MySQL.Types.Parameter      // LiteralValueType
SQL.MySQL.Types.Parameters     // ArrayType(SqlParameterType)
SQL.MySQL.Types.Row            // DictType(String -> SqlParameterType)
SQL.MySQL.Types.Result         // VariantType({ select, insert, update, delete })
```

---

### Microsoft Access

**Import:**
```typescript
import { SQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `open(config: Expr<AccessConfigType>): StringExpr` | Open Access database file | `SQL.Access.open(config)` |
| `tables(handle: StringExpr): Expr<AccessTablesResultType>` | List all table names | `SQL.Access.tables(conn)` |
| `query<T>(typeArgs: [T], handle: StringExpr, options: Expr<AccessQueryOptionsType>): Expr<ArrayType<T>>` | Query table with typed results | `SQL.Access.query([UserRowType], conn, options)` |
| `close(handle: StringExpr): NullExpr` | Close database connection | `SQL.Access.close(conn)` |

**Types:**

Access types via `SQL.Access.Types`:
```typescript
SQL.Access.Types.Config        // StructType({ path, password? })
SQL.Access.Types.QueryOptions  // StructType({ table, columns?, rowOffset?, rowLimit? })
SQL.Access.Types.TablesResult  // StructType({ tables: Array<String> })
```

**Notes:**
- Read-only: The mdb-reader library cannot create or modify Access databases
- Supports Access 97 through Access 2019 (.mdb and .accdb formats)
- Supports encrypted databases with password option

---

## Storage (S3)

**Import:**
```typescript
import { Storage } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `putObject(config: Expr<S3ConfigType>, key: StringExpr, data: BlobExpr): NullExpr` | Upload object to S3 | `Storage.S3.putObject(config, "file.txt", data)` |
| `getObject(config: Expr<S3ConfigType>, key: StringExpr): BlobExpr` | Download object from S3 | `Storage.S3.getObject(config, "file.txt")` |
| `deleteObject(config: Expr<S3ConfigType>, key: StringExpr): NullExpr` | Delete object from S3 | `Storage.S3.deleteObject(config, "file.txt")` |
| `headObject(config: Expr<S3ConfigType>, key: StringExpr): Expr<S3ObjectMetadataType>` | Get object metadata | `Storage.S3.headObject(config, "file.txt")` |
| `listObjects(config: Expr<S3ConfigType>, prefix: StringExpr, maxKeys: IntegerExpr): Expr<S3ListResultType>` | List objects in bucket | `Storage.S3.listObjects(config, "uploads/", 100n)` |
| `presignUrl(config: Expr<S3ConfigType>, key: StringExpr, expiresIn: IntegerExpr): StringExpr` | Generate pre-signed URL | `Storage.S3.presignUrl(config, "file.txt", 3600n)` |

**Types:**

Access types via `Storage.S3.Types`:
```typescript
Storage.S3.Types.Config           // StructType({ region, bucket, accessKeyId?, secretAccessKey?, endpoint? })
Storage.S3.Types.ObjectMetadata   // StructType({ key, size, lastModified, contentType?, etag? })
Storage.S3.Types.ListResult       // StructType({ objects, isTruncated, continuationToken? })
```

---

## File Transfer

### FTP

**Import:**
```typescript
import { Transfer } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `connect(config: Expr<FtpConfigType>): StringExpr` | Connect to FTP server | `Transfer.FTP.connect(config)` |
| `put(handle: StringExpr, localPath: StringExpr, remotePath: StringExpr): NullExpr` | Upload file to FTP | `Transfer.FTP.put(conn, "./local.txt", "/remote.txt")` |
| `get(handle: StringExpr, remotePath: StringExpr, localPath: StringExpr): NullExpr` | Download file from FTP | `Transfer.FTP.get(conn, "/remote.txt", "./local.txt")` |
| `list(handle: StringExpr, remotePath: StringExpr): ArrayExpr<StringType>` | List directory contents | `Transfer.FTP.list(conn, "/uploads")` |
| `delete(handle: StringExpr, remotePath: StringExpr): NullExpr` | Delete file from FTP | `Transfer.FTP.delete(conn, "/old.txt")` |
| `close(handle: StringExpr): NullExpr` | Close FTP connection | `Transfer.FTP.close(conn)` |

**Types:**

Access types via `Transfer.FTP.Types`:
```typescript
Transfer.FTP.Types.Config     // StructType({ host, port?, user?, password?, secure? })
```

---

### SFTP

**Import:**
```typescript
import { Transfer } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `connect(config: Expr<SftpConfigType>): StringExpr` | Connect to SFTP server | `Transfer.SFTP.connect(config)` |
| `put(handle: StringExpr, localPath: StringExpr, remotePath: StringExpr): NullExpr` | Upload file to SFTP | `Transfer.SFTP.put(conn, "./local.txt", "/remote.txt")` |
| `get(handle: StringExpr, remotePath: StringExpr, localPath: StringExpr): NullExpr` | Download file from SFTP | `Transfer.SFTP.get(conn, "/remote.txt", "./local.txt")` |
| `list(handle: StringExpr, remotePath: StringExpr): ArrayExpr<StringType>` | List directory contents | `Transfer.SFTP.list(conn, "/uploads")` |
| `delete(handle: StringExpr, remotePath: StringExpr): NullExpr` | Delete file from SFTP | `Transfer.SFTP.delete(conn, "/old.txt")` |
| `close(handle: StringExpr): NullExpr` | Close SFTP connection | `Transfer.SFTP.close(conn)` |

**Types:**

Access types via `Transfer.SFTP.Types`:
```typescript
Transfer.SFTP.Types.Config    // StructType({ host, port?, username, password?, privateKey? })
```

---

## NoSQL Databases

### Redis

**Import:**
```typescript
import { NoSQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `connect(config: Expr<RedisConfigType>): StringExpr` | Connect to Redis server | `NoSQL.Redis.connect(config)` |
| `get(handle: StringExpr, key: StringExpr): Expr<OptionType(StringType)>` | Get value by key | `NoSQL.Redis.get(conn, "user:123")` |
| `set(handle: StringExpr, key: StringExpr, value: StringExpr): NullExpr` | Set key to value | `NoSQL.Redis.set(conn, "user:123", data)` |
| `setex(handle: StringExpr, key: StringExpr, seconds: IntegerExpr, value: StringExpr): NullExpr` | Set key with expiration | `NoSQL.Redis.setex(conn, "session:abc", 3600n, token)` |
| `del(handle: StringExpr, key: StringExpr): NullExpr` | Delete key | `NoSQL.Redis.del(conn, "user:123")` |
| `close(handle: StringExpr): NullExpr` | Close Redis connection | `NoSQL.Redis.close(conn)` |

**Types:**

Access types via `NoSQL.Redis.Types`:
```typescript
NoSQL.Redis.Types.Config      // StructType({ host, port, password?, db?, keyPrefix? })
```

---

### MongoDB

**Import:**
```typescript
import { NoSQL } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `connect(config: Expr<MongoConfigType>): StringExpr` | Connect to MongoDB | `NoSQL.MongoDB.connect(config)` |
| `insertOne(handle: StringExpr, collection: StringExpr, document: StringExpr): StringExpr` | Insert document | `NoSQL.MongoDB.insertOne(conn, "users", jsonDoc)` |
| `findOne(handle: StringExpr, collection: StringExpr, filter: StringExpr): Expr<OptionType(StringType)>` | Find one document | `NoSQL.MongoDB.findOne(conn, "users", '{"id": 123}')` |
| `find(handle: StringExpr, collection: StringExpr, filter: StringExpr, limit: IntegerExpr): ArrayExpr<StringType>` | Find documents | `NoSQL.MongoDB.find(conn, "users", '{}', 10n)` |
| `updateOne(handle: StringExpr, collection: StringExpr, filter: StringExpr, update: StringExpr): BooleanExpr` | Update document | `NoSQL.MongoDB.updateOne(conn, "users", filter, update)` |
| `deleteOne(handle: StringExpr, collection: StringExpr, filter: StringExpr): BooleanExpr` | Delete document | `NoSQL.MongoDB.deleteOne(conn, "users", '{"id": 123}')` |
| `close(handle: StringExpr): NullExpr` | Close MongoDB connection | `NoSQL.MongoDB.close(conn)` |

**Types:**

Access types via `NoSQL.MongoDB.Types`:
```typescript
NoSQL.MongoDB.Types.Config        // StructType({ uri, database, collection })
NoSQL.MongoDB.Types.BsonDocument  // DictType(String -> BsonValueType)
```

---

## File Formats

### XLSX (Excel)

**Import:**
```typescript
import { Format } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `read(blob: BlobExpr, options: Expr<XlsxReadOptionsType>): Expr<XlsxSheetType>` | Read XLSX file | `Format.XLSX.read(xlsxBlob, options)` |
| `write(data: Expr<XlsxSheetType>, options: Expr<XlsxWriteOptionsType>): BlobExpr` | Write XLSX file | `Format.XLSX.write(sheetData, options)` |
| `info(blob: BlobExpr): Expr<XlsxInfoType>` | Get XLSX metadata | `Format.XLSX.info(xlsxBlob)` |

**Types:**

Access types via `Format.XLSX.Types`:
```typescript
Format.XLSX.Types.Cell          // LiteralValueType
Format.XLSX.Types.Row           // ArrayType(XlsxCellType)
Format.XLSX.Types.Sheet         // ArrayType(XlsxRowType)
Format.XLSX.Types.ReadOptions   // StructType({ sheetName? })
Format.XLSX.Types.WriteOptions  // StructType({ sheetName? })
Format.XLSX.Types.SheetInfo     // StructType({ name, rowCount, columnCount })
Format.XLSX.Types.Info          // StructType({ sheets })
```

---

### XML

**Import:**
```typescript
import { Format } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `parse(blob: BlobExpr, config: Expr<XmlParseConfigType>): Expr<XmlNodeType>` | Parse XML to tree structure | `Format.XML.parse(xmlBlob, config)` |
| `serialize(node: Expr<XmlNodeType>, config: Expr<XmlSerializeConfigType>): BlobExpr` | Serialize tree to XML | `Format.XML.serialize(xmlNode, config)` |

**Types:**

Access types via `Format.XML.Types`:
```typescript
Format.XML.Types.Node              // RecursiveType StructType({ tag, attributes, children })
Format.XML.Types.ParseConfig       // StructType({ preserveWhitespace, decodeEntities })
Format.XML.Types.SerializeConfig   // StructType({ indent?, includeXmlDeclaration, encodeEntities, selfClosingTags })
```

---

## Compression

### Gzip

**Import:**
```typescript
import { Compression } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `compress(data: BlobExpr, options: Expr<GzipOptionsType>): BlobExpr` | Compress data using gzip | `Compression.Gzip.compress(data, options)` |
| `decompress(data: BlobExpr): BlobExpr` | Decompress gzip data | `Compression.Gzip.decompress(compressed)` |

**Types:**

Access types via `Compression.Gzip.Types`:
```typescript
Compression.Gzip.Types.Level      // IntegerType (0-9)
Compression.Gzip.Types.Options    // StructType({ level? })
```

---

### Zip

**Import:**
```typescript
import { Compression } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `compress(entries: Expr<ZipEntriesType>, options: Expr<ZipOptionsType>): BlobExpr` | Create ZIP archive | `Compression.Zip.compress(entries, options)` |
| `decompress(data: BlobExpr): Expr<ZipExtractedType>` | Extract ZIP archive | `Compression.Zip.decompress(zipBlob)` |

**Types:**

Access types via `Compression.Zip.Types`:
```typescript
Compression.Zip.Types.Level       // IntegerType (0-9)
Compression.Zip.Types.Options     // StructType({ level? })
Compression.Zip.Types.Entry       // StructType({ name, data })
Compression.Zip.Types.Entries     // ArrayType(ZipEntryType)
Compression.Zip.Types.Extracted   // DictType(String -> Blob)
```

---

### Tar

**Import:**
```typescript
import { Compression } from "@elaraai/east-node-io";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `create(entries: Expr<TarEntriesType>): BlobExpr` | Create TAR archive | `Compression.Tar.create(entries)` |
| `extract(data: BlobExpr): Expr<TarExtractedType>` | Extract TAR archive | `Compression.Tar.extract(tarBlob)` |

**Types:**

Access types via `Compression.Tar.Types`:
```typescript
Compression.Tar.Types.Entry       // StructType({ name, data })
Compression.Tar.Types.Entries     // ArrayType(TarEntryType)
Compression.Tar.Types.Extracted   // DictType(String -> Blob)
```

---

## Accessing Types

All module types are accessible via a nested `Types` property:

```typescript
import { SQL, Storage, NoSQL, Format } from "@elaraai/east-node-io";

// Access SQL types
const postgresConfig = SQL.Postgres.Types.Config;
const sqlResult = SQL.Postgres.Types.Result;

// Access Storage types
const s3Config = Storage.S3.Types.Config;
const metadata = Storage.S3.Types.ObjectMetadata;

// Access NoSQL types
const redisConfig = NoSQL.Redis.Types.Config;

// Access Format types
const xlsxSheet = Format.XLSX.Types.Sheet;
```

**Pattern:**
- `Module.SubModule.Types.TypeName` - Access types through the module namespace
- All configuration and result types are organized under `Types`
