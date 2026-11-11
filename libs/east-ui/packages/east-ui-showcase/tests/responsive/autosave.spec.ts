/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * An automatic Save in a real browser, on the page's e3: the choice a builder
 * keeps beside Save, and what it then sends by itself — measured over the
 * Sheet's work orders, whose toolbar holds the shared history bar every
 * builder mounts and the Elara eye before it.
 *
 * - Save is a split button, one box of two parts — Save, then its chevron on
 *   Save's edge — in a bar no wider for it: its five squares stand 4 apart,
 *   and the bar is as wide as five 8 apart, so no toolbar's row folds sooner.
 *   Save alone answers to its name, or to a part of it, as a script or a
 *   voice asks for it. The chevron opens one switch, Autosave — its word at
 *   the row's start, the switch at its end, and nothing else to read — off as
 *   it begins; flicked on, it is kept at once, in the browser, and holds
 *   through a reload.
 * - On, an edit is saved a pause after the person's last act, with no press of
 *   Save: one commit to the page's e3, which the sheet, mounted again over the
 *   record, shows.
 * - An optimiser's result is never saved by itself. What was changed before it
 *   is; then Save waits for a press, the split button wearing Elara's ring as
 *   one outline — around Save and its chevron together, neither part ringed by
 *   itself, its edge whole on every side — and the panel says why. A press
 *   sends the rest, as one commit, and the ring goes.
 * - An Undo or a Redo is never saved by itself (ruled 11 Nov 2026): stepped
 *   back over a saved edit, nothing is sent however long it stands, nor as the
 *   tab hides, and Save — on — says why. Forward again, nothing waits. A press
 *   of Save sends a step back as the person's, and the next edit is saved by
 *   itself as before.
 * - Where a builder's author says so (`autosave`, a literal or the app's own
 *   data), the switch begins on with nothing kept in the browser, and an edit
 *   is saved by itself from the first; the viewer's own flick is kept, and
 *   stands over the author's word through a reload — measured over a Calendar
 *   whose `autosave` reads an input of the app's.
 * - On a phone the chevron is a square on Save's edge, in the row where the
 *   row holds it beside its count (`builder-frame-phone.spec.ts`), and a tap
 *   opens the switch in the frame's bottom panel, its row of touch size.
 *   Where the row is short of it (ruled 11 Nov 2026), More stands in Discard's
 *   place and holds the two: an author's on stands there too, a press opens
 *   the switch and Discard changes in the bottom panel, the switch flicked off
 *   is kept, and Discard changes drops the drafts at its one press; in a row
 *   wide enough again the buttons themselves are back.
 * - Under a touch pointer on a wide screen every square of the bar, and the
 *   chevron, is 44px tall by its halo and takes the taps over its own width:
 *   one just inside its edge lands on it, never on the halo of the one
 *   beside it.
 *
 * The page's clock is held, so the pause runs only as a test moves it on: an
 * edit is never sent before the test says the pause is over, however slow the
 * machine. Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `pnpm exec playwright test autosave`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { leaveBuilder, visitBuilder } from "./builder-page";
import { e3Requests, installE3Faults } from "./e3-faults";
import { OPTIMISE_BUILDERS } from "./optimise-eye";
import { settled } from "./settle";

/** The work orders with the shop's optimiser: a Sheet over a record, its history bar the shared one. */
const ORDERS = OPTIMISE_BUILDERS.Sheet;
/** A phone-sized Sheet with no optimiser: its second row holds the history alone. */
const PHONE = "e3/sheet/sheet-actions/sheetActionsPhone";
/** A Calendar whose author says where its Autosave begins, from the app's own setting: on. */
const AUTHORED = "e3/calendar/calendar/calendarAutosave";
const ROOT = "[data-builder-frame]";

/** The moment the page's clock is held at. */
const HELD = new Date("2026-11-10T09:00:00Z").getTime();
/** The automatic Save's pause, and a little more. */
const PAUSE_MS = 2_500;

