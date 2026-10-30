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
import { IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
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
    const onIssue = vi.fn<(issue: EditIssue) => void>();
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
    // Before Undo, the first of the history's buttons.
    const names = [...ui.container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names.indexOf("Undo") - names.indexOf("2 conflicts")).toBe(1);
    expect((ui.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(ui.getByText("Conflicts · 1")).toBeTruthy();

    fireEvent.click(radio(card!, "source"));
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
    expect(session.entries.get("a")!.draft).toEqual(liftDraft(Draft, { id: "a", end: 7n }));
    // Every one chosen: it says so, and the card folds to how it is chosen, which opens it again.
    await waitFor(() => expect(ui.getByText("The conflict is chosen. Save is on.")).toBeTruthy());
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
    const [issue] = ui.onIssue.mock.calls[0]!;
    expect(issue).toEqual({ entry: "c", row: none, field: some("end"), message: editingMessages.issueConflict() });
    expect(history.sourceOf(issue)).toBe("shifts");
    // A choice is one step of the history, in its session.
    fireEvent.click(radio(cards()[1]!, "source"));
    expect([history.unsettled, history.session("shifts")!.unsettled, history.canUndo]).toEqual([1, 0, true]);
    act(() => history.undo());
    expect(history.unsettled).toBe(2);
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

test("locked while an optimiser run is out: it opens, its choices and its foot are off, and it says why", async () => {
    const session = conflicted(["a"]);
    const ui = mount(session, { locked: true });
    await opened(1);
    expect(ui.getByText("An optimiser run is in progress. Choose once it finishes.")).toBeTruthy();
    expect([radio(cards()[0]!, "draft").disabled, radio(cards()[0]!, "source").disabled]).toEqual([true, true]);
    expect((ui.getByRole("button", { name: "Keep all mine" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(radio(cards()[0]!, "source"));
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
