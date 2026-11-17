/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an error says, as a banner or a status line says it — the one copy the
 * package's parts share. It imports nothing, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`) carries it to a host in Node.
 *
 * @packageDocumentation
 */

/**
 * What an error says: an `Error`'s message, or what else was thrown, as text.
 *
 * @param err - What was thrown, or a promise rejected with
 * @returns Its message
 */
export function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
