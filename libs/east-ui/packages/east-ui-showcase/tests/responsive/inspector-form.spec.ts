/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The inspectors' forms, measured in a real browser (#1220): every field
 * `FieldForm` draws in the Sheet's inspector and in the Plan's, aligned to the
 * pixel. A form is one column — each field's label, control and help line at
 * the form's edge, every control that fills its field as wide as the others,
 * and a Set or Clear at the field's end, clear of its control and centred on
 * its line. A one-line control — a text, a number, a date, a select, a
 * reference, a read-only value — is the design system's Input, 32px (44px on
 * a coarse pointer), whatever its kind; a checkbox's box sits centred on that
 * line, and a tag's chip is the design system's 22px. One rhythm: 16px between fields, a nested struct's among them, and
 * 8px inside a field — from its label to its control, from its control to its
 * help line, from a group's head to its first field. Nothing runs past the
 * pane's edge or is cut off; a changed field's tint stays clear of its
 * neighbours and inside the pane, and so does a focus ring.
 *
 * Read over the Sheet's examples — the machines' upkeep (`sheetUpkeep`, a
 * field of every kind: a machine with every field set, one with its Options
 * empty, a new row with no field given, a field changed, a row's issue), the
 * workshop's line, band, several rows and nothing selected, and a batch's
 * line and band — and over the Plan's print works: one event, several, a
 * press's row and nothing selected. Pinned beside main on a desktop, overlaid
 * on a phone; in both themes. No screenshot is read: boxes and computed
 * styles, polled until the page is at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test inspector-form`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { openExample, rowSel } from "./plan-page";

const SHEETS = "e3/sheet/sheet";
const EVENTS = "e3/plan/plan-events";

/** The design system's Input: a one-line control's height (`base-components.md` › Field & forms). */
const LINE = 32;
/** The touch height: every control on a coarse pointer (#346). */
const TOUCH = 44;
/** Between fields. */
const BETWEEN = 16;
/** Inside a field: its label to its control, its control to its help line; a group's head to its first field. */
const INSIDE = 8;
/** A one-line control's text: the design system's body, 13px — 16px on a coarse pointer, under which a phone zooms into a focused field (#346). */
const TYPE = { fine: "13px", coarse: "16px" } as const;
/** The box a tag is typed into: the chips' 12.5px — 16px on a coarse pointer. */
const TAG_TYPE = { fine: "12.5px", coarse: "16px" } as const;
/** A tag's chip: the design system's tag chip (`parts-tag-chip.html`), on any pointer. */
const CHIP = 22;
/** A help line: mono 11px. */
const HELP_TYPE = "11px";

/** The open pane's panel: the end slot's sheet, pinned beside main or floating over it. */
const PANEL = "[data-orientation][data-side][data-surface]";

/** What the form measures wrong, read in the page — each a line naming the field and what is out of line. */
async function formFaults(pane: Locator, coarse: boolean): Promise<string[]> {
    return pane.evaluate((slot, { coarse, line, touch, between, inside, panelSel, type, tagType, chipHeight, helpType }) => {
        const bad: string[] = [];
        const panel = slot.querySelector(panelSel) ?? slot;
        const P = panel.getBoundingClientRect();
        const H = coarse ? touch : line;
        const T = coarse ? type.coarse : type.fine;
        const TT = coarse ? tagType.coarse : tagType.fine;
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
        const px = (n: number) => `${Math.round(n * 10) / 10}px`;
        const box = (el: Element) => el.getBoundingClientRect();
        const bordered = (el: Element) => {
            const s = getComputedStyle(el);
            return ["Top", "Right", "Bottom", "Left"].every((side) => Number.parseFloat(s[`border${side}Width` as "borderTopWidth"]) > 0 && s[`border${side}Style` as "borderTopStyle"] !== "none");
        };
        const forms = [...panel.querySelectorAll("[data-field-form]")];
        if (forms.length === 0) bad.push("the pane shows no form");
        for (const form of forms) {
            const F = box(form);
            if (F.width === 0) { bad.push("a form not laid out"); continue; }
            // ── One rhythm: the form's own items, then each group's.
            const items = [...form.children].filter((el) => box(el).height > 0);
            for (let i = 1; i < items.length; i++) {
                const gap = box(items[i]!).top - box(items[i - 1]!).bottom;
                if (!near(gap, between)) bad.push(`${items[i]!.getAttribute("data-field") ?? items[i]!.getAttribute("data-field-group")}: ${px(gap)} under the field before it, not ${between}px`);
            }
            for (const group of form.querySelectorAll("[data-field-group]")) {
                const head = group.firstElementChild!;
                const fields = [...group.querySelectorAll("[data-field]")];
                const first = fields[0];
                if (first !== undefined) {
                    const gap = box(first).top - box(head).bottom;
                    if (!near(gap, inside)) bad.push(`${group.getAttribute("data-field-group")}: its first field sits ${px(gap)} under its head, not ${inside}px`);
                }
                for (let i = 1; i < fields.length; i++) {
                    const gap = box(fields[i]!).top - box(fields[i - 1]!).bottom;
                    if (!near(gap, between)) bad.push(`${fields[i]!.getAttribute("data-field")}: ${px(gap)} under the field before it in ${group.getAttribute("data-field-group")}, not ${between}px`);
                }
            }
            for (const field of form.querySelectorAll("[data-field]")) {
                const key = field.getAttribute("data-field")!;
                const editor = field.getAttribute("data-editor")!;
                const B = box(field);
                const root = field.querySelector("[data-scope=field][data-part=root]");
                const label = root?.querySelector(":scope > [data-part=label]") ?? null;
                if (root === null || label === null) { bad.push(`${key}: no field around it`); continue; }
                // The control's line: what the field holds after its label.
                const lineEl = label.nextElementSibling;
                const help = root.querySelector(":scope > [data-part=helper-text]");
                const side = field.querySelector("[data-field-set], [data-field-clear]");
                // ── One column.
                if (!near(B.left, F.left) || !near(B.right, F.right)) bad.push(`${key}: the field spans ${px(B.left - F.left)}–${px(B.right - F.left)} of the form's ${px(F.width)}`);
                for (const [what, el] of [["label", label], ["control", lineEl], ["help line", help]] as const) {
                    if (el === null) continue;
                    if (!near(box(el).left, F.left)) bad.push(`${key}: its ${what} starts ${px(box(el).left - F.left)} in from the form's edge`);
                }
                if (lineEl === null) { bad.push(`${key}: no control`); continue; }
                const L = box(lineEl);
                // ── Inside a field: 8px from the label to the control, and from the control to its help line.
                const toLine = L.top - box(label).bottom;
                if (!near(toLine, inside)) bad.push(`${key}: its control sits ${px(toLine)} under its label, not ${inside}px`);
                // What the line holds: a checkbox, tags, the host's own control, or one bordered box — a text, a
                // number, a date, a select, a read-only value, a checklist's box, or a field with no value yet.
                const tick = lineEl.querySelector("[data-scope=checkbox][data-part=control]");
                const tagged = lineEl.querySelector("[data-scope=tags-input][data-part=control]");
                const shape = editor === "custom" ? "custom" : tick !== null ? "checkbox" : tagged !== null ? "tags" : "line";
                // The control's bordered box: the tags' own, or the first in the line that is not the Set or Clear.
                const control = shape === "tags" ? tagged
                    : [lineEl, ...lineEl.querySelectorAll("*")].find((el) => bordered(el) && box(el).width > 20 && (side === null || !side.contains(el))) ?? null;
                if (help !== null) {
                    const under = (shape === "line" || shape === "tags") && control !== null ? control : lineEl;
                    const gap = box(help).top - box(under).bottom;
                    if (!near(gap, inside)) bad.push(`${key}: its help line sits ${px(gap)} under its control, not ${inside}px`);
                    const size = getComputedStyle(help).fontSize;
                    if (size !== helpType) bad.push(`${key}: its help line is set in ${size}, not ${helpType}`);
                }
                // ── One height per line, and one type: the text a control holds.
                if (shape === "line") {
                    if (control === null) bad.push(`${key}: no bordered control`);
                    else {
                        if (!near(box(control).height, H)) bad.push(`${key} (${editor}): its control is ${px(box(control).height)} tall, not ${H}px`);
                        const text = control.matches("input, button") ? control : control.querySelector("input, [role=spinbutton]") ?? control;
                        const size = getComputedStyle(text).fontSize;
                        if (size !== T) bad.push(`${key} (${editor}): its text is set in ${size}, not ${T}`);
                    }
                }
                if (shape === "tags" && control !== null) {
                    // One row of chips, or none, is one line; more rows grow it.
                    const rows = new Set([...control.querySelectorAll("[data-part=item], [data-part=input]")].map((c) => Math.round(box(c).top)));
                    if (rows.size <= 1 ? !near(box(control).height, H) : box(control).height < H - 0.5) bad.push(`${key} (tags): its control is ${px(box(control).height)} tall over ${rows.size} rows, not ${H}px`);
                    // Each chip the design system's: a row stands its line whatever its chips' height, so the chips are read too.
                    for (const chip of control.querySelectorAll("[data-part=item-preview]")) {
                        if (!near(box(chip).height, chipHeight)) bad.push(`${key} (tags): its chip "${chip.textContent}" is ${px(box(chip).height)} tall, not ${chipHeight}px`);
                    }
                    const typed = control.querySelector("[data-part=input]");
                    const size = typed === null ? null : getComputedStyle(typed).fontSize;
                    if (size !== null && size !== TT) bad.push(`${key} (tags): its box is set in ${size}, not ${TT}`);
                }
                if (shape === "checkbox") {
                    const T = box(tick!);
                    if (!near(L.height, H)) bad.push(`${key} (checkbox): its line is ${px(L.height)} tall, not ${H}px`);
                    if (!near(T.top + T.height / 2, L.top + L.height / 2)) bad.push(`${key} (checkbox): its box is centred ${px(T.top + T.height / 2 - (L.top + L.height / 2))} off its line`);
                }
                // ── A control that fills its field: from the form's edge to its end, or to its Set or Clear.
                const fills = control !== null && (shape === "line" || shape === "tags");
                if (side !== null) {
                    const S = box(side);
                    const what = side.hasAttribute("data-field-set") ? "Set" : "Clear";
                    if (!near(S.right, F.right)) bad.push(`${key}: its ${what} ends ${px(F.right - S.right)} short of the form's edge`);
                    const A = fills ? box(control!) : L;
                    if (fills && S.left < A.right + 4 - 0.5) bad.push(`${key}: its ${what} sits ${px(S.left - A.right)} from its control`);
                    const mid = A.top + A.height / 2;
                    if (!near(S.top + S.height / 2, mid)) bad.push(`${key}: its ${what} is centred ${px(S.top + S.height / 2 - mid)} off its control's line`);
                } else if (fills && control !== null && !near(box(control).right, F.right)) {
                    bad.push(`${key} (${editor}): its control ends ${px(F.right - box(control).right)} short of the form's edge`);
                }
                if (fills && control !== null && !near(box(control).left, F.left)) bad.push(`${key} (${editor}): its control starts ${px(box(control).left - F.left)} in from the form's edge`);
            }
        }
        // ── Nothing escapes the pane, or is cut off.
        for (const el of panel.querySelectorAll("*")) {
            const s = getComputedStyle(el);
            const b = box(el);
            if (b.width <= 1 || b.height <= 1 || s.visibility === "hidden" || s.clip.startsWith("rect(0")) continue;
            if (b.left < P.left - 0.5 || b.right > P.right + 0.5) {
                const what = el.getAttribute("data-field") ?? el.getAttribute("data-part") ?? el.tagName.toLowerCase();
                bad.push(`${what}: ${px(b.left - P.left)}–${px(b.right - P.left)} past the pane's ${px(P.width)}`);
            }
        }
        for (const el of panel.querySelectorAll("[data-field] *")) {
            const s = getComputedStyle(el);
            const clips = s.overflowX === "hidden" || s.overflowX === "clip" || el.tagName === "INPUT";
            if (!clips || el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
            const text = el instanceof HTMLInputElement ? el.value : el.textContent ?? "";
            const titled = el.closest("[title]")?.getAttribute("title") === text;
            if (s.textOverflow !== "ellipsis" || !titled) bad.push(`${el.closest("[data-field]")!.getAttribute("data-field")}: "${text}" is cut off`);
        }
        // ── A changed field's tint: the field's own, inside the pane, and clear of every other field's — as if each
        // of them were changed too, so two changed fields' tints never meet.
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--chakra-colors-brand-tint)";
        document.body.appendChild(probe);
        const tint = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const fields = [...panel.querySelectorAll("[data-field]")];
        const spreadOf = (el: Element) => Math.max(0, ...[...getComputedStyle(el).boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)]
            .map((m) => Number(m[4]) + Number(m[3]) + Math.max(Math.abs(Number(m[1])), Math.abs(Number(m[2])))));
        const grown = (el: Element, spread: number) => {
            const b = box(el);
            return { left: b.left - spread, right: b.right + spread, top: b.top - spread, bottom: b.bottom + spread };
        };
        const meets = (a: { left: number; right: number; top: number; bottom: number }, b: DOMRect | { left: number; right: number; top: number; bottom: number }) =>
            a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const dirty = fields.filter((f) => f.hasAttribute("data-dirty"));
        for (const f of dirty) {
            const key = f.getAttribute("data-field");
            if (getComputedStyle(f).backgroundColor !== tint) bad.push(`${key}: changed, and not tinted`);
            const spread = spreadOf(f);
            const t = grown(f, spread);
            if (t.left < P.left - 0.5 || t.right > P.right + 0.5) bad.push(`${key}: its tint runs past the pane`);
            for (const other of fields) {
                if (other === f || other.contains(f) || f.contains(other)) continue;
                if (meets(t, grown(other, spread))) bad.push(`${key}: its tint would meet ${other.getAttribute("data-field")}'s`);
            }
            for (const head of panel.querySelectorAll("[data-field-group] > :first-child")) {
                if (meets(t, box(head))) bad.push(`${key}: its tint reaches the head ${head.textContent}`);
            }
        }
        return bad;
    }, { coarse, line: LINE, touch: TOUCH, between: BETWEEN, inside: INSIDE, panelSel: PANEL, type: TYPE, tagType: TAG_TYPE, chipHeight: CHIP, helpType: HELP_TYPE });
}

