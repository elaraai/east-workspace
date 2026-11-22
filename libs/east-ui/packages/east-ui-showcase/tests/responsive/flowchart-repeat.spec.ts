/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A transition drawn where there is one already is refused where it is seen
 * (east-workspace#1709): on the bakery's steps (`flowchartBakery`), a handle
 * dragged from Mix to Proof, which a move joins already, adds none — and the
 * footer says so, naming the two steps, in the danger ink. A drop that seems
 * to have done nothing is never left unexplained. The next transition drawn,
 * from Mix to Bake, is added, and the footer's words go. A page of its own:
 * the pointer is held down as a handle is dragged.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-repeat --project desktop`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { CARRY_WINDOW, openFlowchart } from "./flowchart-page";
import { settled } from "./settle";
import { token } from "./tokens";

/** A handle of one step dragged to the middle of another's card, and let go there. */
async function connect(page: Page, root: Locator, from: Locator, to: Locator): Promise<void> {
    const key = await from.getAttribute("data-flowchart-node");
    const handle = (await root.locator(`[data-flowchart-ports=${JSON.stringify(key)}] [data-flowchart-handle="right"]`).boundingBox())!;
    const card = (await to.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 10 });
    await page.mouse.up();
    await settled(page);
}

test("flowchartBakery: a handle dragged to a step it is joined to already adds nothing, and the footer says the two steps are joined already, in the danger ink — until a transition is added @desktop", async ({ page }) => {
    await page.setViewportSize(CARRY_WINDOW);
    const { root } = await openFlowchart(page, "flowchartBakery");
    const step = (name: string): Locator => root.locator("[data-flowchart-node]").filter({ hasText: name }).first();
    const links = root.locator("[data-flowchart-link]");
    const said = root.locator("[data-flowchart-message]");
    const joined = await links.count();
    await expect(said).toHaveText("");

    // Mix to Proof is joined already: none is added, and the footer says so in the danger ink.
    await connect(page, root, step("Mix"), step("Proof"));
    await expect(links).toHaveCount(joined);
    await expect(said).toHaveText(/^A .+ from Mix to Proof is there already$/);
    await expect(said).toHaveAttribute("data-tone", "refused");
    expect(await said.evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, "fg-danger"));

    // Mix to Bake is joined by none: it is added, and the refusal's words go.
    await connect(page, root, step("Mix"), step("Bake"));
    await expect(links).toHaveCount(joined + 1);
    await expect(said).toHaveText("");
    await expect(said).not.toHaveAttribute("data-tone", "refused");
});
