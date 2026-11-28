/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * TagsInput suggestions (#131, east-workspace#1779): the app's own, never the
 * browser's `<datalist>`. On a desktop, a list under the box, the app's
 * combobox list: no datalist and no `list` link, the box the list's input;
 * what is typed opens it with the suggestions the tags don't hold, those the
 * words start first; a press, or ↓ and ⏎, takes one as a tag at once, the box
 * emptied and the list shut, and ⏎ with none chosen makes what is typed the
 * tag; words matching none shut it. No suggestions, or a read-only input, offer
 * none. In a phone's frame, which has no desktop-style popover (ruled 4 Nov
 * 2026), the suggestions are a row of chips under the box instead
 * (east-workspace#1741): those the tags don't hold, what is typed narrowing
 * them, a press taking one as a tag and clearing the box.
 *
 * Its name (#1758): inside a Field, the box a tag is typed in is named by the
 * field's label and described by its help — the label is `for` the hidden
 * input that carries the tags — and outside one it carries neither.
 *
 * What is typed in its box and not Entered (#1758): Esc puts it back, so the
 * box is empty and leaving it adds nothing, and while the box holds words the
 * Esc is its own — it says so and takes the key, the list shut too — so what it
 * lies in stays (east-workspace#1779); and as the tags input is left it is a
 * tag (`blurBehavior: add`) or is cleared (`clear`) — as the keyboard leaves
 * it, on a device that takes touch too, where the tags input's own tracking
 * hears no focus move, its list open or not: the list shut, and the keyboard
 * left where it went, on every device; and as a press outside it lets go: never as that press
 * begins, so what it pressed stays where it was pressed, and ahead of the click
 * its release makes, which hears the tag (east-workspace#1779). The keyboard
 * moving to one of its own tags' ×, or a press on one of its own suggestions,
 * leaves it as typed.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, Field } from "@chakra-ui/react";
import { defaultValue, some, none, variant } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { FramePhoneLayer } from "../../layout/builder-frame/frame-layer.js";
import { releasePress } from "../../testing/pointer.js";
import { EastChakraTagsInput, type TagsInputValue } from "./index.js";

afterEach(cleanup);

/** The list's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
// jsdom has no `CSS.escape`, and the list finds its highlighted item with it, to scroll it into view — every browser has one.
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });

/** A tags input's payload as FieldForm builds one: East's default of its type, with the fields a test sets. */
const BASE = defaultValue<typeof TagsInput.Types.Root>(TagsInput.Types.Root);

function tagsValue(suggestions?: string[], held: string[] = [], readOnly = false): TagsInputValue {
    return { ...BASE, value: held, suggestions: suggestions !== undefined ? some(suggestions) : none, readOnly: readOnly ? some(true) : none };
}

/** The payload with a blur behaviour, and its host told each edit. */
function toldValue(blurBehavior: "add" | "clear", suggestions: string[] | undefined, held: string[], told: string[][]): TagsInputValue {
    return {
        ...tagsValue(suggestions, held), blurBehavior: some(variant(blurBehavior, null)),
        onChange: some((tags: string[]) => { told.push([...tags]); return null; }),
    } as TagsInputValue;
}

const ui = (value: TagsInputValue) =>
    render(<ChakraProvider value={system}><EastChakraTagsInput value={value} /></ChakraProvider>);

/** The input drawn in a phone's frame: its phone layer given, as the frame gives it at 560px and narrower. */
const phoneUi = (value: TagsInputValue) =>
    render(
        <ChakraProvider value={system}>
            <FramePhoneLayer.Provider value={document.createElement("div")}><EastChakraTagsInput value={value} /></FramePhoneLayer.Provider>
        </ChakraProvider>,
    );

const REGISTER = ["Forklift", "Confined space", "First aid", "Working at height"];

const offered = (container: HTMLElement) => [...container.querySelectorAll("[data-tags-suggestion]")].map((chip) => chip.textContent);
const tagsOf = (container: HTMLElement) => [...container.querySelectorAll('[data-scope="tags-input"][data-part="item-text"]')].map((tag) => tag.textContent);
/** The box a tag is typed in. */
const box = (container: HTMLElement) => container.querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
/** The list's suggestions as it shows them, portalled out of the field: none while it is shut. */
const listed = () => screen.queryAllByRole("option").map((option) => option.textContent);

/** Lets the tags input's microtasks and frames run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    });
}

/**
 * Waits the two frames an open list takes to hear the focus move outside it, as a person's next move always does: Zag
 * arms the list's layer a frame after it opens (`trackDismissableElement`, `defer`), and its outside tracking a frame
 * after that (`trackInteractOutside`), only then listening for a `focusin` (`@zag-js/dismissable`, `interact-outside`
 * 1.38). A Tab in those frames goes unheard, the list left open.
 */
async function listArmed() {
    await act(async () => {
        for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
    });
}

describe("TagsInput suggestions on a desktop: the app's own list under the box (east-workspace#1779)", () => {
    test("no browser list: the box is the list's input, still the tags input's box, and nothing is offered before words are typed", () => {
        const { container } = ui(tagsValue(REGISTER, ["Forklift"]));
        expect([container.querySelector("datalist"), box(container).getAttribute("list"), box(container).getAttribute("role")]).toEqual([null, null, "combobox"]);
        expect(listed()).toEqual([]);
    });

    test("what is typed opens the list: the suggestions its tags don't hold, those the words start first", async () => {
        const user = userEvent.setup();
        const { container } = ui(tagsValue(REGISTER, ["Forklift"]));
        await user.click(box(container));
        await user.keyboard("f");
        await waitFor(() => expect(listed()).toEqual(["First aid", "Confined space"]));
        expect(box(container).getAttribute("aria-expanded")).toBe("true");
    });

    test("a press on a suggestion takes it as a tag at once, the box emptied and the list shut; what was typed to find it is no tag", async () => {
        const told: string[][] = [];
        const user = userEvent.setup();
        const { container } = ui(toldValue("add", REGISTER, ["Forklift"], told));
        await user.click(box(container));
        await user.keyboard("f");
        await user.click(await screen.findByRole("option", { name: "First aid" }));
        await settle();
        expect([told, tagsOf(container), box(container).value, listed()]).toEqual([[["Forklift", "First aid"]], ["Forklift", "First aid"], "", []]);
    });

    test("after a press on a suggestion, what is typed next is the tags input's own, as before: the box says it takes Esc, which puts it back, and ⏎ makes it a tag (east-workspace#1779)", async () => {
        const told: string[][] = [];
        const user = userEvent.setup();
        const { container } = ui(toldValue("add", REGISTER, ["Forklift"], told));
        await user.click(box(container));
        await user.keyboard("f");
        await user.click(await screen.findByRole("option", { name: "First aid" }));
        await settle();
        await user.keyboard("draft");
        expect([box(container).value, box(container).hasAttribute("data-escape-layer")]).toEqual(["draft", true]);
        await user.keyboard("{Escape}");
        await settle();
        expect(box(container).value).toBe("");
        await user.keyboard("site visit{Enter}");
        await settle();
        expect([told.at(-1), tagsOf(container), box(container).value]).toEqual([["Forklift", "First aid", "site visit"], ["Forklift", "First aid", "site visit"], ""]);
    });

    test("↓ chooses a suggestion and ⏎ takes it; ⏎ with none chosen makes what is typed the tag, as it always has", async () => {
        const told: string[][] = [];
        const user = userEvent.setup();
        const { container } = ui(toldValue("add", REGISTER, ["Forklift"], told));
        await user.click(box(container));
        await user.keyboard("f");
        await waitFor(() => expect(listed()).toEqual(["First aid", "Confined space"]));
        await user.keyboard("{ArrowDown}{Enter}");
        await settle();
        expect([tagsOf(container), box(container).value]).toEqual([["Forklift", "First aid"], ""]);
        await user.keyboard("fork lift{Enter}");
        await settle();
        expect([told, tagsOf(container), box(container).value]).toEqual([
            [["Forklift", "First aid"], ["Forklift", "First aid", "fork lift"]], ["Forklift", "First aid", "fork lift"], "",
        ]);
    });

    test("words matching none shut the list; a read-only input, or one with no suggestions, offers none", async () => {
        const user = userEvent.setup();
        const { container } = ui(tagsValue(REGISTER, ["Forklift"]));
        await user.click(box(container));
        await user.keyboard("f");
        await waitFor(() => expect(listed()).not.toEqual([]));
        await user.keyboard("zz");
        await waitFor(() => expect([listed(), box(container).getAttribute("aria-expanded")]).toEqual([[], "false"]));
        cleanup();
        const readOnly = ui(tagsValue(REGISTER, [], true));
        expect(box(readOnly.container).getAttribute("role")).toBeNull();
        cleanup();
        const plain = ui(tagsValue());
        expect([plain.container.querySelector("datalist"), box(plain.container).getAttribute("role")]).toEqual([null, null]);
    });
});

describe("TagsInput suggestions in a phone's frame (east-workspace#1741)", () => {
    test("a row of chips under the box offers the suggestions its tags don't hold, in their order, and no list", () => {
        const { container } = phoneUi(tagsValue(REGISTER, ["Forklift"]));
        expect(container.querySelector("datalist")).toBeNull();
        expect(box(container).getAttribute("role")).toBeNull();
        expect(offered(container)).toEqual(["Confined space", "First aid", "Working at height"]);
    });

    test("what is typed narrows the chips, those it starts first; a press takes one as a tag and clears the box", async () => {
        const user = userEvent.setup();
        const { container } = phoneUi(tagsValue(REGISTER, ["Forklift"]));
        const input = box(container);
        await user.click(input);
        await user.keyboard("f");
        expect(offered(container)).toEqual(["First aid", "Confined space"]);
        await user.click(screen.getByRole("button", { name: "First aid" }));
        expect(tagsOf(container)).toEqual(["Forklift", "First aid"]);
        expect(input.value).toBe("");
        expect(offered(container)).toEqual(["Confined space", "Working at height"]);
    });

    test("words matching none leave the row standing with no chip in it, so the field keeps its height as it is typed in", async () => {
        const user = userEvent.setup();
        const { container } = phoneUi(tagsValue(REGISTER, ["Forklift"]));
        await user.click(box(container));
        await user.keyboard("zz");
        expect(container.querySelector("[data-tags-suggestions]")).not.toBeNull();
        expect(offered(container)).toEqual([]);
        await user.keyboard("{Backspace}{Backspace}");
        expect(offered(container)).toEqual(["Confined space", "First aid", "Working at height"]);
    });

    test("a read-only input, or one holding every suggestion, offers none", () => {
        expect(offered(phoneUi(tagsValue(REGISTER, [], true)).container)).toEqual([]);
        cleanup();
        const { container } = phoneUi(tagsValue(REGISTER, REGISTER));
        expect(container.querySelector("[data-tags-suggestions]")).toBeNull();
    });
});

describe("TagsInput in a Field (#1758)", () => {
    test("the box a tag is typed in is named by its field's label and described by its help, which the label's own `for` does not reach", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <Field.Root>
                    <Field.Label>Finishes</Field.Label>
                    <EastChakraTagsInput value={tagsValue(["matte", "gloss"])} />
                    <Field.HelperText>A word or two each.</Field.HelperText>
                </Field.Root>
            </ChakraProvider>,
        );
        const label = container.querySelector("label")!;
        // The label is for the hidden input that carries the tags: the box a person types in is another element.
        expect(label.getAttribute("for")).not.toBe(box(container).id);
        expect(label.getAttribute("for")).toBe(container.querySelector("[data-scope=tags-input][data-part=root] input[hidden]")!.id);
        expect(box(container).getAttribute("aria-labelledby")).toBe(label.id);
        expect(screen.getByRole("combobox", { name: "Finishes" })).toBe(box(container));
        const help = document.getElementById(box(container).getAttribute("aria-describedby") ?? "");
        expect(help?.textContent).toBe("A word or two each.");
    });

    test("outside a Field it names nothing: the input is as its value says", () => {
        const { container } = ui(tagsValue());
        expect([box(container).getAttribute("aria-labelledby"), box(container).getAttribute("aria-describedby")]).toEqual([null, null]);
    });
});

describe("what is typed in a TagsInput's box and not Entered (#1758)", () => {
    const shown = (container: HTMLElement) => [...container.querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((tag) => tag.textContent);

    /** A tags input that holds `held`, with what its host is told and a button after it, which `onAfter` hears clicked; its list offering `suggestions`, where given. */
    function mount(blurBehavior: "add" | "clear", held: string[] = [], onAfter?: () => void, suggestions?: string[]) {
        const told: string[][] = [];
        const { container } = render(
            <ChakraProvider value={system}><EastChakraTagsInput value={toldValue(blurBehavior, suggestions, held, told)} /><button type="button" onClick={onAfter}>after</button></ChakraProvider>,
        );
        return { container, told, after: () => screen.getByRole("button", { name: "after" }) };
    }

    /** Runs a test as on a device that takes touch as well as a keyboard: a touchscreen laptop, a tablet with one. */
    async function onTouchDevice(run: () => Promise<void>) {
        Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
        try {
            await run();
        } finally {
            Reflect.deleteProperty(navigator, "maxTouchPoints");
        }
    }

    /** Whether an Esc pressed now reaches what the box lies in untaken, as the page hears it after the box: its default not prevented. */
    async function escapeReachesHost(user: ReturnType<typeof userEvent.setup>): Promise<boolean> {
        let reached = false;
        const host = (event: KeyboardEvent) => { if (event.key === "Escape") reached = !event.defaultPrevented; };
        document.addEventListener("keydown", host);
        try {
            await user.keyboard("{Escape}");
        } finally {
            document.removeEventListener("keydown", host);
        }
        return reached;
    }

    test("Esc puts back what is typed: the box is emptied, and leaving it adds no tag", async () => {
        const { container, told, after } = mount("add");
        const user = userEvent.setup();
        await user.click(box(container));
        await user.type(box(container), "urgnet");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(box(container).value).toBe(""));
        await user.click(after());
        await settle();
        expect([told, shown(container)]).toEqual([[], []]);
    });

    test("while the box holds words, Esc is its own: the box says so and takes the key, so what it lies in stays (east-workspace#1779)", async () => {
        const { container } = mount("add");
        const user = userEvent.setup();
        await user.click(box(container));
        expect(box(container).hasAttribute("data-escape-layer")).toBe(false);
        await user.type(box(container), "draft");
        expect(box(container).hasAttribute("data-escape-layer")).toBe(true);
        const reached = await escapeReachesHost(user);
        await settle();
        expect([reached, box(container).value, box(container).hasAttribute("data-escape-layer")]).toEqual([false, "", false]);
    });

    test("with its list open, one Esc shuts the list and empties the box (east-workspace#1779)", async () => {
        const user = userEvent.setup();
        const { container } = ui(tagsValue(REGISTER, ["Forklift"]));
        await user.click(box(container));
        await user.keyboard("f");
        await waitFor(() => expect(listed()).not.toEqual([]));
        await user.keyboard("{Escape}");
        await settle();
        expect([listed(), box(container).value, tagsOf(container)]).toEqual([[], "", ["Forklift"]]);
    });

    test("a key that ends an input method's composition is the composition's: Esc then leaves what is typed", async () => {
        const { container } = mount("add");
        const user = userEvent.setup();
        await user.click(box(container));
        await user.type(box(container), "しゅう");
        // Safari's Esc that ends a composition: sent after the composition's end, as key 229.
        await act(async () => { fireEvent.keyDown(box(container), { key: "Escape", keyCode: 229 }); });
        await settle();
        expect(box(container).value).toBe("しゅう");
    });

    test("on a device that takes touch too, a tag typed is a tag as Tab takes the keyboard from the tags input, and the box is emptied", async () => {
        await onTouchDevice(async () => {
            const { container, told, after } = mount("add", ["sales"]);
            const user = userEvent.setup();
            await user.click(box(container));
            await user.type(box(container), "weekly");
            await user.tab();
            expect(document.activeElement).toBe(after());
            await settle();
            expect([told, shown(container), box(container).value]).toEqual([[["sales", "weekly"]], ["sales", "weekly"], ""]);
        });
    });

    for (const device of ["a desktop", "a device that takes touch too"] as const) {
        test(`on ${device}, Tab with its list open hands the keyboard on: the list shuts, the keyboard stays where it went, and what is typed is a tag (east-workspace#1779)`, async () => {
            const run = async () => {
                const { container, told, after } = mount("add", ["sales"], undefined, ["monthly", "weekly"]);
                const user = userEvent.setup();
                await user.click(box(container));
                await user.type(box(container), "week");
                await waitFor(() => expect(listed()).toEqual(["weekly"]));
                await listArmed();
                await user.tab();
                expect(document.activeElement).toBe(after());
                await settle();
                expect([document.activeElement === after(), listed(), told, shown(container), box(container).value])
                    .toEqual([true, [], [["sales", "week"]], ["sales", "week"], ""]);
            };
            if (device === "a desktop") await run();
            else await onTouchDevice(run);
        });
    }

    test("a tag the tags input holds already is held once, and a box left empty adds none", async () => {
        await onTouchDevice(async () => {
            const { container, told } = mount("add", ["sales"]);
            const user = userEvent.setup();
            await user.click(box(container));
            await user.tab();
            await settle();
            await user.click(box(container));
            await user.type(box(container), "sales");
            await user.tab();
            await settle();
            expect([told, shown(container)]).toEqual([[], ["sales"]]);
        });
    });

    test("with `clear`, what is typed is cleared as Tab takes the keyboard from the tags input, and is no tag", async () => {
        await onTouchDevice(async () => {
            const { container, told } = mount("clear");
            const user = userEvent.setup();
            await user.click(box(container));
            await user.type(box(container), "weekly");
            await user.tab();
            await settle();
            expect([told, shown(container), box(container).value]).toEqual([[], [], ""]);
        });
    });

    test("a press outside leaves what is typed as it is while it is held, so nothing it pressed moves; as it lets go, what is typed is a tag, told ahead of the click its release makes (east-workspace#1779)", async () => {
        const atClick: string[][][] = [];
        const { container, told, after } = mount("add", ["sales"], () => { atClick.push(told.map((tags) => [...tags])); });
        const user = userEvent.setup();
        await user.click(box(container));
        await user.type(box(container), "weekly");
        // Held down on the button after the field, which takes the keyboard from the box: the field as it was.
        await user.pointer({ keys: "[MouseLeft>]", target: after() });
        await settle();
        expect([document.activeElement === after(), told, shown(container), box(container).value]).toEqual([true, [], ["sales"], "weekly"]);
        // Let go as a browser lets it go: the click hears what the release did (`releasePress`).
        await releasePress(after());
        await settle();
        expect([atClick, told, shown(container), box(container).value]).toEqual([[[["sales", "weekly"]]], [["sales", "weekly"]], ["sales", "weekly"], ""]);
    });

    test("a press on one of its own suggestions is no leaving: the suggestion is the tag, and what was typed to find it is not (east-workspace#1779)", async () => {
        const told: string[][] = [];
        const { container } = phoneUi(toldValue("add", REGISTER, ["Forklift"], told));
        const user = userEvent.setup();
        await user.click(box(container));
        await user.keyboard("f");
        await user.click(screen.getByRole("button", { name: "First aid" }));
        await settle();
        expect([told, shown(container), box(container).value]).toEqual([[["Forklift", "First aid"]], ["Forklift", "First aid"], ""]);
    });

    test("the keyboard moving to one of its own tags' × leaves what is typed in the box: it has not left the tags input", async () => {
        const { container, told } = mount("add", ["sales"]);
        const user = userEvent.setup();
        await user.click(box(container));
        await user.type(box(container), "week");
        const remove = container.querySelector<HTMLElement>("[data-scope=tags-input][data-part=item-delete-trigger]")!;
        await act(async () => { fireEvent.blur(box(container), { relatedTarget: remove }); });
        await settle();
        expect([told, box(container).value]).toEqual([[], "week"]);
    });
});