/** What of the pane falls outside it, read in the page — for a pane that shows no form: its counts, facts and hints. */
async function paneFaults(pane: Locator): Promise<string[]> {
    return pane.evaluate((slot, panelSel) => {
        const panel = slot.querySelector(panelSel) ?? slot;
        const P = panel.getBoundingClientRect();
        const bad: string[] = [];
        let shown = 0;
        for (const el of panel.querySelectorAll("*")) {
            const s = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            if (b.width <= 1 || b.height <= 1 || s.visibility === "hidden" || s.clip.startsWith("rect(0")) continue;
            shown++;
            if (b.left < P.left - 0.5 || b.right > P.right + 0.5) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").slice(0, 24)}": past the pane's edge`);
        }
        if (shown === 0) bad.push("the pane shows nothing");
        return bad;
    }, PANEL);
}

/** Every control's focus ring, stepped through by Tab from the form's first: inside the pane. */
async function ringFaults(page: Page, pane: Locator): Promise<string[]> {
    const first = pane.locator("[data-field-form] input:not([disabled]), [data-field-form] button:not([disabled])").first();
    await first.focus();
    const bad: string[] = [];
    for (let i = 0; i < 40; i++) {
        const at = await pane.evaluate((slot, panelSel) => {
            const panel = slot.querySelector(panelSel) ?? slot;
            const active = document.activeElement;
            if (active === null || !panel.contains(active)) return null;
            const P = panel.getBoundingClientRect();
            // The ring is the focused control's, or its bordered box's (a number, a date, tags: focus within).
            let ringed: Element | null = active;
            while (ringed !== null && panel.contains(ringed) && getComputedStyle(ringed).boxShadow === "none") ringed = ringed.parentElement;
            if (ringed === null || !panel.contains(ringed)) return { name: active.tagName, out: false };
            const b = ringed.getBoundingClientRect();
            const spread = Math.max(0, ...[...getComputedStyle(ringed).boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map((m) => Number(m[4]) + Number(m[3])));
            return { name: `${active.closest("[data-field]")?.getAttribute("data-field") ?? active.tagName}`, out: b.left - spread < P.left - 0.5 || b.right + spread > P.right + 0.5 };
        }, PANEL);
        if (at === null) break;
        if (at.out) bad.push(`${at.name}: its focus ring runs past the pane`);
        await page.keyboard.press("Tab");
    }
    return bad;
}

// ============================================================================
// The Sheet's inspector
// ============================================================================

/** Open a Sheet example: on a desktop its box 1440px wide, the inspector pinned beside main; on a phone as the page lays it out. */
async function openSheet(page: Page, name: string, theme: "light" | "dark", phone: boolean): Promise<{ box: Locator; pane: Locator }> {
    const hash = `${SHEETS}/${name}`;
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    const box = entry.locator("[data-builder-frame]").first().locator("xpath=..");
    if (!phone) await box.evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
    await settled(page);
    return { box, pane: box.locator("[data-builder-frame] [data-frame-slot=end]") };
}

/** A sheet's row, by its id. */
const sheetRow = (box: Locator, id: string) => box.locator(`[data-frame-slot=main] [data-slot=row][data-row-id="${id}"]`);

/** Select by a click, or a tap on a phone, then open the inspector there from its rail. */
async function select(page: Page, box: Locator, target: Locator, phone: boolean): Promise<void> {
    if (phone) await target.tap();
    else await target.click();
    await settled(page);
    if (phone) {
        await box.getByRole("button", { name: "Expand Inspector" }).tap();
        await settled(page);
    }
}

for (const phone of [false, true]) {
    test.describe(`The Sheet's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1220)`, () => {
        test.skip(({ isMobile }) => isMobile !== phone, phone ? "measured on the phone" : "measured at the desktop width");
        const coarse = phone;
        const themes = phone ? (["light"] as const) : (["light", "dark"] as const);

        for (const theme of themes) {
            test(`the upkeep: a machine with every field set — each kind on one column and one line, Set and Clear on its line, one rhythm, nothing past the pane (${theme})`, async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", theme, phone);
                await select(page, box, sheetRow(box, "S101").locator("[data-slot=cell][data-key=name]"), phone);
                await expect(pane.locator("[data-sheet-inspector=row] [data-field]")).toHaveCount(15);
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });

            test(`the upkeep: a machine with its Options empty — Not set, Set beside a number, a checkbox and a date, empty tags and checklist (${theme})`, async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", theme, phone);
                await select(page, box, sheetRow(box, "E201").locator("[data-slot=cell][data-key=name]"), phone);
                await expect(pane.locator("[data-field='wear'] [data-field-set]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });
        }

        test("the upkeep: a new row, no field given but its name — every field Not set, its issues listed above them, nothing past the pane", async ({ page }) => {
            const { box, pane } = await openSheet(page, "sheetUpkeep", "light", phone);
            const blank = box.locator("[data-frame-slot=main] [data-slot=row][data-blank] [data-slot=cell][data-key=name]").first();
            if (phone) await blank.tap();
            else await blank.click();
            await page.keyboard.type("Planer");
            await page.keyboard.press("Enter");
            await settled(page);
            const row = box.locator("[data-frame-slot=main] [data-slot=row]:not([data-blank])", { has: page.locator("[data-key=name]", { hasText: "Planer" }) });
            await select(page, box, row.locator("[data-slot=cell][data-key=name]"), phone);
            await expect(pane.locator("[data-inspector-issues]")).toBeVisible();
            await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            expect(await paneFaults(pane)).toEqual([]);
        });

        if (!phone) {
            test("the upkeep: a field changed in the form is tinted, the tint clear of its neighbours and inside the pane; a row out of service lists its issue", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", "light", phone);
                await select(page, box, sheetRow(box, "R301").locator("[data-slot=cell][data-key=name]"), phone);
                const crew = pane.locator("[data-field='crew'] input");
                await crew.fill("Day crew");
                await crew.press("Enter");
                await expect(pane.locator("[data-field='crew'][data-dirty]")).toHaveCount(1);
                await expect(pane.locator("[data-inspector-issues]")).toContainText("book its next service");
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });

            test("the upkeep: every control's focus ring stays inside the pane", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetUpkeep", "light", phone);
                await select(page, box, sheetRow(box, "S101").locator("[data-slot=cell][data-key=name]"), phone);
                expect(await ringFaults(page, pane)).toEqual([]);
            });

            for (const theme of ["light", "dark"] as const) {
                test(`the workshop: an operation's line — its dates, its quantity with its unit, its work centres, its notes and created_by read only (${theme})`, async ({ page }) => {
                    const { box, pane } = await openSheet(page, "sheetWorkshop", theme, phone);
                    await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row]:not(:has([data-slot=groupSummary])) [data-slot=cell][data-key=notes]").first(), phone);
                    await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
                    await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                });
            }

            test("the workshop: an order's band — its name, customer, due date and status", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetWorkshop", "light", phone);
                await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row][data-band-row] [data-slot=cell]").first(), phone);
                await expect(pane.locator("[data-sheet-inspector=band]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });

            test("the workshop: several operations — the column a bulk edit sets, and its value", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetWorkshop", "light", phone);
                const gutters = box.locator("[data-frame-slot=main] [data-slot=row]:not([data-band-row]):not([data-blank]) [data-slot=gutter]");
                await gutters.nth(0).click();
                await gutters.nth(2).click({ modifiers: ["Shift"] });
                await settled(page);
                await expect(pane.locator("[data-sheet-inspector=several]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });

            test("the workshop with nothing selected: its counts and hints inside the pane", async ({ page }) => {
                const { pane } = await openSheet(page, "sheetWorkshop", "light", phone);
                await expect(pane.locator("[data-sheet-inspector=none]")).toBeVisible();
                expect(await paneFaults(pane)).toEqual([]);
            });

            test("the batches: a step's line and a batch's band", async ({ page }) => {
                const { box, pane } = await openSheet(page, "sheetBatches", "light", phone);
                await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row]:not([data-band-row]):not([data-blank]) [data-slot=cell][data-key=task]").first(), phone);
                await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
                await select(page, box, box.locator("[data-frame-slot=main] [data-slot=row][data-band-row] [data-slot=cell]").first(), phone);
                await expect(pane.locator("[data-sheet-inspector=band]")).toBeVisible();
                await expect.poll(() => formFaults(pane, coarse)).toEqual([]);
            });
        }
    });
}

// ============================================================================
// The Plan's inspector
// ============================================================================

/** Open the print works: on a desktop its box 1440px wide, both panes pinned beside main. */
async function openPrintWorks(page: Page, theme: "light" | "dark", phone: boolean): Promise<{ entry: Locator; frame: Locator; pane: Locator }> {
    const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
    if (!phone) {
        await entry.locator("[data-plan-frame]").first().locator("xpath=..").evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
        await settled(page);
    }
    const frame = entry.locator("[data-builder-frame]").first();
    return { entry, frame, pane: frame.locator(":scope > [data-frame-slot='body'] > [data-frame-slot='end']") };
}

/** The spring catalogue's run on Press A1, and the press's other runs. */
const pressA1 = rowSel("presses.span", "Hall A", "a1");

for (const phone of [false, true]) {
    test.describe(`The Plan's inspector form — ${phone ? "on a phone" : "pinned beside main"} (#1220)`, () => {
        test.skip(({ isMobile }) => isMobile !== phone, phone ? "measured on the phone" : "measured at the desktop width");
        const themes = phone ? (["light"] as const) : (["light", "dark"] as const);

        for (const theme of themes) {
            test(`one event: its kind's form — a customer, a stock, a due date and time — on one column and one line (${theme})`, async ({ page }) => {
                const { entry, frame, pane } = await openPrintWorks(page, theme, phone);
                // On a phone the Plan is its narrow list (#570): the press's card, in the Rows tab, draws its runs.
                if (phone) {
                    await entry.locator("[data-plan-tab='rows']").tap();
                    await settled(page);
                }
                const bar = phone ? entry.locator("[data-run]", { hasText: "Spring catalogue" }).first() : entry.locator(`${pressA1} [data-run]`, { hasText: "Spring catalogue" });
                await select(page, frame, bar, phone);
                await expect(pane.locator("[data-plan-inspector='event'] [data-field]")).toHaveCount(3);
                await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });
        }

        if (!phone) {
            test("several events: the bulk edit's state and resource", async ({ page }) => {
                const { entry, frame, pane } = await openPrintWorks(page, "light", phone);
                await select(page, frame, entry.locator(`${pressA1} [data-run]`, { hasText: "Spring catalogue" }), phone);
                await entry.locator(`${pressA1} [data-run]`, { hasText: "Museum guide" }).click({ modifiers: ["Shift"] });
                await settled(page);
                await expect(pane.locator("[data-plan-inspector='events']")).toBeVisible();
                await expect.poll(() => formFaults(pane, phone)).toEqual([]);
                expect(await paneFaults(pane)).toEqual([]);
            });

            test("a press's row and nothing selected: facts, counts and hints inside the pane", async ({ page }) => {
                const { entry, frame, pane } = await openPrintWorks(page, "light", phone);
                await expect(pane.locator("[data-plan-inspector='none']")).toBeVisible();
                expect(await paneFaults(pane)).toEqual([]);
                await select(page, frame, entry.locator(`${pressA1} [role="rowheader"]`), phone);
                await expect(pane.locator("[data-plan-inspector='row']")).toBeVisible();
                expect(await paneFaults(pane)).toEqual([]);
            });
        }
    });
}