/** A page whose clock is held and whose requests of its e3 are listed, on a builder's example. */
async function open(page: Page, route: string, viewport: { width: number; height: number }): Promise<Locator> {
    await installE3Faults(page);
    await page.clock.setFixedTime(new Date(HELD));
    await page.setViewportSize(viewport);
    const entry = await visitBuilder(page, route, ROOT, "light");
    return entry.locator(ROOT).first();
}

/** The clock moved on from where it is held: what waited a pause after the last act is then due. */
async function later(page: Page, ms: number): Promise<void> {
    await page.clock.setFixedTime(new Date(HELD + ms));
}

/** How many commits the page has sent its e3: a record's mutation each. */
const commits = async (page: Page): Promise<number> => (await e3Requests(page)).filter((request) => request.kind === "mutate").length;

/** The rows of a sheet that still hold a draft. */
const drafts = (frame: Locator): Locator => frame.locator("[data-frame-slot=main] [data-slot='row'][data-draft]");

/** An order's job, as the sheet draws it. */
const jobOf = (frame: Locator, order: string): Locator => frame.locator(`[data-frame-slot=main] [data-slot='row'][data-row-id='${order}'] [data-key='job']`);

/** Types a job into an order's cell, as a person does. */
async function typeJob(page: Page, frame: Locator, order: string, job: string): Promise<void> {
    await jobOf(frame, order).dblclick();
    const input = page.locator("[data-slot='editorInput']");
    await input.fill(job);
    await input.press("Enter");
    await expect(jobOf(frame, order)).toHaveText(job);
}

/** The choice's panel, wherever it opens: the popover's body, or a phone's bottom panel's. */
const panelOf = (page: Page): Locator => page.locator("[data-history-autosave-panel]");

/** The panel's one switch, as whoever asks the page finds it: a switch named Autosave. */
const switchOf = (page: Page): Locator => panelOf(page).getByRole("switch", { name: "Autosave", exact: true });

/** The switch's row, which takes the press: its word and the switch at its end. */
const rowOf = (page: Page): Locator => panelOf(page).locator("[data-scope='switch'][data-part='root']");

/** Opens the panel from the chevron and flicks Autosave on — off as it begins — then closes it with Esc. */
async function turnOn(page: Page, chevron: Locator): Promise<void> {
    await chevron.click();
    const panel = panelOf(page);
    await expect(switchOf(page)).not.toBeChecked();
    await rowOf(page).click();
    await expect(switchOf(page)).toBeChecked();
    await expect(chevron).toHaveAttribute("data-on", "");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
}

/**
 * Where the split Save wears Elara's ring — 1px of the Elara edge and its glow, as the theme draws it on what a run
 * left: on the pair's box, on Save's own or on the chevron's; whether the pair's box is its two parts' edge to edge, at
 * their corners; and each side its 1px edge is cut on by what clips the row.
 */
const ringOf = (bar: Locator) => bar.locator("[data-history-save]").evaluate((box) => {
    const save = box.querySelector("button")!;
    const chevron = box.querySelector<HTMLElement>("[data-history-autosave]")!;
    const [b, s, c] = [box.getBoundingClientRect(), save.getBoundingClientRect(), chevron.getBoundingClientRect()];
    const look = getComputedStyle(box);
    const round = (n: number) => Math.round(n * 10) / 10;
    // The ring as the page resolves it: a focused part's own ring is another shadow.
    const probe = document.createElement("span");
    probe.style.boxShadow = "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)";
    box.appendChild(probe);
    const ring = getComputedStyle(probe).boxShadow;
    probe.remove();
    const ringed = (el: Element) => getComputedStyle(el).boxShadow === ring;
    const cut: string[] = [];
    for (let at = box.parentElement; at !== null && !at.hasAttribute("data-builder-frame"); at = at.parentElement) {
        const over = getComputedStyle(at);
        if (over.overflowX === "visible" && over.overflowY === "visible") continue;
        // What clips, clips at its padding's edge.
        const clip = at.getBoundingClientRect();
        const [left, right] = [clip.left + Number.parseFloat(over.borderLeftWidth), clip.right - Number.parseFloat(over.borderRightWidth)];
        const [top, bottom] = [clip.top + Number.parseFloat(over.borderTopWidth), clip.bottom - Number.parseFloat(over.borderBottomWidth)];
        if (over.overflowX !== "visible" && (b.left - 1 < left - 0.5 || b.right + 1 > right + 0.5)) cut.push(`a side, by ${at.getAttribute("data-frame-slot") ?? at.tagName.toLowerCase()}`);
        if (over.overflowY !== "visible" && (b.top - 1 < top - 0.5 || b.bottom + 1 > bottom + 0.5)) cut.push(`its top or bottom, by ${at.getAttribute("data-frame-slot") ?? at.tagName.toLowerCase()}`);
    }
    return {
        pair: ring !== "none" && ringed(box), save: ringed(save), chevron: ringed(chevron),
        around: [round(b.left - s.left), round(b.right - c.right), round(b.top - s.top), round(b.bottom - s.bottom)],
        corners: [look.borderTopLeftRadius, look.borderTopRightRadius, look.borderBottomRightRadius, look.borderBottomLeftRadius],
        cut,
    };
});

