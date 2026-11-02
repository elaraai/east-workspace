/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Who a record's commit names, as a person reads it — what a builder says
 * after "saved … by": the person who made it, and no one for the platform's
 * own writers or a write that named no one.
 *
 * @packageDocumentation
 */
import { StringType, equalFor } from "@elaraai/east";

const textEqual = equalFor(StringType);

/**
 * The person a commit's actor names: a signed-in person (`auth:` and their
 * email), a command line's user (`cli:` and their name), or a name a client
 * gave with no kind before it; `undefined` for the platform's own writers —
 * the deploy's (`system:deploy`), a feed's (`files:sync`) — and for a write
 * that named no one (`api`).
 *
 * @param actor - The commit's actor
 * @returns The person, or `undefined` where it names no one
 */
export function authorOf(actor: string): string | undefined {
    const colon = actor.indexOf(":");
    if (colon < 0) return actor.trim().length === 0 || textEqual(actor, "api") ? undefined : actor;
    const name = actor.slice(colon + 1).trim();
    const kind = actor.slice(0, colon);
    return name.length > 0 && (textEqual(kind, "auth") || textEqual(kind, "cli")) ? name : undefined;
}
