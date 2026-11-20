/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host's own session under the canvas's one history (#1673) — a page's
 * starting filters beside its tiles: the host's gestures and the canvas's are
 * steps of the history in the order they were made, which Undo and Redo walk
 * through the history item and the keys — from the host's band too; Save sends
 * each session's change as its own request, and so does an Apply a screen asks
 * for, answered once both read back; each session's banners stand, the host's
 * named; and the band the host draws over the grid stands between the
 * selection bar and the grid, its clicks and keys its own.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { SortedMap, StringType, StructType, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { liftDraft } from "../../editing/draft.js";
import { EditHistory } from "../../editing/history.js";
import { EditSession, type EntryVersion } from "../../editing/session.js";
import { clickTile, history, historyButton, key, mountSnapGrid, selectedTile, settle, spanOf, tileEl } from "./snap-grid-editing.test-utils.js";
import type { SnapGridEntryRef, SnapGridJoined } from "./use-snap-grid-editing.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

/** The host's entries: notes, keyed — one, `n-1`. */
const Note = StructType({ text: StringType });
const NoteDraft = Editing.Types.DraftField(Note);
type NoteValue = ValueTypeOf<typeof Note>;
type ApplyResult = ValueTypeOf<typeof Editing.Types.ApplyResult>;

const KEY_ORDER = some(variant("keyOrder", null));
/** The note's version, drafted whole. */
const version = (text: string): EntryVersion<SnapGridEntryRef> => ({ draft: liftDraft(NoteDraft, { text }), wire: { id: "n-1" }, place: KEY_ORDER });

/** A host: its session over its one note, read whole, its Saves counted and answered as given; and the history it keeps. */
function host(answer: ApplyResult = variant("applied", { revision: none })) {
    let sent = 0;
    const session = new EditSession<SnapGridEntryRef>({
        sourceId: "notes", entryType: Note, draftType: NoteDraft, keyType: StringType,
        apply: () => { sent += 1; return answer; }, patch: undefined, refresh: undefined,
    });
    /** The source's one note, as East holds a Dict. */
    const held = (text: string) => variant("snapshot", new SortedMap([["n-1", { text }] as [string, NoteValue]], compareFor(StringType)));
    session.observeBase(held("Draft"));
    const joined: SnapGridJoined = { history: new EditHistory<SnapGridEntryRef>(), sessions: [{ key: "notes", session, name: "Notes" }] };
    /** The note, as the host's session holds it now. */
    const text = (): string => {
        const entry = session.entries.get("n-1");
        return entry === undefined ? "Draft" : (entry.draft as { value: NoteValue }).value.text;
    };
    /** The band over the grid: its button writes the note, one gesture of the history. */
    const head = (
        <button type="button" data-testid="host-edit" onClick={(e) => {
            joined.history.record([{ key: "notes", updates: [{ id: "n-1", before: version("Draft"), after: version(`${text()}+`) }] }], "typed", "Edit note");
            e.currentTarget.blur();
        }}>Edit note</button>
    );
    /** The source reads back as its Save left it: the session confirms its commit. */
    const readBack = (saved: string) => act(() => { session.reconcile(held(saved), () => undefined); });
    return { joined, head, session, text, readBack, sent: () => sent };
}

/** Press the band's button, as a pointer does. */
async function editNote(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(c.querySelector<HTMLElement>("[data-testid=host-edit]")!); });
    await settle();
}