test("Save and its chevron are one box of two parts, and Save alone answers to its name; the chevron opens one switch, Autosave, which — flicked on, kept at once — saves an edit by itself a pause after the last act — one commit to the page's e3, with no press of Save — and the sheet mounted again shows it, the choice held through a reload @desktop", async ({ page }) => {
    const frame = await open(page, ORDERS.route, { width: 1440, height: 900 });
    const bar = frame.locator("[data-frame-slot='toolbar'] [data-slot='history']");
    // Asked for by a part of its name, as a script or a voice asks for it: one button.
    const save = bar.getByRole("button", { name: "Save" });
    await expect(save).toHaveCount(1);
    const chevron = bar.locator("[data-history-autosave]");
    await expect(chevron).toHaveAccessibleName("Automatic saving");
    // One box: the chevron on Save's edge at its height, the edge between them the chevron's, square where they meet.
    const pair = await bar.locator("[data-history-save]").evaluate((box) => {
        const first = box.querySelector("button")!;
        const second = box.querySelector<HTMLElement>("[data-history-autosave]")!;
        const [s, c] = [first.getBoundingClientRect(), second.getBoundingClientRect()];
        const [sl, cl] = [getComputedStyle(first), getComputedStyle(second)];
        return {
            save: [s.width, s.height], chevron: [c.width, c.height], apart: c.left - s.right, level: c.top - s.top,
            meet: [sl.borderTopRightRadius, sl.borderBottomRightRadius, cl.borderTopLeftRadius, cl.borderBottomLeftRadius],
            ends: [sl.borderTopLeftRadius, cl.borderTopRightRadius], edge: [sl.borderRightWidth, cl.borderLeftWidth],
        };
    });
    expect(pair).toEqual({
        save: [28, 28], chevron: [16, 28], apart: 0, level: 0,
        meet: ["0px", "0px", "0px", "0px"], ends: ["4px", "4px"], edge: ["0px", "1px"],
    });
    // The bar is no wider for the chevron: its five squares 4 apart and the chevron's 16 take what five took 8 apart.
    const squares = await bar.evaluate((el) => {
        const boxes = [...el.querySelectorAll<HTMLElement>("button")].filter((b) => !b.hasAttribute("data-history-autosave")).map((b) => b.getBoundingClientRect());
        return { gaps: boxes.slice(1).map((b, i) => Math.round((b.left - boxes[i]!.right) * 10) / 10), width: Math.round(el.getBoundingClientRect().width * 10) / 10 };
    });
    expect(squares).toEqual({ gaps: [4, 4, 4, 4], width: 5 * 28 + 4 * 8 });
    await expect(chevron).not.toHaveAttribute("data-on", "");
    // The panel: one row — the word at its start, the theme's switch at its end — and nothing else to read (ruled 11 Nov
    // 2026: one switch, never a pair of choices).
    await chevron.click();
    await expect(panelOf(page)).toHaveText("Autosave");
    await expect(panelOf(page).locator("input")).toHaveCount(1);
    // At rest: the popover has grown to its size.
    await settled(page);
    const laid = await rowOf(page).evaluate((row) => {
        const panel = row.closest<HTMLElement>("[data-history-autosave-panel]")!;
        const pad = getComputedStyle(panel);
        // To a tenth of a pixel, nothing a negative nothing: the popover's last frame of growing leaves a thousandth.
        const round = (n: number) => Math.round(n * 10) / 10 || 0;
        const [p, r] = [panel.getBoundingClientRect(), row.getBoundingClientRect()];
        const label = row.querySelector("[data-part='label']")!.getBoundingClientRect();
        const control = row.querySelector("[data-part='control']")!.getBoundingClientRect();
        return {
            height: round(r.height), short: round(p.width - Number.parseFloat(pad.paddingLeft) - Number.parseFloat(pad.paddingRight) - r.width),
            label: round(label.left - r.left), control: round(r.right - control.right), size: [round(control.width), round(control.height)],
        };
    });
    expect(laid).toEqual({ height: 32, short: 0, label: 0, control: 0, size: [36, 20] });
    await page.keyboard.press("Escape");
    await expect(panelOf(page)).toBeHidden();
    await turnOn(page, chevron);

    await typeJob(page, frame, "WO-1001", "Cut side panels");
    // The clock has not moved since the edit: it waits, and nothing was sent.
    await expect(drafts(frame)).toHaveCount(1);
    await expect(save).toBeEnabled();
    expect(await commits(page)).toBe(0);
    // The pause over: the Save goes by itself, and the page reads back what it saved.
    await later(page, PAUSE_MS);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    await expect(drafts(frame)).toHaveCount(0);
    expect(await commits(page)).toBe(1);

    // Mounted again over the record: the job as saved, the choice as kept.
    await leaveBuilder(page);
    const again = (await visitBuilder(page, ORDERS.route, ROOT, undefined)).locator(ROOT).first();
    await expect(jobOf(again, "WO-1001")).toHaveText("Cut side panels");
    await expect(drafts(again)).toHaveCount(0);
    await expect(again.locator("[data-history-autosave]")).toHaveAttribute("data-on", "");
    // And through a reload, which starts the page's e3 again: the choice is the browser's.
    await page.reload();
    const reloaded = (await visitBuilder(page, ORDERS.route, ROOT, undefined)).locator(ROOT).first();
    await expect(reloaded.locator("[data-history-autosave]")).toHaveAttribute("data-on", "");
});

