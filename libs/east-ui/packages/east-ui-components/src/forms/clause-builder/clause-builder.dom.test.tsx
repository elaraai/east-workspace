/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * ClauseBuilder DOM tests — the two general robustness fixes:
 *
 * - #193: intrinsically wide value controls (datetime singles, all range
 *   ops, set ops) stack on their own full-width line instead of overflowing
 *   the inline grid (the Add-filter popover grew a horizontal scrollbar and
 *   the submit button collided with the date input).
 * - #194: the TagsInput's in-flight text counts — picking a `<datalist>`
 *   suggestion (or typing without Enter) only sets the input TEXT, never a
 *   tag, so Add stayed disabled with a value visibly in the control.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import * as React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { ClauseBuilder, type ClauseFieldSpec, type ClauseKind, type ClauseOpSpec } from "./index.js";

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

const FIELDS: ClauseFieldSpec[] = [
    { id: "note", label: "Note", kind: "string", hints: ["rush order", "fragile"] },
    { id: "qty", label: "Qty", kind: "integer" },
    { id: "day", label: "Day", kind: "datetime" },
];
const OPS: Record<ClauseKind, ClauseOpSpec[]> = {
    string: [{ tag: "eq", glyph: "=" }, { tag: "in", glyph: "in", input: "set" }],
    integer: [{ tag: "gte", glyph: "≥" }, { tag: "in", glyph: "in", input: "set" }, { tag: "between", glyph: "between", input: "range" }],
    float: [{ tag: "gte", glyph: "≥" }],
    datetime: [{ tag: "before", glyph: "before" }, { tag: "between", glyph: "between", input: "range" }],
    boolean: [{ tag: "is", glyph: "is" }],
};
const opsFor = (k: ClauseKind) => OPS[k];

const mount = (initial?: { fieldId: string; op: string; value: unknown }) => {
    const onSubmit = vi.fn();
    const { container } = ui(<ClauseBuilder fields={FIELDS} opsFor={opsFor} onSubmit={onSubmit} {...(initial !== undefined ? { initial } : {})} />);
    return { container, onSubmit };
};

describe("ClauseBuilder — wide value controls stack instead of overflowing (#193)", () => {
    test("a compact single (string eq) keeps the inline row", () => {
        const { container } = mount({ fieldId: "note", op: "eq", value: "" });
        expect(container.querySelector("[data-clause-stacked]")).toBeNull();
    });

    test("a datetime single stacks — the segmented date input gets a full-width line", () => {
        const { container } = mount({ fieldId: "day", op: "before", value: new Date("2025-03-01") });
        expect(container.querySelector("[data-clause-stacked]")).not.toBeNull();
    });

    test("range ops stack (datetime between and integer between alike)", () => {
        const a = mount({ fieldId: "day", op: "between", value: { min: new Date("2025-03-01"), max: new Date("2025-03-28") } });
        expect(a.container.querySelector("[data-clause-stacked]")).not.toBeNull();
        cleanup();
        const b = mount({ fieldId: "qty", op: "between", value: { min: 0n, max: 10n } });
        expect(b.container.querySelector("[data-clause-stacked]")).not.toBeNull();
    });

    test("set ops keep their stacked layout", () => {
        const { container } = mount({ fieldId: "note", op: "in", value: [] });
        expect(container.querySelector("[data-clause-stacked]")).not.toBeNull();
    });

    test("clause datetime controls are date-precision — no time segments to clip (#196)", () => {
        mount({ fieldId: "day", op: "between", value: { min: new Date("2025-01-05"), max: new Date("2025-03-28") } });
        // Both bounds render date segments only; the hour/minute spinbuttons
        // (the part that clipped in the Edit popover) are gone.
        expect(screen.getAllByRole("spinbutton", { name: /month/i }).length).toBe(2);
        expect(screen.queryByRole("spinbutton", { name: /hour/i })).toBeNull();
    });
});

describe("ClauseBuilder — in-flight TagsInput text counts toward the clause (#194)", () => {
    test("typing a value WITHOUT Enter enables Add and submits it", async () => {
        const { onSubmit } = mount({ fieldId: "note", op: "in", value: [] });
        const user = userEvent.setup();

        const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
        expect(add.disabled).toBe(true);
        expect(screen.getByText("Enter at least one value.")).toBeTruthy();

        // A datalist suggestion pick lands the same way: input TEXT, no tag.
        await user.click(screen.getByPlaceholderText("a, b, c"));
        await user.paste("rush order");
        expect(add.disabled).toBe(false);

        await user.click(add);
        expect(onSubmit).toHaveBeenCalledWith({ fieldId: "note", kind: "string", op: "in", value: ["rush order"] });
    });

    test("pending text merges with committed tags, deduped", async () => {
        const { onSubmit } = mount({ fieldId: "note", op: "in", value: ["fragile"] });
        const user = userEvent.setup();
        const input = screen.getByPlaceholderText("a, b, c");

        await user.click(input);
        await user.paste("fragile");
        await user.click(screen.getByRole("button", { name: "Add" }));
        expect(onSubmit).toHaveBeenCalledWith({ fieldId: "note", kind: "string", op: "in", value: ["fragile"] });
        onSubmit.mockClear();

        await user.clear(input);
        await user.click(input);
        await user.paste("rush order");
        await user.click(screen.getByRole("button", { name: "Add" }));
        expect(onSubmit).toHaveBeenCalledWith({ fieldId: "note", kind: "string", op: "in", value: ["fragile", "rush order"] });
    });

    test("integer in-set: non-numeric pending text stays disabled with the hint; numeric enables", async () => {
        const { onSubmit } = mount({ fieldId: "qty", op: "in", value: [] });
        const user = userEvent.setup();
        const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
        const input = screen.getByPlaceholderText("a, b, c");

        await user.click(input);
        await user.paste("abc");
        expect(add.disabled).toBe(true);
        expect(screen.getByText("Enter at least one whole number.")).toBeTruthy();

        await user.clear(input);
        await user.click(input);
        await user.paste("12");
        expect(add.disabled).toBe(false);
        await user.click(add);
        expect(onSubmit).toHaveBeenCalledWith({ fieldId: "qty", kind: "integer", op: "in", value: ["12"] });
    });
});
