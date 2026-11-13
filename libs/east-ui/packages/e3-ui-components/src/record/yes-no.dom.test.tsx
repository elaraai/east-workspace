/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * ⌫ or Delete on a Record's yes/no cell — a boolean, a toggle — sets it off,
 * as ⌫ on a cycle goes back to its first choice (#1585). Over the Record's
 * every-kind page deployed to e3 itself.
 */

import { expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { settle, sheetHarness } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** A row's cell, by the row's key and the column's. */
const cell = (container: HTMLElement, id: string, key: string) =>
    container.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys. */
const grid = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The ring's column, by its key. */
const ring = (container: HTMLElement) => container.querySelector("[data-record] [data-active]")?.getAttribute("data-key");

/** The ring walked onto a row's cell by the arrow keys, from its badge, which a press steps nothing on. */
async function ringOn(container: HTMLElement, id: string, key: string) {
    fireEvent.mouseDown(cell(container, id, "badge"), { button: 0 });
    fireEvent.click(cell(container, id, "badge"));
    await settle();
    for (let i = 0; i < 20 && ring(container) !== key; i++) {
        fireEvent.keyDown(grid(container), { key: "ArrowRight" });
        await settle();
    }
    expect(ring(container)).toBe(key);
}

test("⌫ on a Record's boolean and Delete on its toggle set each off, as ⌫ on a cycle goes back to its first choice (#1585)", async () => {
    const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-yes-no" });
    const inducted = (id: string) => cell(container, id, "inducted").querySelector('[data-slot="box"]')?.getAttribute("aria-checked");
    const nights = (id: string) => cell(container, id, "night").textContent;
    expect([inducted("P-0401"), nights("P-0408")]).toEqual(["true", "yes"]);
    await ringOn(container, "P-0401", "inducted");
    fireEvent.keyDown(grid(container), { key: "Backspace" });
    await settle();
    await ringOn(container, "P-0408", "night");
    fireEvent.keyDown(grid(container), { key: "Delete" });
    await settle();
    expect([inducted("P-0401"), nights("P-0408")]).toEqual(["false", "no"]);
});
