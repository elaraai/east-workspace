/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The history bar's automatic Save: where its builder keeps a choice of one,
 * Save is a split button whose chevron opens the choice, kept for the builder;
 * on, the session's changes are saved a pause after the person's last act, with
 * no press — never under an open editor, a held pointer or a run of the
 * optimiser, and never an optimiser's result, which Save says it waits for.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { kept, keptFlag, keptName, resetKept } from "../platform/kept.js";
import { AUTOSAVE_PAUSE_MS } from "./autosave.js";
import { autosaveChoiceKey, autosaveChoiceOf, beginAutosave, keepAutosaveChoice } from "./autosave-choice.js";
import { liftDraft } from "./draft.js";
import { HistoryBar, type HistoryBarProps } from "./HistoryBar.js";
import { EditHistory } from "./history.js";
import { editingMessages, type EditingWords } from "./messages.js";
import { EditSession, type EntryVersion } from "./session.js";

/** Ark positioners observe sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    resetKept();
    window.localStorage.clear();
    window.sessionStorage.clear();
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };
const start = some(variant("ordered", variant("start", null)));
const version = (id: string, end: bigint): EntryVersion<string> => ({ draft: liftDraft(Draft, { id, end }), wire: `${id} to ${end}`, place: start });
/** Where the runs' builder keeps its choice. */
const CHOICE = autosaveChoiceKey("", "runs.view");

/** A session over two runs whose builder keeps a choice of an automatic Save, and each Save it sent. */
function runs() {
    const sent: Uint8Array[] = [];
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id",
        apply: (bytes) => { sent.push(bytes); return variant("applied", { revision: none }); }, patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }, { id: "b", end: 2n }]));
    keepAutosaveChoice(session, CHOICE);
    return { session, sent };
}
/** Sets a run's end: a person's gesture, or an optimiser's result. */
const setEnd = (session: EditSession<string>, id: string, from: bigint, to: bigint, by: "resize" | "optimise" = "resize") =>
    act(() => { session.record([{ id, before: version(id, from), after: version(id, to) }], by, by === "resize" ? "Resize" : "Elara run #1"); });
/** The automatic Save turned on for the runs' builder, as its panel's On keeps it. */
const turnOn = () => kept(CHOICE, keptFlag).write(true);

/** The bar over a session, drawn again as the session moves — as a builder's toolbar draws it. */
function mount(session: HistoryBarProps<string>["session"], props: Partial<HistoryBarProps<string>> = {}) {
    const bar = (more: Partial<HistoryBarProps<string>> = {}) => <ChakraProvider value={system}>
        <HistoryBar session={session} words={WORDS} editing={false} onAction={() => undefined} onIssue={() => undefined} {...props} {...more} />
    </ChakraProvider>;
    const ui = render(bar());
    const off = session.subscribe(() => { act(() => { ui.rerender(bar()); }); });
    return {
        ...ui,
        again: (more: Partial<HistoryBarProps<string>>) => act(() => { ui.rerender(bar(more)); }),
        save: () => ui.getByRole("button", { name: "Save" }) as HTMLButtonElement,
        chevron: () => ui.container.querySelector<HTMLButtonElement>("[data-history-autosave]"),
        stop: () => { off(); ui.unmount(); },
    };
}
/** Lets the time pass, and what a Save's answer sets going run. */
const pass = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