test("an optimiser's result is never saved by itself: what was changed before it is, then Save waits for a press, the split button wearing Elara's ring as one outline, the panel saying why — and a press sends the rest as one commit @desktop", async ({ page }) => {
    const frame = await open(page, ORDERS.route, { width: 1440, height: 900 });
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    const bar = toolbar.locator("[data-slot='history']");
    const save = toolbar.getByRole("button", { name: "Save" });
    const chevron = toolbar.locator("[data-history-autosave]");
    // Nothing waits: no ring, on the pair or on either part.
    expect(await ringOf(bar)).toMatchObject({ pair: false, save: false, chevron: false });
    await turnOn(page, chevron);
    // A person's edit, to an order the optimiser leaves as it is; then a run from the eye, which lands as one step after it.
    await typeJob(page, frame, "WO-1001", "Cut side panels");
    const eye = toolbar.locator("[data-optimise-button]");
    await expect(eye).toBeEnabled({ timeout: 30_000 });
    await eye.click();
    await expect(frame.locator("[data-optimise-banner='done']")).toBeVisible({ timeout: 45_000 });
    await settled(page);
    // The result waits for a person's Save from the moment it lands: Save says so, and nothing was sent.
    await expect(save).toHaveAttribute("data-held", "");
    expect(await commits(page)).toBe(0);
    // The ring is the pair's, one outline around Save and its chevron (ruled 11 Nov 2026): on the box that is the two
    // edge to edge, at their corners, neither part ringed by itself, its edge whole on every side. The pointer off the
    // bar: a hover draws nothing of its own on a part.
    await page.mouse.move(0, 0);
    expect(await ringOf(bar)).toEqual({ pair: true, save: false, chevron: false, around: [0, 0, 0, 0], corners: ["4px", "4px", "4px", "4px"], cut: [] });
    const waiting = await drafts(frame).count();
    expect(waiting, "the edited order, and each the run changed").toBeGreaterThan(1);
    // The pause over: the edit made before the run is saved by itself — one commit — and the run's changes stay drafts.
    await later(page, PAUSE_MS);
    await expect(drafts(frame)).toHaveCount(waiting - 1, { timeout: 15_000 });
    expect(await commits(page)).toBe(1);
    await expect(jobOf(frame, "WO-1001")).toHaveText("Cut side panels");
    await expect(save).toHaveAttribute("data-held", "");
    await expect(save).toBeEnabled();
    // The panel says why they wait.
    await chevron.click();
    await expect(panelOf(page).locator("[data-history-autosave-held]")).toHaveText("Elara's changes, and what you changed after them, are saved when you press Save.");
    await page.keyboard.press("Escape");
    await expect(panelOf(page)).toBeHidden();
    // However long they wait, they are not sent: a press of Save sends them, the second commit and no third.
    await later(page, 10 * 60_000);
    await save.click();
    await expect(save).toBeDisabled({ timeout: 15_000 });
    await expect(drafts(frame)).toHaveCount(0);
    expect(await commits(page)).toBe(2);
    await expect(save).not.toHaveAttribute("data-held", "");
    expect(await ringOf(bar)).toMatchObject({ pair: false, save: false, chevron: false });
});

