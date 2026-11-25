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
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, Field } from "@chakra-ui/react";
import { defaultValue, some, none } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { FramePhoneLayer } from "../../layout/builder-frame/frame-layer.js";
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
