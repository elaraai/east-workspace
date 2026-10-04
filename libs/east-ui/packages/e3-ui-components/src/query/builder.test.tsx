/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Query.Builder>`'s shell (#935), rendered over a saved queries record in
 * memory whose patch door applies each patch with East's own checks: the one
 * toolbar with the history item, the pane with its three tabs, the results and
 * the status line, and no border; the record read; the open query from the UI
 * store, or a new one on the first data source. And the open query's editing
 * session, through the history item (E1–E7): one gesture is one transaction,
 * undone, redone and discarded; Apply is one patch of one entry; readiness is
 * the check's; a stale save is a conflict; a new query is named on its first
 * Apply; opening another query and back keeps the drafts. Recent runs round
 * trip through the browser's storage.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { useCallback, useMemo } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, JqType, PatchType, SortedMap, checkJq, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Toolbar, getRegisteredPlatformImplementations, historyToolbarItem, system, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { Query, QueriesHandleType, queryKeys, recordBindPlatformFn } from "@elaraai/e3-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import { useRecentQueries } from "./hooks.js";
import { querySourceId, useOpenQuery, type QueryOpen } from "./open-query.js";
import {
    CUSTOMERS, HandleType, RECORD, ROOT, commits as committed, enabled, keys, mountBuilder, openQuery, press, readRecord as recordOf, recordHarness,
    savedQuery, settle, type RecordHarness, type Saved,
} from "./query.test-utils.js";
import { entriesQuery, queryEntries, savedOffers, type QueryEntry, type SavedQuery } from "./session.js";
import { newStep } from "./steps/edit.js";
import { layOutSteps } from "./steps/print.js";
import { useQuerySession, type QuerySessionState } from "./use-query-session.js";
import { useQueryEditingWords, useQueryWords } from "./words.js";

type TreePath = ValueTypeOf<typeof TreePathType>;

const BIG_ORDERS = savedQuery("Big orders", ".orders | map(select(.total >= 1000))");
const COUNT = savedQuery("Order count", ".orders | length");
const SAVED: Saved = new SortedMap([[BIG_ORDERS.name, BIG_ORDERS], [COUNT.name, COUNT]], keys);
const savedEqual = equalFor(Query.Types.SavedQuery);
const programEqual = equalFor(JqType);

let harness: RecordHarness;

beforeEach(() => {
    harness = recordHarness(SAVED);
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** The record as it stands — what its patch door last wrote. */
const readRecord = () => recordOf(harness);

/** The mutations the record committed, newest first. */
const commits = () => committed(harness);

// ─── The shell, through its carrier ─────────────────────────────────────────

describe("<Query.Builder> — the shell (#935)", () => {
    test("the one toolbar holds the history item; the result's strips under it; the pane its Query, Datasets and Library tabs; the results and the status line", async () => {
        const { container } = await mountBuilder();
        const builder = container.querySelector<HTMLElement>("[data-query-builder]")!;
        expect([...builder.querySelector("[data-frame-slot=toolbar]")!.querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item")))
            .toEqual(["history", "copy", "save", "run"]);
        expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Query", "Datasets", "Library"]);
        expect(screen.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");
        expect(builder.querySelector("[data-query-results]")).not.toBeNull();
        expect(builder.querySelector("[data-query-status]")).not.toBeNull();
        // Laid out by the builder frame (#1125): the toolbar; the result's strips as its banners; the pane and the
        // results across its body, the results its main; and the status line as its footer.
        const frame = builder.querySelector<HTMLElement>("[data-builder-frame]")!;
        const region = (name: string) => frame.querySelector<HTMLElement>(`:scope > [data-frame-slot="${name}"]`)!;
        expect([...frame.children].map(el => el.getAttribute("data-frame-slot"))).toEqual(["toolbar", "banners", "body", "footer"]);
        expect([...region("body").children].map(el => el.getAttribute("data-frame-slot"))).toEqual(["start", "main"]);
        expect([
            region("banners").firstElementChild!.hasAttribute("data-query-strips"),
            region("body").querySelector(':scope > [data-frame-slot="main"]')!.firstElementChild!.hasAttribute("data-query-results"),
            region("footer").firstElementChild!.hasAttribute("data-query-status"),
        ]).toEqual([true, true, true]);
    }, 30_000);

    test("it draws no border around itself: its recipe's root has none, so a host frames it or places it bare", () => {
        const recipe = system.getSlotRecipe("queryBuilder") as { base: { root: Record<string, unknown> } };
        expect(Object.keys(recipe.base.root).filter(k => /^border/i.test(k) || /^(outline|boxShadow)$/.test(k))).toEqual([]);
    });

    test("it opens a new query on the first data source, and a saved query the query library opens, from the record it reads", async () => {
        const { container } = await mountBuilder();
        const builder = () => container.querySelector<HTMLElement>("[data-query-builder]")!;
        expect(builder().getAttribute("data-query-open")).toBe(querySourceId(variant("new", { id: "first", source: "orders", from: none })));
        // The pane's rail counts the open query's steps.
        const rail = () => builder().querySelector<HTMLElement>("[data-collapsed] [title=Query]")!.textContent;
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Query" })); });
        await settle();
        expect(rail()).toBe("0Query");
        await openQuery(variant("saved", "Big orders"));
        expect(builder().getAttribute("data-query-open")).toBe(`query.saved:"Big orders"`);
        expect(rail()).toBe("1Query");
    }, 30_000);

    test("a saved query the record no longer holds says so, and a record that fails to read is a banner", async () => {
        const { container } = await mountBuilder();
        await openQuery(variant("saved", "Gone"));
        expect(screen.getByText("“Gone” isn't saved here")).toBeTruthy();
        expect(container.querySelector("[data-query-builder]")).toBeNull();
    }, 30_000);
});

// ─── The editing session, through the history item ──────────────────────────

/** The bound record, as the record runtime gives it. */
function boundRecord(): ValueTypeOf<typeof QueriesHandleType> {
    return East.compile(East.function([], HandleType, (_$) => recordBindPlatformFn([HandleType], RECORD)), getRegisteredPlatformImplementations())() as never;
}

/** A surface over the open query's session: the history item in its toolbar, and the session handed out. */
function SessionHarness({ onState }: { onState: (state: QuerySessionState) => void }) {
    const handle = useMemo(() => boundRecord(), []);
    const words = useQueryWords();
    const editingWords = useQueryEditingWords();
    const read = useCallback(() => handle.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    const record = result.ok ? result.value : undefined;
    const first = useMemo((): QueryOpen => variant("new", { id: "first", source: "orders", from: none }), []);
    const [open, writeOpen] = useOpenQuery(queryKeys(undefined).query, first);
    const state = useQuerySession({ handle, record, root: ROOT, open, writeOpen, storageKey: "session-test", words });
    onState(state);
    return (
        <div data-open={querySourceId(open)} data-naming={state.naming ? "" : undefined}>
            <Toolbar items={[historyToolbarItem({ session: state.session, words: editingWords, editing: false, onIssue: () => {}, onAction: state.onAction })]} />
        </div>
    );
}

/** Mount the harness, and hand back the session as it stands after each render. */
async function mountSession() {
    let latest: QuerySessionState | undefined;
    const utils = render(
        <ChakraProvider value={system}>
            <SessionHarness onState={(state) => { latest = state; }} />
        </ChakraProvider>,
    );
    await settle();
    return { ...utils, state: () => latest! };
}

/** The open query's steps as they stand, with a step added at the end — a gesture's entries. */
function withStep(state: QuerySessionState, kind: "limit" | "filter" | "count"): QueryEntry[] {
    const { header, query } = entriesQuery(state.entries!);
    const before = layOutSteps(query, ROOT.type).final;
    return queryEntries(header, [...query.steps, newStep(kind, before, ROOT.type)]);
}

/** One gesture, as a surface records it. */
async function gesture(state: () => QuerySessionState, next: QueryEntry[], label: string) {
    let recorded = false;
    await act(async () => { recorded = state().gesture(next, "insert", label); });
    await settle();
    return recorded;
}

describe("<Query.Builder> — the editing session (#935)", () => {
    test("E1, E2: one gesture is one transaction — the history item undoes, redoes and discards it", async () => {
        const { state } = await mountSession();
        await openQuery(variant("saved", "Big orders"));
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter"]);
        expect(await gesture(state, withStep(state(), "limit"), "Keep the first")).toBe(true);
        expect(state().session.pending).toBe(1);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter", "limit"]);
        await press("Undo");
        expect(state().session.pending).toBe(0);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter"]);
        await press("Redo");
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter", "limit"]);
        await press("Discard");
        expect(state().session.pending).toBe(0);
        expect(enabled("Undo")).toBe(false);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter"]);
    }, 30_000);

    test("E3: Apply — the builder's Save — is one patch of the open query's entry, and its session takes the save as its own", async () => {
        const { state } = await mountSession();
        await openQuery(variant("saved", "Big orders"));
        await gesture(state, withStep(state(), "limit"), "Keep the first");
        expect(enabled("Save")).toBe(true);
        await press("Save");
        expect(await commits()).toEqual(["patch", "$init"]);
        const saved = readRecord();
        // The program of the steps as saved: the filter, then Keep the first's `.[:10]`.
        expect(programEqual(checkJq(".orders | map(select(.total >= 1000))\n| .[:10]", ROOT.type, { root: true }).program!, saved.get("Big orders")!.program)).toBe(true);
        expect(savedEqual(saved.get("Order count")!, COUNT)).toBe(true);
        // The session acknowledged its own request: nothing pending, nothing stale, the steps as saved.
        expect([state().session.status, state().session.pending, state().session.stale]).toEqual(["idle", 0, false]);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter", "limit"]);
    }, 30_000);

    test("E4: readiness is the check's — an unfinished step keeps Save off, and says so; a finished one lets it go", async () => {
        const { state } = await mountSession();
        await openQuery(variant("saved", "Big orders"));
        await gesture(state, withStep(state(), "filter"), "Keep rows where");
        expect(state().session.readiness.type).toBe("incomplete");
        expect(enabled("Save")).toBe(false);
        expect(screen.getByRole("button", { name: "1 issue" })).toBeTruthy();
        await press("Undo");
        expect(state().session.readiness.type).toBe("ready");
    }, 30_000);

    test("E5: a save another landed first is a conflict, and the other save stands", async () => {
        const { state, container } = await mountSession();
        await openQuery(variant("saved", "Big orders"));
        await gesture(state, withStep(state(), "limit"), "Keep the first");
        // Another operator's save of the query lands between this Apply's read and its commit.
        const other = { ...BIG_ORDERS, description: some("Orders of 1,000 or more."), saved_at: new Date(Date.UTC(2026, 9, 1, 8, 0)) };
        const patch = East.compile(Query.save, [])(SAVED, some("Big orders"), other);
        const forward = harness.memory.mutate.bind(harness.memory);
        let raced = false;
        harness.memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                await forward(ws, record, mutation, { args: [encodeBeast2For(PatchType(Query.Types.Saved))(patch)] });
            }
            return forward(ws, record, mutation, request);
        };
        await press("Save");
        expect(await commits()).toEqual(["patch", "$init"]);
        expect(savedEqual(readRecord().get("Big orders")!, other)).toBe(true);
        // The commit is refused, in the builder's words; and the session, reading the query back, finds it moved under its drafts.
        expect([state().session.status, state().session.stale]).toEqual(["conflict", true]);
        expect(state().session.issues.map(i => i.message)).toEqual([
            "Big orders changed since this edit began — last changed by memory. Discard your changes to see it, or save under another name.",
        ]);
        expect(container.querySelector("[data-slot=history]")!.textContent).toContain("Source changed — review or discard these drafts");
        expect(enabled("Save")).toBe(false);
    }, 30_000);

    test("E6: a query never saved is named on its first Apply, rather than saved", async () => {
        const { state, container } = await mountSession();
        expect(container.querySelector("[data-open]")!.getAttribute("data-open")).toBe(`query.new:"first"`);
        await gesture(state, withStep(state(), "limit"), "Keep the first");
        expect(enabled("Save")).toBe(true);
        await press("Save");
        expect(container.querySelector("[data-naming]")).not.toBeNull();
        expect(await commits()).toEqual(["$init"]);
    }, 30_000);

    test("E6: a new query saved under its name opens as that saved query, once its session has taken the save", async () => {
        const { state, container } = await mountSession();
        // The save popover (#936) names the query — one gesture — and applies it.
        const { header, query } = entriesQuery(withStep(state(), "count"));
        await gesture(state, queryEntries({ ...header, name: "Orders counted" }, query.steps), "Name the query");
        await act(async () => { await state().session.apply(); });
        await settle();
        expect(await commits()).toEqual(["patch", "$init"]);
        expect(programEqual(readRecord().get("Orders counted")!.program, checkJq(".orders | length", ROOT.type, { root: true }).program!)).toBe(true);
        expect(container.querySelector("[data-open]")!.getAttribute("data-open")).toBe(`query.saved:"Orders counted"`);
        expect([state().session.status, state().session.pending]).toEqual(["idle", 0]);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["count"]);
    }, 30_000);

    test("E7: opening another query and back keeps the first one's drafts", async () => {
        const { state } = await mountSession();
        await openQuery(variant("saved", "Big orders"));
        await gesture(state, withStep(state(), "limit"), "Keep the first");
        await openQuery(variant("saved", "Order count"));
        expect(state().session.pending).toBe(0);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["count"]);
        await openQuery(variant("saved", "Big orders"));
        expect(state().session.pending).toBe(1);
        expect(entriesQuery(state().entries!).query.steps.map(s => s.type)).toEqual(["filter", "limit"]);
    }, 30_000);
});

// ─── Saved queries offered ───────────────────────────────────────────────────

describe("<Query.Builder> — the saved queries it offers (#934, #935)", () => {
    test("a saved query is offered to start from only where each data source it reads is bound, by name and path", () => {
        const archive: TreePath = [variant("field", "inputs"), variant("field", "archive"), variant("field", "orders")];
        const elsewhere = { ...savedQuery("Archived orders", ".orders | length"), root: [{ name: "orders", path: archive }] };
        const missing = { ...savedQuery("Customer count", ".customers | length"), root: [{ name: "regions", path: CUSTOMERS }] };
        const record: Saved = new SortedMap([BIG_ORDERS, COUNT, elsewhere, missing].map((q): [string, SavedQuery] => [q.name, q]), keys);
        expect(savedOffers(record, ROOT)).toEqual([
            { name: "Big orders", source: "orders" },
            { name: "Order count", source: "orders" },
        ]);
    });
});

// ─── Recent runs ─────────────────────────────────────────────────────────────

describe("<Query.Builder> — recent runs (#935)", () => {
    test("a run is kept in the browser, newest first, and a query run again moves to the front", () => {
        const key = queryKeys(undefined).recent;
        const first = renderHook(() => useRecentQueries(key));
        act(() => { first.result.current.remember(BIG_ORDERS); });
        act(() => { first.result.current.remember(COUNT); });
        act(() => { first.result.current.remember({ ...BIG_ORDERS, saved_at: new Date(Date.UTC(2026, 9, 1, 10, 0)) }); });
        first.unmount();
        const again = renderHook(() => useRecentQueries(key));
        expect(again.result.current.recent.map(q => q.name)).toEqual(["Big orders", "Order count"]);
        expect(savedEqual(again.result.current.recent[1]!, COUNT)).toBe(true);
    });
});
