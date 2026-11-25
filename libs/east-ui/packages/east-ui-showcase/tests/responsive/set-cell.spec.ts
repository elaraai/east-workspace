/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A set cell on one line, its members removed whole (east-workspace#1741): in
 * the Record's every-kind example and in the Sheet's workshop, each half of
 * its link column, every chip line stands on one line inside its row — each
 * chip whole, or, alone and wider than its room, shortened with "…", its hover
 * then saying its whole words — and a `+N` stands for the members past its
 * room, its hover naming them and its count theirs; hovering a Record's set
 * cell puts every member in the strip. The workshop's own rows shorten none,
 * with a tenth to spare: a platform whose text runs wider draws them whole too.
 * A set cell's line is as wide as its cell's room, so members a narrow cell
 * folded show again once a wider one holds them; Details draws every member,
 * on as many lines as they take. In the open editor the members keep one
 * line, scrolling under what is typed, which stays in view, and a chip's ×
 * takes its member out, the editor open on the rest — on a touch screen a
 * 34px target of its own at the chip's end, never over the chip's words. A
 * box a tag is typed into keeps to its field, a placeholder longer than the
 * field cut inside it. On a phone the bottom container edits a set cell in the
 * form's tags editor, its chips the design system's touch size: 34 tall, each
 * × a 34 square at its end; the register's other members are suggested as
 * touch chips under it — never the browser's list, a phone having no
 * desktop-style popover — what is typed narrowing them and a press taking one,
 * the box keeping the focus, its placeholder whole and its words in the field
 * chrome's body face. As the editor grows the row it edits stays in view —
 * whole while the room holds it, its top under the header once it does not —
 * and the notice a phone's footer lays over main's foot never covers it.
 *
 * Run: `pnpm exec playwright test set-cell`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
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
 * Every one-line chip line in an example — a cell's, never Details', which wraps — each with what breaks its
 * invariants: one line, inside its row and its line, its chips whole but a lone one too wide, which "…" shortens, and
 * its `+N` naming as many members as it counts.
 *
 * @param entry - The example's entry
 * @returns Each line, in the page's order
 */
function linesOf(entry: Locator): Promise<LineDrawn[]> {
    return entry.evaluate((root) => [...root.querySelectorAll<HTMLElement>('[data-slot="chipLine"]:not([data-wrap])')].map((line): LineDrawn => {
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
        // A set's half is its cell's own child: as wide as the cell's room, so its line is fitted again as the cell's width changes.
        const cell = line.closest<HTMLElement>('[data-slot="cell"]');
        const half = line.closest<HTMLElement>("[data-half]");
        if (cell !== null && half !== null && half.parentElement === cell) {
            const style = getComputedStyle(cell);
            const room = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const wide = half.getBoundingClientRect().width;
            if (Math.abs(wide - room) > 0.5) faults.push(`its half ${wide} wide in a cell with room for ${room}`);
        }
        const alone = line.hasAttribute("data-alone");
        const chips = parts.filter((part) => part.getAttribute("data-slot") === "chip");
        if (alone && chips.length !== 1) faults.push(`alone with ${chips.length} chips`);
        // Shortened, it says its whole words on hover: without them the hover is its half's, which says only which half it is.
        if (alone && (line.getAttribute("title") ?? "") === "") faults.push("shortened, with no hover to say its words");
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

/**
 * A tags input's box under a placeholder longer than its field — four hundred characters, set as the renderer sets a
 * placeholder's length — as drawn: whether the box keeps inside its control's padding, and the control holds what it
 * lays out.
 */
const longPlaceholderOf = (control: Locator) => control.evaluate(async (el) => {
    const input = el.querySelector<HTMLInputElement>('[data-scope="tags-input"][data-part="input"]')!;
    input.placeholder = "x".repeat(400);
    input.style.setProperty("--tags-typed", "400ch");
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const inside = { left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) };
    const typed = input.getBoundingClientRect();
    return { inField: typed.left >= inside.left - 0.5 && typed.right <= inside.right + 0.5, held: el.scrollWidth <= el.clientWidth };
});

/** A tags editor's box as drawn: whether its placeholder's words fit inside its padding whole, and whether its face is mono. */
const typedBoxOf = (editor: Locator) => editor.evaluate((el) => {
    const input = el.querySelector<HTMLInputElement>('[data-scope="tags-input"][data-part="input"]')!;
    const style = getComputedStyle(input);
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font}`;
    probe.textContent = input.placeholder;
    document.body.appendChild(probe);
    const words = probe.getBoundingClientRect().width;
    probe.remove();
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { placeholderWhole: words <= room + 0.5, mono: /mono/i.test(style.fontFamily) };
});

test.describe("A set cell on one line (east-workspace#1741)", () => {
    for (const route of [EVERY_KIND, WORKSHOP]) {
        test(`${route}: every chip line on one line inside its row, each chip whole or, alone, shortened with "…", a +N naming the rest`, async ({ page }) => {
            const entry = await open(page, route);
            expect((await linesOf(entry)).length).toBeGreaterThan(0);
            expect(await faultsOf(entry)).toEqual([]);
        });
    }

    test("a member alone wider than its half is shortened, and its hover says its whole words, where its half's would say only which half it is @desktop", async ({ page }) => {
        const entry = await open(page, WORKSHOP);
        // The first operation's cell, its destination one machine: narrowed until the chip no longer fits its half.
        const cell = entry.locator('[data-slot="row"] [data-slot="cell"][data-key="machines"]').first();
        const line = cell.locator('[data-half="to"] [data-slot="chipLine"]');
        const words = await line.locator('[data-slot="chip"] [data-slot="chipText"]').first().textContent();
        await expect(line).not.toHaveAttribute("data-alone", "");
        await cell.locator('[data-slot="linkCell"]').evaluate((grid) => { grid.style.flex = "none"; grid.style.width = "90px"; });
        await expect(line).toHaveAttribute("data-alone", "");
        await settled(page);
        expect([await line.getAttribute("title"), await cell.locator('[data-half="to"]').getAttribute("title")]).toEqual([words, "To"]);
        expect(await faultsOf(entry)).toEqual([]);
    });

    test("the workshop's own rows shorten no chip, with a tenth to spare: each half's chips, a tenth wider, still fit their line @desktop", async ({ page }) => {
        const entry = await open(page, WORKSHOP);
        // The rows are drawn a window at a time: each window down the sheet, to its foot.
        const tight = new Set<string>();
        const scroller = entry.locator('[data-builder-frame] [role="grid"]').first();
        for (let step = 0; step < 40; step++) {
            const read = await entry.evaluate((root) => [...root.querySelectorAll<HTMLElement>('[data-slot="cell"][data-key="machines"] [data-slot="chipLine"]:not([data-wrap])')].map((line) => {
                const row = line.closest<HTMLElement>('[data-slot="row"]');
                const half = line.closest("[data-half]")?.getAttribute("data-half");
                const chips = [...line.querySelectorAll<HTMLElement>(':scope > [data-slot="chip"], :scope > [data-slot="chipMore"]')];
                const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
                // Each chip at its natural width: its words' and its meta's, never the width a short line cut it to.
                const natural = chips.reduce((sum, chip) => sum + Math.max(chip.scrollWidth, chip.getBoundingClientRect().width), 0) + gap * Math.max(0, chips.length - 1);
                return { at: `${row?.getAttribute("data-row-id") ?? "?"}:${half}`, natural, room: line.getBoundingClientRect().width, alone: line.hasAttribute("data-alone"), more: line.querySelector('[data-slot="chipMore"]') !== null };
            }));
            for (const line of read) if (line.alone || line.more || line.natural * 1.1 > line.room) tight.add(`${line.at}: ${Math.round(line.natural)} in ${Math.round(line.room)}`);
            const more = await scroller.evaluate((el) => {
                const sc = [el, ...el.querySelectorAll<HTMLElement>("*")].find((x) => x.scrollHeight > x.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(x).overflowY)) ?? el;
                const before = sc.scrollTop;
                sc.scrollTop = before + Math.max(40, sc.clientHeight - 80);
                return sc.scrollTop > before;
            });
            if (!more) break;
            await settled(page);
        }
        expect([...tight]).toEqual([]);
    });

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

    test("on a phone a set cell's editor is the form's tags editor, the register's other members suggested as chips under it, a tag typed or a suggestion pressed written to the cell, which keeps its one line @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0401", "certificates");
        await cell.click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        const tags = editor.locator('[data-scope="tags-input"][data-part="item-text"]');
        const suggested = editor.locator("[data-tags-suggestion]");
        await expect(tags).toHaveText(["Forklift", "Confined space"]);
        // A phone's frame has no desktop-style popover: the suggestions are chips under the box, never the browser's list.
        await expect(editor.locator("datalist")).toHaveCount(0);
        await expect(editor.locator("input[list]")).toHaveCount(0);
        await expect(suggested).toHaveText(["First aid", "Working at height"]);
        // Its box in the field chrome's body face, its placeholder whole wherever it stands.
        expect(await typedBoxOf(editor)).toEqual({ placeholderWhole: true, mono: false });
        const input = editor.locator('[data-scope="tags-input"][data-part="input"]');
        await input.click();
        await input.pressSequentially("first");
        await expect(suggested).toHaveText(["First aid"]);
        await input.press("Enter");
        await expect(tags).toHaveText(["Forklift", "Confined space", "First aid"]);
        await expect(suggested).toHaveText(["Working at height"]);
        await settled(page);
        expect(await typedBoxOf(editor)).toEqual({ placeholderWhole: true, mono: false });
        expect(membersOf((await linesOf(entry)).find((l) => l.at === "P-0401/certificates"))).toEqual(["Forklift", "Confined space", "First aid"]);
        expect(await faultsOf(entry)).toEqual([]);
        // The design system's touch chips, in this panel alone: each 34 tall, 8 apart on its row, its × a 34 square at its
        // full height and its very end; the box a tag is typed into as tall; the suggestions the touch chip's 34 too; and
        // the control whole, its foot in sight.
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
                suggestions: [...el.querySelectorAll("[data-tags-suggestion]")].map((s) => Math.round(box(s).height)),
                whole: foot !== null && el.contains(foot),
            };
        });
        expect(drawn).toEqual({ chips: Array(3).fill({ h: 34, x: [34, 34], atEnd: true }), gaps: [8], input: 34, suggestions: [34], whole: true });
        // A suggestion pressed is taken, as the desktop's strip takes a chip, and the box keeps the focus: a phone's keyboard stays up.
        await editor.getByRole("button", { name: "Working at height", exact: true }).click();
        await expect(tags).toHaveText(["Forklift", "Confined space", "First aid", "Working at height"]);
        await expect(suggested).toHaveCount(0);
        await expect(input).toBeFocused();
        await settled(page);
        expect(membersOf((await linesOf(entry)).find((l) => l.at === "P-0401/certificates"))).toEqual(["Forklift", "Confined space", "First aid", "Working at height"]);
    });

    test("on a phone the box a tag is typed into is never narrower than its placeholder, at any phone width, where its line leaves it any room or none @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        await recordCell(entry, "P-0408", "certificates").click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        const cut: string[] = [];
        // The page is kept between tests: its own size is put back, whatever the sweep met.
        const own = page.viewportSize()!;
        try {
            for (const take of ["Forklift", "Confined space", "First aid", "Working at height"]) {
                await editor.getByRole("button", { name: take, exact: true }).click();
                await expect(editor.locator('[data-scope="tags-input"][data-part="item-text"]').last()).toHaveText(take);
                for (let width = 320; width <= 470; width += 2) {
                    await page.setViewportSize({ width, height: own.height });
                    // Laid out at that width: two frames, the frame's width read and the editor laid out again in the second.
                    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
                    if (!(await typedBoxOf(editor)).placeholderWhole) cut.push(`${take}@${width}`);
                }
                await page.setViewportSize(own);
            }
        } finally {
            await page.setViewportSize(own);
        }
        expect(cut).toEqual([]);
    });

    test("on a phone the row a set editor edits stays in view as the editor grows — whole while the room holds it, its top under the header once it does not — and a notice laid over main's foot never covers the editor @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0408", "certificates");
        await cell.click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        // A notice — the copy's — which the phone's footer lays over main's foot while it speaks.
        await page.keyboard.press("ControlOrMeta+c");
        const notice = entry.locator('[data-slot="footerLive"][data-footer-live]');
        await expect(notice).toHaveText(/^Copied /);
        const tags = editor.locator('[data-scope="tags-input"][data-part="item-text"]');
        const input = editor.locator('[data-scope="tags-input"][data-part="input"]');
        // What a tap lands on: across the edited cell's top, middle and foot, the cell — neither the header over its row nor
        // the editor under it — and on the editor's last pixels, the editor, never the notice's band.
        const landing = () => entry.evaluate((root) => {
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
        // One member typed in: the room holds the row whole, and the member taken before its words clear moves no row.
        await input.click();
        await input.pressSequentially("fork");
        await input.press("Enter");
        await expect(tags).toHaveText(["Forklift"]);
        await settled(page);
        expect(await landing()).toEqual({ row: [true, true, true], editorFoot: [true, true, true] });
        // Two more: the tags take a second line, the rows keep less room than a row, and the row's top stays in view.
        for (const word of ["conf", "work"]) {
            await input.click();
            await input.pressSequentially(word);
            await input.press("Enter");
        }
        await expect(tags).toHaveText(["Forklift", "Confined space", "Working at height"]);
        await expect(notice).toHaveText(/^Copied /);
        await settled(page);
        const grown = await landing();
        expect({ top: grown.row[0], editorFoot: grown.editorFoot }).toEqual({ top: true, editorFoot: [true, true, true] });
    });

    test("a set cell's members are fitted again as its cell gets wider: those a narrow cell folded into +N show once the cell holds them", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        const line = async () => (await linesOf(entry)).find((l) => l.at === "P-0401/certificates");
        // A phone's frame, its columns slots of the view: narrow, the cell holds one member and +1.
        await sizeBuilder(page, entry, ROOT, 390);
        const narrow = await line();
        expect([narrow?.chips, narrow?.more?.names]).toEqual([["Forklift"], ["Confined space"]]);
        // Wider, still a phone's: the slot holds both.
        await sizeBuilder(page, entry, ROOT, 540);
        const wide = await line();
        expect([wide?.chips, wide?.more]).toEqual([["Forklift", "Confined space"], undefined]);
        expect(await faultsOf(entry)).toEqual([]);
    });

    test("Details draws a set's every member, on as many lines as they take inside its field: never a +N @desktop", async ({ page }) => {
        // Wide enough for the frame to pin its inspector beside the grid.
        await page.setViewportSize({ width: 1600, height: 1200 });
        const entry = await open(page, EVERY_KIND);
        const cell = recordCell(entry, "P-0401", "certificates");
        await cell.dblclick();
        const input = cell.locator('[data-slot="editorInput"]');
        await expect(input).toBeFocused();
        await input.pressSequentially("First aid, Working at height, Rigging and slinging, Welding inspection");
        await input.press("Enter");
        await input.press("Enter");
        await expect(cell.locator('[data-slot="editor"]')).toHaveCount(0);
        await recordCell(entry, "P-0401", "name").click();
        const field = entry.locator('[data-frame-slot="end"] [role="tabpanel"]:not([hidden]) [data-inspector-link="certificates"]');
        await expect(field).toBeVisible();
        await settled(page);
        const drawn = await field.evaluate((el) => {
            const line = el.querySelector<HTMLElement>('[data-slot="chipLine"]')!;
            const box = el.getBoundingClientRect();
            const chips = [...line.querySelectorAll<HTMLElement>('[data-slot="chip"]')];
            const boxes = chips.map((chip) => chip.getBoundingClientRect());
            const words = (chip: HTMLElement) => chip.querySelector<HTMLElement>('[data-slot="chipText"]');
            return {
                chips: chips.map((chip) => words(chip)?.textContent ?? ""),
                more: line.querySelectorAll('[data-slot="chipMore"]').length,
                lines: new Set(boxes.map((b) => Math.round(b.top))).size > 1,
                outside: chips.filter((_, i) => boxes[i]!.left < box.left - 0.5 || boxes[i]!.right > box.right + 0.5).map((chip) => words(chip)?.textContent ?? ""),
                cut: chips.filter((chip) => { const w = words(chip); return w !== null && w.scrollWidth > w.clientWidth + 0.5; }).map((chip) => words(chip)?.textContent ?? ""),
            };
        });
        expect(drawn).toEqual({
            chips: ["Forklift", "Confined space", "First aid", "Working at height", "Rigging and slinging", "Welding inspection"],
            more: 0, lines: true, outside: [], cut: [],
        });
        // The row's own cell keeps its one line.
        expect(await faultsOf(entry)).toEqual([]);
    });

    test("on a touch screen wider than a phone's, a chip's × in the open editor is a 34px target of its own at the chip's end, no part of it over the chip's words: a touch on the words takes no member, one on the ×'s corner takes its own @mobile", async ({ page }) => {
        // A tablet's width: the cell's own editor, where a phone's frame edits a set in its bottom container.
        await page.setViewportSize({ width: 1024, height: 900 });
        const entry = await open(page, EVERY_KIND);
        await expect(entry.locator(ROOT).first()).not.toHaveAttribute("data-phone", "");
        const cell = recordCell(entry, "P-0401", "certificates");
        await cell.dblclick();
        const half = cell.locator('[data-slot="editor"] [data-half="to"]');
        await expect(half.locator('[data-slot="chip"] [data-slot="chipText"]')).toHaveText(["Forklift", "Confined space"]);
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a coarse pointer").toBe(true);
        const drawn = await half.evaluate((el) => [...el.querySelectorAll<HTMLElement>('[data-slot="chip"]')].map((chip) => {
            // The half scrolls sideways to keep the caret in view: each chip is read where it shows whole.
            chip.scrollIntoView({ block: "nearest", inline: "nearest" });
            const words = chip.querySelector<HTMLElement>('[data-slot="chipText"]')!;
            const remove = chip.querySelector<HTMLElement>('[data-slot="chipRemove"]')!;
            const w = words.getBoundingClientRect();
            const x = remove.getBoundingClientRect();
            const c = chip.getBoundingClientRect();
            const hit = (px: number, py: number) => {
                const at = document.elementFromPoint(px, py);
                return at === null ? "nothing" : remove.contains(at) ? "remove" : words.contains(at) ? "words" : chip.contains(at) ? "chip" : "elsewhere";
            };
            const midY = (w.top + w.bottom) / 2;
            const midX = (x.left + x.right) / 2;
            return {
                target: [Math.round(x.width), Math.round(x.height)],
                // The words, at their start, their middle and their last pixel.
                words: [hit(w.left + 1, midY), hit((w.left + w.right) / 2, midY), hit(w.right - 1, midY)],
                // The ×'s own box: its four edges, a pixel in.
                remove: [hit(x.left + 1, midY), hit(x.right - 1, midY), hit(midX, x.top + 1), hit(midX, x.bottom - 1)],
                // Clear of the words, and ending at its chip's end: never over the next chip.
                clear: x.left >= w.right - 0.5,
                atEnd: Math.abs(x.right - c.right) < 0.5,
            };
        }));
        expect(drawn).toEqual(Array(2).fill({
            target: [34, 34], words: ["words", "words", "words"], remove: ["remove", "remove", "remove", "remove"], clear: true, atEnd: true,
        }));
        // A touch on the words takes no member — at their middle: a browser gives a touch within a finger's reach of a
        // control to the control, as it does beside any — and one on the ×'s corner, far from its mark, takes its own.
        const forklift = half.locator('[data-slot="chip"]').first();
        const middle = await forklift.locator('[data-slot="chipText"]').evaluate((el) => {
            el.parentElement!.scrollIntoView({ block: "nearest", inline: "nearest" });
            const b = el.getBoundingClientRect();
            return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
        });
        await page.touchscreen.tap(middle.x, middle.y);
        await expect(half.locator('[data-slot="chip"] [data-slot="chipText"]')).toHaveText(["Forklift", "Confined space"]);
        const corner = await forklift.locator('[data-slot="chipRemove"]').evaluate((el) => {
            el.parentElement!.scrollIntoView({ block: "nearest", inline: "nearest" });
            const b = el.getBoundingClientRect();
            return { x: b.right - 3, y: b.top + 3 };
        });
        await page.touchscreen.tap(corner.x, corner.y);
        await expect(half.locator('[data-slot="chip"] [data-slot="chipText"]')).toHaveText(["Confined space"]);
    });

    test("a box a tag is typed into keeps to its field: a placeholder longer than the field is cut inside the box, which never passes the field's edge", async ({ page }) => {
        const entry = await visitBuilder(page, "forms/tags-input/tagsInputBasic", '[data-scope="tags-input"][data-part="control"]', "light");
        expect(await longPlaceholderOf(entry.locator('[data-scope="tags-input"][data-part="control"]').first())).toEqual({ inField: true, held: true });
    });

    test("on a phone the tags editor's box keeps to its field too, under a placeholder longer than it @mobile", async ({ page }) => {
        const entry = await open(page, EVERY_KIND);
        await recordCell(entry, "P-0408", "certificates").click();
        const editor = entry.locator('[data-sheet-cell-editor="certificates"] [data-cell-tags]');
        await expect(editor).toBeVisible();
        expect(await longPlaceholderOf(editor.locator('[data-scope="tags-input"][data-part="control"]'))).toEqual({ inField: true, held: true });
    });
});
