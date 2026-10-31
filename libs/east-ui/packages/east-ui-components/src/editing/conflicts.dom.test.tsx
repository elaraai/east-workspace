/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The conflicts button and its popover, over real sessions whose drafts
 * another write moved under: the button leads the history bar with how many
 * wait, and Save waits for them; the popover names each as the collection
 * names its issues, with each side's value and what both began from; a choice
 * applies at once as one step Undo takes back; Keep all mine and Use all
 * theirs choose every one in one step; Go to goes to the item as an issue's
 * click does; a banner's Choose opens it; and once every one is chosen it
 * says so, and the button leaves as it closes.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { DateTimeType, DictType, IntegerType, SortedMap, StringType, StructType, compareFor, equalFor, none, some, variant, type PatchPath, type ValueTypeOf } from "@elaraai/east";
import { Editing, EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { liftDraft } from "./draft.js";
import { SessionBanners } from "./banners.js";
import { EditHistory } from "./history.js";
import { HistoryBar, type HistoryAction, type HistoryBarProps } from "./HistoryBar.js";
import { editingMessages, type EditingWords } from "./messages.js";
import { EditSession, type EditIssue, type EntryVersion } from "./session.js";

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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };
const start = some(variant("ordered", variant("start", null)));
const version = (id: string, end: bigint): EntryVersion<string> => ({ draft: liftDraft(Draft, { id, end }), wire: `${id} to ${end}`, place: start });

/** A session over runs each ending at 1, each drafted to end at 4. */
function drafted(ids: readonly string[]): EditSession<string> {
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", ids.map((id) => ({ id, end: 1n }))));
    session.record(ids.map((id) => ({ id, before: version(id, 1n), after: version(id, 4n) })), "resize", "Resize");
    return session;
}

/** The same, then moved under by another write ending each run at 7: a conflict on each run's end. */
function conflicted(ids: readonly string[]): EditSession<string> {
    const session = drafted(ids);
    session.observeBase(variant("snapshot", ids.map((id) => ({ id, end: 7n }))));
    return session;
}

/** The bar as a host draws it: again as its session moves. */
function Bar(props: HistoryBarProps<string>) {
    useSyncExternalStore(props.session.subscribe, props.session.getSnapshot);
    return <HistoryBar {...props} />;
}

function mount(session: EditSession<string> | EditHistory<string>, extra: Partial<HistoryBarProps<string>> = {}) {
    const onIssue = vi.fn<(issue: EditIssue, at?: PatchPath) => void>();
    const onAction = vi.fn<(action: HistoryAction) => void>();
    const ui = render(
        <ChakraProvider value={system}>
            <Bar session={session} words={WORDS} editing={false} onAction={onAction} onIssue={onIssue} where={(issue) => `Run ${issue.entry}`} {...extra} />
        </ChakraProvider>,
    );
    return { ...ui, onIssue, onAction };
}

const button = () => document.querySelector<HTMLButtonElement>("[data-conflicts]");
const cards = () => [...document.querySelectorAll<HTMLElement>("[data-conflict-card]")];
const radio = (card: HTMLElement, choice: "draft" | "source") => card.querySelector<HTMLInputElement>(`[data-choice=${choice}] input`)!;
/** The popover, opened from the button. */
async function opened(count: number) {
    fireEvent.click(button()!);
    await waitFor(() => expect(cards()).toHaveLength(count));
}

test("nothing waits: no conflicts button", () => {
    mount(drafted(["a"]));
    expect(button()).toBeNull();
});

test("while conflicts wait, their button leads the bar's buttons with how many, and Save waits for them", () => {
    const session = conflicted(["a", "b"]);
    expect(session.unsettled).toBe(2);
    const ui = mount(session);
    expect(button()!.textContent).toBe("2");
    expect(button()!.getAttribute("aria-label")).toBe("2 conflicts");
    // The first of the history's buttons: before Issues, and Undo.
    expect(ui.container.querySelector('[data-slot="history"] button')!.getAttribute("aria-label")).toBe("2 conflicts");
    // Save waits aria-disabled, never disabled: it keeps the focus, and its Tooltip says why; a press does nothing.
    const save = ui.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect([save.disabled, save.getAttribute("aria-disabled")]).toEqual([false, "true"]);
    fireEvent.click(save);
    expect(ui.onAction).not.toHaveBeenCalled();
    // Said once, as they appear.
    expect(document.querySelector("[data-conflicts-said]")!.textContent).toBe("2 of your changes conflict with newer changes. Save is off until you choose.");
});

