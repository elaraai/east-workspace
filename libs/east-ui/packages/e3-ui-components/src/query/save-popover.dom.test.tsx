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
 * in the description — hands the host the name, the description, `none`
 * untouched or cleared and the text once edited, and the tags (#1758): the
 * open query's as it opens, the saved queries' suggested as one is typed in
 * the app's own list (east-workspace#1779), a tag added by ⏎ in their field,
 * which saves nothing, and removed by its ×; one typed and not Entered is
 * saved by a single press on Save, the field as it was while the press is
 * held, so nothing moves under it (east-workspace#1779). It closes once the
 * host has saved, and shows what refused the save otherwise. While the save runs Save is loading
 * and both buttons are disabled; Esc cancels — but with a tag typed and not
 * Entered, the first Esc puts it back and the popover stays (east-workspace#1779)
 * — and each opening starts over.
 * Hung from the ⋯ chip Save… folds into (#1229), it opens from the chip's
 * menu, beside the chip, and gives the focus back to the chip as it closes.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { SortedSet, StringType, compareFor, none, some, type option } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { releasePress } from "@elaraai/east-ui-components/testing";
import { QuerySavePopover, type QuerySavePopoverProps } from "./save-popover.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `CSS.escape`, and the tags' list finds its highlighted item with it — every browser has one.
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");
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
type Tags = QuerySavePopoverProps["tags"];

/** A saved query's tags, in East's order. */
const tagsOf = (...tags: string[]): Tags => new SortedSet(tags, compareFor(StringType));
/** The tags the other saved queries hold: what the field suggests. */
const KNOWN: readonly string[] = ["monthly", "sales", "weekly"];
/** What each Save handed the host: the name, the description, and the tags in their order. */
const saved = (onSave: { mock: { calls: Parameters<Save>[] } }) => onSave.mock.calls.map(([name, description, tags]) => [name, description, [...tags]]);

/** What a harness gives the popover: all but what it hangs from and whether it is open. */
type Given = Omit<QuerySavePopoverProps, "open" | "onOpenChange" | "trigger" | "anchor">;

/** The toolbar's Save… and the popover it opens, over the open query, as the builder places them. */
function SaveHarness(props: Given) {
    const [open, setOpen] = useState(false);
    return <QuerySavePopover {...props} open={open} onOpenChange={setOpen} trigger={<button type="button">Save…</button>} />;
}

/** The ⋯ chip the popover hangs from once Save… has folded into it (#1229), and its menu's Save…, which opens it. */
function AnchoredHarness(props: Given) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <QuerySavePopover {...props} open={open} onOpenChange={setOpen} anchor={<button type="button">⋯</button>} />
            <button type="button" onClick={() => setOpen(true)}>Save from the menu</button>
            <button type="button">Elsewhere</button>
        </>
    );
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
async function mount(options: { description?: option<string>; tags?: Tags; onSave?: Save } = {}) {
    const onSave = vi.fn<Save>(options.onSave ?? (async () => undefined));
    const tags = options.tags ?? tagsOf();
    render(
        <ChakraProvider value={system}>
            <SaveHarness name="Big orders" taken={new Set(["Order count"])} description={options.description ?? none}
                tags={tags} knownTags={KNOWN} generated={GENERATED} onSave={onSave} />
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
/** The tags field: the shared form's, by its key. */
const tagsField = (p: Popover) => p.getByText("Tags").closest<HTMLElement>("[data-field]")!;
/** Its box, which a tag is typed in. */
const tagsInput = (p: Popover) => tagsField(p).querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
/** The tags it shows, in order. */
const tagsShown = (p: Popover) => [...tagsField(p).querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((tag) => tag.textContent);
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
    });

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
    });

    test("the description holds at most 140 characters", async () => {
        const { popover, onSave } = await mount();
        const field = descriptionField(popover);
        expect(field.getAttribute("maxlength")).toBe("140");
        await act(async () => { fireEvent.change(field, { target: { value: "x".repeat(138) } }); });
        await userEvent.type(field, "yzw");
        expect([field.value, hintOf(field)]).toEqual([`${"x".repeat(138)}yz`, counted(140)]);
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", some(`${"x".repeat(138)}yz`), []]]);
    });

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
        expect(saved(onSave)).toEqual([]);
        expect(screen.getByRole("dialog")).toBeTruthy();

        await act(async () => { fireEvent.change(name, { target: { value: "  " } }); });
        expect(popover.getByText("Give the query a name to save it.")).toBeTruthy();
        expect(saveButton(popover).disabled).toBe(true);

        await act(async () => { fireEvent.change(name, { target: { value: "Big orders" } }); });
        expect(popover.queryByText("Order count is taken")).toBeNull();
        expect([name.getAttribute("aria-invalid"), saveButton(popover).disabled]).toEqual([null, false]);
    });

    test("Save hands the host the name and none while the description is untouched, and closes once the host has saved", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []]]);
    });

    test("once edited, Save hands the host the description as written, trimmed — under the name as typed, trimmed", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.change(nameField(popover), { target: { value: "  Large orders " } }); });
        await act(async () => { fireEvent.change(descriptionField(popover), { target: { value: "  Orders of 1,000 or more.\n" } }); });
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Large orders", some("Orders of 1,000 or more."), []]]);
    });

    test("a description cleared is no description: Save hands the host none, and the generated sentence shows in its place", async () => {
        const { popover, onSave } = await mount({ description: some("Orders of 1,000 or more.") });
        await act(async () => { fireEvent.change(descriptionField(popover), { target: { value: "   " } }); });
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []]]);
    });

    test("a query that has a description opens edited, showing it; Use generated returns it to the generated sentence, saved as none", async () => {
        const { popover, onSave } = await mount({ description: some("Orders of 1,000 or more.") });
        const field = descriptionField(popover);
        expect([field.value, field.hasAttribute("data-generated"), hintOf(field)]).toEqual(["Orders of 1,000 or more.", false, counted(24)]);
        await userEvent.click(popover.getByRole("button", { name: "Use generated" }));
        expect([field.value, field.hasAttribute("data-generated")]).toEqual([GENERATED, true]);
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []]]);
    });

    test("⏎ saves from the name, and from the description; Shift ⏎ in the description is a new line", async () => {
        const { popover, onSave } = await mount();
        await userEvent.type(nameField(popover), "{Enter}");
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []]]);

        const again = await open();
        const field = descriptionField(again);
        await userEvent.type(field, "{Shift>}{Enter}{/Shift}");
        await settle();
        expect(field.value).toBe(`${GENERATED}\n`);
        expect(screen.getByRole("dialog")).toBeTruthy();
        await userEvent.type(field, "Shipped only.{Enter}");
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []], ["Big orders", some(`${GENERATED}\nShipped only.`), []]]);
    });

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
        expect(saved(onSave)).toEqual([["Big orders", none, []], ["Big orders", none, []]]);
    });

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
    });

    test("#1758: its tags field, labelled, under the description: the open query's tags, the saved queries' suggested; ⏎ in it adds the tag typed and saves nothing; a tag's × removes it; Save hands the host the tags", async () => {
        const { popover, onSave } = await mount({ tags: tagsOf("sales") });
        const field = tagsField(popover);
        expect(field.getAttribute("data-editor")).toBe("tags");
        expect(descriptionField(popover).compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(field.textContent).toContain("A word or two each, to find the query by.");
        expect(tagsShown(popover)).toEqual(["sales"]);

        const user = userEvent.setup();
        await user.click(tagsInput(popover));
        await user.type(tagsInput(popover), "w");
        // The tags the other saved queries hold and this one doesn't, as one is typed: the app's own list, never the
        // browser's (east-workspace#1779).
        const list = document.getElementById(tagsInput(popover).getAttribute("aria-controls")!)!;
        expect([field.querySelector("datalist"), within(list).getAllByRole("option").map((option) => option.textContent)]).toEqual([null, ["weekly"]]);
        await user.type(tagsInput(popover), "eekly{Enter}");
        await settle();
        expect(tagsShown(popover)).toEqual(["sales", "weekly"]);
        // ⏎ added the tag: the popover is open, and nothing was saved.
        expect([screen.queryByRole("dialog") !== null, saved(onSave)]).toEqual([true, []]);

        await act(async () => { fireEvent.click(field.querySelector("[data-part=item-delete-trigger]")!); });
        await settle();
        expect(tagsShown(popover)).toEqual(["weekly"]);
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, ["weekly"]]]);
    });

    test("#1758: a tag typed and not Entered is a tag as the keyboard leaves its box — Save, pressed once, keeps it, nothing moving under the press (east-workspace#1779)", async () => {
        const { popover, onSave } = await mount();
        const user = userEvent.setup();
        await user.click(tagsInput(popover));
        await user.type(tagsInput(popover), "monthly");
        // A press as a person makes it: the button down, which takes the keyboard from the box — the field as it was,
        // so nothing under the press moves — then up, as a browser lets it go: the tag made as it lets go, ahead of the
        // click, which saves it. A page's own events each run to their end before the next (`releasePress`).
        await user.pointer({ keys: "[MouseLeft>]", target: saveButton(popover) });
        await settle();
        expect([tagsShown(popover), tagsInput(popover).value]).toEqual([[], "monthly"]);
        await releasePress(saveButton(popover));
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, ["monthly"]]]);
    });

    test("#1758: on a device that takes touch too, a tag typed and left by Tab is saved: Tab to Save, then ⏎", async () => {
        Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
        try {
            const { popover, onSave } = await mount();
            const user = userEvent.setup();
            await user.click(tagsInput(popover));
            await user.type(tagsInput(popover), "weekly");
            await user.tab();
            expect(document.activeElement).toBe(cancelButton(popover));
            await user.tab();
            expect(document.activeElement).toBe(saveButton(popover));
            await user.keyboard("{Enter}");
            await closed();
            expect(saved(onSave)).toEqual([["Big orders", none, ["weekly"]]]);
        } finally {
            Reflect.deleteProperty(navigator, "maxTouchPoints");
        }
    });

    test("#1758: the ⏎ that ends an input method's composition saves nothing, in the name or the description — Safari sends it after the composition's end, as key 229", async () => {
        const { popover, onSave } = await mount();
        for (const field of [nameField(popover), descriptionField(popover)]) {
            await act(async () => { fireEvent.keyDown(field, { key: "Enter", keyCode: 229 }); });
            await act(async () => { fireEvent.keyDown(field, { key: "Enter", isComposing: true }); });
            await settle();
        }
        expect([screen.queryByRole("dialog") !== null, saved(onSave)]).toEqual([true, []]);
    });

    test("#1758: ⌘ or Ctrl ⏎ is its host's, in the name and the description: it saves nothing, and goes on to the host as it came", async () => {
        const { popover, onSave } = await mount();
        // Each press goes on unprevented: what a builder around it runs its query on.
        const passed = [
            fireEvent.keyDown(nameField(popover), { key: "Enter", metaKey: true }),
            fireEvent.keyDown(nameField(popover), { key: "Enter", ctrlKey: true }),
            fireEvent.keyDown(descriptionField(popover), { key: "Enter", metaKey: true }),
            fireEvent.keyDown(descriptionField(popover), { key: "Enter", ctrlKey: true }),
        ];
        await settle();
        expect([passed, screen.queryByRole("dialog") !== null, saved(onSave)]).toEqual([[true, true, true, true], true, []]);
    });

    test("#1758: Esc with a tag typed puts it back, the popover staying with what it holds — its list open or shut; Esc again cancels (east-workspace#1779)", async () => {
        const { popover, onSave } = await mount();
        const user = userEvent.setup();
        await user.type(tagsInput(popover), "region{Enter}");
        await user.type(tagsInput(popover), "draft");
        await user.keyboard("{Escape}");
        await settle();
        expect([screen.queryByRole("dialog") !== null, tagsShown(popover), tagsInput(popover).value]).toEqual([true, ["region"], ""]);
        // Typed again, its list open: one Esc shuts the list and puts the word back, the popover still open.
        await user.type(tagsInput(popover), "w");
        await waitFor(() => expect(screen.queryAllByRole("option").map((option) => option.textContent)).toEqual(["weekly"]));
        await user.keyboard("{Escape}");
        await settle();
        expect([screen.queryByRole("dialog") !== null, screen.queryAllByRole("option"), tagsInput(popover).value]).toEqual([true, [], ""]);
        await user.keyboard("{Escape}");
        await closed();
        expect(saved(onSave)).toEqual([]);
    });

    test("Esc cancels — nothing is saved — and each opening starts over from the open query's name, description and tags", async () => {
        const { popover, onSave } = await mount();
        await act(async () => { fireEvent.change(nameField(popover), { target: { value: "Large orders" } }); });
        await userEvent.type(descriptionField(popover), " Drafted.");
        await userEvent.type(tagsInput(popover), "weekly{Enter}");
        await settle();
        expect(tagsShown(popover)).toEqual(["weekly"]);
        await userEvent.keyboard("{Escape}");
        await closed();
        expect(saved(onSave)).toEqual([]);

        const again = await open();
        const field = descriptionField(again);
        expect([nameField(again).value, field.value, field.hasAttribute("data-generated"), hintOf(field)])
            .toEqual(["Big orders", GENERATED, true, "Generated from the steps · edit to write your own"]);
        expect(tagsShown(again)).toEqual([]);
    });
});