/** The tab hidden, then shown again: what an automatic Save has due is sent at once as it hides. */
async function hideTab(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        // The document's own again.
        Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange"));
    });
}

test("on, an Undo or a Redo is never saved by itself: stepped back over a saved edit, nothing is sent however long it stands nor as the tab hides, Save on and saying why; forward again nothing waits; back once more, a press of Save sends what stands; and the next edit is saved by itself again @desktop", async ({ page }) => {
    const frame = await open(page, ORDERS.route, { width: 1440, height: 900 });
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    const save = toolbar.getByRole("button", { name: "Save" });
    const undo = toolbar.getByRole("button", { name: "Undo", exact: true });
    const redo = toolbar.getByRole("button", { name: "Redo", exact: true });
    await turnOn(page, toolbar.locator("[data-history-autosave]"));
    const was = (await jobOf(frame, "WO-1001").textContent()) ?? "";
    await typeJob(page, frame, "WO-1001", "Cut side panels");
    await later(page, PAUSE_MS);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    await expect(drafts(frame)).toHaveCount(0);
    expect(await commits(page)).toBe(1);

    // Back, to look: the job as it was, a draft over what was saved. Ten minutes on, and the tab hidden — which sends at
    // once whatever an automatic Save has due — nothing was sent: a step back is no change of the person's.
    await undo.click();
    await expect(jobOf(frame, "WO-1001")).toHaveText(was);
    await expect(drafts(frame)).toHaveCount(1);
    await later(page, PAUSE_MS + 10 * 60_000);
    await hideTab(page);
    await settled(page);
    expect(await commits(page)).toBe(1);
    await expect(drafts(frame)).toHaveCount(1);
    // Save is on, and says why it waits.
    await expect(save).toBeEnabled();
    await save.hover();
    await expect(page.locator("[data-scope='tooltip'][data-part='content'][data-state='open']")).toHaveText("Save · Undo and Redo are not saved automatically");
    await page.mouse.move(0, 0);

    // Forward again: as it was saved — no draft, nothing to save.
    await redo.click();
    await expect(jobOf(frame, "WO-1001")).toHaveText("Cut side panels");
    await expect(drafts(frame)).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect(await commits(page)).toBe(1);

    // Back once more, and a press of Save: the state stepped to is saved, as the person's — the second commit.
    await undo.click();
    await expect(drafts(frame)).toHaveCount(1);
    await save.click();
    await expect(drafts(frame)).toHaveCount(0, { timeout: 15_000 });
    await expect(jobOf(frame, "WO-1001")).toHaveText(was);
    expect(await commits(page)).toBe(2);

    // And the next edit is the person's newest: saved by itself, a pause after it — the third commit.
    await typeJob(page, frame, "WO-1001", "Cut end panels");
    expect(await commits(page)).toBe(2);
    await later(page, 2 * PAUSE_MS + 10 * 60_000);
    await expect(drafts(frame)).toHaveCount(0, { timeout: 15_000 });
    expect(await commits(page)).toBe(3);
});

