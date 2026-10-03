/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The query builder's save popover (#936, `Query Editor Spec.md` §4.13),
 * hanging from the toolbar's Save… over an open query: the shared name
 * popover headed "Save query · {name}", offering the open query's name — a
 * name another saved query holds is refused, the open query's own is not —
 * with the description under it. Untouched, the description is the generated
 * sentence, muted, with its hint; edited, its count and Use generated, which
 * returns it to the generated sentence; at most 140 characters; a query that
 * has one opens edited. Save — the button, ⏎ in the name, ⏎ but not Shift ⏎
 * in the description — hands the host the name and the description, `none`
 * untouched or cleared and the text once edited; it closes once the host has saved, and
 * shows what refused the save otherwise. While the save runs Save is loading
 * and both buttons are disabled; Esc cancels, and each opening starts over.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, type option } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { QuerySavePopover, type QuerySavePopoverProps } from "./save-popover.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

afterEach(() => {
    cleanup();
});

/** The sentence the steps of the open query generate. */
const GENERATED = "Orders where total is at least 1,000.";
/** The words under the description once it is edited, for a description of `n` characters. */
const counted = (n: number) => `${n}/140 · shown under the name in the library`;

type Save = QuerySavePopoverProps["onSave"];

/** The toolbar's Save… and the popover it opens, over the open query, as the builder places them. */
function SaveHarness(props: Omit<QuerySavePopoverProps, "open" | "onOpenChange" | "trigger">) {
    const [open, setOpen] = useState(false);
    return <QuerySavePopover {...props} open={open} onOpenChange={setOpen} trigger={<button type="button">Save…</button>} />;
}

/** Let the popover's transitions and the save settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** Open the popover from Save…, and hand back what it shows. */
async function open() {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save…" })); });
    await settle();
    return within(screen.getByRole("dialog"));
}

/**
 * Mount Save… over the open query "Big orders" — another saved query holds
 * "Order count" — and open the popover.
 */
async function mount(options: { description?: option<string>; onSave?: Save } = {}) {
    const onSave = vi.fn<Save>(options.onSave ?? (async () => undefined));
    render(
        <ChakraProvider value={system}>
            <SaveHarness name="Big orders" taken={new Set(["Order count"])} description={options.description ?? none}
                generated={GENERATED} onSave={onSave} />
        </ChakraProvider>,
    );
    return { onSave, popover: await open() };
}

type Popover = Awaited<ReturnType<typeof open>>;
/** The name field. */
const nameField = (p: Popover) => p.getByRole("textbox", { name: "Query name" }) as HTMLInputElement;
/** The description field. */
const descriptionField = (p: Popover) => p.getByRole("textbox", { name: "What the query answers, in one sentence" }) as HTMLTextAreaElement;
/** The words under the description — the hint the field is described by. */
const hintOf = (field: HTMLElement) => document.getElementById(field.getAttribute("aria-describedby")!)!.textContent;
/** The foot's buttons. */
const saveButton = (p: Popover) => p.getByRole("button", { name: "Save" }) as HTMLButtonElement;
const cancelButton = (p: Popover) => p.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
/** Whether the popover has closed. */
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

