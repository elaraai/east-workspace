/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Record's inspector (`Record - DX Proposal.md` IN1–IN9), measured in the
 * page in both themes: the shift preferences (Example 3) at a width that pins
 * the inspector beside the grid. With no row, its counts and its hint; on a
 * row, the tabs, the head and its chip, the sections by column group, a
 * cycle's line of radios, a drafted field's tint, the facts and the actions;
 * on a new row, its issues over its form, each field they name washed and no
 * radio checked, then the Issues tab's lines, a press on one ringing its cell
 * and putting the keyboard in its field. The read-only skills matrix (Example
 * 5) prints each member, its long label whole, and offers no action. The
 * page's clock is held at the day the proposal walks and its zone at UTC, so
 * each age and each audit reads the same whenever and wherever the suite
 * runs; a spec that holds the clock keeps Playwright's own page.
 */

import { expect, test, type Locator } from "playwright/test";
import { RECORD_THEMES, cellOf, looks, openRecord, recordTheme, type PartLook } from "./record-page";
import { computed } from "./tokens";

test.use({ timezoneId: "UTC" });

/** The type a part is set in: its family, size, weight, spacing in ems, and case. */
const typeOf = (part: PartLook | null) => [part?.family, part?.size, part?.weight, part?.spacing, part?.caps];

/** The inspector's pane, and the tab open in it. */
function paneOf(entry: Locator): { pane: Locator; open: Locator } {
    const pane = entry.locator('[data-frame-slot="end"]');
    return { pane, open: pane.locator('[role="tabpanel"]:not([hidden])') };
}

