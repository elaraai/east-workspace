/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One entry's three-way merge: what a session drafted, against what its source
 * holds now, both from the value they began from — East's own patch merge
 * (`detectConflictsFor`, `mergeWithResolutionsFor`), at the draft's type, so a
 * draft not yet complete merges as one that is.
 *
 * - Changes of different parts, or the same change on both sides, combine:
 *   the draft carried over is the source's value with every change of the
 *   draft's.
 * - A part both changed to different values is a conflict, at its patch path.
 *   The draft carried over keeps the draft's value there until someone
 *   chooses, and the entry keeps what both began from — the source's value,
 *   rewound at each conflict alone — so the conflicts read again from the
 *   three values are the same ones, and a later change of the source's to
 *   another part is no conflict.
 * - Taking the source's value at a conflict writes it into the draft; keeping
 *   the draft's moves what both began from to the source's value there.
 *   Either way that conflict reads no more.
 * - A conflict the draft comes to read no more by a gesture — the part changed
 *   by hand to the source's value — began from the source's value too, once
 *   the draft is carried over again (`began`).
 *
 * @packageDocumentation
 */
import {
    IntegerType, OptionType, StringType, applyFor, detectConflictsFor, diffFor, equalFor, mergeWithResolutionsFor, pathFromString,
    prunePatchFor, toEastTypeValue, type EastType, type PatchPath, type PatchPathSegment, type Resolution, type option,
} from "@elaraai/east";

/** What a conflict is: both sides changed a part of the entry; one side removed it while the other changed it; or both added it. */
export type ConflictKind = "changed" | "removed-by-source" | "removed-by-draft" | "added-by-both";

/** One conflict of an entry. */
export interface ConflictPoint {
    /** Where, as East's patch path: what a choice is keyed by. */
    readonly path: string;
    /** Where, as steps from the entry: the entry's own presence left out. */
    readonly at: PatchPath;
    /** What it is. */
    readonly kind: ConflictKind;
}

/** An entry's draft carried over to the value its source holds now. */
export interface MergedEntry {
    /** The draft carried over: the source's value with every change of the draft's — at a conflict, the draft's value until someone chooses. */
    readonly draft: option<unknown>;
    /** What both began from, where a change conflicts: the source's value, rewound at each conflict; `undefined` where none does. */
    readonly ancestor: option<unknown> | undefined;
    /** Each conflict, in the order East's merge meets them. */
    readonly points: readonly ConflictPoint[];
}

/** One step from an entry to a conflict, as a person reads it: the draft's own wrappers left out. */
export type ConflictStep =
    | { readonly kind: "field"; readonly name: string }
    | { readonly kind: "item"; readonly index: bigint }
    | { readonly kind: "key"; readonly key: string }
    | { readonly kind: "case"; readonly tag: string };

const KEEP_DRAFT: Resolution = { type: "keepA" };
const textEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** Whether two path steps name the same place. */
function sameSegment(a: PatchPathSegment, b: PatchPathSegment): boolean {
    switch (a.kind) {
        case "field": return b.kind === "field" && textEqual(a.name, b.name);
        case "index": return b.kind === "index" && integerEqual(a.index, b.index);
        case "key": return b.kind === "key" && textEqual(a.key, b.key);
        case "variant": return b.kind === "variant" && textEqual(a.tag, b.tag);
    }
}

/** Whether one path holds the other: a patch's part at or above a place, or below it. */
function related(a: PatchPath, b: PatchPath): boolean {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (!sameSegment(a[i]!, b[i]!)) return false;
    return true;
}

/**
 * Whether a type is a draft's own field: missing, a value, or text that could
 * not be read — a wrapper of the draft's, no step of the entry's.
 *
 * @param type - The type
 * @returns Whether it is a draft's field
 */
export function isDraftField(type: EastType): boolean {
    return type.type === "Variant" && Object.keys(type.cases).length === 3 && "missing" in type.cases && "value" in type.cases && "invalid" in type.cases;
}

/**
 * The three-way merge of one entry type's drafts — see the module docs.
 */
export class EntryMerger {
    private readonly diff: (before: option<unknown>, after: option<unknown>) => unknown;
    private readonly apply: (base: option<unknown>, patch: unknown) => option<unknown>;
    private readonly detect: (a: unknown, b: unknown) => readonly { path: string }[];
    private readonly mergeWith: (a: unknown, b: unknown, resolutions: Map<string, Resolution>) => unknown;
    private readonly prune: (patch: never, keep: (path: PatchPath) => boolean) => unknown;
    /** Whether two of the entry's draft values — each present or absent — are equal. */
    readonly equal: (a: option<unknown>, b: option<unknown>) => boolean;

