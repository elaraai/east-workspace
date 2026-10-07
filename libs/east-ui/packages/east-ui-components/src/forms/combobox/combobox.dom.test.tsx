/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * The shared Combobox's list when the focus moves outside it (#1228). On a
 * desktop Zag hears the focus move (`focusin` on the document) and its own
 * outside interaction closes the list, reverting text no item holds where
 * custom values are refused; the combobox leaves it so. On a touch screen Zag
 * listens for no focus, so the combobox hears it as Zag would, and closes the
 * list as Zag would: the box left as Zag leaves it, its host hearing what it
 * hears on a desktop, and the focus left where it went. Every way out, and
 * every journey of the focus, runs on both against the same expectations: a
 * blur to nothing closes nothing, a focus inside closes nothing, a tap is
 * Zag's own dismissal.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, none, some } from "@elaraai/east";
import { Combobox } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { closedText, type ComboboxSelectionBehavior } from "./close-on-focus-outside.js";
import { EastChakraCombobox, type ComboboxRootValue } from "./index.js";

/** Ark positioners observe sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}
// jsdom has no `CSS.escape`, and the combobox finds its highlighted item with it, to scroll it into view — every browser has one.
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

/** A touch screen as Zag tells one (`navigator.maxTouchPoints`). */
const touchScreen = () => { Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true }); };

/** The list, while it is open. */
const openContent = () => document.querySelector('[data-scope="combobox"][data-part="content"][data-state="open"]');
/** The combobox's box, as it is now. */
const theBox = () => screen.getByPlaceholderText("Search...") as HTMLInputElement;
/** The control outside the combobox. */
const elsewhere = () => screen.getByRole("button", { name: "Elsewhere" });
/** A part of the combobox, by its name. */
const part = (name: string) => () => document.querySelector<HTMLElement>(`[data-scope="combobox"][data-part="${name}"]`)!;

/** Two animation frames: what Zag defers — its outside interaction, and a focus put back in the box — and what the combobox defers as Zag does, has run. */
const frames = () => act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));

/** A finger on a touch screen, as its pointer events say. */
const finger = { pointerType: "touch", button: 0 } as const;

/** What the combobox's host hears, in order: its box's text, its list opening and closing, and its picks. */
type Heard = ["text", string] | ["open", boolean] | ["picked", string[]];

/**
 * A combobox over two woods — `root` setting what else it is, `behavior` its
 * renderer's `selectionBehavior` — beside a control outside it, its list
 * open: an item picked from it first if `pick` names one, then `typed` typed.
 * What its host hears, from the start.
 */
async function mount(root: Partial<ComboboxRootValue>, typed: string, pick?: string, behavior?: ComboboxSelectionBehavior) {
    const heard: Heard[] = [];
    const value: ComboboxRootValue = {
        ...defaultValue<typeof Combobox.Types.Root>(Combobox.Types.Root),
        items: [{ value: "oak", label: "Oak", disabled: none }, { value: "ash", label: "Ash", disabled: none }],
        onInputValueChange: some((text: string) => { heard.push(["text", text]); return null; }),
        onOpenChange: some((open: boolean) => { heard.push(["open", open]); return null; }),
        onChangeMultiple: some((picked: string[]) => { heard.push(["picked", picked]); return null; }),
        ...root,
    };
    const view = render(
        <ChakraProvider value={system}>
            <EastChakraCombobox value={value} {...(behavior !== undefined && { selectionBehavior: behavior })} />
            <button type="button">Elsewhere</button>
        </ChakraProvider>,
    );
    const user = userEvent.setup();
    const box = theBox();
    if (pick !== undefined) {
        await user.click(part("trigger")());
        await waitFor(() => expect(openContent()).not.toBeNull());
        const item = screen.getByText(pick).closest<HTMLElement>('[data-part="item"]')!;
        fireEvent.pointerDown(item, finger);
        fireEvent.click(item);
        await waitFor(() => expect(heard.map(([kind]) => kind)).toContain("picked"));
    }
    await user.type(box, typed);
    await waitFor(() => expect(openContent()).not.toBeNull());
    await waitFor(() => expect(heard).toContainEqual(["open", true]));
    // The list's dismissable layer hears the focus two frames after the list opens, and a pointer a task after that.
    await frames();
    await frames();
    return { heard, user, box, view };
}