test("on a phone the chevron is a square on Save's edge; a tap opens the switch in the frame's bottom panel, its row of touch size; flicked on, it is kept, and the panel's close takes the focus back to the chevron @mobile", async ({ page }) => {
    // A phone 430 wide: the showcase's card leaves the builder 364px, a row that holds the chevron beside its count (from 338).
    const frame = await open(page, PHONE, { width: 430, height: 932 });
    await expect(frame).toHaveAttribute("data-phone", "");
    const row = frame.locator("[data-frame-slot='sessionRow']");
    const chevron = row.locator("[data-history-autosave]");
    await expect(chevron).toBeVisible();
    await expect(row.getByRole("button", { name: "Save" })).toHaveCount(1);
    await chevron.tap();
    // No popover on a phone: the frame's bottom panel, as the row's conflicts open in it.
    const panel = frame.locator("[data-frame-slot='bottomPanel'] [data-frame-panel]");
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-scope='popover'][data-part='content'][data-state='open']")).toHaveCount(0);
    // One switch, its row the target at touch size and as wide as the panel's body: its word at the start, the switch at the end.
    const flick = rowOf(page);
    await expect(panel.locator("input")).toHaveCount(1);
    const laid = await flick.evaluate((el) => {
        const body = el.closest<HTMLElement>("[data-history-autosave-panel]")!;
        const pad = getComputedStyle(body);
        const round = (n: number) => Math.round(n * 10) / 10;
        const [b, r] = [body.getBoundingClientRect(), el.getBoundingClientRect()];
        const label = el.querySelector<HTMLElement>("[data-part='label']")!;
        return {
            tall: r.height >= 44, short: round(b.width - Number.parseFloat(pad.paddingLeft) - Number.parseFloat(pad.paddingRight) - r.width),
            control: round(r.right - el.querySelector("[data-part='control']")!.getBoundingClientRect().right),
            word: [label.textContent, label.scrollWidth <= label.clientWidth + 0.5],
        };
    });
    expect(laid).toEqual({ tall: true, short: 0, control: 0, word: ["Autosave", true] });
    await expect(switchOf(page)).not.toBeChecked();
    await flick.tap();
    await expect(switchOf(page)).toBeChecked();
    await expect(chevron).toHaveAttribute("data-on", "");
    await panel.locator("[data-frame-panel-close]").tap();
    await expect(panel).toHaveCount(0);
    await expect(chevron).toBeFocused();
});

