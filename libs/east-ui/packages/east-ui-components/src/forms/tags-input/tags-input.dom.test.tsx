/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * TagsInput autocomplete (#131): an optional `suggestions` list renders a
 * native <datalist> linked to the text input via its `list` attribute, so the
 * browser offers autocomplete while free entry still works. No suggestions ⇒
 * no datalist and no `list` link. In a phone's frame, which has no
 * desktop-style popover (ruled 4 Nov 2026), the suggestions are a row of chips
 * under the box instead (east-workspace#1741): those the tags don't hold, what
 * is typed narrowing them, a press taking one as a tag and clearing the box.
 *
 * Its name (#1758): inside a Field, the box a tag is typed in is named by the
 * field's label and described by its help — the label is `for` the hidden
 * input that carries the tags — and outside one it carries neither.
 *
 * What is typed in its box and not Entered (#1758): Esc puts it back, so the
 * box is empty and leaving it adds nothing; and as the tags input is left it is
 * a tag (`blurBehavior: add`) or is cleared (`clear`) — as the keyboard leaves
 * it, on a device that takes touch too, where the tags input's own tracking
 * hears no focus move, and as a press outside it lets go: never as that press
 * begins, so what it pressed stays where it was pressed, and ahead of the click
 * its release makes, which hears the tag (east-workspace#1779). The keyboard
 * moving to one of its own tags' ×, or a press on one of its own suggestions,
 * leaves it as typed.
 */

import { describe, test, expect, afterEach } from "vitest";
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

/** A tags input's payload as FieldForm builds one: East's default of its type, with the fields a test sets. */
const BASE = defaultValue<typeof TagsInput.Types.Root>(TagsInput.Types.Root);

function tagsValue(suggestions?: string[], held: string[] = [], readOnly = false): TagsInputValue {
    return { ...BASE, value: held, suggestions: suggestions !== undefined ? some(suggestions) : none, readOnly: readOnly ? some(true) : none };
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

describe("TagsInput suggestions (#131)", () => {
    test("renders a datalist of options linked to the input", () => {
        const { container } = ui(tagsValue(["NA", "EU", "APAC", "LATAM"]));
        const datalist = container.querySelector("datalist");
        expect(datalist).not.toBeNull();
        expect(datalist!.querySelectorAll("option").length).toBe(4);
        // The text input is linked to the datalist for native autocomplete.
        const input = container.querySelector("input[list]");
        expect(input).not.toBeNull();
        expect(input!.getAttribute("list")).toBe(datalist!.id);
        expect(container.querySelector("[data-tags-suggestions]")).toBeNull();
    });

    test("renders no datalist (and no list link) when there are no suggestions", () => {
        const { container } = ui(tagsValue());
        expect(container.querySelector("datalist")).toBeNull();
        expect(container.querySelector("input[list]")).toBeNull();
    });
});

describe("TagsInput suggestions in a phone's frame (east-workspace#1741)", () => {
    test("a row of chips under the box offers the suggestions its tags don't hold, in their order, and no list", () => {
        const { container } = phoneUi(tagsValue(REGISTER, ["Forklift"]));
        expect(container.querySelector("datalist")).toBeNull();
        expect(container.querySelector("input[list]")).toBeNull();
        expect(offered(container)).toEqual(["Confined space", "First aid", "Working at height"]);
    });

    test("what is typed narrows the chips, those it starts first; a press takes one as a tag and clears the box", async () => {
        const user = userEvent.setup();
        const { container } = phoneUi(tagsValue(REGISTER, ["Forklift"]));
        const input = container.querySelector<HTMLInputElement>('[data-scope="tags-input"][data-part="input"]')!;
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
        const input = container.querySelector<HTMLInputElement>('[data-scope="tags-input"][data-part="input"]')!;
        await user.click(input);
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
    /** The box a tag is typed in. */
    const box = (container: HTMLElement) => container.querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;

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
    const box = (container: HTMLElement) => container.querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
    const shown = (container: HTMLElement) => [...container.querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((tag) => tag.textContent);

    /** Lets the tags input's microtasks and frames run. */
    async function settle() {
        await act(async () => {
            for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
        });
    }

    /** A tags input that holds `held`, with what its host is told and a button after it, which `onAfter` hears clicked. */
    function mount(blurBehavior: "add" | "clear", held: string[] = [], onAfter?: () => void) {
        const told: string[][] = [];
        const value = {
            ...tagsValue(undefined, held), blurBehavior: some(variant(blurBehavior, null)),
            onChange: some((tags: string[]) => { told.push([...tags]); return null; }),
        } as TagsInputValue;
        const { container } = render(<ChakraProvider value={system}><EastChakraTagsInput value={value} /><button type="button" onClick={onAfter}>after</button></ChakraProvider>);
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
        const value = {
            ...tagsValue(REGISTER, ["Forklift"]), blurBehavior: some(variant("add", null)),
            onChange: some((tags: string[]) => { told.push([...tags]); return null; }),
        } as TagsInputValue;
        const { container } = phoneUi(value);
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