test("the folded bar keeps the button: it is what turns Save back on", () => {
    mount(conflicted(["a"]), { buttonsOnly: true });
    expect(button()!.textContent).toBe("1");
});

test("each conflict as the collection names it, with both sides and what both began from; a choice applies at once, and Undo brings it back", async () => {
    const session = conflicted(["a"]);
    const ui = mount(session);
    await opened(1);
    const [card] = cards();
    expect(card!.textContent).toContain("Run a");
    expect(card!.textContent).toContain("Changed since you started editing · was 1");
    expect(ui.getByRole("radio", { name: "Yours, 4" })).toBe(radio(card!, "draft"));
    expect(ui.getByRole("radio", { name: "Theirs, 7, Changed since you started editing · was 1" })).toBe(radio(card!, "source"));
    expect([radio(card!, "draft").checked, radio(card!, "source").checked]).toEqual([false, false]);
    // The head: Conflicts · 1, its count in a span of its own (the active control's ink).
    expect([...document.querySelectorAll("span")].some((span) => span.textContent === "Conflicts · 1")).toBe(true);

    fireEvent.click(radio(card!, "source"));
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
    expect(session.entries.get("a")!.draft).toEqual(liftDraft(Draft, { id: "a", end: 7n }));
    // Every one chosen: it says so — Theirs taken, nothing is left to save — and the card folds to how it is chosen,
    // which opens it again.
    await waitFor(() => expect(ui.getByText("The conflict is chosen. Nothing is left to save.")).toBeTruthy());
    expect(cards()[0]!.querySelector("input")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "End · used theirs: 7" }));
    expect(radio(cards()[0]!, "source").checked).toBe(true);
    // The button stays while the popover is open, the count gone.
    expect(button()!.hasAttribute("data-settled")).toBe(true);

    act(() => session.undo());
    expect([session.unsettled, session.pending]).toEqual([1, 1]);
    expect([radio(cards()[0]!, "draft").checked, radio(cards()[0]!, "source").checked]).toEqual([false, false]);
    // Kept, the draft's value stands against the newer one: Save sends it.
    fireEvent.click(radio(cards()[0]!, "draft"));
    expect([session.unsettled, session.canApply]).toEqual([0, true]);
    expect(session.entries.get("a")!.draft).toEqual(liftDraft(Draft, { id: "a", end: 4n }));
});

test("Keep all mine and Use all theirs choose every one, chosen or not, in one step", async () => {
    const session = conflicted(["a", "b"]);
    const ui = mount(session);
    await opened(2);
    fireEvent.click(radio(cards()[0]!, "draft"));
    fireEvent.click(ui.getByRole("button", { name: "Use all theirs" }));
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
    act(() => session.undo());
    // One step back: a still chosen as kept, b waiting again.
    expect(session.unsettled).toBe(1);
    expect(session.settled.map((settled) => [settled.id, settled.choice])).toEqual([["a", "draft"]]);
    fireEvent.click(ui.getByRole("button", { name: "Keep all mine" }));
    expect([session.unsettled, session.canApply]).toEqual([0, true]);
});

test("Go to goes to a conflict's item as an issue's click does: a history finds its session by it", async () => {
    const history = new EditHistory<string>();
    history.sync([["runs", conflicted(["a"])], ["shifts", conflicted(["c"])]]);
    const ui = mount(history);
    expect(button()!.textContent).toBe("2");
    await opened(2);
    expect(cards().map((card) => card.querySelector("[data-conflict-item]")!.textContent)).toEqual(["Run a", "Run c"]);
    fireEvent.click(cards()[1]!.querySelector("button")!);
    // Handed the conflict's issue, and where the conflict is in its entry.
    const [issue, at] = ui.onIssue.mock.calls[0]!;
    expect(issue).toEqual({ entry: "c", row: none, field: some("end"), message: editingMessages.issueConflict() });
    expect(at).toEqual([{ kind: "field", name: "end" }, { kind: "variant", tag: "value" }]);
    expect(history.sourceOf(issue)).toBe("shifts");
    // A choice is one step of the history, in its session.
    fireEvent.click(radio(cards()[1]!, "source"));
    expect([history.unsettled, history.session("shifts")!.unsettled, history.canUndo]).toEqual([1, 0, true]);
    act(() => history.undo());
    expect(history.unsettled).toBe(2);
});