/**
 * A Tab out of the box, its list open: what the box is left holding, and all
 * its host hears — the same on a desktop, where Zag closes the list, as on a
 * touch screen, where the combobox does.
 */
const LEAVING: { name: string; root: Partial<ComboboxRootValue>; behavior?: ComboboxSelectionBehavior; pick?: string; typed: string; left: string; heard: Heard[] }[] = [
    {
        name: "text no item holds, custom values refused (East's default), is reverted — emptied, with nothing selected (`replace`, a single value's default)",
        root: {}, typed: "zz", left: "",
        heard: [["text", "z"], ["open", true], ["text", "zz"], ["text", ""], ["open", false]],
    },
    {
        name: "text no item holds, custom values refused, is reverted — to the selected item's label (`replace`)",
        root: { value: some("oak") }, typed: "zz", left: "Oak",
        heard: [["text", "z"], ["open", true], ["text", "zz"], ["text", "Oak"], ["open", false]],
    },
    {
        name: "text no item holds, custom values refused, is kept where the renderer keeps the box's text (`preserve`)",
        root: {}, behavior: "preserve", typed: "zz", left: "zz",
        heard: [["text", "z"], ["open", true], ["text", "zz"], ["open", false]],
    },
    {
        name: "text no item holds is kept where custom values are (`allowCustomValue`)",
        root: { allowCustomValue: some(true) }, typed: "zz", left: "zz",
        heard: [["text", "z"], ["open", true], ["text", "zz"], ["open", false]],
    },
    {
        name: "a multiple's text no item holds is emptied (`clear`, a multiple's default), its pick kept",
        root: { multiple: some(true) }, pick: "Oak", typed: "zz", left: "",
        heard: [["open", true], ["picked", ["oak"]], ["text", "z"], ["text", "zz"], ["text", ""], ["open", false]],
    },
];

/** A step of a journey, its list open at the start: what is done, then whether the list is open, what the box holds, and all its host has heard. */
interface Step { what: string; run: (user: ReturnType<typeof userEvent.setup>) => void | Promise<void>; open: boolean; left: string; heard: Heard[] }

/** The focus moved, by script, onto what `find` finds. */
const focusOnto = (find: () => HTMLElement) => () => { act(() => { find().focus(); }); };

/** A finger's tap on what `find` finds, in the order a touch screen sends it: down, up, the focus onto it, the click. */
const tap = (find: () => HTMLElement) => () => {
    const el = find();
    fireEvent.pointerDown(el, finger);
    fireEvent.pointerUp(el, finger);
    act(() => { el.focus(); });
    fireEvent.click(el);
};

/** What the host has heard by the time "zz" is typed, and by the time "a" is. */
const ZZ: Heard[] = [["text", "z"], ["open", true], ["text", "zz"]];
const A: Heard[] = [["text", "a"], ["open", true]];

/**
 * Journeys of the focus, the list open — the same on a desktop, where Zag
 * hears the focus, as on a touch screen, where the combobox does. `zag`: every
 * close in it is Zag's own on both, so the box is never started again. `ends`:
 * where the focus is at the end, the control outside unless it says.
 */
