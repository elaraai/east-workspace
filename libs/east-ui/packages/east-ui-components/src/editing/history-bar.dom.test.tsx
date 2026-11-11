/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The history bar (#879) is every collection's: it speaks the words its
 * collection hands it, reads its session, and leaves each action to the
 * collection to run — here over a projection that is not a sheet's.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { liftDraft } from "./draft.js";
import { HistoryBar, type HistoryAction } from "./HistoryBar.js";
import { EditHistory } from "./history.js";
import { editingMessages, SESSION_TEXT, type EditingMessages, type EditingWords } from "./messages.js";
import { EditSession, type EditIssue, type EntryVersion } from "./session.js";
import { keepDrafts, keptDraftsKey } from "./keep.js";
import { resetKept } from "../platform/kept.js";

/** Ark positioners observe sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
/** The English table with every message marked `⟦` — a word without the mark did not come from the words handed in. */
const MARKED = Object.fromEntries(Object.entries(editingMessages).map(([k, f]) =>
    [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as EditingMessages;
const WORDS: EditingWords = { ...formatters("en-US"), m: MARKED };
const start = some(variant("ordered", variant("start", null)));
const version = (end: bigint): EntryVersion<string> => ({ draft: liftDraft(Draft, { id: "a", end }), wire: `a to ${end}`, place: start });

/** A session over a source of runs, of its own name. */
function runs(sourceId = "runs"): EditSession<string> {
    const session = new EditSession<string>({
        sourceId, entryType: Run, draftType: Draft, idField: "id",
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    return session;
}

function setup(locked = false, phone = false) {
    const session = runs();
    const onAction = vi.fn<(action: HistoryAction) => void>();
    const onIssue = vi.fn<(issue: EditIssue) => void>();
    const bar = () => <ChakraProvider value={system}>
        <HistoryBar session={session} words={WORDS} editing={false} onAction={onAction} onIssue={onIssue} locked={locked} phone={phone} />
    </ChakraProvider>;
    const utils = render(bar());
    return { ...utils, session, onAction, onIssue, refresh: () => utils.rerender(bar()) };
}

test("the bar speaks the words its collection hands it, and each action is the collection's to run", () => {
    const ui = setup();
    for (const name of ["⟦Undo", "⟦Redo", "⟦Discard", "⟦Save"]) expect(ui.getByRole("button", { name })).toBeTruthy();
    expect((ui.getByRole("button", { name: "⟦Undo" }) as HTMLButtonElement).disabled).toBe(true);
    // No issues: the issues button keeps its place, hidden.
    expect(ui.container.querySelector('[data-slot="historyIssues"]')!.hasAttribute("data-empty")).toBe(true);
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    fireEvent.click(ui.getByRole("button", { name: "⟦Undo" }));
    fireEvent.click(ui.getByRole("button", { name: "⟦Save" }));
    expect(ui.onAction.mock.calls.map(([action]) => action)).toEqual(["undo", "apply"]);
});

test("a button run out under the focus keeps it, aria-disabled and refusing, until the focus moves on: Discard pressed from the keyboard leaves the focus on Discard, never on the page", () => {
    const ui = setup();
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    const discard = ui.getByRole("button", { name: "⟦Discard" }) as HTMLButtonElement;
    act(() => { discard.focus(); });
    fireEvent.click(discard);
    // The collection discards: nothing is left to discard, and Discard keeps the focus, refusing another press.
    act(() => { ui.session.discard(); });
    ui.refresh();
    expect([document.activeElement === discard, discard.disabled, discard.getAttribute("aria-disabled")]).toEqual([true, false, "true"]);
    fireEvent.click(discard);
    expect(ui.onAction.mock.calls.map(([action]) => action)).toEqual(["discard"]);
    // The focus moved on, it is disabled, out of the tab order.
    act(() => { discard.blur(); });
    expect([discard.disabled, discard.getAttribute("aria-disabled")]).toEqual([true, null]);
});

test("locked while a run of the optimiser is out (#1409, R2): each action aria-disabled and refused, none disabled, the issues still reachable", () => {
    const ui = setup(true);
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    expect(ui.container.querySelector('[data-slot="history"]')!.hasAttribute("data-history-locked")).toBe(true);
    for (const name of ["⟦Undo", "⟦Redo", "⟦Discard", "⟦Save"]) {
        const button = ui.getByRole("button", { name }) as HTMLButtonElement;
        expect([name, button.getAttribute("aria-disabled")]).toEqual([name, "true"]);
        fireEvent.click(button);
    }
    // Undo and Save could run, were the bar not locked: they keep their size and their focus, and run nothing.
    expect((ui.getByRole("button", { name: "⟦Undo" }) as HTMLButtonElement).disabled).toBe(false);
    expect(ui.onAction).not.toHaveBeenCalled();
});

test("an incomplete draft counts as an issue the bar goes to; the status and the session's own error are worded, a host's error shown as written", () => {
    const ui = setup();
    const incomplete: EntryVersion<string> = { draft: { id: variant("value", "a"), end: variant("missing", null) }, wire: "a to ?", place: start };
    ui.session.record([{ id: "a", before: version(1n), after: incomplete }], "typed", "Clear the end");
    ui.refresh();
    expect((ui.getByRole("button", { name: "⟦Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByRole("button", { name: "⟦1 issue" }));
    expect(ui.onIssue).toHaveBeenCalledWith(expect.objectContaining({ entry: "a", field: some("end") }));
    ui.session.status = "applying";
    ui.session.error = SESSION_TEXT.noRevision;
    ui.refresh();
    expect(ui.getByRole("status").textContent).toBe("⟦Saving…");
    expect(ui.getByRole("alert").textContent).toBe(`⟦${SESSION_TEXT.noRevision}`);
    ui.session.error = "Refused by the host";
    ui.refresh();
    expect(ui.getByRole("alert").textContent).toBe("Refused by the host");
});

test("a Save out, and its saved state read back, shows on Save until the page holds it (#1573): busy, the live dot in its tick's place; a read back that failed, or stalled, is Retry refresh's — in both forms", () => {
    vi.useFakeTimers();
    for (const phone of [false, true]) {
        const ui = setup(false, phone);
        ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
        ui.refresh();
        const save = () => ui.queryByRole("button", { name: "⟦Save" });
        const retry = () => ui.queryByRole("button", { name: "⟦Retry refresh" });
        /** Save as it shows: busy, its live dot, its tick. */
        const looks = () => {
            const button = save();
            return button === null ? null : [button.getAttribute("aria-busy"), button.querySelector("[data-history-live]") !== null, button.querySelector("svg") !== null];
        };
        expect([looks(), retry()], `idle, phone ${phone}`).toEqual([[null, false, true], null]);
        ui.session.status = "applying";
        ui.refresh();
        expect([looks(), retry()], `out, phone ${phone}`).toEqual([["true", true, false], null]);
        ui.session.status = "reconciling";
        ui.refresh();
        expect([looks(), retry()], `reading back, phone ${phone}`).toEqual([["true", true, false], null]);
        // Nothing read back for ten seconds: Retry refresh asks again, in Save's place, until the read back moves.
        act(() => { vi.advanceTimersByTime(9_999); });
        expect([looks(), retry()], `reading back a while, phone ${phone}`).toEqual([["true", true, false], null]);
        act(() => { vi.advanceTimersByTime(1); });
        expect([looks(), retry() !== null], `read back stalled, phone ${phone}`).toEqual([null, true]);
        ui.session.availabilityChanged();
        ui.refresh();
        expect([looks(), retry()], `read back moved, phone ${phone}`).toEqual([["true", true, false], null]);
        // The read back failed: Retry refresh asks again, in Save's place.
        ui.session.error = "read-back refused";
        ui.refresh();
        expect([looks(), retry() !== null], `read back failed, phone ${phone}`).toEqual([null, true]);
        ui.session.status = "idle";
        ui.session.error = undefined;
        ui.refresh();
        expect([looks(), retry()], `saved, phone ${phone}`).toEqual([[null, false, true], null]);
        cleanup();
    }
});

test("over a history of several sessions (#1194), Save reads the read back from the session that reads back, never another's error (#1573)", () => {
    const [laps, legs] = [runs("laps"), runs("legs")];
    const history = new EditHistory<string>();
    history.sync([["laps", laps], ["legs", legs]]);
    const bar = () => <ChakraProvider value={system}>
        <HistoryBar session={history} words={WORDS} editing={false} onAction={() => undefined} onIssue={() => undefined} />
    </ChakraProvider>;
    const ui = render(bar());
    const save = () => ui.queryByRole("button", { name: "⟦Save" });
    const retry = () => ui.queryByRole("button", { name: "⟦Retry refresh" });
    // One session reads its Save back, and the other's Save could not be prepared, and says why.
    laps.status = "reconciling";
    legs.error = "could not prepare the Save";
    ui.rerender(bar());
    expect([save()?.getAttribute("aria-busy"), retry(), ui.getByRole("alert").textContent]).toEqual(["true", null, "could not prepare the Save"]);
    // The read back itself failed: Retry refresh asks again.
    laps.error = "read-back refused";
    ui.rerender(bar());
    expect([save(), retry() !== null]).toEqual([null, true]);
});

test("over a history of several sessions, a conflict in one holds Save only while nothing else can be saved: another session's change keeps Save on, and Save waits, aria-disabled, once the conflict's own is all that is left", () => {
    const [laps, legs] = [runs("laps"), runs("legs")];
    const history = new EditHistory<string>();
    history.sync([["laps", laps], ["legs", legs]]);
    const onAction = vi.fn<(action: HistoryAction) => void>();
    const bar = () => <ChakraProvider value={system}>
        <HistoryBar session={history} words={WORDS} editing={false} onAction={onAction} onIssue={() => undefined} />
    </ChakraProvider>;
    // The laps' run drafted here and changed elsewhere, differently: a conflict to choose. The legs' run drafted alone.
    laps.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    laps.observeBase(variant("snapshot", [{ id: "a", end: 7n }]));
    legs.record([{ id: "a", before: version(1n), after: version(5n) }], "resize", "Resize a");
    const ui = render(bar());
    const save = () => ui.getByRole("button", { name: "⟦Save" }) as HTMLButtonElement;
    expect([history.unsettled, save().disabled, save().getAttribute("aria-disabled")]).toEqual([1, false, null]);
    fireEvent.click(save());
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(["apply"]);
    // The legs' change gone, only the conflict's own is left: Save waits for the choice, and runs nothing.
    act(() => { legs.discard(); });
    ui.rerender(bar());
    expect([save().disabled, save().getAttribute("aria-disabled")]).toEqual([false, "true"]);
    fireEvent.click(save());
    expect(onAction).toHaveBeenCalledTimes(1);
});

test("an open editor turns Save on, to commit it and save — never while a Save is unresolved: Save then shows the Save out, busy and off, and Undo, which commits the editor first, stays on", async () => {
    let answer: (() => void) | undefined;
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id",
        apply: () => new Promise((resolve) => { answer = () => resolve(variant("applied", { revision: none })); }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    const bar = () => <ChakraProvider value={system}>
        <HistoryBar session={session} words={WORDS} editing onAction={() => undefined} onIssue={() => undefined} />
    </ChakraProvider>;
    const ui = render(bar());
    const save = () => ui.getByRole("button", { name: "⟦Save" }) as HTMLButtonElement;
    const undo = () => ui.getByRole("button", { name: "⟦Undo" }) as HTMLButtonElement;
    // Nothing drafted, an editor open: Save and Undo are on, each committing it first.
    expect([save().disabled, undo().disabled]).toEqual([false, false]);
    let saved!: Promise<void>;
    await act(async () => {
        session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
        saved = session.apply();
        await Promise.resolve();
    });
    ui.rerender(bar());
    // The request out: the session takes gestures still, so Undo is on; the next Save waits for it, so Save is off, busy.
    expect([session.locked, session.writable]).toEqual([true, true]);
    expect([save().disabled, save().getAttribute("aria-busy"), undo().disabled]).toEqual([true, "true", false]);
    // Answered and read back, an editor still open: Save is on again.
    await act(async () => {
        answer!();
        await saved;
        expect(session.reconcile(variant("snapshot", [{ id: "a", end: 4n }]), () => undefined)).toBe(true);
    });
    ui.rerender(bar());
    expect([session.locked, save().disabled, save().getAttribute("aria-busy")]).toEqual([false, false, null]);
});

test("drafts a reload would lose are said under the buttons, where the bar says its error", () => {
    resetKept();
    window.sessionStorage.clear();
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id",
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    keepDrafts(session, keptDraftsKey("", "runs", "runs.bar"), StringType);
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    const { container } = render(<ChakraProvider value={system}>
        <HistoryBar session={session} words={WORDS} editing={false} onAction={() => undefined} onIssue={() => undefined} />
    </ChakraProvider>);
    expect(container.querySelector("[data-history-keeping]")!.textContent).toBe(`⟦${editingMessages.bannerUnkept({ reason: "full" })}`);
});

test("a phone's form (Mobile Builder Frame Spec.md FR6): the drafts' count first, the issues there at none and off, then Undo, Redo, Discard and Save, Save filled while it would save", () => {
    const ui = setup(false, true);
    const root = ui.container.querySelector('[data-slot="history"]')!;
    expect(root.getAttribute("data-history-form")).toBe("phone");
    expect(ui.getByRole("status").textContent).toBe(`⟦${editingMessages.historyChanges({ n: 0, count: "0" })}`);
    const issues = ui.getByRole("button", { name: `⟦${editingMessages.issues({ n: 0, count: "0" })}` }) as HTMLButtonElement;
    expect([issues.disabled, ui.container.querySelector('[data-slot="historyIssues"]')]).toEqual([true, null]);
    expect([...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")))
        .toEqual([`⟦${editingMessages.issues({ n: 0, count: "0" })}`, "⟦Undo", "⟦Redo", "⟦Discard", "⟦Save"]);
    expect(ui.getByRole("button", { name: "⟦Save" }).hasAttribute("data-ready")).toBe(false);
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    const changes = ui.getByRole("status").firstElementChild as HTMLElement;
    const counted = `⟦${editingMessages.historyChanges({ n: 1, count: "1" })}`;
    expect([changes.textContent, changes.hasAttribute("data-changes")]).toEqual([counted, true]);
    // The chip says how many characters its number holds — the words before the noun — for the row to show it whole or not at all.
    expect(changes.style.getPropertyValue("--history-figures")).toBe(String(counted.split(" ")[0]!.length));
    expect(ui.getByRole("button", { name: "⟦Save" }).hasAttribute("data-ready")).toBe(true);
});

test("a phone's Discard asks first, in the band under its row (FR8, no popover, never a dialog): Cancel keeps the drafts, Discard changes is the collection's to run", async () => {
    const ui = setup(false, true);
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "⟦Discard" })); });
    expect(ui.onAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(`⟦${editingMessages.discardAskTitle({ n: 1, count: "1" })}`);
    // No dialog, and no popover's content: what the row's Issues square would open its conflicts in stays shut.
    expect(document.querySelector('[role="dialog"], [data-scope="popover"][data-part="positioner"], [data-scope="popover"][data-part="content"]')).toBeNull();
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "⟦Cancel" })); });
    expect(ui.onAction).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "⟦Discard" })); });
    await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-history-discard-confirm]")!); });
    expect(ui.onAction.mock.calls.map(([action]) => action)).toEqual(["discard"]);
});
