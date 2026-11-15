/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's editing sessions, as a run of its optimiser asks them
 * (east-workspace#1622; `use-optimise.ts`' {@link OptimiseSessions}): each
 * session over a record the builder edits, by the record's name in the
 * deployed package. One reading for every builder — a Schedule kind's
 * session, a record's beside the kinds, a Sheet's — so a run hands over the
 * same drafts, waits on the same carrying-over and says a conflict in the same
 * words whichever builder it is.
 *
 * @packageDocumentation
 */

import { decodeBeast2For } from "@elaraai/east";
import { optimiseMessages, type EditSession, type EditingWords } from "@elaraai/east-ui-components";
import { FuncDraftType } from "@elaraai/e3-ui/internal";
import type { ScheduleEditing } from "../schedule/editing.js";
import type { FuncCallDraft } from "./use-func-call.js";
import type { OptimiseRefused, OptimiseSessions } from "./use-optimise.js";

/** A draft, from the bytes a session's draft form answers: beast2 at e3's draft type. */
const decodeDraft = decodeBeast2For(FuncDraftType) as (bytes: Uint8Array) => FuncCallDraft;

/** One of a builder's sessions, and the record it edits. */
export interface OptimiseSession {
    /** The record's name in the deployed package: what the function lists in `drafts`. */
    readonly record: string;
    /** The session over it. */
    readonly session: Pick<EditSession<unknown>, "toDraft" | "carrying" | "status" | "unsettled">;
    /**
     * Whether the session has yet to judge its drafts where its record reads now, as its builder knows it: a session
     * told its record moved only after the render the record moves in is carrying from that render on
     * (`ScheduleEditing.carrying`). The session's own `carrying` unless given.
     */
    readonly carrying?: (() => boolean) | undefined;
    /**
     * Whether the session takes a gesture now, as its builder knows it: its record read, the session writable
     * (`ScheduleEditing.available`). An answer lands as a gesture does, so it waits for one that does not. Always,
     * unless given.
     */
    readonly available?: (() => boolean) | undefined;
}

/** The words a run says a conflict to choose in: the refused Save's. */
export type OptimiseSessionWords = Pick<EditingWords, "number"> & { readonly m: Pick<EditingWords["m"], "bannerConflicts"> };

/** A refusal's first line, or the session's own word where it names none. */
function refusal(issues: readonly { readonly message: string }[], fallback: string): OptimiseRefused {
    return { refused: issues[0]?.message ?? fallback };
}

/**
 * A builder's sessions as a run asks them.
 *
 * @param held - Each session over a record the builder edits, read as the run asks: the builder's sessions as they stand
 * @param words - The builder's editing words: a conflict to choose is said in the refused Save's, as the banner's sentence
 * @returns The sessions' drafts, whether they stand on what the page has read, and the conflicts they hold
 */
export function optimiseSessions(held: () => readonly OptimiseSession[], words: OptimiseSessionWords): OptimiseSessions {
    // Two kinds over one record share its session: each session once.
    const over = (records: readonly string[]): readonly OptimiseSession[] => {
        const named = new Set(records);
        const seen = new Set<OptimiseSession["session"]>();
        return held().filter((part) => {
            if (!named.has(part.record) || seen.has(part.session)) return false;
            seen.add(part.session);
            return true;
        });
    };
    return {
        drafts(listed) {
            const drafts: FuncCallDraft[] = [];
            for (const part of over(listed)) {
                const handed = part.session.toDraft();
                // A session with no draft form saves through no record's door: it has no draft to hand over.
                if (handed === undefined || handed.type === "unchanged") continue;
                if (handed.type === "draft") { drafts.push(decodeDraft(handed.value)); continue; }
                // A Save of the session's own still on its way, or the record's refusal of the edits as they stand: in its words.
                return refusal(handed.value, handed.type);
            }
            return drafts;
        },
        settled(records) {
            // A Save on its way, or being read back, is the session's to finish before anything lands on it.
            return over(records).every((part) => !(part.carrying?.() ?? part.session.carrying) && part.available?.() !== false
                && part.session.status !== "applying" && part.session.status !== "reconciling");
        },
        conflicts(records) {
            let n = 0;
            for (const part of over(records)) n += part.session.unsettled;
            return n === 0 ? undefined : optimiseMessages.refusedConflicts({ conflicts: words.m.bannerConflicts({ n, count: words.number(n) }) });
        },
    };
}

/**
 * A Schedule builder's sessions as a run asks them: each kind's and each record's beside them, named by the record
 * its session edits — the name its binding carries, its editing's `sourceId` on the wire.
 *
 * @param editing - The builder's editing, read as the run asks; `undefined` while it has none, and there are no drafts
 * @param recordOf - The record a kind's session, or a record's beside the kinds, edits, by the kind's slot or the
 *   record's key; `undefined` for one that edits no record
 * @param words - The builder's editing words
 * @returns The sessions, as a run asks them
 */
export function scheduleOptimiseSessions(editing: () => Pick<ScheduleEditing, "sessions" | "carrying" | "available"> | undefined,
    recordOf: (kind: string) => string | undefined, words: OptimiseSessionWords): OptimiseSessions {
    return optimiseSessions(() => {
        const now = editing();
        if (now === undefined) return [];
        return now.sessions.flatMap((part): OptimiseSession[] => {
            const record = recordOf(part.kind);
            return record === undefined ? []
                : [{ record, session: part.session, carrying: () => now.carrying(part.kind), available: () => now.available(part.kind) }];
        });
    }, words);
}
