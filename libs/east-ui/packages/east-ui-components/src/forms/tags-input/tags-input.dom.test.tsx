/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * TagsInput autocomplete (#131): an optional `suggestions` list renders a
 * native <datalist> linked to the text input via its `list` attribute, so the
 * browser offers autocomplete while free entry still works. No suggestions ⇒
 * no datalist and no `list` link.
 *
 * Its name (#1758): inside a Field, the box a tag is typed in is named by the
 * field's label and described by its help — the label is `for` the hidden
 * input that carries the tags — and outside one it carries neither.
 *
 * What is typed in its box and not Entered (#1758): Esc puts it back, so the
 * box is empty and leaving it adds nothing; and as the keyboard leaves the tags
 * input it is a tag (`blurBehavior: add`) or is cleared (`clear`) — on a device
 * that takes touch too, where the tags input's own tracking hears no focus
 * move. The keyboard moving to one of its own tags' × leaves it as typed.
 */

import { describe, test, expect, afterEach } from "vitest";
import { act, render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, Field } from "@chakra-ui/react";
import { some, none, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraTagsInput, type TagsInputValue } from "./index.js";

afterEach(cleanup);

function tagsValue(suggestions?: string[], given: Partial<Record<keyof TagsInputValue, unknown>> = {}): TagsInputValue {
    return {
        value: [],
        defaultValue: none,
        suggestions: suggestions !== undefined ? some(suggestions) : none,
        max: none,
        maxLength: none,
        disabled: none,
        readOnly: none,
        invalid: none,
        editable: none,
        delimiter: none,
        addOnPaste: none,
        blurBehavior: none,
        allowOverflow: none,
        label: none,
        placeholder: none,
        onChange: none,
        onInputChange: none,
        onHighlightChange: none,
        style: none,
        ...given,
    } as TagsInputValue;
}

const ui = (value: TagsInputValue) =>
    render(<ChakraProvider value={system}><EastChakraTagsInput value={value} /></ChakraProvider>);

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
    });

    test("renders no datalist (and no list link) when there are no suggestions", () => {
        const { container } = ui(tagsValue());
        expect(container.querySelector("datalist")).toBeNull();
        expect(container.querySelector("input[list]")).toBeNull();
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

    /** A tags input that holds `held`, with what its host is told and a button after it. */
    function mount(blurBehavior: "add" | "clear", held: string[] = []) {
        const told: string[][] = [];
        const value = tagsValue(undefined, {
            value: held, blurBehavior: some(variant(blurBehavior, null)),
            onChange: some((tags: string[]) => { told.push([...tags]); return null; }),
        });
        const { container } = render(<ChakraProvider value={system}><EastChakraTagsInput value={value} /><button type="button">after</button></ChakraProvider>);
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
