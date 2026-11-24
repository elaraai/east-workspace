/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A set cell on one line, its members removed whole (east-workspace#1741): in
 * the Record's every-kind example and in the Sheet's workshop, each half of
 * its link column, every chip line stands on one line inside its row — each
 * chip whole, or, alone and wider than its room, shortened with "…" — and a
 * `+N` stands for the members past its room, its hover naming them and its
 * count theirs; hovering a Record's set cell puts every member in the strip.
 * In the open editor the members keep one line, scrolling under what is
 * typed, which stays in view, and a chip's × takes its member out, the editor
 * open on the rest. On a phone the bottom container edits a set cell in the
 * form's tags editor, the register's other members suggested, its chips the
 * design system's touch size: 34 tall, each × a 34 square at its end; as the
 * editor grows the row it edits stays in view, and the notice a phone's footer
 * lays over main's foot never covers it.
 *
 * Run: `pnpm exec playwright test set-cell`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";
const EVERY_KIND = "e3/record/record/recordEveryKind";
const WORKSHOP = "e3/sheet/sheet/sheetWorkshop";

/** One chip line as the page draws it: its chips' words, its `+N` and the members it names, and what breaks its invariants. */
interface LineDrawn {
    /** Where it is, for a failure to say: its row's key, its column's, and a link's From half. */
    readonly at: string;
    readonly chips: readonly string[];
    readonly more: { readonly n: number; readonly names: readonly string[] } | undefined;
    readonly faults: readonly string[];
}

/**
 * Every chip line in an example, each with what breaks its invariants: one line, inside its row and its line, its
 * chips whole but a lone one too wide, which "…" shortens, and its `+N` naming as many members as it counts.
 *
 * @param entry - The example's entry
 * @returns Each line, in the page's order
 */
function linesOf(entry: Locator): Promise<LineDrawn[]> {
    return entry.evaluate((root) => [...root.querySelectorAll<HTMLElement>('[data-slot="chipLine"]')].map((line): LineDrawn => {
        const row = line.closest<HTMLElement>('[data-slot="row"], [data-slot="stickyLine"]');
        const from = line.closest("[data-half]")?.getAttribute("data-half") === "from";
        const at = `${row?.getAttribute("data-row-id") ?? "?"}/${line.closest('[data-slot="cell"]')?.getAttribute("data-key") ?? "?"}${from ? ":from" : ""}`;
        const box = line.getBoundingClientRect();
        const rowBox = (row ?? line).getBoundingClientRect();
        const faults: string[] = [];
        if (line.querySelector("[data-measure]") !== null) faults.push("still measuring");
        const parts = [...line.children] as HTMLElement[];
        const tops = parts.map((part) => part.getBoundingClientRect().top);
        if (Math.max(...tops) - Math.min(...tops) > 0.5) faults.push(`on two lines: tops ${tops.join(", ")}`);
        for (const part of parts) {
            const b = part.getBoundingClientRect();
            if (b.top < rowBox.top - 0.5 || b.bottom > rowBox.bottom + 0.5) faults.push(`"${part.textContent}" past its row`);
            if (b.left < box.left - 0.5 || b.right > box.right + 0.5) faults.push(`"${part.textContent}" cut by its line`);
        }
        const alone = line.hasAttribute("data-alone");
        const chips = parts.filter((part) => part.getAttribute("data-slot") === "chip");
        if (alone && chips.length !== 1) faults.push(`alone with ${chips.length} chips`);
        chips.forEach((chip, i) => {
            const words = chip.querySelector<HTMLElement>('[data-slot="chipText"]');
            if (words === null || words.scrollWidth <= words.clientWidth + 0.5) return;
            if (!(alone && i === 0)) faults.push(`"${words.textContent}" cut mid-word`);
            else if (getComputedStyle(words).textOverflow !== "ellipsis") faults.push(`"${words.textContent}" cut with no "…"`);
        });
        const more = parts.find((part) => part.getAttribute("data-slot") === "chipMore");
        const names = more?.getAttribute("title")?.split(", ") ?? [];
        const n = more === undefined ? 0 : Number((more.textContent ?? "").replace(/^\+/, ""));
        if (more !== undefined && n !== names.length) faults.push(`${more.textContent} names ${names.length}`);
        return { at, chips: chips.map((chip) => chip.querySelector('[data-slot="chipText"]')?.textContent ?? ""), more: more === undefined ? undefined : { n, names }, faults };
    }));
}

/** The lines of an example that break an invariant, each with why. */
const faultsOf = async (entry: Locator) => (await linesOf(entry)).filter((line) => line.faults.length > 0).map((line) => `${line.at}: ${line.faults.join("; ")}`);

/** The members a line stands for: those its chips show, then those its `+N` names. */
const membersOf = (line: LineDrawn | undefined) => (line === undefined ? undefined : [...line.chips, ...(line.more?.names ?? [])]);

/** An example on the page, at rest with its rows drawn. */
async function open(page: Page, route: string): Promise<Locator> {
    const entry = await visitBuilder(page, route, ROOT, "light");
    await expect(entry.locator('[data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** A Record's cell, by its row's key and its column's. */
const recordCell = (entry: Locator, id: string, key: string) => entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);

test.describe("A set cell on one line (east-workspace#1741)", () => {
    for (const route of [EVERY_KIND, WORKSHOP]) {
        test(`${route}: every chip line on one line inside its row, each chip whole or, alone, shortened with "…", a +N naming the rest`, async ({ page }) => {
            const entry = await open(page, route);
            expect((await linesOf(entry)).length).toBeGreaterThan(0);
            expect(await faultsOf(entry)).toEqual([]);
        });
    }

    test("the open editor keeps its members on one line under what is typed, which stays in view; a chip's × takes its member out, the editor open on the rest; at rest a +N names those past the cell's room, and the hover puts every member in the strip @desktop", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0401", "certificates");
        await cell.dblclick();
        const input = cell.locator('[data-slot="editorInput"]');
        await expect(input).toBeFocused();
        await input.pressSequentially("First aid, Working at height, typed past the chips");
        const half = cell.locator('[data-slot="editor"] [data-half="to"]');
        await expect(half.locator('[data-slot="chip"] [data-slot="chipText"]')).toHaveText(["Forklift", "Confined space", "First aid", "Working at height"]);
        const drawn = await half.evaluate((el) => {
            const view = el.getBoundingClientRect();
            const field = el.querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
            const box = field.getBoundingClientRect();
            const tops = [...el.querySelectorAll('[data-slot="chip"]')].map((chip) => chip.getBoundingClientRect().top);
            return {
                lines: new Set(tops.map((top) => Math.round(top))).size,
                scrolls: el.scrollWidth > el.clientWidth,
                typedInView: box.left >= view.left - 0.5 && box.right <= view.right + 0.5,
                typedWhole: field.scrollWidth <= field.clientWidth + 1,
            };
        });
        expect(drawn).toEqual({ lines: 1, scrolls: true, typedInView: true, typedWhole: true });
        await input.fill("");
        await half.getByRole("button", { name: "Remove Forklift" }).click();
        await expect(half.locator('[data-slot="chip"] [data-slot="chipText"]')).toHaveText(["Confined space", "First aid", "Working at height"]);
        await expect(input).toBeFocused();
        await input.press("Enter");
        await expect(cell.locator('[data-slot="editor"]')).toHaveCount(0);
        await settled(page);
        const line = (await linesOf(entry)).find((l) => l.at === "P-0401/certificates");
        expect(membersOf(line)).toEqual(["Confined space", "First aid", "Working at height"]);
        expect(line?.more?.n ?? 0).toBeGreaterThan(0);
        expect(await faultsOf(entry)).toEqual([]);
        await cell.hover();
        await expect(entry.locator('[data-record-strip] [data-slot="stripText"]')).toHaveText("Confined space, First aid, Working at height");
    });

    test("on a phone a set cell's editor is the form's tags editor, the register's other members suggested, a tag added written to the cell, which keeps its one line @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0401", "certificates");
        await cell.click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        const tags = editor.locator('[data-scope="tags-input"][data-part="item-text"]');
        await expect(tags).toHaveText(["Forklift", "Confined space"]);
        expect(await editor.locator("datalist option").evaluateAll((options) => options.map((o) => o.getAttribute("value")))).toEqual(["First aid", "Working at height"]);
        const input = editor.locator('[data-scope="tags-input"][data-part="input"]');
        await input.click();
        await input.pressSequentially("first");
        await input.press("Enter");
        await expect(tags).toHaveText(["Forklift", "Confined space", "First aid"]);
        await settled(page);
        expect(membersOf((await linesOf(entry)).find((l) => l.at === "P-0401/certificates"))).toEqual(["Forklift", "Confined space", "First aid"]);
        expect(await faultsOf(entry)).toEqual([]);
        // The design system's touch chips, in this panel alone: each 34 tall, 8 apart on its row, its × a 34 square at its
        // full height and its very end; the box a tag is typed into as tall; and the control whole, its foot in sight.
        const drawn = await editor.evaluate((el) => {
            const box = (x: Element) => x.getBoundingClientRect();
            const chips = [...el.querySelectorAll('[data-scope="tags-input"][data-part="item-preview"]')].map((chip) => {
                const c = box(chip);
                const x = box(chip.querySelector('[data-part="item-delete-trigger"]')!);
                const atEnd = Math.abs(x.right - c.right) < 0.5 && Math.abs(x.top - c.top) < 0.5 && Math.abs(x.bottom - c.bottom) < 0.5;
                return { h: Math.round(c.height), x: [Math.round(x.width), Math.round(x.height)], atEnd, left: c.left, right: c.right, top: c.top };
            });
            const gaps: number[] = [];
            for (let i = 1; i < chips.length; i++) if (Math.abs(chips[i]!.top - chips[i - 1]!.top) < 0.5) gaps.push(Math.round(chips[i]!.left - chips[i - 1]!.right));
            const control = box(el.querySelector('[data-scope="tags-input"][data-part="control"]')!);
            const foot = document.elementFromPoint(control.left + 12, control.bottom - 2);
            return {
                chips: chips.map(({ h, x, atEnd }) => ({ h, x, atEnd })), gaps,
                input: Math.round(box(el.querySelector('[data-scope="tags-input"][data-part="input"]')!).height),
                whole: foot !== null && el.contains(foot),
            };
        });
        expect(drawn).toEqual({ chips: Array(3).fill({ h: 34, x: [34, 34], atEnd: true }), gaps: [8], input: 34, whole: true });
    });

    test("on a phone the row a set editor edits stays in view as the editor grows, and a notice laid over main's foot never covers the editor @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0408", "certificates");
        await cell.click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        // A notice — the copy's — which the phone's footer lays over main's foot while it speaks.
        await page.keyboard.press("ControlOrMeta+c");
        await expect(entry.locator('[data-slot="footerLive"][data-footer-live]')).toHaveText(/^Copied /);
        const input = editor.locator('[data-scope="tags-input"][data-part="input"]');
        for (const word of ["fork", "conf", "work"]) {
            await input.click();
            await input.pressSequentially(word);
            await input.press("Enter");
        }
        await expect(editor.locator('[data-scope="tags-input"][data-part="item-text"]')).toHaveText(["Forklift", "Confined space", "Working at height"]);
        await expect(entry.locator('[data-slot="footerLive"][data-footer-live]')).toHaveText(/^Copied /);
        await settled(page);
        // What a tap lands on: across the edited cell's top, middle and foot, the cell — neither the header over its row nor
        // the editor under it — and on the editor's last pixels, the editor, never the notice's band.
        const drawn = await entry.evaluate((root) => {
            const edited = root.querySelector('[data-record] [data-slot="row"][data-row-id="P-0408"] [data-slot="cell"][data-key="certificates"]')!;
            const e = edited.getBoundingClientRect();
            const control = root.querySelector('[data-cell-tags] [data-scope="tags-input"][data-part="control"]')!;
            const c = control.getBoundingClientRect();
            const lands = (el: Element, x: number, y: number) => { const hit = document.elementFromPoint(x, y); return hit !== null && el.contains(hit); };
            return {
                row: [e.top + 2, (e.top + e.bottom) / 2, e.bottom - 2].map((y) => lands(edited, (e.left + e.right) / 2, y)),
                editorFoot: [2, 6, 10].map((dy) => lands(control, c.left + 12, c.bottom - dy)),
            };
        });
        expect(drawn).toEqual({ row: [true, true, true], editorFoot: [true, true, true] });
    });
});
