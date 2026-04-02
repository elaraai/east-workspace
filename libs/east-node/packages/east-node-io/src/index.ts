/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East Node IO - I/O platform functions for the East language on Node.js
 *
 * Provides type-safe I/O operations for East programs including:
 * - SQL databases (SQLite, PostgreSQL, MySQL)
 * - Cloud storage (S3)
 * - File transfer (FTP, SFTP)
 * - NoSQL databases (Redis, MongoDB)
 * - File formats (XLSX/Excel, CSV, XML)
 * - Compression (gzip, zip, tar)
 *
 * @packageDocumentation
 */

// Export SQL modules
export * from "./sql/index.js";

// Export Storage modules
export * from "./storage/index.js";

// Export Transfer modules
export * from "./transfer/index.js";

// Export NoSQL modules
export * from "./nosql/index.js";

// Export Format modules
export * from "./format/index.js";

// Export Compression modules
export * from "./compression/index.js";

// Re-export all exports as a nested EastNodeIO namespace (matching East.East pattern)
export * as EastNodeIO from './index.js';

