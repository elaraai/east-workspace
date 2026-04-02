/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Connection management utilities for East Node IO.
 *
 * Provides opaque handle-based connection management for databases,
 * storage services, and file transfer protocols.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { EastError } from "@elaraai/east/internal";

/**
 * Internal connection handle storage.
 * Maps handle UUIDs to connection objects and their cleanup functions.
 *
 * @internal
 */
const connectionHandles = new Map<string, { connection: any; cleanup?: () => Promise<void> }>();

/**
 * Creates an opaque handle for a connection object.
 *
 * Generates a UUID handle and stores the connection in internal storage.
 * The handle can be used to retrieve the connection later.
 *
 * @param connection - The connection object to store
 * @param cleanup - Optional cleanup function to call when closing all handles
 * @returns Opaque handle (UUID string) for the connection
 *
 * @example
 * ```ts
 * const pool = new pg.Pool(config);
 * const handle = createHandle(pool, async () => await pool.end());
 * ```
 */
export function createHandle(connection: any, cleanup?: () => Promise<void>): string {
    const handle = randomUUID();
    const entry: { connection: any; cleanup?: () => Promise<void> } = { connection };
    if (cleanup) {
        entry.cleanup = cleanup;
    }
    connectionHandles.set(handle, entry);
    return handle;
}

/**
 * Retrieves a connection object by its handle.
 *
 * Looks up the connection associated with the given handle.
 * Throws an error if the handle is invalid or not found.
 *
 * @typeParam T - The expected type of the connection object
 * @param handle - The opaque handle for the connection
 * @returns The connection object cast to type T
 *
 * @throws {EastError} When handle is invalid or not found (location: "connection_handle")
 *
 * @example
 * ```ts
 * const pool = getConnection<pg.Pool>(handle);
 * const result = await pool.query(sql, params);
 * ```
 */
export function getConnection<T>(handle: string): T {
    const entry = connectionHandles.get(handle);
    if (!entry) {
        throw new EastError(`Invalid connection handle: ${handle}`, {
            location: [{ filename: "connection_handle", line: 0n, column: 0n }]
        });
    }
    return entry.connection as T;
}

/**
 * Closes and removes a connection handle.
 *
 * Removes the connection from internal storage. The connection object
 * itself should be closed by the caller before calling this function.
 *
 * @param handle - The opaque handle to close
 *
 * @throws {EastError} When handle is invalid or not found (location: "connection_close")
 *
 * @example
 * ```ts
 * const pool = getConnection<pg.Pool>(handle);
 * await pool.end();
 * closeHandle(handle);
 * ```
 */
export function closeHandle(handle: string): void {
    const entry = connectionHandles.get(handle);
    if (!entry) {
        throw new EastError(`Cannot close invalid handle: ${handle}`, {
            location: [{ filename: "connection_close", line: 0n, column: 0n }]
        });
    }
    connectionHandles.delete(handle);
}

/**
 * Gets the current number of active connection handles.
 *
 * Useful for debugging and testing to ensure connections are properly cleaned up.
 *
 * @returns Number of active connection handles
 *
 * @internal
 */
export function getHandleCount(): number {
    return connectionHandles.size;
}

/**
 * Closes all active connection handles.
 *
 * Useful for test cleanup to ensure all connections are closed even if tests fail.
 * Calls each connection's registered cleanup function, then clears all handles.
 *
 * @internal
 */
export async function closeAllHandles(): Promise<void> {
    for (const [handle, entry] of connectionHandles.entries()) {
        try {
            if (entry.cleanup) {
                await entry.cleanup();
            }
        } catch (err) {
            // Ignore errors during cleanup
            console.error(`Error closing handle ${handle}:`, err);
        }
    }
    connectionHandles.clear();
}