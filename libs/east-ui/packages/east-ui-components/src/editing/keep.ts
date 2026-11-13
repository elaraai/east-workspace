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
 * it closes, and at a sign-out with everything kept. They are kept by the data
 * set the host names (`EditingScope`), their source and their view, so another
 * data set's source of the same name never takes them. A session keeps its
 * drafts where its collection says how its projection is written
 * (`wireType`); one whose drafts storage refuses, or whose kept drafts cannot
 * be restored, says so ({@link useDraftsKeeping}). The history is not kept:
 * it starts at the restored drafts, as after any carry-over. Whether an
 * optimiser's result among them waited for a person's Save is kept beside them,
 * and whether they stood where Undo or Redo had left them, so no automatic Save
 * sends restored drafts that waited for a person's (`autosave.ts`). So are the
 * keys the session made for the new entries among them (`EditSession.ownKeys`,
 * keys.ts): a new entry whose key another write takes while the page is away
 * is given another, as it would have been before the reload. And so is a
 * request whose outcome the session does not know — a Save on its way, or one
 * left with no answer — with what it changes and what it leaves
 * (`EditSession.keptRequest`): the page that loads puts the session back as it
 * stood and asks the source again, so what was drafted since the request was
 * sent is still a change from what it leaves, whatever the request came to.
 * Forgotten, a row put back by Undo since was no draft to keep and was gone
 * with the page, and a change the request had saved came back as unsaved.
 *
 * @packageDocumentation
 */