test("a collection that names a conflict's part names its card by it; one it does not name, by its entry and the steps in words", async () => {
    // Handed the steps the card names it by after the entry's name: none here, the end its label.
    const steps: (readonly string[])[] = [];
    const conflictItem = (issue: EditIssue, at: PatchPath, words: readonly string[]) => {
        steps.push(words);
        return issue.entry === "b" && at[0]?.kind === "field" ? `The ${issue.entry} run's ${at[0].name}` : undefined;
    };
    mount(conflicted(["a", "b"]), { conflictItem });
    await opened(2);
    expect(cards().map((card) => card.querySelector("[data-conflict-item]")!.textContent)).toEqual(["Run a", "The b run's end"]);
    expect(steps.every((words) => words.length === 0)).toBe(true);
});

test("in a narrow frame Go to closes the popover, which would cover the item, and the button stays", async () => {
    const ui = mount(conflicted(["a"]));
    await opened(1);
    vi.spyOn(button()!.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 320 } as DOMRect);
    fireEvent.click(cards()[0]!.querySelector("button")!);
    expect(ui.onIssue).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(button()!.textContent).toBe("1");
});

test("locked while an optimiser run is out: it opens, its choices and its foot aria-disabled — their place and the focus kept — and the live dot says why", async () => {
    const session = conflicted(["a"]);
    const ui = mount(session, { locked: true });
    expect(button()!.closest("[data-conflicts]")).toBeTruthy();
    await opened(1);
    const notice = document.querySelector('[data-conflicts-notice="locked"]')!;
    expect(notice.textContent).toBe("Choices are off while the optimiser runs");
    expect(notice.querySelector("span[aria-hidden]")).not.toBeNull();
    const [draft, source] = [radio(cards()[0]!, "draft"), radio(cards()[0]!, "source")];
    expect([draft.disabled, draft.getAttribute("aria-disabled"), source.getAttribute("aria-disabled")]).toEqual([false, "true", "true"]);
    const keepAll = ui.getByRole("button", { name: "Keep all mine" }) as HTMLButtonElement;
    expect([keepAll.disabled, keepAll.getAttribute("aria-disabled")]).toEqual([false, "true"]);
    fireEvent.click(radio(cards()[0]!, "source"));
    fireEvent.click(keepAll);
    expect(session.unsettled).toBe(1);
});

test("once every one is chosen, the button leaves as the popover closes", async () => {
    const session = conflicted(["a"]);
    const ui = mount(session);
    await opened(1);
    fireEvent.click(ui.getByRole("button", { name: "Use all theirs" }));
    expect(button()).not.toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(button()).toBeNull());
});

test("the banner says how many of the person's changes conflict, and its Choose opens the bar's popover — while a bar holds the session", async () => {
    const session = conflicted(["a", "b"]);
    const alone = render(<ChakraProvider value={system}><SessionBanners session={session} words={WORDS} onAction={() => undefined} /></ChakraProvider>);
    const banner = () => document.querySelector<HTMLElement>('[data-session-banner="conflicts"]');
    expect(banner()!.textContent).toContain("2 of your changes conflict with newer changes");
    // The design system's Banner, a guard band under the toolbar: the conflicts mark, its word, the message — and no live
    // role of its own, the conflicts button's live region saying it once.
    const root = banner()!.firstElementChild!;
    expect([root.getAttribute("data-banner-tone"), root.getAttribute("data-banner-form"), root.getAttribute("role")]).toEqual(["guard", "band", null]);
    expect(root.querySelector("[data-banner-word]")!.textContent).toBe("Conflict");
    expect(root.querySelector('[data-banner-mark] svg[data-icon="not-equal"]')).not.toBeNull();
    // No bar holds the session: nothing to open.
    expect(banner()!.querySelector("[data-banner-action]")).toBeNull();
    alone.unmount();
    render(
        <ChakraProvider value={system}>
            <SessionBanners session={session} words={WORDS} onAction={() => undefined} />
            <Bar session={session} words={WORDS} editing={false} onAction={() => undefined} onIssue={() => undefined} />
        </ChakraProvider>,
    );
    fireEvent.click(banner()!.querySelector('[data-banner-action="choose"]')!);
    await waitFor(() => expect(cards()).toHaveLength(2));
    // Every one chosen: the banner goes.
    fireEvent.click(screen.getByRole("button", { name: "Use all theirs" }));
    expect(banner()).toBeNull();
});

// ── An item's dates, one card ─────────────────────────────────────────────

const Booking = StructType({ id: StringType, start: DateTimeType, end: DateTimeType });
const BookingDraft = Editing.Types.Draft(Booking);
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 6));
const booking = (from: number, to: number): EntryVersion<string> => ({ draft: liftDraft(BookingDraft, { id: "B1", start: day(from), end: day(to) }), wire: "B1", place: start });