test("under a touch pointer on a wide screen every square of the bar, and the chevron, is 44px tall by its halo and takes the taps over its own width: one just inside its edge lands on it, never on the one beside it @mobile", async ({ page }) => {
    const frame = await open(page, ORDERS.route, { width: 1280, height: 800 });
    await expect(frame).not.toHaveAttribute("data-phone", "");
    const bar = frame.locator("[data-frame-slot='toolbar'] [data-slot='history']");
    await expect(bar.locator("[data-history-save]")).toBeVisible();
    // The band in the window's middle: a tap above or below a control is on the screen.
    await frame.locator("[data-frame-slot='toolbar']").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const missed = await bar.evaluate((el) => {
        const bad: string[] = [];
        const lands = (on: Element, x: number, middle: number, where: string) => {
            const name = on.getAttribute("aria-label") ?? "?";
            for (const dy of [-21, 0, 21]) {
                const hit = document.elementFromPoint(x, middle + dy);
                if (hit === null || !on.contains(hit)) bad.push(`${name}: a tap ${where}${dy === 0 ? "" : `, ${Math.abs(dy)}px ${dy < 0 ? "above" : "below"} its middle,`} lands on ${hit?.getAttribute("aria-label") ?? hit?.tagName ?? "nothing"}`);
            }
        };
        // Each control the bar shows: its issues button, hidden in its slot while there are none, takes no tap.
        const shown = [...el.querySelectorAll<HTMLElement>("button")].filter((button) => button.checkVisibility({ visibilityProperty: true }));
        for (const button of shown) {
            const b = button.getBoundingClientRect();
            const middle = b.top + b.height / 2;
            lands(button, b.left + 2, middle, "2px inside its start");
            lands(button, b.left + b.width / 2, middle, "on its column");
            lands(button, b.right - 2, middle, "2px inside its end");
        }
        return { bad, shown: shown.map((button) => button.getAttribute("aria-label")) };
    });
    expect(missed).toEqual({ bad: [], shown: ["Undo", "Redo", "Discard", "Save", "Automatic saving"] });
});

test("where its author says Autosave begins on, it is on from the first, nothing kept in the browser, and an edit is saved by itself a pause after it; the viewer's flick off is kept, and stands over the author's word through a reload @desktop", async ({ page }) => {
    const frame = await open(page, AUTHORED, { width: 1440, height: 900 });
    const bar = frame.locator("[data-frame-slot='toolbar'] [data-slot='history']");
    const save = bar.getByRole("button", { name: "Save" });
    const chevron = bar.locator("[data-history-autosave]");
    /** The choices of an automatic Save the browser keeps: a viewer's own, never an author's word. */
    const kept = () => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes("editing.autosave")).length);
    // On as the app's setting says, with no choice of the viewer's kept.
    await expect(chevron).toHaveAttribute("data-on", "");
    expect(await kept()).toBe(0);
    // An edit: a visit deleted from the keyboard.
    const visit = frame.locator("[data-calendar-event]", { hasText: "Intake call" });
    await visit.click();
    await page.keyboard.press("Delete");
    await expect(visit).toHaveCount(0);
    // The clock has not moved since the edit: it waits, and nothing was sent.
    await expect(save).toBeEnabled();
    expect(await commits(page)).toBe(0);
    // The pause over: the Save goes by itself, one commit, and still nothing is kept in the browser.
    await later(page, PAUSE_MS);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    expect(await commits(page)).toBe(1);
    expect(await kept()).toBe(0);
    // The viewer's own: flicked off, kept at once.
    await chevron.click();
    await expect(switchOf(page)).toBeChecked();
    await rowOf(page).click();
    await expect(switchOf(page)).not.toBeChecked();
    await expect(chevron).not.toHaveAttribute("data-on", "");
    expect(await kept()).toBe(1);
    await page.keyboard.press("Escape");
    await expect(panelOf(page)).toBeHidden();
    // Through a reload, which starts the page's e3 again with its setting on: the viewer's choice stands over it.
    await page.reload();
    const reloaded = (await visitBuilder(page, AUTHORED, ROOT, undefined)).locator(ROOT).first();
    await expect(reloaded.locator("[data-history-autosave]")).not.toHaveAttribute("data-on", "");
});