test("a session no builder keeps a choice for shows Save alone; one a builder keeps a choice for shows the chevron beside it, in each of the bar's forms", () => {
    const plain = new EditSession<string>({
        sourceId: "plain", entryType: Run, draftType: Draft, idField: "id",
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    expect(autosaveChoiceOf(plain)).toBeUndefined();
    const alone = mount(plain);
    expect([alone.chevron(), alone.container.querySelector("[data-history-save]")]).toEqual([null, null]);
    alone.stop();
    for (const form of [{}, { buttonsOnly: true }, { phone: true }]) {
        const ui = mount(runs().session, form);
        const split = ui.container.querySelector("[data-history-save]")!;
        // Save, then the chevron: one box of two parts.
        expect([...split.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["Save", "Automatic saving"]);
        // Save alone answers to its name, or to a part of it — a script's `Save`, a voice's: no other control of the bar holds the word.
        expect([...ui.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "").filter((name) => /save/i.test(name))).toEqual(["Save"]);
        expect(ui.chevron()!.hasAttribute("data-on")).toBe(false);
        ui.stop();
    }
});

test("the chevron opens one switch, Autosave — off as it begins — and a flick is kept for the builder at once, in the browser", async () => {
    const { session } = runs();
    const ui = mount(session);
    await act(async () => { fireEvent.click(ui.chevron()!); });
    const flick = await screen.findByRole<HTMLInputElement>("switch", { name: "Autosave" });
    const panel = document.querySelector<HTMLElement>("[data-history-autosave-panel]")!;
    // One word and its switch (ruled 11 Nov 2026): no pair of choices to read, and no words under it.
    expect([panel.textContent, panel.querySelectorAll("input").length, document.querySelector('[role="radiogroup"], input[type="radio"]')]).toEqual(["Autosave", 1, null]);
    expect([flick.checked, window.localStorage.getItem(keptName(CHOICE))]).toEqual([false, null]);
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(true));
    expect([window.localStorage.getItem(keptName(CHOICE)), ui.chevron()!.hasAttribute("data-on")]).toEqual(["true", true]);
    // Off again: kept as it is flicked.
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(false));
    expect([window.localStorage.getItem(keptName(CHOICE)), ui.chevron()!.hasAttribute("data-on")]).toEqual(["false", false]);
    ui.stop();
});

test("the switch begins where its builder's author says while its viewer has chosen nothing — on, nothing kept — and follows the author's word as it moves; the viewer's own flick is kept, and stands over whatever the author says after, through a reload", async () => {
    const { session } = runs();
    beginAutosave(session, true);
    const ui = mount(session);
    const read = () => [ui.chevron()!.hasAttribute("data-on"), window.localStorage.getItem(keptName(CHOICE))];
    expect(read()).toEqual([true, null]);
    // The author's word is data's: it moves, and a choice never made moves with it.
    act(() => { beginAutosave(session, false); });
    expect(read()).toEqual([false, null]);
    act(() => { beginAutosave(session, true); });
    expect(read()).toEqual([true, null]);
    // The viewer's own: off, kept.
    await act(async () => { fireEvent.click(ui.chevron()!); });
    const flick = await screen.findByRole<HTMLInputElement>("switch", { name: "Autosave" });
    expect(flick.checked).toBe(true);
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(false));
    expect(read()).toEqual([false, "false"]);
    // Whatever the author says after, the viewer's stands.
    act(() => { beginAutosave(session, false); });
    act(() => { beginAutosave(session, true); });
    expect(read()).toEqual([false, "false"]);
    ui.stop();
    // A reload: the choice read back from the browser, over the author's on.
    resetKept();
    const again = mount(session);
    expect(again.chevron()!.hasAttribute("data-on")).toBe(false);
    again.stop();
});

test("begun on by its author, a change is saved a pause after it with no press, its viewer having chosen nothing; begun off, it waits for one", async () => {
    vi.useFakeTimers();
    const on = runs();
    beginAutosave(on.session, true);
    const ui = mount(on.session);
    await setEnd(on.session, "a", 1n, 4n);
    await pass(AUTOSAVE_PAUSE_MS - 1);
    expect(on.sent).toHaveLength(0);
    await pass(1);
    expect([on.sent.length, window.localStorage.getItem(keptName(CHOICE))]).toEqual([1, null]);
    ui.stop();
    const off = runs();
    const waits = mount(off.session);
    await setEnd(off.session, "a", 1n, 4n);
    await pass(60_000);
    expect(off.sent).toHaveLength(0);
    waits.stop();
});

/** A phone's More, where the bar draws one. */
const moreOf = (container: HTMLElement) => container.querySelector<HTMLButtonElement>("[data-history-more]");

