/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A docked pane's control as the page draws it — a `<Dock>`'s, and every
 * builder's panes' — and the presses that collapse and expand the pane: its
 * control; on its open row, the room between the control and its tabs; on its
 * rail, the room beside the control on the rail's bar, and the rail's own. A
 * pane's control stands where it stands, open or collapsed: what a spec checks
 * after each press (`dock.spec.ts`, `builder-panes.spec.ts`). Where it stands
 * is read against what holds the pane — its builder's frame, else its example
 * — so a page that scrolls to bring a control into view moves nothing.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A point on the page. */
interface Point { readonly x: number; readonly y: number }

/** A pane's control, where it stands, and the points a press toggles the pane at that are no control. */
export interface DockControl {
    /** Whether the pane is open. */
    readonly open: boolean;
    /** The control's name: `Collapse …` open, `Expand …` collapsed. */
    readonly name: string;
    /** The control's box, from the corner of what holds the pane: its builder's frame, else its example. */
    readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    /** Open: the room on its row between the control and its tabs (or its name). */
    readonly row: Point | undefined;
    /** Collapsed: the room beside the control on the rail's bar. */
    readonly bar: Point | undefined;
    /** Collapsed: the rail's own room, before what it shows. */
    readonly rail: Point | undefined;
}

/**
 * Reads a pane's control: the pane is the `<Dock>`'s root (`[data-orientation][data-side][data-surface]`).
 *
 * @param pane - The pane
 * @returns Its control, where it stands, and the points a press toggles it at
 */
export function dockControlOf(pane: Locator): Promise<DockControl> {
    return pane.evaluate((root) => {
        const open = !root.hasAttribute("data-collapsed");
        // The control: the row's or the rail bar's button that says whether the pane is open, never the `+n` menu's.
        const control = root.querySelector<HTMLElement>(":scope > * > button[aria-expanded]");
        if (control === null) throw new Error("the pane draws no control");
        const c = control.getBoundingClientRect();
        // Against what holds the pane, which a scroll moves with it.
        const held = (root.closest("[data-builder-frame]") ?? root.closest("[data-index]") ?? document.documentElement).getBoundingClientRect();
        const box = { x: c.x - held.x, y: c.y - held.y, width: c.width, height: c.height };
        const middle = c.top + c.height / 2;
        let row: { x: number; y: number } | undefined;
        let bar: { x: number; y: number } | undefined;
        let rail: { x: number; y: number } | undefined;
        if (open) {
            // What the row holds beside its control: its tabs, or its name as its only tab.
            const beside = control.parentElement!.querySelector(":scope > [data-dock-tabs], :scope > span");
            if (beside !== null) {
                const h = beside.getBoundingClientRect();
                row = c.right <= h.left ? { x: (c.right + h.left) / 2, y: middle } : { x: (h.right + c.left) / 2, y: middle };
            }
        } else {
            const holder = control.parentElement!;
            const vertical = root.getAttribute("data-orientation") === "vertical";
            // Beside the control on its bar: above it on a sidebar's rail, before it on a tray's.
            bar = vertical ? { x: c.left - 4, y: middle } : { x: c.left + c.width / 2, y: c.top - 4 };
            const shown = [...root.children].find((child) => child !== holder && !child.hasAttribute("data-dock-body") && child.getAttribute("role") !== "tabpanel");
            if (shown !== undefined) {
                const r = shown.getBoundingClientRect();
                rail = { x: r.left + 6, y: r.top + 6 };
            }
        }
        return { open, name: control.getAttribute("aria-label") ?? "", box, row, bar, rail };
    });
}

/** How a press toggles a pane: on its control, or on the room beside it — its row's open, its rail's or its bar's collapsed. */
export type DockPress = "control" | "row" | "bar" | "rail";

/**
 * Presses a pane where it says, waits for the page to be at rest, and checks the pane toggled and its control stands
 * where it stood: to the 64th of a pixel the page lays out in, across and, but on a tray pinned to the end — whose row
 * rides the tray's edge as it opens — down.
 *
 * @param page - The page
 * @param pane - The pane
 * @param rest - The control as it stood at rest
 * @param press - Where to press
 */
export async function pressDock(page: Page, pane: Locator, rest: DockControl, press: DockPress): Promise<void> {
    // In view first: a press by its point lands where the page shows it.
    await pane.locator(":scope > * > button[aria-expanded]").first().scrollIntoViewIfNeeded();
    const before = await dockControlOf(pane);
    if (press === "control") await pane.getByRole("button", { name: before.name, exact: true }).click();
    else {
        const at = before[press];
        if (at === undefined) throw new Error(`the pane has no ${press} to press, ${before.open ? "open" : "collapsed"}`);
        await page.mouse.click(at.x, at.y);
    }
    await settled(page);
    const rides = await pane.evaluate((root) => root.getAttribute("data-orientation") === "vertical" && root.getAttribute("data-side") === "end");
    const lu = (v: number) => Math.round(v * 64) / 64 + 0;
    await expect.poll(async () => {
        const now = await dockControlOf(pane);
        return {
            open: now.open,
            moved: `${lu(now.box.x - rest.box.x)}px across, ${rides ? "—" : `${lu(now.box.y - rest.box.y)}px`} down`,
            size: `${lu(now.box.width)} × ${lu(now.box.height)}`,
        };
    }, { message: `pressed on its ${press}` }).toEqual({
        open: !before.open,
        moved: `0px across, ${rides ? "—" : "0px"} down`,
        size: `${lu(rest.box.width)} × ${lu(rest.box.height)}`,
    });
}