test("in a phone's row too short for Save's chevron, More stands in Discard's place and holds the two (ruled 11 Nov 2026): an author's on shows on it and an edit is saved by itself; a press opens the Autosave switch and Discard changes in the frame's bottom panel; flicked off — kept — the next edit waits however long, and Discard changes drops it at its one press; in a row wide enough again the buttons themselves are back @desktop", async ({ page }) => {
    const frame = await open(page, AUTHORED, { width: 1440, height: 900 });
    const chevron = frame.locator("[data-history-autosave]"), more = frame.locator("[data-history-more]");
    const save = frame.getByRole("button", { name: "Save" });
    const discard = frame.getByRole("button", { name: "Discard", exact: true });
    const visit = (title: string) => frame.locator("[data-calendar-event]", { hasText: title });
    /** A visit deleted from the keyboard, in a frame wide enough for its grid. */
    const remove = async (title: string) => { await visit(title).click(); await page.keyboard.press("Delete"); await expect(visit(title)).toHaveCount(0); };
    /** A phone's frame, 294px wide in a 360px page: its row short of the chevron. */
    const narrow = async () => { await page.setViewportSize({ width: 360, height: 800 }); await settled(page); await expect(frame).toHaveAttribute("data-phone", ""); };
    const wide = async () => { await page.setViewportSize({ width: 1440, height: 900 }); await settled(page); await expect(frame).not.toHaveAttribute("data-phone", ""); };
    // A toolbar's bar: the buttons themselves, and no More.
    await expect(chevron).toHaveAttribute("data-on", "");
    await expect(more).toHaveCount(0);
    // An edit, the clock held: it waits.
    await remove("Intake call");
    expect(await commits(page)).toBe(0);
    // The row short of the chevron: More in Discard's place, on as its author says — and its on stands, so the edit goes.
    await narrow();
    await expect(chevron).toBeHidden();
    await expect(discard).toHaveCount(0);
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("data-on", "");
    await later(page, PAUSE_MS);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    expect(await commits(page)).toBe(1);
    // More opens the two in the frame's bottom panel — no popover on a phone: the switch, on, and Discard changes, off with nothing drafted.
    await more.click();
    const panel = frame.locator("[data-frame-slot='bottomPanel'] [data-frame-panel]");
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-scope='popover'][data-part='content'][data-state='open']")).toHaveCount(0);
    const drop = panel.getByRole("button", { name: "Discard changes", exact: true });
    await expect(switchOf(page)).toBeChecked();
    await expect(drop).toBeDisabled();
    // Each the panel's width, the button — a 44px target under any pointer — under the switch, whose row a touch pointer
    // makes 44 too (the phone's chevron test).
    const laid = await panel.locator("[data-history-more-panel]").evaluate((body) => {
        const pad = getComputedStyle(body), room = body.getBoundingClientRect().width - Number.parseFloat(pad.paddingLeft) - Number.parseFloat(pad.paddingRight);
        const [flick, button] = [body.querySelector("[data-scope='switch'][data-part='root']")!.getBoundingClientRect(), body.querySelector("button")!.getBoundingClientRect()];
        const round = (n: number) => Math.round(n * 10) / 10;
        return { switch: round(room - flick.width), button: [round(room - button.width), button.height >= 44, button.top >= flick.bottom] };
    });
    expect(laid).toEqual({ switch: 0, button: [0, true, true] });
    // Flicked off: kept, and off on More.
    await rowOf(page).click();
    await expect(switchOf(page)).not.toBeChecked();
    await expect(more).not.toHaveAttribute("data-on", "");
    expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes("editing.autosave")).length)).toBe(1);
    await panel.locator("[data-frame-panel-close]").click();
    await expect(panel).toHaveCount(0);
    await expect(more).toBeFocused();
    // Off: the next edit — made where the frame is wide — waits however long, and as the tab hides.
    await wide();
    await expect(more).toHaveCount(0);
    await expect(discard).toBeVisible();
    await expect(chevron).toBeVisible();
    await remove("Site survey");
    await narrow();
    await later(page, 2 * PAUSE_MS + 10 * 60_000);
    await hideTab(page);
    await settled(page);
    expect(await commits(page)).toBe(1);
    await expect(save).toBeEnabled();
    // Discard changes, on now: one press drops the draft — the press of More came first — and the panel goes.
    await more.click();
    await expect(drop).toBeEnabled();
    await drop.click();
    await expect(panel).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect(await commits(page)).toBe(1);
    // Wide again: the visit the draft removed is back, with the buttons themselves.
    await wide();
    await expect(visit("Site survey")).toHaveCount(1);
    await expect(more).toHaveCount(0);
});
