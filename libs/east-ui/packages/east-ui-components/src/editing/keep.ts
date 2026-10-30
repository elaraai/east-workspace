/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drafts kept through a reload. An editing session's drafts are written to
 * the tab's storage (kept state, `tab`) in the same step as each change —
 * typed: each value beast2 at the session's own schemas, which a reload
 * checks before it restores them — and restored as the page loads again,
 * carried over to what the source holds then ({@link EditSession.restore}):
 * a source that has not moved takes them back as they were, a change since
 * combines with them or is a conflict to choose, and a Save that landed
 * before the reload leaves no draft. The tab alone keeps them: they go when
 * it closes, and at a sign-out with everything kept. A session keeps its
 * drafts where its collection says how its projection is written
 * (`wireType`); one whose drafts storage refuses, or whose kept drafts cannot
 * be restored, says so ({@link useDraftsKeeping}). The history is not kept:
 * it starts at the restored drafts, as after any carry-over.
 *
 * @packageDocumentation
 */
import { useSyncExternalStore } from "react";
import {
    ArrayType, BlobType, EastTypeType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some,
    toEastTypeValue, type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { EditingPlacementType } from "@elaraai/east-ui/internal";
import { kept, keptBytes, type KeptFailureReason } from "../platform/kept.js";
import type { EditSession, KeptEntry } from "./session.js";

/** One drafted entry as the tab keeps it: each value beast2 at its own type. */
const KeptEntryType = StructType({
    id: StringType,
    was: OptionType(BlobType),
    draft: OptionType(BlobType),
    wire: OptionType(BlobType),
    beforeWire: OptionType(BlobType),
    place: OptionType(EditingPlacementType),
    beforePlace: OptionType(EditingPlacementType),
});

/** A session's drafts as the tab keeps them: the schemas they were made under, and each drafted entry. */
export const KeptDraftsType = StructType({
    entryType: EastTypeType,
    draftType: EastTypeType,
    wireType: EastTypeType,
    entries: ArrayType(KeptEntryType),
});

type KeptEntryValue = ValueTypeOf<typeof KeptEntryType>;

const encodeDrafts = encodeBeast2For(KeptDraftsType);
const decodeDrafts = decodeBeast2For(KeptDraftsType);
const sameType = equalFor(EastTypeType);
const sameText = equalFor(StringType);

/** How a session's drafts are kept through a reload. */
export type DraftsKeeping =
    /** Kept, or nothing to keep. */
    | { readonly state: "kept" }
    /** Storage refused the drafts' last write: a reload would lose them. */
    | { readonly state: "unkept"; readonly reason: KeptFailureReason }
    /** What the tab kept could not be restored: drafts of another schema, or bytes this version does not read. */
    | { readonly state: "lost"; readonly reason: "schema" | "unreadable" };

const KEPT: DraftsKeeping = { state: "kept" };

/** A session's keeping, and who hears it. */
interface Keeping {
    state: DraftsKeeping;
    readonly listeners: Set<() => void>;
    readonly subscribe: (listener: () => void) => () => void;
}

const keepings = new WeakMap<object, Keeping>();

function keepingOf(session: object): Keeping {
    let keeping = keepings.get(session);
    if (keeping === undefined) {
        const listeners = new Set<() => void>();
        keeping = { state: KEPT, listeners, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
        keepings.set(session, keeping);
    }
    return keeping;
}

function setKeeping(session: object, next: DraftsKeeping): void {
    const keeping = keepingOf(session);
    const was = keeping.state;
    if (was.state === "kept" ? next.state === "kept" : next.state !== "kept" && was.state === next.state && was.reason === next.reason) return;
    keeping.state = next;
    for (const listener of [...keeping.listeners]) listener();
}

/**
 * How a session's drafts are kept through a reload, as it stands now.
 *
 * @param session - The session
 * @returns Its keeping
 */
export function draftsKeepingOf(session: object): DraftsKeeping {
    return keepingOf(session).state;
}

/**
 * How a session's drafts are kept through a reload: kept, or why not — what
 * its banners say ({@link SessionBanners}).
 *
 * @param session - The session
 * @returns Its keeping
 */
export function useDraftsKeeping(session: object): DraftsKeeping {
    const keeping = keepingOf(session);
    return useSyncExternalStore(keeping.subscribe, () => keeping.state, () => keeping.state);
}

/**
 * A session's key among what the tab keeps: its source and its view.
 *
 * @param sourceId - The source's identity
 * @param view - The view's key
 * @returns The key
 */
export function keptDraftsKey(sourceId: string, view: string): string {
    return `editing.drafts:${encodeURIComponent(sourceId)}:${encodeURIComponent(view)}`;
}

/** Whether two readings of a session's drafts hold the same versions: each value the same object, so nothing new to write. */
function sameEntries<W>(a: readonly KeptEntry<W>[], b: readonly KeptEntry<W>[]): boolean {
    if (a.length !== b.length) return false;
    const held = (x: option<unknown>, y: option<unknown>) => sameText(x.type, y.type) && (x.type === "none" || y.type === "none" || Object.is(x.value, y.value));
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!, y = b[i]!;
        if (!sameText(x.id, y.id) || !held(x.was, y.was) || !held(x.draft, y.draft) || !Object.is(x.wire, y.wire) || !Object.is(x.beforeWire, y.beforeWire)
            || !Object.is(x.place, y.place) || !Object.is(x.beforePlace, y.beforePlace)) return false;
    }
    return true;
}

/**
 * A value's bytes at its type, each object's encoded once: a draft written
 * again with the rest re-encodes nothing of its own.
 *
 * @param type - The values' type
 * @returns The encoder
 */
function cachedEncoder(type: EastType): (value: unknown) => Uint8Array {
    const encode = encodeBeast2For(toEastTypeValue(type)) as (value: unknown) => Uint8Array;
    const made = new WeakMap<object, Uint8Array>();
    return (value) => {
        if (typeof value !== "object" || value === null) return encode(value);
        let bytes = made.get(value);
        if (bytes === undefined) { bytes = encode(value); made.set(value, bytes); }
        return bytes;
    };
}

/**
 * Keep a session's drafts through a reload — see the module docs: what the
 * tab kept of them under the key is staged for the session's first base,
 * and they are written as each change is made, from now on.
 *
 * @typeParam W - The collection's projection of an entry
 * @param session - A session made now, before its first base
 * @param key - Its key among what the tab keeps ({@link keptDraftsKey})
 * @param wireType - The type of its collection's projection of an entry
 */
export function keepDrafts<W>(session: EditSession<W>, key: string, wireType: EastType): void {
    const handle = kept(key, keptBytes, { where: "tab" });
    const types = { entryType: toEastTypeValue(session.entryType), draftType: toEastTypeValue(session.draftType), wireType: toEastTypeValue(wireType) };
    const encodeDraft = cachedEncoder(session.draftType);
    const encodeWire = cachedEncoder(wireType);
    const decodeDraft = decodeBeast2For(types.draftType) as (bytes: Uint8Array) => unknown;
    const decodeWire = decodeBeast2For(types.wireType) as (bytes: Uint8Array) => W;
    const optionOf = <T>(blob: option<Uint8Array>, decode: (bytes: Uint8Array) => T): option<T> => (blob.type === "some" ? some(decode(blob.value)) : none);
    const blobOf = (value: option<unknown>): option<Uint8Array> => (value.type === "some" ? some(encodeDraft(value.value)) : none);
    const entryOf = (entry: KeptEntryValue): KeptEntry<W> => {
        const wire = optionOf(entry.wire, decodeWire);
        const beforeWire = optionOf(entry.beforeWire, decodeWire);
        return {
            id: entry.id, was: optionOf(entry.was, decodeDraft), draft: optionOf(entry.draft, decodeDraft),
            wire: wire.type === "some" ? wire.value : undefined, beforeWire: beforeWire.type === "some" ? beforeWire.value : undefined,
            place: entry.place, beforePlace: entry.beforePlace,
        };
    };
    const valueOf = (entry: KeptEntry<W>): KeptEntryValue => ({
        id: entry.id, was: blobOf(entry.was), draft: blobOf(entry.draft),
        wire: entry.wire === undefined ? none : some(encodeWire(entry.wire)),
        beforeWire: entry.beforeWire === undefined ? none : some(encodeWire(entry.beforeWire)),
        place: entry.place, beforePlace: entry.beforePlace,
    });

    // What the tab kept: restored at the session's first base, if it was made under these schemas and reads.
    const stored = handle.read();
    if (stored !== undefined) {
        let lost: "schema" | "unreadable" | undefined;
        try {
            const value = decodeDrafts(stored);
            if (!sameType(value.entryType, types.entryType) || !sameType(value.draftType, types.draftType) || !sameType(value.wireType, types.wireType)) lost = "schema";
            else session.restore(value.entries.map(entryOf));
        } catch {
            lost = "unreadable";
        }
        if (lost !== undefined) {
            handle.remove();
            setKeeping(session, { state: "lost", reason: lost });
        }
    }

    // Written as each change is made: the same versions as last written write nothing.
    let last: readonly KeptEntry<W>[] | undefined;
    session.subscribe(() => {
        const entries = session.keptEntries;
        if (last !== undefined && sameEntries(last, entries)) return;
        last = entries;
        if (entries.length === 0) {
            handle.remove();
            if (keepingOf(session).state.state === "unkept") setKeeping(session, KEPT);
            return;
        }
        handle.write(encodeDrafts({ ...types, entries: entries.map(valueOf) }));
        const failure = handle.failure();
        setKeeping(session, failure === undefined ? KEPT : { state: "unkept", reason: failure });
    });
}