describe("the query's save popover (#936)", () => {
    test("it opens under Save…, headed Save query · Big orders: the name offered, and the generated description, muted, with its hint", async () => {
        const { popover } = await mount();
        expect(screen.getByRole("button", { name: "Save…" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
        expect(popover.getByText("Save query ·").textContent).toBe("Save query · Big orders");
        expect(nameField(popover).value).toBe("Big orders");
        const field = descriptionField(popover);
        expect([field.value, field.hasAttribute("data-generated"), hintOf(field)])
            .toEqual([GENERATED, true, "Generated from the steps · edit to write your own"]);
        expect(popover.queryByRole("button", { name: "Use generated" })).toBeNull();
        expect([cancelButton(popover).disabled, saveButton(popover).disabled]).toEqual([false, false]);
    }, 30_000);

    test("its description is muted by the edit popover's recipe while it is the generated sentence", () => {
        const recipe = system.getSlotRecipe("sliceEdit") as { base: Record<string, Record<string, unknown>> };
        expect(recipe.base["textArea"]!["&[data-generated]"]).toEqual({ color: "fg.muted" });
    });

    test("typing makes the description the author's, starting from the generated sentence: its count and Use generated; Use generated returns it", async () => {
        const { popover } = await mount();
        const field = descriptionField(popover);
        await userEvent.type(field, " Mostly shipped.");
        const typed = `${GENERATED} Mostly shipped.`;
        expect([field.value, field.hasAttribute("data-generated"), hintOf(field)]).toEqual([typed, false, counted(typed.length)]);
        await userEvent.clear(field);
        await userEvent.type(field, "Big orders by total.");
        expect([field.value, hintOf(field)]).toEqual(["Big orders by total.", counted(20)]);

        await userEvent.click(popover.getByRole("button", { name: "Use generated" }));
        expect([field.value, field.hasAttribute("data-generated"), hintOf(field)])
            .toEqual([GENERATED, true, "Generated from the steps · edit to write your own"]);
        expect(popover.queryByRole("button", { name: "Use generated" })).toBeNull();
    }, 30_000);

    test("the description holds at most 140 characters", async () => {
        const { popover, onSave } = await mount();
        const field = descriptionField(popover);
        expect(field.getAttribute("maxlength")).toBe("140");
        await act(async () => { fireEvent.change(field, { target: { value: "x".repeat(138) } }); });
        await userEvent.type(field, "yzw");
        expect([field.value, hintOf(field)]).toEqual([`${"x".repeat(138)}yz`, counted(140)]);
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", some(`${"x".repeat(138)}yz`)]]);
    }, 30_000);

    test("a name another saved query holds is the field's error and keeps Save off, ⏎ included; the open query's own name is not", async () => {
        const { popover, onSave } = await mount();
        const name = nameField(popover);
        // The open query's own name is offered, and saving under it is allowed.
        expect([name.getAttribute("aria-invalid"), saveButton(popover).disabled]).toEqual([null, false]);

        await act(async () => { fireEvent.change(name, { target: { value: "Order count" } }); });
        expect(popover.getByText("Order count is taken").id).toBe(name.getAttribute("aria-describedby"));
        expect([name.getAttribute("aria-invalid"), saveButton(popover).disabled]).toEqual(["true", true]);
        await userEvent.type(name, "{Enter}");
        await settle();
        expect(onSave.mock.calls).toEqual([]);
        expect(screen.getByRole("dialog")).toBeTruthy();

        await act(async () => { fireEvent.change(name, { target: { value: "  " } }); });
        expect(popover.getByText("Give the query a name to save it.")).toBeTruthy();
        expect(saveButton(popover).disabled).toBe(true);

        await act(async () => { fireEvent.change(name, { target: { value: "Big orders" } }); });
        expect(popover.queryByText("Order count is taken")).toBeNull();
        expect([name.getAttribute("aria-invalid"), saveButton(popover).disabled]).toEqual([null, false]);
    }, 30_000);

    test("Save hands the host the name and none while the description is untouched, and closes once the host has saved", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none]]);
    }, 30_000);

    test("once edited, Save hands the host the description as written, trimmed — under the name as typed, trimmed", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.change(nameField(popover), { target: { value: "  Large orders " } }); });
        await act(async () => { fireEvent.change(descriptionField(popover), { target: { value: "  Orders of 1,000 or more.\n" } }); });
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Large orders", some("Orders of 1,000 or more.")]]);
    }, 30_000);

    test("a description cleared is no description: Save hands the host none, and the generated sentence shows in its place", async () => {
        const { popover, onSave } = await mount({ description: some("Orders of 1,000 or more.") });
        await act(async () => { fireEvent.change(descriptionField(popover), { target: { value: "   " } }); });
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none]]);
    }, 30_000);

    test("a query that has a description opens edited, showing it; Use generated returns it to the generated sentence, saved as none", async () => {
        const { popover, onSave } = await mount({ description: some("Orders of 1,000 or more.") });
        const field = descriptionField(popover);
        expect([field.value, field.hasAttribute("data-generated"), hintOf(field)]).toEqual(["Orders of 1,000 or more.", false, counted(24)]);
        await userEvent.click(popover.getByRole("button", { name: "Use generated" }));
        expect([field.value, field.hasAttribute("data-generated")]).toEqual([GENERATED, true]);
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none]]);
    }, 30_000);

    test("⏎ saves from the name, and from the description; Shift ⏎ in the description is a new line", async () => {
        const { popover, onSave } = await mount();
        await userEvent.type(nameField(popover), "{Enter}");
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none]]);

        const again = await open();
        const field = descriptionField(again);
        await userEvent.type(field, "{Shift>}{Enter}{/Shift}");
        await settle();
        expect(field.value).toBe(`${GENERATED}\n`);
        expect(screen.getByRole("dialog")).toBeTruthy();
        await userEvent.type(field, "Shipped only.{Enter}");
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none], ["Big orders", some(`${GENERATED}\nShipped only.`)]]);
    }, 30_000);

    test("what refused the save shows in the popover, which stays open; a save that resolves undefined closes it", async () => {
        const refusal = "Another query took the name Big orders first — choose another.";
        const { popover, onSave } = await mount({
            onSave: vi.fn<Save>().mockResolvedValueOnce(refusal).mockResolvedValueOnce(undefined),
        });
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await settle();
        expect(popover.getByRole("alert").textContent).toBe(refusal);
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect([cancelButton(popover).disabled, saveButton(popover).disabled]).toEqual([false, false]);

        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(onSave.mock.calls).toEqual([["Big orders", none], ["Big orders", none]]);
    }, 30_000);

    test("while the save runs, Save is loading and Cancel and Save are disabled", async () => {
        let finish: (refused: string | undefined) => void = () => {};
        const { popover } = await mount({ onSave: () => new Promise<string | undefined>((resolve) => { finish = resolve; }) });
        const save = saveButton(popover);
        const cancel = cancelButton(popover);
        await act(async () => { fireEvent.click(save); });
        await settle();
        expect([save.hasAttribute("data-loading"), save.disabled, cancel.disabled]).toEqual([true, true, true]);
        await act(async () => { finish(undefined); });
        await closed();
    }, 30_000);

    test("Esc cancels — nothing is saved — and each opening starts over from the open query's name and description", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.change(nameField(popover), { target: { value: "Large orders" } }); });
        await userEvent.type(descriptionField(popover), " Drafted.");
        await userEvent.keyboard("{Escape}");
        await closed();
        expect(onSave.mock.calls).toEqual([]);

        const again = await open();
        const field = descriptionField(again);
        expect([nameField(again).value, field.value, field.hasAttribute("data-generated"), hintOf(field)])
            .toEqual(["Big orders", GENERATED, true, "Generated from the steps · edit to write your own"]);
    }, 30_000);
});