    /**
     * @param draftType - The entry's draft type
     */
    constructor(draftType: EastType) {
        const type = toEastTypeValue(OptionType(draftType));
        this.diff = diffFor(type);
        this.apply = applyFor(type);
        this.detect = detectConflictsFor(type);
        this.mergeWith = mergeWithResolutionsFor(type);
        this.prune = prunePatchFor(type) as unknown as EntryMerger["prune"];
        this.equal = equalFor(type);
    }

    /**
     * Carry an entry's draft over to the value its source holds now.
     *
     * @param was - The value both began from
     * @param draft - The draft
     * @param source - The value the source holds now
     * @param joined - The places that go with a conflict's, by its place — the fields a move writes with an item's times.
     *   While the conflict waits, the draft's own value stands at each, as at the conflict, and what both began from is
     *   put back there with it: one side's whole, never one side's times with the other's shift.
     * @returns The draft carried over, what both began from where a change conflicts, and each conflict
     */
    merge(was: option<unknown>, draft: option<unknown>, source: option<unknown>, joined?: (at: PatchPath) => readonly PatchPath[]): MergedEntry {
        const ours = this.diff(was, draft);
        const theirs = this.diff(was, source);
        const found = this.detect(ours, theirs);
        const keep = new Map(found.map((conflict) => [conflict.path, KEEP_DRAFT] as const));
        const carried = this.apply(was, this.mergeWith(ours, theirs, keep));
        if (found.length === 0) return { draft: carried, ancestor: undefined, points: [] };
        const at = found.map((conflict) => pathFromString(conflict.path));
        const along = joined === undefined ? [] : at.flatMap((place) => joined(place));
        // The source's value, put back at each conflict, and at each place that goes with one, to what both began from.
        const back = this.prune(this.diff(source, was) as never, (leaf) => [...at, ...along].some((place) => related(leaf, place)));
        return {
            draft: along.length === 0 ? carried : this.takeSourceAt(carried, draft, along),
            ancestor: this.apply(source, back),
            points: found.map((conflict, i) => pointOf(conflict.path, at[i]!, was, draft, source)),
        };
    }

    /**
     * What both began from, as the three values read now: the source's value, put back to what both began from at each
     * conflict they still read, and at each place that goes with one. A conflict the draft reads no more — changed by
     * hand to the source's value there, with no choice made — began from the source's value: carried over again, a
     * later change of the source's to that part is the source's to make, and no conflict.
     *
     * @param was - What both began from, as a carry-over kept it
     * @param draft - The draft
     * @param source - The value its source holds
     * @param joined - The places that go with a conflict's, by its place
     * @returns What both began from
     */
    began(was: option<unknown>, draft: option<unknown>, source: option<unknown>, joined?: (at: PatchPath) => readonly PatchPath[]): option<unknown> {
        const found = this.detect(this.diff(was, draft), this.diff(was, source));
        if (found.length === 0) return source;
        const at = found.map((conflict) => pathFromString(conflict.path));
        const along = joined === undefined ? [] : at.flatMap((place) => joined(place));
        return this.apply(source, this.prune(this.diff(source, was) as never, (leaf) => [...at, ...along].some((place) => related(leaf, place))));
    }

    /**
     * What an entry's draft and its source's value both began from, where a request that changed the entry may or may
     * not have landed: it was sent, no answer came, and sent again it was refused — which says nothing of the first
     * sending, since a source answers a request again only while it remembers it (e3: a record's last sixteen keyed requests).
     *
     * Each part the request changed is judged by what the source holds there:
     * - as the request left it: the request's doing, or another write's to the same end — it began from what was sent,
     *   so a draft made since is a change from that;
     * - as the edit began: the request did not land there, or was put back — it began from that;
     * - neither, another write's value: it began from whichever makes the draft's difference from the source a
     *   conflict to choose. A draft still as it was sent began as its edit did, an unsaved change against another's;
     *   one changed since at that part, or at one that holds it, began from what was sent, a change since against
     *   another's. Taken the other way, either would be given up for the source's value with nothing asked: an
     *   unsaved change lost where the request never landed, an Undo of a saved one where it had. A part the request
     *   set whole — a new entry, a removal — that the draft has changed only within began as its edit did: the two
     *   are then two entries under one key, or an entry removed by one and changed by the other, a conflict of the
     *   whole, never one entry whose parts are merged.
     *
     * @param before - The entry as its edit began
     * @param sent - The entry as the request left it
     * @param draft - The draft
     * @param source - The value its source holds now
     * @returns What both began from
     */
    eitherBegan(before: option<unknown>, sent: option<unknown>, draft: option<unknown>, source: option<unknown>): option<unknown> {
        const leaves = (patch: unknown): PatchPath[] => {
            const out: PatchPath[] = [];
            this.prune(patch as never, (leaf) => { out.push(leaf); return true; });
            return out;
        };
        const offSent = leaves(this.diff(sent, source));
        const offBefore = leaves(this.diff(before, source));
        const drafted = leaves(this.diff(sent, draft));
        const at = (places: readonly PatchPath[], leaf: PatchPath): boolean => places.some((place) => related(leaf, place));
        // Changed since at the part itself, or at one that holds it: a change within the part alone is no change of it.
        const over = (places: readonly PatchPath[], leaf: PatchPath): boolean => places.some((place) => place.length <= leaf.length && related(leaf, place));
        return this.apply(before, this.prune(this.diff(before, sent) as never, (leaf) => !at(offSent, leaf) || (at(offBefore, leaf) && over(drafted, leaf))));
    }

