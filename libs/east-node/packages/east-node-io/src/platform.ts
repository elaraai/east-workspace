/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Platform export for east-node-cli.
 *
 * This module provides all I/O platform functions for use with the CLI.
 * Import via `@elaraai/east-node-io/platform`.
 *
 * @packageDocumentation
 */

// SQL implementations
import { SqliteImpl } from "./sql/sqlite.js";
import { PostgresImpl } from "./sql/postgres.js";
import { MySqlImpl } from "./sql/mysql.js";
import { AccessImpl } from "./sql/access.js";

// Storage implementations
import { S3Impl } from "./storage/s3.js";

// Transfer implementations
import { FtpImpl } from "./transfer/ftp.js";
import { SftpImpl } from "./transfer/sftp.js";

// NoSQL implementations
import { RedisImpl } from "./nosql/redis.js";
import { MongoDBImpl } from "./nosql/mongodb.js";

// Format implementations
import { XlsxImpl } from "./format/xlsx.js";

// Compression implementations
import { GzipImpl } from "./compression/gzip.js";
import { ZipImpl } from "./compression/zip.js";
import { TarImpl } from "./compression/tar.js";

/**
 * Complete I/O platform implementation.
 *
 * Pass this array to the CLI or `compile()` to enable all I/O platform functions.
 */
const NodeIOPlatform = [
    ...SqliteImpl,
    ...PostgresImpl,
    ...MySqlImpl,
    ...AccessImpl,
    ...S3Impl,
    ...FtpImpl,
    ...SftpImpl,
    ...RedisImpl,
    ...MongoDBImpl,
    ...XlsxImpl,
    ...GzipImpl,
    ...ZipImpl,
    ...TarImpl,
];

export default NodeIOPlatform;
