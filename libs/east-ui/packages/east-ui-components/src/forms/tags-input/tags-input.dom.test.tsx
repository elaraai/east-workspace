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
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider, Field } from "@chakra-ui/react";
import { some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraTagsInput, type TagsInputValue } from "./index.js";

afterEach(cleanup);

function tagsValue(suggestions?: string[]): TagsInputValue {
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