const JOURNEYS: { name: string; root: Partial<ComboboxRootValue>; typed: string; zag?: true; ends?: () => HTMLElement; steps: Step[] }[] = [
    {
        name: "a blur to nothing — the phone's keyboard dismissed — closes nothing; the focus moved outside after it closes the list",
        root: {}, typed: "zz",
        steps: [
            { what: "the box blurred to nothing", run: () => { act(() => { theBox().blur(); }); }, open: true, left: "zz", heard: ZZ },
            { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
        ],
    },
    {
        name: "the focus moved inside — onto the trigger, the clear trigger, the list, an item and the box — closes nothing; moved outside, it closes the list",
        root: { value: some("oak") }, typed: "a",
        steps: [
            { what: "onto the trigger", run: focusOnto(part("trigger")), open: true, left: "a", heard: A },
            { what: "onto the clear trigger", run: focusOnto(part("clear-trigger")), open: true, left: "a", heard: A },
            { what: "onto the list", run: focusOnto(part("content")), open: true, left: "a", heard: A },
            { what: "onto an item", run: focusOnto(() => screen.getByText("Ash").closest<HTMLElement>('[data-part="item"]')!), open: true, left: "a", heard: A },
            { what: "onto the box", run: focusOnto(theBox), open: true, left: "a", heard: A },
            { what: "outside", run: focusOnto(elsewhere), open: false, left: "Oak", heard: [...A, ["text", "Oak"], ["open", false]] },
        ],
    },
    {
        name: "a focus with no element for its target, or onto a control gone before the next frame, closes nothing; moved outside, it closes the list",
        root: {}, typed: "zz",
        steps: [
            { what: "a focusin on the document itself", run: () => { act(() => { document.dispatchEvent(new FocusEvent("focusin")); }); }, open: true, left: "zz", heard: ZZ },
            {
                what: "the focus moved onto a control removed before the next frame",
                run: () => { act(() => { const gone = document.createElement("button"); document.body.append(gone); gone.focus(); gone.remove(); }); },
                open: true, left: "zz", heard: ZZ,
            },
            { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
        ],
    },
    {
        name: "the focus moved outside and back into the box within a frame — as Zag's own initial focus takes it back after an open — closes the list, the focus left in the box",
        root: {}, typed: "zz", ends: theBox,
        steps: [
            {
                what: "the focus moved outside, then back into the box",
                run: () => { act(() => { elsewhere().focus(); theBox().focus(); }); },
                open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]],
            },
        ],
    },
    {
        name: "a tap on the box keeps the list open; the focus moved outside after it closes the list",
        root: {}, typed: "zz",
        steps: [
            { what: "a tap on the box", run: tap(theBox), open: true, left: "zz", heard: ZZ },
            { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
        ],
    },
    {
        name: "closed by the focus moved outside, then the box focused again and left, its list closed: nothing more is heard",
        root: {}, typed: "a",
        steps: [
            { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "", heard: [...A, ["text", ""], ["open", false]] },
            { what: "the box focused again", run: focusOnto(theBox), open: false, left: "", heard: [...A, ["text", ""], ["open", false]] },
            { what: "the focus moved outside again", run: focusOnto(elsewhere), open: false, left: "", heard: [...A, ["text", ""], ["open", false]] },
        ],
    },
    {
        name: "closed by Escape, then the focus moved outside: nothing more is heard",
        root: {}, typed: "zz", zag: true,
        steps: [
            { what: "Escape", run: async (user) => { await user.keyboard("{Escape}"); }, open: false, left: "zz", heard: [...ZZ, ["open", false]] },
            { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "zz", heard: [...ZZ, ["open", false]] },
        ],
    },
    {
        name: "a tap outside, on a control that takes the focus, is Zag's own dismissal: it closes the list, the box never started again",
        root: {}, typed: "zz", zag: true,
        steps: [
            { what: "a tap on the control outside", run: tap(elsewhere), open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
        ],
    },
    {
        name: "a focus moved while a finger is down — a long press — is the finger's: the list stays open until its click closes it, Zag's own dismissal",
        root: {}, typed: "zz", zag: true,
        steps: [
            {
                what: "a finger pressed on the control outside, and the focus moved onto it while it is down",
                run: () => { fireEvent.pointerDown(elsewhere(), finger); act(() => { elsewhere().focus(); }); },
                open: true, left: "zz", heard: ZZ,
            },
            { what: "the finger lifted", run: () => { fireEvent.pointerUp(elsewhere(), finger); }, open: true, left: "zz", heard: ZZ },
            { what: "its click", run: () => { fireEvent.click(elsewhere()); }, open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
        ],
    },
];

/** Walks a journey's steps, each checked a frame after it: the list, the box's text and all the host has heard. */
async function walk(steps: readonly Step[], heard: Heard[], user: ReturnType<typeof userEvent.setup>) {
    for (const { what, run, open, left, heard: expected } of steps) {
        await run(user);
        await frames();
        await waitFor(() => expect(openContent() !== null, what).toBe(open));
        await waitFor(() => expect(heard, what).toEqual(expected));
        await waitFor(() => expect(theBox().value, what).toBe(left));
    }
}

for (const { device, touch } of [{ device: "on a desktop, where Zag closes the list itself", touch: false }, { device: "on a touch screen", touch: true }]) {
    describe(`${device} (#1228)`, () => {
        if (touch) beforeEach(touchScreen);

        for (const { name, root, behavior, pick, typed, left, heard: expected } of LEAVING) {
            test(`Tab out of the box: ${name} — the focus left where it went`, async () => {
                const { heard, user, box } = await mount(root, typed, pick, behavior);
                await user.tab();
                expect(elsewhere()).toBe(document.activeElement);
                await waitFor(() => expect(openContent()).toBeNull());
                await waitFor(() => expect(heard).toEqual(expected));
                await waitFor(() => expect(theBox().value).toBe(left));
                // A close that put the focus back in the box would do so a frame later.
                await frames();
                expect(elsewhere()).toBe(document.activeElement);
                expect(heard).toEqual(expected);
                // On a desktop, Zag's close, never the combobox's: the same box, never started again.
                if (!touch) expect(box.isConnected).toBe(true);
            });
        }

        for (const { name, root, typed, zag, ends, steps } of JOURNEYS) {
            test(name, async () => {
                const { heard, user, box } = await mount(root, typed);
                await walk(steps, heard, user);
                expect((ends ?? elsewhere)()).toBe(document.activeElement);
                if (!touch || zag === true) expect(box.isConnected).toBe(true);
            });
        }

        test("unmounted with its list open, nothing is heard after, wherever the focus moves", async () => {
            const { heard, view } = await mount({}, "zz");
            view.rerender(<ChakraProvider value={system}><button type="button">Elsewhere</button></ChakraProvider>);
            act(() => { elsewhere().focus(); });
            await frames();
            expect(heard).toEqual(ZZ);
        });

        if (touch) {
            // Zag's own `isPointerDown` waits for a `pointerup`, which a pan never sends: its focus path
            // never runs on a touch screen, and on a desktop a pointer is seldom cancelled.
            test("a pan — a finger pressed, then cancelled, never lifted — leaves the focus heard: moved outside after it, the list closes", async () => {
                const { heard, user } = await mount({}, "zz");
                await walk([
                    {
                        what: "a finger panning the list", open: true, left: "zz", heard: ZZ,
                        run: () => { fireEvent.pointerDown(part("content")(), finger); fireEvent.pointerCancel(part("content")(), finger); },
                    },
                    { what: "the focus moved outside", run: focusOnto(elsewhere), open: false, left: "", heard: [...ZZ, ["text", ""], ["open", false]] },
                ], heard, user);
                expect(elsewhere()).toBe(document.activeElement);
            });
        }
    });
}

describe("closedText — the box's text after an outside close, as Zag's revertInputValue leaves it (#1228)", () => {
    test("text that is the selection's own — where even `clear` would empty it — or where custom values are kept, stays", () => {
        expect(closedText("Oak", "Oak", "clear", false)).toBe("Oak");
        expect(closedText("", "", "clear", false)).toBe("");
        expect(closedText("zz", "Oak", "replace", true)).toBe("zz");
        expect(closedText("zz", "", "clear", true)).toBe("zz");
    });

    test("custom text refused: replace puts back the selection's labels (or empties the box with none), preserve keeps it, clear empties it", () => {
        expect(closedText("zz", "Oak, Ash", "replace", false)).toBe("Oak, Ash");
        expect(closedText("zz", "", "replace", false)).toBe("");
        expect(closedText("zz", "Oak", "preserve", false)).toBe("zz");
        expect(closedText("zz", "Oak", "clear", false)).toBe("");
    });
});
