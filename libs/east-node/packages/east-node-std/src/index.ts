/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East Node - Node.js platform integration for East language
 *
 * @packageDocumentation
 */

// Export test utilities
export * from "./test.js";

// Export platform function definitions and implementations
export * from "./console.js";
export * from "./env.js";
export * from "./fs.js";
export * from "./path.js";
export * from "./crypto.js";
export * from "./time.js";
export * from "./fetch.js";
export * from "./random.js";
export * from "./json.js";

// Import implementations for combined export
import { ConsoleImpl } from "./console.js";
import { EnvImpl } from "./env.js";
import { FileSystemImpl } from "./fs.js";
import { PathImpl } from "./path.js";
import { CryptoImpl } from "./crypto.js";
import { TimeImpl } from "./time.js";
import { FetchImpl } from "./fetch.js";
import { RandomImpl } from "./random.js";
import { JsonImpl } from "./json.js";
import { TestImpl } from "./test.js";

/**
 * Complete Node.js platform implementation.
 *
 * Pass this array to `compile()` or `compileAsync()` to enable all Node.js platform functions.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { NodePlatform, Console, FileSystem } from "@elaraai/east-node-std";
 *
 * const fn = East.function([], NullType, $ => {
 *     const content = $.let(FileSystem.readFile("data.txt"));
 *     $(Console.log(content));
 * });
 *
 * // Note: Use compileAsync since TimeImpl uses async
 * const compiled = fn.toIR().compileAsync(NodePlatform);
 * await compiled();
 * ```
 */
export const NodePlatform = [
    ...ConsoleImpl,
    ...EnvImpl,
    ...FileSystemImpl,
    ...PathImpl,
    ...CryptoImpl,
    ...TimeImpl,
    ...FetchImpl,
    ...RandomImpl,
    ...JsonImpl,
    ...TestImpl,
];

/**
 * Synchronous subset of Node.js platform (excludes Time.sleep and Fetch operations).
 *
 * Use this for programs that don't need async operations.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { NodePlatformSync, Console } from "@elaraai/east-node-std";
 *
 * const fn = East.function([], NullType, $ => {
 *     $(Console.log("Hello, World!"));
 * });
 *
 * const compiled = fn.toIR().compile(NodePlatformSync);
 * compiled();
 * ```
 */
export const NodePlatformSync = [
    ...ConsoleImpl,
    ...EnvImpl,
    ...FileSystemImpl,
    ...PathImpl,
    ...CryptoImpl,
    ...RandomImpl,
    ...JsonImpl,
    // TimeImpl excluded (has async sleep)
    // FetchImpl excluded (all async)
];

// Re-export all exports as a nested EastNode namespace (matching East.East pattern)
export * as EastNode from './index.js';