describe("the query's save popover hung from the ⋯ chip (#1229)", () => {
    /** Mount the chip and its menu's Save… over the open query "Big orders", the popover closed. */
    function mountAnchored(onSave: Save) {
        render(
            <ChakraProvider value={system}>
                <AnchoredHarness name="Big orders" taken={new Set(["Order count"])} description={none} tags={tagsOf()} knownTags={KNOWN} generated={GENERATED} onSave={onSave} />
            </ChakraProvider>,
        );
        return screen.getByRole("button", { name: "⋯" });
    }
    /**
     * Open it, as the chip's menu's Save… does, and wait the frame in which the
     * popover starts to hear Esc and a click outside: Zag defers that a frame.
     */
    async function openFromMenu() {
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save from the menu" })); });
        await settle();
        await act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }); });
        return within(screen.getByRole("dialog"));
    }

    test("the chip sits in the popover's anchor, its own props untouched; Save… in its menu opens the popover, which saves; closing, the focus goes back to the chip", async () => {
        const onSave = vi.fn<Save>(async () => undefined);
        const chip = mountAnchored(onSave);
        expect(chip.parentElement!.getAttribute("data-part")).toBe("anchor");
        expect([chip.getAttribute("aria-haspopup"), chip.getAttribute("data-part")]).toEqual([null, null]);
        const popover = await openFromMenu();
        expect(popover.getByText("Save query ·").textContent).toBe("Save query · Big orders");
        await act(async () => { fireEvent.click(saveButton(popover)); });
        await closed();
        expect(saved(onSave)).toEqual([["Big orders", none, []]]);
        await waitFor(() => expect(document.activeElement).toBe(chip));
    });

    test("Esc closes it, nothing saved, and the focus goes back to the chip; a control the viewer moves to keeps the focus", async () => {
        const onSave = vi.fn<Save>(async () => undefined);
        const chip = mountAnchored(onSave);
        const popover = await openFromMenu();
        nameField(popover).focus();
        await userEvent.keyboard("{Escape}");
        await closed();
        await waitFor(() => expect(document.activeElement).toBe(chip));
        expect(saved(onSave)).toEqual([]);
        // Opened again and left for another control: the focus stays where the viewer put it.
        await openFromMenu();
        const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
        await userEvent.click(elsewhere);
        await closed();
        await settle();
        expect(document.activeElement).toBe(elsewhere);
    });
});