import { useSyncExternalStore } from "react";
import {
    ArrayType, BlobType, BooleanType, DictType, EastTypeType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    none, some, toEastTypeValue, type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { EditingPlacementType } from "@elaraai/east-ui/internal";
import { kept, keptBytes, keptFlag, type KeptFailureReason } from "../platform/kept.js";
import type { EditSession, EntryVersion, KeptEntry, KeptRequest } from "./session.js";

/**
 * The type of a collection's projection of an entry that is only the entry's
 * id — a ref: what a collection that draws its drafts from its source's rows
 * keeps its drafts with (`wireType`).
 */
export const EntryRefType = StructType({ id: StringType });

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

/**
 * The keys a session made for the new entries among its drafts, as the tab
 * keeps them beside the drafts: each with the id it was made from. Under a key
 * of their own, so the drafts' bytes stay as every version that kept them
 * wrote them.
 */
const KeptOwnKeysType = DictType(StringType, OptionType(StringType));

/** An entry's version as the tab keeps it beside a request: its draft and the collection's projection of it, each beast2 at its own type, and where it stands. */
const KeptVersionType = StructType({ draft: OptionType(BlobType), wire: OptionType(BlobType), place: OptionType(EditingPlacementType) });

/**
 * A request whose outcome its session does not know, as the tab keeps it
 * beside the drafts, under a key of its own — the drafts' bytes stay as every
 * version that kept them wrote them: the schemas it was made under, the batch
 * as it was sent, each entry it changes as its edit began and as the request
 * leaves it, the keys the session made among them, whether an automatic Save
 * sent it, and whether it has been sent again and refused since
 * (`EditSession.keptRequest`).
 */
export const KeptRequestType = StructType({
    entryType: EastTypeType,
    draftType: EastTypeType,
    wireType: EastTypeType,
    payload: BlobType,
    automatic: BooleanType,
    refused: BooleanType,
    targets: ArrayType(StructType({ id: StringType, before: KeptVersionType, after: KeptVersionType })),
    minted: KeptOwnKeysType,
});

type KeptVersionValue = ValueTypeOf<typeof KeptVersionType>;

const encodeRequest = encodeBeast2For(KeptRequestType);
const decodeRequest = decodeBeast2For(KeptRequestType);
const encodeDrafts = encodeBeast2For(KeptDraftsType);
const decodeDrafts = decodeBeast2For(KeptDraftsType);
const encodeOwnKeys = encodeBeast2For(KeptOwnKeysType);
const decodeOwnKeys = decodeBeast2For(KeptOwnKeysType);
const sameOwnKeys = equalFor(KeptOwnKeysType);
const compareText = compareFor(StringType);
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
 * A session's key among what the tab keeps: its data set, its source and its
 * view — another data set's source of the same name keeps its own.
 *
 * @param scope - The data set, as its host names it (the host's `EditingScope`); empty where it names none
 * @param sourceId - The source's identity
 * @param view - The view's key
 * @returns The key
 */
export function keptDraftsKey(scope: string, sourceId: string, view: string): string {
    return `editing.drafts:${encodeURIComponent(scope)}:${encodeURIComponent(sourceId)}:${encodeURIComponent(view)}`;
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
    // Beside the drafts, under a key of its own — their own bytes are read by every version that kept them: whether an
    // optimiser's result among them waited for a person's Save.
    const waiting = kept(`${key}:held`, keptFlag, { where: "tab" });
    // And whether they stood where Undo or Redo had left them, which no automatic Save sends either.
    const stepped = kept(`${key}:stepped`, keptFlag, { where: "tab" });
    // And the keys the session made for the new entries among them: its own to make again where another write takes one.
    const made = kept(`${key}:made`, keptBytes, { where: "tab" });
    // And a request whose outcome the session does not know: the page that loads asks the source again.
    const asking = kept(`${key}:request`, keptBytes, { where: "tab" });
    const ownKeysOf = (keys: ReadonlyMap<string, string | undefined>): ValueTypeOf<typeof KeptOwnKeysType> =>
        new SortedMap([...keys].map(([id, from]) => [id, from === undefined ? none : some(from)] as const), compareText);
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

    const versionOf = (version: KeptVersionValue): EntryVersion<W> => {
        const wire = optionOf(version.wire, decodeWire);
        return { draft: version.draft.type === "some" ? decodeDraft(version.draft.value) : undefined, wire: wire.type === "some" ? wire.value : undefined, place: version.place };
    };
    const versionValueOf = (version: EntryVersion<W>): KeptVersionValue => ({
        draft: version.draft === undefined ? none : some(encodeDraft(version.draft)),
        wire: version.wire === undefined ? none : some(encodeWire(version.wire)),
        place: version.place,
    });
    // The request the tab kept, read before the drafts are restored: made under other schemas, or bytes this version
    // does not read, it is forgotten — the drafts are then carried over as they are where no request was kept.
    let request: KeptRequest<W> | undefined;
    const asked = asking.read();
    if (asked !== undefined) {
        try {
            const value = decodeRequest(asked);
            if (sameType(value.entryType, types.entryType) && sameType(value.draftType, types.draftType) && sameType(value.wireType, types.wireType)) {
                request = {
                    payload: value.payload, automatic: value.automatic, asked: value.refused ? "refused" : "unanswered",
                    targets: value.targets.map((target) => ({ id: target.id, before: versionOf(target.before), after: versionOf(target.after) })),
                    minted: new Map([...value.minted].map(([id, from]) => [id, from.type === "some" ? from.value : undefined] as const)),
                };
            }
        } catch {
            request = undefined;
        }
        if (request === undefined) asking.remove();
    }

    // What the tab kept: restored at the session's first base, if it was made under these schemas and reads.
    const stored = handle.read();
    if (stored !== undefined) {
        let lost: "schema" | "unreadable" | undefined;
        try {
            const value = decodeDrafts(stored);
            if (!sameType(value.entryType, types.entryType) || !sameType(value.draftType, types.draftType) || !sameType(value.wireType, types.wireType)) lost = "schema";
            else if (session.restore(value.entries.map(entryOf), waiting.read() === true, stepped.read() === true)) {
                // The keys it made, where the tab kept any: bytes that do not read leave the drafts restored, their new
                // entries under keys the session no longer knows as its own — a conflict to choose where one is taken.
                const own = made.read();
                try {
                    if (own !== undefined) session.restoreOwnKeys(new Map([...decodeOwnKeys(own)].map(([id, from]) => [id, from.type === "some" ? from.value : undefined] as const)));
                } catch {
                    made.remove();
                }
            }
        } catch {
            lost = "unreadable";
        }
        if (lost !== undefined) {
            handle.remove();
            waiting.remove();
            stepped.remove();
            made.remove();
            asking.remove();
            request = undefined;
            setKeeping(session, { state: "lost", reason: lost });
        }
    } else {
        waiting.remove();
        stepped.remove();
        made.remove();
    }
    // With the drafts kept beside it, or with none: every draft made since may have been taken back.
    if (request !== undefined) session.restoreRequest(request);

    // Written as each change is made: the same versions as last written write nothing.
    let last: readonly KeptEntry<W>[] | undefined;
    let lastOwn: ValueTypeOf<typeof KeptOwnKeysType> | undefined;
    let lastRequest: KeptRequest<W> | undefined;
    // Whether the tab holds a request: the one it kept as the page loaded, until the session has resolved it, or one written since.
    let asks = request !== undefined;
    // Why the request's last write was refused, while it was: a reload would lose it, whatever the drafts' own write did.
    let unasked: KeptFailureReason | undefined;
    session.subscribe(() => {
        // The request first, kept while its outcome is not known and gone once it is: the same request writes nothing.
        const out = session.keptRequest;
        if (out === undefined) {
            if (asks) asking.remove();
            asks = false; lastRequest = undefined; unasked = undefined;
        } else if (!Object.is(out, lastRequest)) {
            lastRequest = out; asks = true;
            asking.write(encodeRequest({
                ...types, payload: out.payload, automatic: out.automatic, refused: out.asked === "refused", minted: ownKeysOf(out.minted),
                targets: out.targets.map((target) => ({ id: target.id, before: versionValueOf(target.before), after: versionValueOf(target.after) })),
            }));
            unasked = asking.failure();
        }
        const entries = session.keptEntries;
        // Kept with the drafts, and gone with them: the keys of the new entries among them that the session made.
        const own = entries.length === 0 ? undefined : ownKeysOf(session.ownKeys);
        if (own === undefined || own.size === 0) {
            made.remove();
            lastOwn = undefined;
        } else if (lastOwn === undefined || !sameOwnKeys(lastOwn, own)) {
            made.write(encodeOwnKeys(own));
            lastOwn = own;
        }
        // Kept with the drafts, and gone with them: a person's Save, or an Undo of the result, ends the wait with no draft moving.
        if (entries.length > 0 && session.autosaveHeld) waiting.write(true);
        else waiting.remove();
        // A step back, too: a person's Save of it, a Redo back to where the last change left the steps, or the next change ends it.
        if (entries.length > 0 && session.autosaveStepped) stepped.write(true);
        else stepped.remove();
        if (last !== undefined && sameEntries(last, entries)) {
            if (unasked !== undefined) setKeeping(session, { state: "unkept", reason: unasked });
            return;
        }
        last = entries;
        if (entries.length === 0) {
            handle.remove();
            if (unasked !== undefined) setKeeping(session, { state: "unkept", reason: unasked });
            else if (keepingOf(session).state.state === "unkept") setKeeping(session, KEPT);
            return;
        }
        handle.write(encodeDrafts({ ...types, entries: entries.map(valueOf) }));
        const failure = handle.failure() ?? unasked;
        setKeeping(session, failure === undefined ? KEPT : { state: "unkept", reason: failure });
    });
}