describe("a host's own session under the canvas's history (#1673)", () => {
    test("the host's gestures and the canvas's are steps of one history, in the order they were made: Undo takes them back through the history item and the keys, Redo replays them", async () => {
        const h = host();
        const canvas = await mountSnapGrid({ joined: h.joined, head: h.head });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await editNote(c);
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        expect([spanOf(c, "region"), h.text(), spanOf(c, "trend"), h.joined.history.pending]).toEqual([3, "Draft+", 7, 3]);
        // Back, a step at a time: the trend's, the note's, the region's.
        await history(canvas, "Undo");
        expect([spanOf(c, "region"), h.text(), spanOf(c, "trend")]).toEqual([3, "Draft+", 8]);
        await key(c, { key: "z", ctrlKey: true });
        expect([spanOf(c, "region"), h.text(), spanOf(c, "trend")]).toEqual([3, "Draft", 8]);
        await history(canvas, "Undo");
        expect([spanOf(c, "region"), h.text(), historyButton(canvas, "Undo").disabled]).toEqual([4, "Draft", true]);
        // And forward: the region's, the note's — from a key pressed in the band — the trend's.
        await history(canvas, "Redo");
        await act(async () => { fireEvent.keyDown(c.querySelector<HTMLElement>("[data-testid=host-edit]")!, { key: "y", ctrlKey: true }); });
        await settle();
        expect([spanOf(c, "region"), h.text(), spanOf(c, "trend")]).toEqual([3, "Draft+", 8]);
        await history(canvas, "Redo");
        expect([spanOf(c, "region"), h.text(), spanOf(c, "trend"), historyButton(canvas, "Redo").disabled]).toEqual([3, "Draft+", 7, true]);
        // Drafts, all of them: neither source took a write.
        expect([canvas.writes(), h.sent()]).toEqual([0, 0]);
    }, 30_000);

    test("Save sends each session's change as its own request, and Discard drops both", async () => {
        const h = host();
        const canvas = await mountSnapGrid({ joined: h.joined, head: h.head });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await editNote(c);
        await history(canvas, "Save");
        expect([canvas.applies.length, canvas.writes(), h.sent()]).toEqual([1, 1, 1]);
        expect(canvas.stored().find((t) => t.id === "region")!.span).toBe(3n);
        // Each reads back as its Save left it: nothing is still to confirm.
        await canvas.confirm();
        h.readBack("Draft+");
        await settle();
        expect([h.joined.history.status, h.joined.history.pending]).toEqual(["idle", 0]);
        // A later change of each, discarded together.
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        await editNote(c);
        await history(canvas, "Discard");
        expect([spanOf(c, "trend"), h.joined.history.pending, historyButton(canvas, "Undo").disabled]).toEqual([8, 0, true]);
    }, 30_000);

    test("an Apply a screen asks for (#998) sends each session's change, and is answered applied once both read back — never refused while the history is still sending them", async () => {
        const h = host();
        const canvas = await mountSnapGrid({ joined: h.joined, head: h.head, applies: true });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await editNote(c);
        await canvas.hostAsksApply("ask-1");
        // Both sent, each its own request; the screen's ask waits for them to read back.
        expect([canvas.applies.length, canvas.writes(), h.sent(), canvas.boundApply().type]).toEqual([1, 1, 1, "asked"]);
        await canvas.confirm();
        h.readBack("Draft+");
        await settle();
        expect(canvas.boundApply()).toEqual(variant("applied", "ask-1"));
        expect([h.joined.history.status, h.joined.history.pending]).toEqual(["idle", 0]);
    }, 30_000);

    test("each session's banners stand: the host's under its name, its refusal its own, the canvas's change saved past it", async () => {
        const h = host(variant("conflict", [{ entry: "n-1", row: none, field: none, message: "Changed since this edit began" }]));
        const canvas = await mountSnapGrid({ joined: h.joined, head: h.head });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await editNote(c);
        await history(canvas, "Save");
        expect([canvas.writes(), h.sent(), h.session.status]).toEqual([1, 1, "conflict"]);
        // After the banner's word, its title names the host's source.
        expect(c.querySelector<HTMLElement>("[data-session-banner=conflict]")?.textContent).toContain("Notes: Not saved — 1 conflict with newer changes");
        // The canvas's own banners say nothing: its change was saved.
        expect(c.querySelectorAll("[data-session-banner]")).toHaveLength(1);
    }, 30_000);

    test("the band over the grid stands between the selection bar and the grid; its clicks and keys are its own — the selected tile stays, and Delete removes nothing", async () => {
        const h = host();
        const canvas = await mountSnapGrid({ joined: h.joined, head: h.head });
        const c = canvas.container;
        expect([...c.querySelector("[data-snap-grid-main]")!.children].map((el) => el.hasAttribute("data-snap-grid-selection") ? "selection"
            : el.hasAttribute("data-snap-grid-head") ? "head" : el.querySelector("[data-snap-grid-canvas]") !== null ? "grid" : "?")).toEqual(["selection", "head", "grid"]);
        await clickTile(c, "region");
        await editNote(c);
        await act(async () => { fireEvent.keyDown(c.querySelector<HTMLElement>("[data-testid=host-edit]")!, { key: "Delete" }); });
        await settle();
        expect([selectedTile(c), tileEl(c, "region") !== null, h.text()]).toEqual(["region", true, "Draft+"]);
    }, 30_000);

    test("without a host's session the canvas's session is its history: its gestures its own", async () => {
        const canvas = await mountSnapGrid({ head: <span data-testid="band">Band</span> });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await history(canvas, "Undo");
        expect([spanOf(c, "region"), c.querySelector("[data-snap-grid-head] [data-testid=band]") !== null]).toEqual([4, true]);
    }, 30_000);
});