test("a phone's bar holds More — the square its row shows in Discard's place where it is short of Discard and Save's chevron both (ruled 11 Nov 2026) — where its builder keeps a choice of an automatic Save, and in no other form of the bar", () => {
    const plain = new EditSession<string>({
        sourceId: "plain", entryType: Run, draftType: Draft, idField: "id",
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    // No choice to hold: Discard is Discard, at every width.
    const alone = mount(plain, { phone: true });
    expect(moreOf(alone.container)).toBeNull();
    alone.stop();
    for (const form of [{}, { buttonsOnly: true }]) {
        const ui = mount(runs().session, form);
        expect(moreOf(ui.container)).toBeNull();
        ui.stop();
    }
    const ui = mount(runs().session, { phone: true });
    // In the row's order: Discard, More in its place, then Save and its chevron — of which the row shows Discard and the chevron, or More.
    expect([...ui.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")).slice(-5)).toEqual(["Redo", "Discard", "More", "Save", "Automatic saving"]);
    expect(moreOf(ui.container)!.hasAttribute("data-on")).toBe(false);
    // Save alone still answers to its name.
    expect([...ui.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "").filter((name) => /save/i.test(name))).toEqual(["Save"]);
    ui.stop();
});

test("More opens the Autosave switch and Discard changes: the switch, flicked, is kept and shows on More; Discard changes — off with nothing to discard, and locked while a run of the optimiser is out — discards at its one press, the press of More having come first, and closes", async () => {
    const { session } = runs();
    const acted: string[] = [];
    const ui = mount(session, { phone: true, onAction: (action) => { acted.push(action); } });
    const more = moreOf(ui.container)!;
    await act(async () => { fireEvent.click(more); });
    const flick = await screen.findByRole<HTMLInputElement>("switch", { name: "Autosave" });
    const discard = () => screen.getByRole<HTMLButtonElement>("button", { name: "Discard changes" });
    // The two it holds, and no more to read: the switch's word, and the button's.
    expect(document.querySelector<HTMLElement>("[data-history-more-panel]")!.textContent).toBe("AutosaveDiscard changes");
    // Nothing drafted: nothing to discard.
    expect([flick.checked, discard().disabled]).toEqual([false, true]);
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(true));
    expect([window.localStorage.getItem(keptName(CHOICE)), more.hasAttribute("data-on"), ui.chevron()!.hasAttribute("data-on")]).toEqual(["true", true, true]);
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(false));
    // A draft: Discard changes is on — but under a run of the optimiser, which locks it as it locks the row's own.
    await setEnd(session, "a", 1n, 4n);
    expect(discard().disabled).toBe(false);
    ui.again({ locked: true });
    expect(discard().getAttribute("aria-disabled")).toBe("true");
    await act(async () => { fireEvent.click(discard()); });
    expect(acted).toEqual([]);
    ui.again({ locked: false });
    expect(discard().getAttribute("aria-disabled")).toBeNull();
    // One press discards: the collection is asked once, and More closes.
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { fireEvent.click(discard()); });
    expect(acted).toEqual(["discard"]);
    await waitFor(() => expect(more.getAttribute("aria-expanded")).toBe("false"));
    ui.stop();
});

test("begun on by its author, a phone's bar is on whatever its row shows — Save's chevron, or More — and More's switch turns it off, kept, as the chevron's does: no width leaves an author's on with nothing to turn it off", async () => {
    vi.useFakeTimers();
    const { session, sent } = runs();
    beginAutosave(session, true);
    const ui = mount(session, { phone: true });
    const read = () => [ui.chevron()!.hasAttribute("data-on"), moreOf(ui.container)!.hasAttribute("data-on"), window.localStorage.getItem(keptName(CHOICE))];
    expect(read()).toEqual([true, true, null]);
    // On: a change goes a pause after it.
    await setEnd(session, "a", 1n, 4n);
    await pass(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(1);
    act(() => { session.reconcile(variant("snapshot", [{ id: "a", end: 4n }, { id: "b", end: 2n }]), () => undefined); });
    vi.useRealTimers();
    // More's switch: on as its author says, flicked off, kept.
    await act(async () => { fireEvent.click(moreOf(ui.container)!); });
    const flick = await screen.findByRole<HTMLInputElement>("switch", { name: "Autosave" });
    expect(flick.checked).toBe(true);
    await act(async () => { fireEvent.click(flick); });
    await waitFor(() => expect(flick.checked).toBe(false));
    expect(read()).toEqual([false, false, "false"]);
    ui.stop();
});

test("off, a change waits for a press however long; on, it is saved a pause after it with no press — the session's own request, once, whatever forms of the bar are drawn", async () => {
    vi.useFakeTimers();
    const { session, sent } = runs();
    // The toolbar draws the bar in each of its forms: one automatic Save between them.
    const full = mount(session);
    const folded = mount(session, { buttonsOnly: true });
    await setEnd(session, "a", 1n, 4n);
    await pass(60_000);
    expect(sent).toHaveLength(0);
    act(() => { turnOn(); });
    // Turned on over a change made before: saved a pause from then, never at once.
    await pass(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toHaveLength(0);
    await pass(1);
    expect(sent).toHaveLength(1);
    // Read back: the next change goes a pause after it.
    act(() => { session.reconcile(variant("snapshot", [{ id: "a", end: 4n }, { id: "b", end: 2n }]), () => undefined); });
    await setEnd(session, "b", 2n, 5n);
    await pass(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(2);
    full.stop();
    folded.stop();
});

test("on, each Save shows on Save alone — busy, its live dot — and its words are not said in the row; off, they are", async () => {
    for (const on of [true, false]) {
        resetKept();
        window.localStorage.clear();
        if (on) turnOn();
        const { session } = runs();
        const ui = mount(session);
        await setEnd(session, "a", 1n, 4n);
        await act(async () => { await session.apply(); });
        expect([session.status, ui.save().getAttribute("aria-busy"), ui.save().querySelector("[data-history-live]") !== null]).toEqual(["reconciling", "true", true]);
        expect([on, ui.queryByRole("status")?.textContent ?? null]).toEqual([on, on ? null : "Saved — reading it back…"]);
        ui.stop();
    }
});

test("on, nothing is saved under an open editor, a run of the optimiser, a held pointer or a key just pressed: each ended, the change goes", async () => {
    vi.useFakeTimers();
    turnOn();
    // An editor open: what it holds is no draft yet, and a Save's reload would land under it.
    const editing = runs();
    const edited = mount(editing.session, { editing: true });
    await setEnd(editing.session, "a", 1n, 4n);
    await pass(60_000);
    expect(editing.sent).toHaveLength(0);
    edited.again({ editing: false });
    await pass(0);
    expect(editing.sent).toHaveLength(1);
    edited.stop();
    // A run of the optimiser out.
    const running = runs();
    const locked = mount(running.session, { locked: true });
    await setEnd(running.session, "a", 1n, 4n);
    await pass(60_000);
    expect(running.sent).toHaveLength(0);
    locked.again({ locked: false });
    await pass(0);
    expect(running.sent).toHaveLength(1);
    locked.stop();
    // A pointer held — a drag under way: saved a pause after it is let go.
    const dragged = runs();
    const ui = mount(dragged.session);
    await setEnd(dragged.session, "a", 1n, 4n);
    act(() => { fireEvent.pointerDown(document.body, { pointerId: 1, pointerType: "mouse" }); });
    await pass(60_000);
    expect(dragged.sent).toHaveLength(0);
    act(() => { fireEvent.pointerUp(document.body, { pointerId: 1, pointerType: "mouse" }); });
    await pass(AUTOSAVE_PAUSE_MS - 1);
    expect(dragged.sent).toHaveLength(0);
    // A key pressed meanwhile starts the pause again.
    act(() => { fireEvent.keyDown(document.body, { key: "a" }); });
    await pass(AUTOSAVE_PAUSE_MS - 1);
    expect(dragged.sent).toHaveLength(0);
    await pass(1);
    expect(dragged.sent).toHaveLength(1);
    ui.stop();
});

test("on, a finger whose lift the page never hears holds no Save back for good: the page's next first finger lets go of it, and the change goes a pause after that one lifts — while a finger still down beside another's lift holds it, until the browser takes it back", async () => {
    vi.useFakeTimers();
    turnOn();
    /** A finger's event, as the page hears it: its first finger — none other down — is the browser's primary pointer. */
    const finger = (type: "pointerDown" | "pointerUp" | "pointerCancel", pointerId: number, isPrimary: boolean) =>
        act(() => { fireEvent[type](document.body, { pointerId, pointerType: "touch", isPrimary }); });
    // A finger put down, and its lift never heard: a phone does not always say a finger ended.
    const lost = runs();
    const ui = mount(lost.session);
    finger("pointerDown", 11, true);
    await setEnd(lost.session, "a", 1n, 4n);
    await pass(60_000);
    // Held, as far as the page can know.
    expect(lost.sent).toHaveLength(0);
    // The next touch. Its finger is the page's first — no other is down — so the lost one is let go of, and this one's
    // lift ends the hold: the change goes a pause after it.
    finger("pointerDown", 12, true);
    finger("pointerUp", 12, true);
    await pass(AUTOSAVE_PAUSE_MS - 1);
    expect(lost.sent).toHaveLength(0);
    await pass(1);
    expect(lost.sent).toHaveLength(1);
    ui.stop();
    // Two fingers down, and one lifts: the other is down still, and holds the Save — until the browser takes it back.
    const two = runs();
    const again = mount(two.session);
    finger("pointerDown", 21, true);
    finger("pointerDown", 22, false);
    await setEnd(two.session, "a", 1n, 4n);
    finger("pointerUp", 22, false);
    await pass(60_000);
    expect(two.sent).toHaveLength(0);
    finger("pointerCancel", 21, true);
    await pass(AUTOSAVE_PAUSE_MS);
    expect(two.sent).toHaveLength(1);
    again.stop();
    // A finger's lift never heard, then a mouse: its press lets go of the finger, and its release ends the hold.
    const mixed = runs();
    const hybrid = mount(mixed.session);
    finger("pointerDown", 31, true);
    await setEnd(mixed.session, "a", 1n, 4n);
    act(() => { fireEvent.pointerDown(document.body, { pointerId: 1, pointerType: "mouse", isPrimary: true }); });
    act(() => { fireEvent.pointerUp(document.body, { pointerId: 1, pointerType: "mouse", isPrimary: true }); });
    await pass(AUTOSAVE_PAUSE_MS);
    expect(mixed.sent).toHaveLength(1);
    hybrid.stop();
});

test("on, a tab hidden saves at once what is due; with the bar gone, nothing is saved by itself", async () => {
    vi.useFakeTimers();
    turnOn();
    const { session, sent } = runs();
    const ui = mount(session);
    await setEnd(session, "a", 1n, 4n);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); for (let i = 0; i < 6; i++) await Promise.resolve(); });
    expect(sent).toHaveLength(1);
    visibility.mockRestore();
    act(() => { session.reconcile(variant("snapshot", [{ id: "a", end: 4n }, { id: "b", end: 2n }]), () => undefined); });
    ui.stop();
    await setEnd(session, "b", 2n, 5n);
    await pass(60_000);
    expect(sent).toHaveLength(1);
});

test("on, an optimiser's result is never saved by itself: what was changed before it goes, Save wears the ring and says why, the panel says why, and a person's Save ends the wait", async () => {
    vi.useFakeTimers();
    turnOn();
    const { session, sent } = runs();
    const ui = mount(session);
    await setEnd(session, "a", 1n, 4n);
    await setEnd(session, "b", 2n, 9n, "optimise");
    expect(ui.save().hasAttribute("data-held")).toBe(true);
    await pass(AUTOSAVE_PAUSE_MS);
    // The person's own change, saved by itself; the result waits.
    expect(sent).toHaveLength(1);
    act(() => { session.reconcile(variant("snapshot", [{ id: "a", end: 4n }, { id: "b", end: 2n }]), () => undefined); });
    await pass(600_000);
    expect([sent.length, session.pending, ui.save().hasAttribute("data-held"), ui.save().disabled]).toEqual([1, 1, true, false]);
    vi.useRealTimers();
    // Its tooltip and the panel say why.
    await act(async () => { fireEvent.click(ui.chevron()!); });
    await waitFor(() => expect(document.querySelector("[data-history-autosave-held]")?.textContent).toBe(editingMessages.autosaveHeld()));
    // A person's Save takes it: no ring, and nothing waits.
    await act(async () => { await session.apply(); });
    expect([sent.length, ui.save().hasAttribute("data-held"), session.autosaveHeld]).toEqual([2, false, false]);
    ui.stop();
});

/** What Save's tooltip says, the pointer over it. */
async function saveTip(save: HTMLElement): Promise<string | null | undefined> {
    fireEvent.pointerMove(save, { pointerType: "mouse" });
    const tip = () => document.querySelector<HTMLElement>('[data-scope="tooltip"][data-part="content"][data-state="open"]');
    await waitFor(() => expect(tip()).not.toBeNull());
    return tip()?.textContent;
}

test("on, a step back or forward is never saved by itself: what Undo left stands however long, Save on and saying why; forward again nothing waits, and a person's Save takes a step back as theirs", async () => {
    // The tooltip follows its button as the page moves, as the browser tells it; jsdom tells nothing.
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
    vi.useFakeTimers();
    turnOn();
    const { session, sent } = runs();
    const ui = mount(session);
    await setEnd(session, "a", 1n, 4n);
    await pass(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(1);
    act(() => { session.reconcile(variant("snapshot", [{ id: "a", end: 4n }, { id: "b", end: 2n }]), () => undefined); });
    // Back, to look: the saved change undone is a change to save, and it waits — ten minutes, and nothing is sent.
    act(() => { session.undo(); });
    await pass(600_000);
    expect([sent.length, session.pending, session.autosaveStepped, ui.save().disabled]).toEqual([1, 1, true, false]);
    vi.useRealTimers();
    expect(await saveTip(ui.save())).toBe(editingMessages.applyStepped());
    // Forward again: as it was saved, nothing to save and nothing waiting.
    act(() => { session.redo(); });
    expect([session.pending, session.autosaveStepped]).toEqual([0, false]);
    // Back once more, and a person's Save: sent, as theirs.
    act(() => { session.undo(); });
    await act(async () => { await session.apply(); });
    expect([sent.length, session.autosaveStepped]).toEqual([2, false]);
    ui.stop();
});

test("off, a step back says nothing of an automatic Save: Save is Save", async () => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
    const { session } = runs();
    const ui = mount(session);
    await setEnd(session, "a", 1n, 4n);
    await setEnd(session, "b", 2n, 5n);
    act(() => { session.undo(); });
    expect(session.autosaveStepped).toBe(true);
    expect(await saveTip(ui.save())).toBe("Save");
    ui.stop();
});

test("off, an optimiser's result wears no ring: nothing is saved by itself, so nothing waits on it", async () => {
    const { session } = runs();
    const ui = mount(session);
    await setEnd(session, "b", 2n, 9n, "optimise");
    expect([session.autosaveHeld, ui.save().hasAttribute("data-held")]).toEqual([true, false]);
    ui.stop();
});

test("over one history of several sessions, the choice is the history's builder's, and on, each session's changes are saved by themselves", async () => {
    vi.useFakeTimers();
    const laps = runs();
    const legs = runs();
    const history = new EditHistory<string>();
    history.sync([["laps", laps.session], ["legs", legs.session]]);
    const key = autosaveChoiceKey("", "track.view");
    keepAutosaveChoice(history, key);
    kept(key, keptFlag).write(true);
    const ui = mount(history);
    expect(ui.chevron()!.hasAttribute("data-on")).toBe(true);
    act(() => {
        history.record([{ key: "laps", updates: [{ id: "a", before: version("a", 1n), after: version("a", 4n) }] }], "resize", "Resize");
        history.record([{ key: "legs", updates: [{ id: "b", before: version("b", 2n), after: version("b", 5n) }] }], "resize", "Resize");
    });
    await pass(AUTOSAVE_PAUSE_MS);
    expect([laps.sent.length, legs.sent.length]).toEqual([1, 1]);
    ui.stop();
});
