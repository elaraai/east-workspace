/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The editing session is every collection's (#879): it carries whatever
 * projection a collection draws an entry with — here a bar, not a sheet's
 * wire row — and records the collections' own gestures under their origins.
 */

import { expect, test } from "vitest";
import { IntegerType, StringType, StructType, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type Origin, type Placement } from "./session.js";

const Run = StructType({ id: StringType, start: IntegerType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const Event = Editing.Types.PatchEvent(Run);
const Batch = Editing.Types.ChangeSet(Run);
/** A collection's own projection of an entry — a bar on a canvas. */
interface Bar { key: string; caption: string }
type RunValue = ValueTypeOf<typeof Run>;
const a: RunValue = { id: "a", start: 1n, end: 3n };
const start = some(variant("ordered", variant("start", null)));
const version = (run: RunValue): EntryVersion<Bar> => ({
    draft: liftDraft(Draft, run), wire: { key: run.id, caption: `${run.start}–${run.end}` }, place: start,
});
const create = (overrides: Partial<EditSessionBinding<Bar>> = {}) => {
    const session = new EditSession<Bar>({
        sourceId: "bars", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined, ...overrides,
    });
    session.observeBase(variant("snapshot", [a]));
    return session;
};

test("an entry version carries the collection's own projection through a gesture, its undo and its redo", () => {
    const session = create();
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–5" });
    session.undo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–3" });
    session.redo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–5" });
    expect(session.originals.get("a")!.wire).toEqual({ key: "a", caption: "1–3" });
});

test("the collections' own gestures — a resize, a drop, a verdict — are reported as the gesture that made them", async () => {
    const events: ValueTypeOf<typeof Event>[] = [];
    const session = create({ patch: (bytes) => events.push(decodeBeast2For(Event)(bytes)) });
    const gestures: [Origin, bigint][] = [["resize", 5n], ["drop", 6n], ["verdict", 7n]];
    let current = a;
    for (const [origin, end] of gestures) {
        const next = { ...current, end };
        session.record([{ id: "a", before: version(current), after: version(next) }], origin, `Set end ${end}`);
        current = next;
    }
    await Promise.resolve();
    expect(events.map((e) => e.origin.type)).toEqual(["resize", "drop", "verdict"]);
    expect(events.every((e) => e.domainChanges.type === "some")).toBe(true);
});

test("an Array batch places anchors first, so Apply leaves the drafted order whichever entry was touched first", async () => {
    const Tile = StructType({ id: StringType });
    const TileDraft = Editing.Types.Draft(Tile);
    const TileBatch = Editing.Types.ChangeSet(Tile);
    const at = (id: string, place: Placement): EntryVersion<Bar> => ({ draft: liftDraft(TileDraft, { id }), wire: { key: id, caption: id }, place });
    const batches: ValueTypeOf<typeof TileBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "tiles", entryType: Tile, draftType: TileDraft, idField: "id", auto: false, patch: undefined, refresh: undefined,
        apply: (bytes) => { batches.push(decodeBeast2For(TileBatch)(bytes)); return variant("applied", { revision: none }); },
    });
    session.observeBase(variant("snapshot", [{ id: "p" }, { id: "a" }, { id: "b" }, { id: "q" }]));
    // q moves beside a: p a q b.
    session.record([{ id: "q", before: at("q", some(variant("ordered", variant("after", "b")))), after: at("q", some(variant("ordered", variant("after", "a")))) }], "move", "Move q");
    // p moves beside a too: a p q b — q now stands after p, and says so.
    session.record([
        { id: "p", before: at("p", some(variant("ordered", variant("before", "a")))), after: at("p", some(variant("ordered", variant("after", "a")))) },
        { id: "q", before: at("q", some(variant("ordered", variant("after", "a")))), after: at("q", some(variant("ordered", variant("after", "p")))) },
    ], "move", "Move p");
    expect(session.applied()).toEqual([{ id: "a" }, { id: "p" }, { id: "q" }, { id: "b" }]);
    await session.apply();
    // q was touched first, but it is anchored on p: p is placed before it.
    expect(batches[0]!.changes.map((c) => c.id)).toEqual(["p", "q"]);
});

test("Apply sends the domain change alone — never the projection — and the source's snapshot acknowledges it", async () => {
    const batches: ValueTypeOf<typeof Batch>[] = [];
    const session = create({ apply: (bytes) => { batches.push(decodeBeast2For(Batch)(bytes)); return variant("applied", { revision: none }); } });
    session.record([{ id: "a", before: version(a), after: version({ ...a, start: 2n }) }], "move", "Move a");
    expect(session.canApply).toBe(true);
    await session.apply();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.changes.map((c) => c.id)).toEqual(["a"]);
    expect(session.status).toBe("reconciling");
    expect(session.reconcile(variant("snapshot", [{ ...a, start: 2n }]), () => true)).toBe(true);
    expect(session.pending).toBe(0);
    expect(session.status).toBe("idle");
});
