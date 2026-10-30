/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Routine band and its batch on e3 itself (#1455, `Decision Queue Spec.md`
 * D5, R28, §15), over the routine queue's example: the models' routine
 * changes, each its own one proposal (D15) and every one routine. The band
 * holds them all, folded under its count and Apply all, and no total — their
 * figures are money and a count; unfolded, a row a case, most worth first,
 * each its recommendation's title, where its change lands and its figure.
 * Apply all is one step over every case whose Apply is on, its banner's Undo
 * the history's; Save writes each record its changes land in — the duties
 * the Roster's duty kind trims, the cover target and the press's readiness —
 * and the verdicts, through their patch doors, a request each; remounted,
 * nothing waits.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, slot } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import { history, press } from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough that the band and its rows mount.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(4_000); });
afterEach(() => restoreFrame());

const verdictEqual = equalFor(ex.OpsVerdict);
const dutiesEqual = equalFor(ex.rosterDuties.type);
const coverEqual = equalFor(ex.rosterCover.type);
const readinessEqual = equalFor(ex.pressReadiness.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);

/** Thursday's long shifts, which the trim ends 2h earlier: C. Kestrel's late at 22:00, S. Meadow's night at 06:00. */
const THU_LATE_END = new Date("2028-03-09T22:00:00Z");
const THU_NIGHT_END = new Date("2028-03-10T06:00:00Z");

/** The routine band; `null` while none stands. */
const band = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-decision-routine]");
/** The band's Apply all, by its count. */
const applyAll = (container: HTMLElement, n: string) => within(band(container)!).getByRole("button", { name: m.applyAll({ n }) });
/** The toolbar's count of the cases waiting that are not routine. */
const waiting = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent;
/** Whether anything waits on Save: the history's Discard is on. */
const unsaved = (container: HTMLElement) => !history(container, editingMessages.discard()).disabled;
/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();

/** The band's rows, as each reads: its case, its recommendation's title, where its change lands and the case's scope, and its figure. */
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-decision-routine-case]")].map(row => {
    const [, text, value] = [...row.children];
    const [title, meta] = [...text!.children];
    return [row.getAttribute("data-decision-routine-case"), title!.textContent, meta!.textContent, value?.textContent];
});

/** Mounts the routine queue, and waits until its band shows, Apply all on. */
async function open() {
    const ui = await h.mount(ex.decisionQueueRoutine);
    await waitFor(() => expect(band(ui.container)).not.toBeNull());
    await waitFor(() => expect(applyAll(ui.container, "3").getAttribute("aria-disabled")).toBeNull());
    return ui;
}

/** A routine case's saved verdict, given within a span: applied, its time read off it, and nothing else, as the roles write it. */
async function savedVerdict(key: string, from: Date, to: Date) {
    const saved = (await h.read(ex.routineVerdicts)).get(key);
    expect(saved).toBeDefined();
    const at = saved!.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, to)).toBeLessThanOrEqual(0);
    expect(verdictEqual(saved!, { verdict: variant("applied", { at }), option: none, answer: none, reason: none, note: none })).toBe(true);
}

test("every case routine: no section, the band first, folded under its count and Apply all, no total — its cases' figures money and a count; the toolbar counts none; unfolded, a row a case, most worth first, each its recommendation's title, where its change lands and the case's scope, and its figure (D5, R4, R28)", async () => {
    const { container } = await open();
    expect(container.querySelectorAll("[data-decision-section]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-decision-card]")).toHaveLength(0);
    expect(band(container)!.hasAttribute("data-first")).toBe(true);
    expect(band(container)!.textContent).toBe(`${m.routine()}3${m.applyAll({ n: "3" })}`);
    expect(waiting(container)).toBe("0");
    expect(rows(container)).toEqual([]);
    const toggle = band(container)!.querySelector<HTMLElement>("button[aria-expanded]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows(container)).toEqual([
        ["cover-saturday", "Trim Saturday's inbound early cover by one", "Capacity · Inbound · Sat 11", "+$408"],
        ["rota-trim", "Trim 4h from Thursday's long shifts", "Roster · Inbound · W10", "+$168"],
        ["ready-a1", "Confirm Press A1 ready in ~2 days", "Forecast · Press A1", "+2"],
    ]);
    // Folded again, its rows go.
    await press(toggle);
    expect(rows(container)).toEqual([]);
});

test("Apply all is one step over the three cases: the band goes, its banner says how many, and nothing waits; the banner's Undo takes the step back, the band and its count back; applied again and saved, each record is written through its door, a request each — Thursday's two shifts trimmed, Saturday's cover at 11 heads, Press A1's readiness confirmed — and the verdicts; remounted, nothing waits (R27–R29)", async () => {
    const { container, unmount } = await open();
    const duties = await h.read(ex.rosterDuties);
    const cover = await h.read(ex.rosterCover);
    const readiness = await h.read(ex.pressReadiness);
    await press(applyAll(container, "3"));
    const banner = m.batch({ n: "3" });
    expect(slot(container, "banners").textContent).toContain(banner.title);
    expect(slot(container, "banners").textContent).toContain(banner.description);
    expect(band(container)).toBeNull();
    expect(container.querySelector("[data-decision-empty]")).not.toBeNull();
    expect(unsaved(container)).toBe(true);
    // The banner's Undo is the history's: the step taken back, the band back with its three, nothing to save.
    await press(within(slot(container, "banners")).getByRole("button", { name: m.undo() }));
    await waitFor(() => expect(band(container)).not.toBeNull());
    expect(band(container)!.textContent).toBe(`${m.routine()}3${m.applyAll({ n: "3" })}`);
    expect(slot(container, "banners").textContent).not.toContain(banner.description);
    expect(unsaved(container)).toBe(false);
    // Applied again, and saved.
    await waitFor(() => expect(applyAll(container, "3").getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(applyAll(container, "3"));
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.pressReadiness.name, ex.rosterCover.name, ex.rosterDuties.name, ex.routineVerdicts.name].sort());
    const to = new Date();
    for (const key of ["cover-saturday", "rota-trim", "ready-a1"]) await savedVerdict(key, from, to);
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties,
        ["s121", { ...duties.get("s121")!, end: THU_LATE_END }],
        ["s153", { ...duties.get("s153")!, end: THU_NIGHT_END }],
    ], byString))).toBe(true);
    const early = cover.get("2028-03-11-inbound-early")!;
    expect(coverEqual(await h.read(ex.rosterCover), new SortedMap([...cover, ["2028-03-11-inbound-early", { ...early, heads: 11n }]], byString))).toBe(true);
    expect(readinessEqual(await h.read(ex.pressReadiness), new SortedMap([...readiness, ["a1", { ...readiness.get("a1")!, confirmed: true }]], byString))).toBe(true);
    // Remounted, the verdicts read back: nothing waits.
    unmount();
    const again = await h.mount(ex.decisionQueueRoutine);
    await waitFor(() => expect(again.container.querySelector("[data-decision-empty]")).not.toBeNull());
    expect(band(again.container)).toBeNull();
});
