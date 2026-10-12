/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * One line per size (#1220): the shared inputs — a text, an integer, a float,
 * a date and its time — and a select's trigger stand one height at each size:
 * the design system's Input at `md`, 32px, 26px at `sm` and 44px at `lg`,
 * their text the size's own, 12.5px, 13px and 14px. Chakra's default recipes
 * had set a text input's and a select's type at 14px on 20px whatever the
 * size, so at `md` a text stood 36px beside a 33px date and a 32px number. On
 * a coarse pointer a control is the 44px touch height, its text 16px. Read
 * over the input configurator — a type and a size at a time — and the select
 * example's trigger, in a real browser: boxes and computed styles.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test field-heights`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const INPUTS = "forms/input/inputStyles";
const SELECTS = "forms/select/selectVariants";

/** Each size's one line and its text (`field-chrome.ts` › `fieldHeights`, the input recipe's sizes). */
const SIZES = [
    { size: "sm", height: 26, type: "12.5px" },
    { size: "md", height: 32, type: "13px" },
    { size: "lg", height: 44, type: "14px" },
] as const;

/** The configurator's input types. */
const TYPES = ["string", "integer", "float", "datetime"] as const;

/** Open an example's entry, at rest. */
async function open(page: Page, hash: string): Promise<Locator> {
    await page.goto(`/?theme=light#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    return entry;
}

/** Choose an item of one of the configurator's selects — its control's nth trigger — and wait for its list to go. */
async function choose(page: Page, entry: Locator, nth: number, item: string): Promise<void> {
    await entry.locator("[data-scope=select][data-part=trigger]").nth(nth).click();
    await page.getByRole("option", { name: item, exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await settled(page);
}

/** The preview's control: its bordered box, how tall it stands, and the type of the text it holds — every segment's, a date's and its time's. */
function previewControl(entry: Locator): Promise<{ height: number; type: string } | null> {
    return entry.evaluate((root) => {
        // A drawn border: a date's segments keep a transparent one, for their focus.
        const bordered = (el: Element) => {
            const s = getComputedStyle(el);
            return ["Top", "Right", "Bottom", "Left"].every((side) => Number.parseFloat(s[`border${side}Width` as "borderTopWidth"]) > 0)
                && s.borderTopColor !== "rgba(0, 0, 0, 0)" && s.borderTopColor !== "transparent";
        };
        // A text's box, a number's root, or the box around a date's segments.
        const text = root.querySelector("input[placeholder='Type something...']");
        const number = root.querySelector("[data-scope=number-input][data-part=root]");
        const segment = root.querySelector("[role=spinbutton]");
        let box: Element | null = text ?? number;
        if (box === null && segment !== null) {
            box = segment;
            while (box !== null && !bordered(box)) box = box.parentElement;
        }
        if (box === null) return null;
        const typed = text !== null ? [text] : number !== null ? [number.querySelector("[data-part=input]")!] : [...root.querySelectorAll("[role=spinbutton]")];
        const types = [...new Set(typed.map((el) => getComputedStyle(el).fontSize))];
        return { height: Math.round(box.getBoundingClientRect().height * 10) / 10, type: types.join(" + ") };
    });
}

test.describe("One line per size (#1220)", () => {
    test.skip(({ isMobile }) => isMobile, "measured at each size with a fine pointer; the phone's below");

    test("the input configurator: a text, an integer, a float and a date with its time are one height at each size, their text the size's", async ({ page }) => {
        test.setTimeout(120_000);
        const entry = await open(page, INPUTS);
        const read: string[] = [];
        const want: string[] = [];
        for (const { size, height, type } of SIZES) {
            await choose(page, entry, 1, size);
            for (const kind of TYPES) {
                await choose(page, entry, 0, kind);
                const at = await previewControl(entry);
                read.push(`${size} ${kind}: ${at === null ? "none" : `${at.height}px, ${at.type}`}`);
                want.push(`${size} ${kind}: ${height}px, ${type}`);
            }
        }
        expect(read).toEqual(want);
    });

    test("a select's trigger: the configurator's own at sm, 26px, and the example's at md, 32px — each its size's text", async ({ page }) => {
        const inputs = await open(page, INPUTS);
        const own = await inputs.locator("[data-scope=select][data-part=trigger]").first().evaluate((el) => [Math.round(el.getBoundingClientRect().height * 10) / 10, getComputedStyle(el).fontSize]);
        expect(own).toEqual([26, "12.5px"]);
        const selects = await open(page, SELECTS);
        const preview = await selects.locator("[data-scope=select][data-part=trigger]").first().evaluate((el) => [Math.round(el.getBoundingClientRect().height * 10) / 10, getComputedStyle(el).fontSize]);
        expect(preview).toEqual([32, "13px"]);
    });
});

test.describe("One line per size on a phone (#1220)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("the input configurator at md: a text, an integer, a float and a date with its time are the 44px touch height, their text 16px", async ({ page }) => {
        test.setTimeout(120_000);
        const entry = await open(page, INPUTS);
        const read: string[] = [];
        for (const kind of TYPES) {
            await choose(page, entry, 0, kind);
            const at = await previewControl(entry);
            read.push(`${kind}: ${at === null ? "none" : `${at.height}px, ${at.type}`}`);
        }
        expect(read).toEqual(TYPES.map((kind) => `${kind}: 44px, 16px`));
    });
});