for (const theme of RECORD_THEMES) {
    test(`the inspector on no row and on one: its counts and hint, the tabs, the head and its chip, the sections by column group, a cycle's line of radios, the facts and the actions (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRecord(page, "recordShiftPreferences", theme, 1600);
        const t = await recordTheme(page);
        const { pane, open } = paneOf(entry);
        await expect(pane).toHaveAttribute("data-pane-mode", "pinned");

        // IN8: no row — the rows shown, the drafts pending and the rows stale, each value mono at the body's size over its label, then the hint.
        const none = await looks(open.locator('[data-record-details="none"]'), {
            shown: '[data-count="shown"] > :first-child', pending: '[data-count="pending"] > :first-child', stale: '[data-count="stale"] > :first-child',
            label: '[data-count="shown"] > :last-child', hint: "[data-record-hint]",
        });
        expect([none.shown?.text, none.pending?.text, none.stale?.text], theme).toEqual(["3", "0", "1"]);
        expect([none.shown?.family, none.shown?.size, none.shown?.weight, none.shown?.tnum, none.shown?.ink], theme).toEqual([t.mono, t.size.body, "500", true, t.c.fg]);
        expect([none.label?.text, ...typeOf(none.label), none.label?.ink], theme).toEqual(["Shown", t.mono, t.size["label-lg"], "600", 0.18, "uppercase", t.c["fg-subtle"]]);
        expect([none.hint?.text, none.hint?.size, none.hint?.ink], theme).toEqual(["Select a row to see its fields here.", t.size["body-sm"], t.c["fg-muted"]]);

        // IN1: the tabs, 43 tall and 20 apart, mono at the label size, 600, 0.14em, in capitals: the open one in ink over a 2px rule of
        // it, the other in the subtle ink; the pane's collapse at their end.
        const tabs = await looks(pane, {
            list: '[role="tablist"]', open: '[role="tab"][aria-selected="true"]', other: '[role="tab"][aria-selected="false"]',
            label: '[role="tab"][aria-selected="true"] > span',
        });
        expect([tabs.list?.height, tabs.list?.gap], theme).toEqual([43, "20px"]);
        expect([tabs.open?.text, tabs.open?.ink, tabs.open?.under], theme).toEqual(["Details", t.c.fg, `2px ${t.c.fg}`]);
        expect([tabs.other?.text, tabs.other?.ink], theme).toEqual([expect.stringMatching(/^Issues/), t.c["fg-subtle"]]);
        expect(typeOf(tabs.label), theme).toEqual([t.mono, t.size["label-md"], "600", 0.14, "uppercase"]);
        await expect(pane.getByRole("button", { name: "Collapse Inspector" }).locator('svg[data-icon="angles-right"]')).toHaveCount(1);

        // P1 on A. Morgan's role: Details for the row.
        await cellOf(entry, "P-0401", "role").click();
        const row = open.locator('[data-record-details="row"]');
        await expect(row).toHaveAttribute("data-record-entry", "P-0401");

        // IN2: the head — the eyebrow naming its row, the title in the heading face, no chip while nothing is drafted.
        const head = await looks(row, { eyebrow: "[data-inspector-what]", name: "[data-inspector-id]", chip: "[data-inspector-id] + * > [data-state]" });
        expect([head.eyebrow?.text, ...typeOf(head.eyebrow), head.eyebrow?.ink], theme).toEqual(["row 1", t.mono, t.size["label-lg"], "600", 0.18, "uppercase", t.c["fg-subtle"]]);
        expect([head.name?.text, head.name?.family, head.name?.size, head.name?.weight, head.name?.ink], theme).toEqual(["A. Morgan", t.heading, t.size["title-md"], "600", t.c.fg]);
        expect(head.chip, theme).toBeNull();

        // IN4: the fields in column order, each column group a section under its label — an unlabelled group's Other — the
        // section heads mono at the label size, 600, 0.16em, in capitals, in the subtle ink.
        const fields = await row.locator("[data-field]").evaluateAll((els) => els.map((el) => el.getAttribute("data-field")));
        expect(fields, theme).toEqual(["name", "role", "days", "afternoon", "nights", "sat", "sun", "overtime"]);
        const sections = await row.locator("[data-field-group]").evaluateAll((els) => els.map((el) => el.getAttribute("data-field-group")));
        expect(sections, theme).toEqual(["Shifts", "Weekends", "Other"]);
        const section = await looks(row, { head: '[data-field-group="Shifts"] > span' });
        expect([section.head?.text, ...typeOf(section.head), section.head?.ink], theme).toEqual(["Shifts", t.mono, t.size["label-sm"], "600", 0.16, "uppercase", t.c["fg-subtle"]]);
        // …the lines of a section 4 apart.
        const lines = await row.locator('[data-field-group="Shifts"] [data-field]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((b) => [b.top, b.bottom]));
        expect(lines.slice(1).map(([top], i) => Math.round(top! - lines[i]![1]!)), theme).toEqual([4, 4]);

        // IN5: a cycle's field one 32 line — its label at the start, 12.5/600 in ink, its whole label its tooltip — and its radios at
        // the end, 12 apart, each a 14 ring in the strong rule, the checked one in the brand with a 6 dot of it.
        const days = row.locator('[data-field="days"]');
        await expect(days).toHaveAttribute("title", "Days");
        const line = await looks(days, { line: "", label: ":scope > span", choices: "[data-field-choice]", checked: '[data-part="item-control"][data-state="checked"]',
            unchecked: '[data-part="item-control"][data-state="unchecked"]', dot: '[data-part="item-control"][data-state="checked"] > span' });
        expect([line.line?.height, line.label?.text, line.label?.size, line.label?.weight, line.label?.ink], theme).toEqual([32, "Days", t.size["body-sm"], "600", t.c.fg]);
        expect(line.choices?.right, `${theme}: at the line's end`).toBe(line.line?.right);
        expect([line.unchecked?.width, line.unchecked?.height, line.unchecked?.edge, line.unchecked?.bg], theme).toEqual([14, 14, t.c["border-strong"], t.c["bg-surface"]]);
        expect([line.checked?.edge, line.dot?.width, line.dot?.height, line.dot?.bg], theme).toEqual([t.c["brand-solid"], 6, 6, t.c["brand-solid"]]);
        const items = await days.locator('[data-part="item"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((b) => [b.left, b.right]));
        expect(items.slice(1).map(([left], i) => Math.round(left! - items[i]![1]!)), theme).toEqual([12, 12]);

        // A cycle stepped in the grid: its field tinted as a change, the tint spread 6 past it, and the head's chip how many fields changed.
        await cellOf(entry, "P-0401", "days").click();
        await expect(days).toHaveAttribute("data-dirty", "");
        await expect(days).toHaveCSS("background-color", t.c["brand-tint"]);
        await expect(days).toHaveCSS("box-shadow", await computed(page, "boxShadow", "0 0 0 6px var(--chakra-colors-brand-tint)"));
        const chip = row.locator('[data-inspector-id] + * > [data-state="pending"]');
        await expect(chip).toHaveText("1 pending");
        await expect(chip).toHaveCSS("background-color", t.c["brand-tint"]);
        await expect(chip).toHaveCSS("color", t.c["brand-solid"]);

        // IN6: the facts last — the audit's when, verb and who, and the age's count — each read only, 32 tall, mono 500 at the body's
        // size in tabular figures, on the canvas behind the subtle rule.
        const facts = await looks(row, { age: '[data-record-fact="days_since"] input', audit: '[data-record-fact="updated"] input' });
        expect(await row.locator('[data-record-fact="updated"] input').inputValue(), theme).toBe("2026-10-21 10:15 · changed · K. Lund");
        expect(await row.locator('[data-record-fact="days_since"] input').inputValue(), theme).toBe("16");
        for (const fact of [facts.age, facts.audit]) {
            expect([fact?.height, fact?.edge, fact?.bg, fact?.family, fact?.size, fact?.weight, fact?.tnum, fact?.ink], theme)
                .toEqual([32, t.c["border-subtle"], t.c["bg-canvas"], t.mono, t.size.body, "500", true, t.c.fg]);
        }
        // IN7: Duplicate and Delete, the Sheet's.
        await expect(row.locator('[data-inspector-action="duplicate"]')).toBeEnabled();
        await expect(row.locator('[data-inspector-action="delete"]')).toBeEnabled();

        // …and D. Novak's age, stale, in the warn step.
        await cellOf(entry, "P-0422", "role").click();
        await expect(row).toHaveAttribute("data-record-entry", "P-0422");
        const stale = row.locator('[data-record-fact="days_since"] input');
        await expect(stale).toHaveValue("177");
        await expect(stale).toHaveAttribute("data-stale", "");
        await expect(stale).toHaveCSS("color", t.c["fg-warning"]);
    });

    test(`a new row in the inspector: New, its issues over its form, each field they name washed and no radio checked — then the Issues tab's lines, a press on one going to its cell and its field (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRecord(page, "recordShiftPreferences", theme, 1600);
        const t = await recordTheme(page);
        const { pane, open } = paneOf(entry);
        // AD1: Add opens the new row on Details.
        await entry.locator('[data-frame-slot="toolbar"] [data-record-action="add"]').click();
        const row = open.locator('[data-record-details="row"]');
        await expect(row.locator('[data-inspector-id] + * > [data-state="new"]')).toHaveText("New");

        // IN2: a new row's chip, New on the subtle paper in the strong rule; its title a dash while empty.
        const head = await looks(row, { name: "[data-inspector-id]", chip: '[data-inspector-id] + * > [data-state="new"]' });
        expect(head.name?.text, theme).toBe("—");
        expect([head.chip?.bg, head.chip?.edge, head.chip?.ink], theme).toEqual([t.c["bg-subtle"], t.c["border-strong"], t.c["fg-strong"]]);

        // IN3: its issues over its form — each field's label mono in capitals in the subtle ink, over its message in the warn step —
        // and each field they name in the warn wash, spread 6 past it.
        const issues = row.locator("[data-inspector-issues]");
        const n = await issues.locator("[data-kind]").count();
        expect(n, theme).toBeGreaterThan(0);
        await expect(issues.locator(":scope > :first-child")).toHaveText(`${n} issues`);
        const issue = await looks(issues, { field: ":scope > :nth-child(2) > :first-child", text: ":scope > :nth-child(2) > [data-kind]" });
        expect([issue.field?.family, issue.field?.size, issue.field?.caps, issue.field?.ink], theme).toEqual([t.mono, t.size["label-sm"], "uppercase", t.c["fg-subtle"]]);
        expect([issue.text?.text, issue.text?.size, issue.text?.ink], theme).toEqual(["Required", t.size["body-sm"], t.c["fg-warning"]]);
        const named = row.locator("[data-field][data-issue]");
        await expect(named).toHaveCount(n);
        const wash = await computed(page, "boxShadow", `0 0 0 6px ${t.requiredWash}`);
        for (let i = 0; i < n; i += 1) {
            await expect(named.nth(i), theme).toHaveCSS("background-color", t.requiredWash);
            await expect(named.nth(i), theme).toHaveCSS("box-shadow", wash);
        }
        // IN5: none checked while unset.
        await expect(row.locator('[data-part="item-control"][data-state="checked"]')).toHaveCount(0);

        // IN9: the Issues tab — each issue its row by its title and its field, mono in capitals in the subtle ink, over its message;
        // a new row with no title yet is New and the record's noun.
        await pane.getByRole("tab", { name: /^Issues/ }).click();
        const lines = open.locator("[data-inspector-issue]");
        await expect(lines).toHaveCount(n);
        const nights = lines.filter({ hasText: "· Nights" });
        const said = await looks(nights, { where: ":scope > :first-child", message: ":scope > [data-kind]" });
        expect([said.where?.text, said.where?.family, said.where?.size, said.where?.caps, said.where?.ink], theme)
            .toEqual(["New person · Nights", t.mono, t.size["label-sm"], "uppercase", t.c["fg-subtle"]]);
        expect([said.message?.text, said.message?.ink], theme).toEqual(["Required", t.c["fg-warning"]]);
        // A press on one: the ring on its cell, Details open, the keyboard in its field.
        await nights.click();
        await expect(pane.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
        const added = entry.locator('[data-record] [data-slot="row"]:has([data-required])');
        await expect(added.locator('[data-slot="cell"][data-key="nights"]')).toHaveAttribute("data-active", "");
        await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-field]")?.getAttribute("data-field") ?? null)).toBe("nights");

        // Undo takes the row back, and the batch holds no issue.
        await entry.locator('[data-frame-slot="toolbar"] button[aria-label="Undo"]').click();
        await expect(added).toHaveCount(0);
        await pane.getByRole("tab", { name: /^Issues/ }).click();
        await expect(open.locator("[data-inspector-no-issues] > :first-child")).toHaveText("No issues");
    });
}

test("a read-only Record's inspector: each member printed on its field's line, the long label whole, no action @desktop", async ({ page }) => {
    // ST9, HD3, IN5 read only.
    const entry = await openRecord(page, "recordSkillsReadOnly", "light", 1600);
    const { open } = paneOf(entry);
    await cellOf(entry, "P-0401", "role").click();
    const row = open.locator('[data-record-details="row"]');
    await expect(row).toHaveAttribute("data-record-entry", "P-0401");
    const handover = row.locator('[data-field="handover"]');
    await expect(handover).toHaveAttribute("title", "Handover to next shift");
    await expect(handover.locator(":scope > span").first()).toHaveText("Handover to next shift");
    await expect(row.locator('[data-field="intake"]')).toContainText("2");
    await expect(row.locator("[data-field-choice]")).toHaveCount(0);
    await expect(row.locator("[data-inspector-actions]")).toHaveCount(0);
});