test("an item moved both ways is one card — its dates whole on each side — and one choice settles both, one step Undo takes back", async () => {
    const session = new EditSession<string>({
        sourceId: "bookings", entryType: Booking, draftType: BookingDraft, idField: "id", auto: false, ranges: [{ start: "start", end: "end" }],
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "B1", start: day(16), end: day(20) }]));
    session.record([{ id: "B1", before: booking(16, 20), after: booking(17, 21) }], "drop", "Move B1");
    // Another write moves it to the 23rd–27th: both its start and its end clash, and wait as one.
    session.observeBase(variant("snapshot", [{ id: "B1", start: day(23), end: day(27) }]));
    expect(session.conflicts.get("B1")!.points).toHaveLength(2);
    expect(session.unsettled).toBe(1);
    const ui = mount(session);
    expect(button()!.textContent).toBe("1");
    await opened(1);
    const [card] = cards();
    expect(card!.textContent).toContain("Dates");
    expect(ui.getByRole("radio", { name: `Yours, ${WORDS.range(day(17), day(21))}` })).toBe(radio(card!, "draft"));
    expect(radio(card!, "source").getAttribute("aria-label")).toBe(`Theirs, ${WORDS.range(day(23), day(27))}, Changed since you started editing · was ${WORDS.range(day(16), day(20))}`);

    fireEvent.click(radio(card!, "source"));
    expect([session.unsettled, session.chosen]).toEqual([0, 1]);
    expect(session.entries.get("B1")!.draft).toEqual(booking(23, 27).draft);
    act(() => session.undo());
    expect([session.unsettled, session.chosen, session.conflicts.get("B1")!.points.length]).toEqual([1, 0, 2]);
});


test("an entry drafted whole, as a schedule's kinds draft their rows, reads its dates on one card all the same", async () => {
    const WholeDraft = EditingDraftFieldType(Booking);
    const whole = (from: number, to: number): EntryVersion<string> => ({ draft: liftDraft(WholeDraft, { id: "B1", start: day(from), end: day(to) }), wire: "B1", place: start });
    const session = new EditSession<string>({
        sourceId: "bookings", entryType: Booking, draftType: WholeDraft, idField: "id", auto: false, ranges: [{ start: "start", end: "end" }],
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "B1", start: day(16), end: day(20) }]));
    session.record([{ id: "B1", before: whole(16, 20), after: whole(17, 21) }], "drop", "Move B1");
    session.observeBase(variant("snapshot", [{ id: "B1", start: day(23), end: day(27) }]));
    expect(session.unsettled).toBe(1);
    const ui = mount(session);
    await opened(1);
    const [card] = cards();
    expect(card!.textContent).toContain("Dates");
    expect(ui.getByRole("radio", { name: `Yours, ${WORDS.range(day(17), day(21))}` })).toBe(radio(card!, "draft"));
});

const Bin = StructType({ id: StringType, m3: IntegerType, kilns: DictType(StringType, IntegerType) });
const BinDraft = Editing.Types.Draft(Bin);
type BinDraftValue = ValueTypeOf<typeof BinDraft>;
const sameBinDraft = equalFor(BinDraft);
/** A bin of its quantity, all of it on one kiln. */
const binOf = (m3: bigint) => ({ id: "b1", m3, kilns: new SortedMap([["K-209", m3]], compareFor(StringType)) });
const bin = (m3: bigint): EntryVersion<string> => ({ draft: liftDraft(BinDraft, binOf(m3)), wire: "b1", place: start });

test("a quantity changed both ways is one card under its own name — the split that follows it on it — and one choice settles both", async () => {
    const session = new EditSession<string>({
        sourceId: "bins", entryType: Bin, draftType: BinDraft, idField: "id", auto: false, together: [{ lead: "m3", with: ["kilns"], label: "Quantity" }],
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [binOf(20n)]));
    session.record([{ id: "b1", before: bin(20n), after: bin(30n) }], "typed", "Set quantity");
    // Another write sets it to 45: its quantity and its split both clash, and wait as one.
    session.observeBase(variant("snapshot", [binOf(45n)]));
    expect(session.conflicts.get("b1")!.points).toHaveLength(2);
    expect(session.unsettled).toBe(1);
    const ui = mount(session);
    expect(button()!.textContent).toBe("1");
    await opened(1);
    const [card] = cards();
    expect(card!.textContent).toContain("Quantity");
    expect(ui.getByRole("radio", { name: "Yours, 30" })).toBe(radio(card!, "draft"));

    fireEvent.click(radio(card!, "source"));
    expect([session.unsettled, session.chosen]).toEqual([0, 1]);
    expect(sameBinDraft(session.entries.get("b1")!.draft as BinDraftValue, bin(45n).draft as BinDraftValue)).toBe(true);
    act(() => session.undo());
    expect([session.unsettled, session.chosen, session.conflicts.get("b1")!.points.length]).toEqual([1, 0, 2]);
});