    /**
     * An entry's conflicts, read from its three values.
     *
     * @param was - What both began from
     * @param draft - The draft
     * @param source - The value its source holds
     * @returns Each conflict
     */
    conflicts(was: option<unknown>, draft: option<unknown>, source: option<unknown>): ConflictPoint[] {
        return this.detect(this.diff(was, draft), this.diff(was, source))
            .map((conflict) => pointOf(conflict.path, pathFromString(conflict.path), was, draft, source));
    }

    /**
     * The draft with the source's value taken at a conflict.
     *
     * @param draft - The draft
     * @param source - The value its source holds
     * @param path - The conflict's patch path
     * @returns The draft
     */
    takeSource(draft: option<unknown>, source: option<unknown>, path: string): option<unknown> {
        return this.takeSourceAt(draft, source, [pathFromString(path)]);
    }

    /**
     * The draft with the source's value taken at each of some places: a
     * conflict's, and those that go with it.
     *
     * @param draft - The draft
     * @param source - The value its source holds
     * @param places - The places
     * @returns The draft
     */
    takeSourceAt(draft: option<unknown>, source: option<unknown>, places: readonly PatchPath[]): option<unknown> {
        return this.apply(draft, this.prune(this.diff(draft, source) as never, (leaf) => places.some((place) => related(leaf, place))));
    }

    /**
     * What both began from, moved to the source's value at a conflict: the
     * draft's value kept there, as a change of the source's.
     *
     * @param was - What both began from
     * @param source - The value its source holds
     * @param path - The conflict's patch path
     * @returns What both began from
     */
    keepDraft(was: option<unknown>, source: option<unknown>, path: string): option<unknown> {
        return this.keepDraftAt(was, source, [pathFromString(path)]);
    }

    /**
     * What both began from, moved to the source's value at each of some
     * places: a conflict's, and those that go with it.
     *
     * @param was - What both began from
     * @param source - The value its source holds
     * @param places - The places
     * @returns What both began from
     */
    keepDraftAt(was: option<unknown>, source: option<unknown>, places: readonly PatchPath[]): option<unknown> {
        return this.apply(was, this.prune(this.diff(was, source) as never, (leaf) => places.some((place) => related(leaf, place))));
    }
}

/** A conflict, read: what it is, and its steps from the entry. */
function pointOf(path: string, segments: PatchPath, was: option<unknown>, draft: option<unknown>, source: option<unknown>): ConflictPoint {
    // A conflict at the entry itself is about whether it is there.
    let kind: ConflictKind = "changed";
    if (segments.length === 0) {
        if (was.type === "none") kind = "added-by-both";
        else if (draft.type === "none") kind = "removed-by-draft";
        else if (source.type === "none") kind = "removed-by-source";
    }
    const first = segments[0];
    const at = first !== undefined && first.kind === "variant" && textEqual(first.tag, "some") ? segments.slice(1) : segments;
    return { path, at, kind };
}

/**
 * A conflict's steps from its entry, as a person reads them: each field, list
 * item, key and choice it is under, the draft's own field wrappers (missing,
 * a value, text that could not be read) left out.
 *
 * @param draftType - The entry's draft type
 * @param at - The conflict's steps ({@link ConflictPoint.at})
 * @returns The steps
 */
export function conflictSteps(draftType: EastType, at: PatchPath): ConflictStep[] {
    const steps: ConflictStep[] = [];
    let type: EastType | undefined = draftType;
    for (const segment of at) {
        switch (segment.kind) {
            case "field":
                steps.push({ kind: "field", name: segment.name });
                type = type?.type === "Struct" ? type.fields[segment.name] : undefined;
                break;
            case "index":
                steps.push({ kind: "item", index: segment.index });
                type = type?.type === "Array" ? type.value : undefined;
                break;
            case "key":
                steps.push({ kind: "key", key: segment.key });
                type = type?.type === "Dict" ? type.value : undefined;
                break;
            case "variant":
                // The draft's own field, or an option's value: no step of the entry's.
                if (type !== undefined && (isDraftField(type) || (type.type === "Variant" && Object.keys(type.cases).length === 2 && "none" in type.cases && "some" in type.cases))) {
                    type = type.type === "Variant" ? type.cases[segment.tag] : undefined;
                    break;
                }
                steps.push({ kind: "case", tag: segment.tag });
                type = type?.type === "Variant" ? type.cases[segment.tag] : undefined;
                break;
        }
    }
    return steps;
}
