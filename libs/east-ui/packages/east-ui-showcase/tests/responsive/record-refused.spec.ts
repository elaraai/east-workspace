/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A change a Record refuses is seen to be refused (east-workspace#1709): on
 * the stock locations keyed by their aisle and their bin (`recordBuiltKeys`),
 * a bin typed over that would build another location's key leaves the
 * location as it was — and says so in red: the status line in the danger ink,
 * and the location's row flashing the danger ring and wash once, then as it
 * was. Refused again, it flashes again. Where the viewer asks for less motion
 * the ring stands instead, for as long as the line says why. The next change
 * taken says its own words, in the line's own ink, and no row is marked.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test record-refused --project desktop`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { CLEAR, cellOf, openRecord, played, rowOf } from "./record-page";
import { settled } from "./settle";
import { computed, token } from "./tokens";

/** What the status line says of a bin that would build Pallet wrap's key. */
const TAKEN = 'Another location is keyed "A-1" already';

/** A bin typed over a location's, as a person types it: the cell pressed, the digits, ⏎. */
async function typeBin(page: Page, entry: Locator, id: string, bin: string): Promise<void> {
    await cellOf(entry, id, "bin").click();
    await page.keyboard.type(bin);
    await page.keyboard.press("Enter");
    await settled(page);
}

/** The flash a row is running, by its name; `null` for a row running none. */
const flashOf = (row: Locator): Promise<string | null> => row.evaluate((el) => {
    const flash = el.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName.startsWith("refused-"));
    return flash instanceof CSSAnimation ? flash.animationName : null;
});

/** A row as its flash draws it at its start, the flash held there: its ring and its paper. */
const flashStart = (row: Locator): Promise<{ ring: string; paper: string }> => row.evaluate((el) => {
    const flash = el.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName.startsWith("refused-"))!;
    flash.pause();
    flash.currentTime = 0;
    const s = getComputedStyle(el);
    const drawn = { ring: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`, paper: s.backgroundColor };
    flash.play();
    return drawn;
});

/**
 * A colour as the page paints it — its red, green, blue and alpha, each of 255: a flash's is computed in the space it
 * is mixed in, and prints unlike the same colour a recipe names.
 */
const painted = (page: Page, colour: string): Promise<number[]> => page.evaluate((value) => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
}, colour);

/** A row's ring and its paper as they stand. */
const standing = (row: Locator): Promise<{ ring: string; paper: string }> => row.evaluate((el) => {
    const s = getComputedStyle(el);
    return { ring: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`, paper: s.backgroundColor };
});

test("recordBuiltKeys: a bin that would build another location's key is refused in red — the status line in the danger ink, the location's row flashing the danger ring and wash once, and again as it is refused again; with less motion the ring stands; the next change taken clears both @desktop", async ({ page }) => {
    const entry = await openRecord(page, "recordBuiltKeys", "light", 1280);
    const status = entry.locator('[data-frame-slot="toolbar"] [data-slot="status"]');
    const strapping = rowOf(entry, "A-2");
    const ink = () => status.evaluate((el) => getComputedStyle(el).color);
    const [danger, muted, neg] = [await token(page, "fg-danger"), await token(page, "fg-muted"), await token(page, "status-neg")];
    // The wash an invalid cell wears: the danger colour, 17% over the paper.
    const wash = await painted(page, await computed(page, "backgroundColor", "color-mix(in srgb, var(--chakra-colors-status-neg) 17%, var(--chakra-colors-bg-surface))"));
    expect(danger, "the danger ink is no ink the line says a change taken in").not.toBe(muted);
    // A row's own papers: at rest, under the pointer, and holding the ring.
    const papers = [await token(page, "bg-surface"), await token(page, "bg-canvas"), await token(page, "bg-subtle")];

    // Strapping's bin typed as 1: A-1 is Pallet wrap's. The location keeps its bin and its key.
    await typeBin(page, entry, "A-2", "1");
    await expect(status).toHaveText(TAKEN);
    await expect(status).toHaveAttribute("data-tone", "refused");
    expect(await ink()).toBe(danger);
    await expect(cellOf(entry, "A-2", "bin")).toHaveText("2");
    // Its row flashes: the danger ring inside its edge and the danger wash, then nothing of either.
    const first = await flashOf(strapping);
    expect(first).toMatch(/^refused-[ab]$/);
    const start = await flashStart(strapping);
    expect([start.ring, await painted(page, start.paper)]).toEqual([`2px solid ${neg} -2px`, wash]);
    await played(strapping);
    const after = await standing(strapping);
    expect([after.ring.includes("none") || after.ring.includes(CLEAR), papers.includes(after.paper)], `${after.ring} on ${after.paper}`).toEqual([true, true]);
    // No other row is marked: never the location that holds the key.
    await expect(entry.locator('[data-record] [data-slot="row"][data-refused]')).toHaveCount(1);

    // Refused again, it flashes again: the flash starts over under its other name.
    await typeBin(page, entry, "A-2", "1");
    const second = await flashOf(strapping);
    expect([second === null, second === first]).toEqual([false, false]);
    await played(strapping);

    // With less motion there is no flash to see: the ring stands, for as long as the line says why.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await typeBin(page, entry, "A-2", "1");
    await played(strapping);
    await expect(status).toHaveAttribute("data-tone", "refused");
    expect((await standing(strapping)).ring).toBe(`2px solid ${neg} -2px`);
    await page.emulateMedia({ reducedMotion: null });

    // A bin no location holds: Strapping moves under A-9, the line says its own words in its own ink, and no row is marked.
    await typeBin(page, entry, "A-2", "9");
    await expect(rowOf(entry, "A-9")).toHaveCount(1);
    await expect(status).not.toHaveAttribute("data-tone", "refused");
    expect(await ink()).toBe(muted);
    await expect(entry.locator('[data-record] [data-slot="row"][data-refused]')).toHaveCount(0);
});