// ── Each value as the component shows it ─────────────────────────────────

const Note = StructType({ id: StringType, note: StringType });
const NoteDraft = Editing.Types.Draft(Note);
const noteOf = (note: string): EntryVersion<string> => ({ draft: liftDraft(NoteDraft, { id: "n1", note }), wire: "n1", place: start });
const BEGAN = "Crane booked for the morning shift on 16 Nov. Access via gate 1; escort required past the substation.";
const MINE = "Crane booked for the morning shift on 16 Nov. Access via gate 3; escort required past the substation.";
const THEIRS = "Crane booked for the afternoon shift on 16 Nov. Access via gate 5; escort required past the substation.";

test("a number reads in mono; absence in words, in the absent style", async () => {
    mount(conflicted(["a"]));
    await opened(1);
    const value = (choice: "draft" | "source") => cards()[0]!.querySelector<HTMLElement>(`[data-choice=${choice}] [data-form]`)!;
    expect([value("draft").getAttribute("data-form"), value("draft").textContent]).toEqual(["mono", "4"]);
    // Another write removes the run: Theirs reads Removed, absent.
    const gone = drafted(["b"]);
    gone.observeBase(variant("snapshot", []));
    cleanup();
    mount(gone);
    await opened(1);
    expect([value("source").getAttribute("data-form"), value("source").textContent]).toEqual(["absent", "Removed"]);
});

test("a long text reads two lines, and Show all opens both in place, the words that differ marked in each", async () => {
    const session = new EditSession<string>({
        sourceId: "notes", entryType: Note, draftType: NoteDraft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "n1", note: BEGAN }]));
    session.record([{ id: "n1", before: noteOf(BEGAN), after: noteOf(MINE) }], "typed", "Edit the note");
    session.observeBase(variant("snapshot", [{ id: "n1", note: THEIRS }]));
    const ui = mount(session);
    await opened(1);
    const value = (choice: "draft" | "source") => cards()[0]!.querySelector<HTMLElement>(`[data-choice=${choice}] [data-form]`)!;
    expect([value("draft").getAttribute("data-form"), value("draft").hasAttribute("data-open")]).toEqual(["text", false]);
    expect(value("draft").querySelector("mark")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Show all" }));
    expect(value("draft").hasAttribute("data-open")).toBe(true);
    const marked = (choice: "draft" | "source") => [...value(choice).querySelectorAll("mark")].map((mark) => mark.textContent);
    expect(marked("draft")).toEqual(["morning", "3;"]);
    expect(marked("source")).toEqual(["afternoon", "5;"]);
    expect(value("source").textContent).toBe(THEIRS);
    fireEvent.click(ui.getByRole("button", { name: "Show less" }));
    expect(value("draft").hasAttribute("data-open")).toBe(false);
});

test("while the newest data is read, the head counts nothing: the live dot says so, over Skeleton cards", async () => {
    const Shift = StructType({ hours: IntegerType });
    const ShiftDraft = Editing.Types.Draft(Shift);
    const shift = (hours: bigint): EntryVersion<string> => ({ draft: liftDraft(ShiftDraft, { hours }), wire: "s1", place: some(variant("keyOrder", null)) });
    const session = new EditSession<string>({
        sourceId: "shifts", entryType: Shift, draftType: ShiftDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "s1", before: shift(8n), after: shift(10n) }], "typed", "Set hours");
    session.observeBase(variant("revision", "r2"));
    session.merge(variant("revision", "r2"), () => some({ hours: 9n }));
    mount(session);
    await opened(1);
    const head = () => [...document.querySelectorAll("span")].find((span) => span.textContent?.startsWith("Conflicts"))!.textContent;
    expect(head()).toBe("Conflicts · 1");
    // The source moves again: its newest data is read.
    act(() => session.observeBase(variant("revision", "r3")));
    await waitFor(() => expect(document.querySelector('[data-conflicts-notice="checking"]')).not.toBeNull());
    expect(document.querySelector('[data-conflicts-notice="checking"]')!.textContent).toBe("Checking your changes against the newest data");
    expect([document.querySelectorAll("[data-conflict-skeleton]").length, cards().length, head()]).toEqual([2, 0, "Conflicts"]);
});
