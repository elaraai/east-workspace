/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's previews gallery on e3 itself (#1453, #1454, #1458,
 * `Decision Queue Spec.md` §9.5, §11), over its example: a case for each preview a
 * target draws, on the morning of Tuesday 20 October 2026 — the Roster's crop
 * and its week's maps by people and by cost (P4, P5, P7), the Plan's crop
 * with its lock and now line (P17, P20) and its day's map with the when strip
 * (P5, P12), the Allocation's crop, the Calendar's and the Sheet's with its
 * guess (P26), a record's changed fields, its mix and its groups (P6, P10,
 * P11), the zones (P9) and the projection (P8) — and a Plan crop for each
 * other mark: stale, a knock-on and a breach (P15, P16, P21). The cases are
 * read whole, in the record's key order (R1, R2), each holding its verdict.
 * Each preview is one image whose sentence says what moves where and names
 * its marks (P25); a preview whose rows are still read draws its
 * placeholders, Apply off meanwhile (P23); the rows a record's target touches
 * are read by key, in one request (R1); and Apply on the Plan's crop writes
 * the job through the target that reads it by its source, and the verdict
 * into the case's own row, its card standing as its preview settles, the
 * crop's marks as they were at the click (P22).
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, waitFor, within } from "@testing-library/react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import type { E3Request } from "../e3-web.test-utils.js";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { layOutList } from "./list.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import {
    action, axis, card, chartRow, entries, fields, head, heads, history, marked, measure, openCard, press, preview, previewRow, previewRows, ruler,
    settleApplied, sheetCells, sheetHead, tile, tiles,
} from "./preview.test-utils.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

// The list laid out, its frame tall enough that every card mounts.
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = layOutList(12_000); });
afterEach(() => restoreFrame());

const caseEqual = equalFor(ex.PreviewCase);
const jobsEqual = equalFor(ex.planPrintJobs.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);

/** The gallery's cases, in the order the list draws them: the record's, by key. */
const CASES = [
    "orders-ready", "price-coast", "print-breach", "print-j1019", "print-knock", "print-stale", "print-thursday", "rota-cost", "rota-garnet",
    "rota-week10", "rounds-boundary", "stock-c5", "stock-minimums", "stock-split", "workshop-press1", "yard-ld2235",
];

/** The print works' jobs' reads, by key and through their interval index: what each print case's preview waits on. */
const JOB_READS = new Set(["read", "find", "page", "rows", "runs", "place", "within"]);
const jobsRead = (request: E3Request) => JOB_READS.has(request.kind) && request.dataset === `records.${ex.planPrintJobs.name}`;

/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();
/** A preview's entry's icons, by their Font Awesome names. */
const icons = (el: Element) => [...el.querySelectorAll("svg[data-icon]")].map(icon => icon.getAttribute("data-icon"));
/** Whether a case's preview has drawn what it reads: its rows, or a map's groups. */
const drawn = (container: HTMLElement, key: string) =>
    head(container, key).querySelector("[data-decision-preview] [data-preview-row], [data-decision-preview] [data-preview-group]") !== null;
/** Where a mark stands on its plot: its place's variable, in percent, to a hundredth. */
const place = (el: Element, name: string) => Math.round(Number.parseFloat((el as HTMLElement).style.getPropertyValue(name)) * 100) / 100;

/** Mounts the gallery, and waits until its cards show and every preview has drawn. */
async function open() {
    const ui = await h.mount(ex.decisionQueuePreviews);
    await waitFor(() => expect(heads(ui.container)).toEqual(CASES));
    await waitFor(() => expect(CASES.filter(key => !drawn(ui.container, key))).toEqual([]), { timeout: 15_000 });
    return ui;
}

// ── Laying out, and each preview's sentence (R1–R3, P3, P25) ────────────────

test("the gallery's cases in the record's order, neither sorted nor sectioned, the toolbar counting them, each a preview of the kind its target draws, its sentence saying what moves where and naming its marks (R1–R3, P3, P5–P11, P15, P16, P21, P25, P26)", async () => {
    const { container } = await open();
    expect(container.querySelector("[data-decision-section]")).toBeNull();
    expect(slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent).toBe("16");
    expect(openCard(container)).toBe("orders-ready");
    const drawn = CASES.map(key => {
        const frame = preview(container, key);
        return [key, frame.getAttribute("data-kind"), frame.getAttribute("data-layout"), frame.getAttribute("aria-label")];
    });
    expect(drawn).toEqual([
        ["orders-ready", "sheet", "sheet", "Status and Due change on WO-1005, WO-1007 and WO-1008. WO-1007 is a low-confidence guess"],
        ["price-coast", "record", "fields", "Coast · List price · 10.5 → 11; Coast · Demand / wk · 14,200 → 13,916"],
        ["print-breach", "plan", "lanes", "Guide reprint runs on Press A1 from 07:00 to 09:00, where it overlaps Menu cards"],
        ["print-j1019", "plan", "lanes", "Loyalty cards leaves Press B2, where it overlapped Market posters, and runs on Press B3 from 09:30 to 15:30; Market posters is pinned on Press B2"],
        ["print-knock", "plan", "lanes", "Order forms runs on Press B1 from 06:00 to 09:00 and pushes Exhibition book from 06:00 to 09:00"],
        ["print-stale", "plan", "lanes", "Stale: the rows changed after this run; the change to Seed catalogue needs a rerun"],
        ["print-thursday", "plan", "map", "5 of 6 presses change; Press B1 takes 2 print jobs, Press A3 loses its print job"],
        ["rota-cost", "roster", "cost", "Week 10 pay by code: AGENCY -$816, ORD +$756 and OT1 -$126"],
        ["rota-garnet", "roster", "roster", "P. Garnet's Early shifts on Mon, Tue and Thu move to J. Quartz"],
        ["rota-week10", "roster", "people", "20 of 69 people change: 18 gain or change shifts, R. Wold and G. Ember lose shifts"],
        ["rounds-boundary", "zones", "zones", "6 of 40 move from Round A to Round B: Round A goes from 25 to 19 and Round B from 15 to 21"],
        ["stock-c5", "projection", "projection", "2,000 (chosen) stays at 440 or above; 1,500 falls to 40, under min; No order falls to 0, under min"],
        ["stock-minimums", "record", "groups", "412 in Envelopes (+8%), 298 in Labels (+12%), 214 in Folders (+5%), 180 in Notebooks (-4%) and 136 in Cards (+6%) change"],
        ["stock-split", "record", "mix", "Harbour goes from 3,800 to 3,200, Hillside from 3,000 to 3,400, Market St from 2,400 to 2,900 and Riverside from 1,600 to 1,300"],
        ["workshop-press1", "calendar", "lanes", "Preventive maintenance leaves Thu 1, where it overlapped Mounting brackets · batch 42, and runs on Sat 3 from 06:00 to 08:00"],
        ["yard-ld2235", "allocation", "lanes", "LD-2235 leaves Waiting and is held in K-305 from Tue 11 14:15 to Thu 20 00:00"],
    ]);
    // Every preview is one image, between its card's title and its chip line.
    for (const key of CASES) {
        expect(preview(container, key).getAttribute("role")).toBe("img");
        expect([...head(container, key).children].indexOf(preview(container, key))).toBe(2);
    }
});

// ── The Roster's crop and its map by people (P4, P5, P13, P14, P24) ─────────

test("the Roster's crop: the week from its Sunday, P. Garnet's three early shifts ghosts moving to J. Quartz, proposed there, every other duty and off day as it stands; P. Garnet's hours better, J. Quartz's worse, landing over contract (P4, P13, P14, P19, P24)", async () => {
    const { container } = await open();
    const frame = preview(container, "rota-garnet");
    expect([...frame.firstElementChild!.children].map(day => day.textContent)).toEqual(["", "S05", "M06", "T07", "W08", "T09", "F10", "S11"]);
    expect(previewRows(frame)).toEqual(["P. Garnet", "J. Quartz"]);
    const garnet = previewRow(frame, "P. Garnet"), quartz = previewRow(frame, "J. Quartz");
    expect(measure(garnet, "40 → 16h")).toBe("better");
    expect(measure(quartz, "24 → 48h")).toBe("worse");
    for (const [key, day] of [["s286", "Mon 6"], ["s287", "Tue 7"], ["s284", "Thu 9"]] as const) {
        expect(tile(garnet, key)).toEqual({ op: "from", fill: undefined, title: `Early · ${day} · moves to J. Quartz` });
        expect(tile(quartz, key)).toEqual({ op: "add", fill: "own", title: `Early · ${day} · proposed` });
    }
    expect(tile(garnet, "s285")).toEqual({ op: undefined, fill: undefined, title: "Early · Sun 5" });
    expect(marked(garnet)).toEqual(["s286", "s287", "s284"]);
    expect(garnet.querySelectorAll("[data-preview-off]")).toHaveLength(2);
    expect(quartz.querySelectorAll("[data-preview-off]")).toHaveLength(1);
});

test("the Roster's week map by people: four of the twenty who change, compact — R. Wold's Sunday night a ghost moving to B. Pumice, G. Ember's Monday early to J. Quartz — then the rest counted, 20 of 69 (P5, P13, P14, P24)", async () => {
    const { container } = await open();
    const frame = preview(container, "rota-week10");
    expect(previewRows(frame)).toEqual(["R. Wold", "B. Pumice", "G. Ember", "J. Quartz"]);
    expect(measure(previewRow(frame, "R. Wold"), "40→32h")).toBe("better");
    expect(measure(previewRow(frame, "B. Pumice"), "24→32h")).toBeUndefined();
    expect(tile(previewRow(frame, "R. Wold"), "s260")).toEqual({ op: "from", fill: undefined, title: "Night · Sun 5 · moves to B. Pumice" });
    expect(tile(previewRow(frame, "B. Pumice"), "s260")).toEqual({ op: "add", fill: "own", title: "Night · Sun 5 · proposed" });
    expect(tile(previewRow(frame, "G. Ember"), "s281")).toEqual({ op: "from", fill: undefined, title: "Early · Mon 6 · moves to J. Quartz" });
    expect(tile(previewRow(frame, "J. Quartz"), "s281")).toEqual({ op: "add", fill: "own", title: "Early · Mon 6 · proposed" });
    expect(within(frame).getByText(m.previewMorePeople({ n: "16" }))).toBeDefined();
    expect(within(frame).getByText(m.previewCount({ n: "20", of: "69" }))).toBeDefined();
});

// ── The Roster's map by cost (P7, P13, P14, P24) ────────────────────────────

test("the Roster's map by cost: week 10's pay by the warehouse's codes, before and after, as its pay answers — the agency's shifts and the overtime saved, ghosts left of zero, the ordinary hours they move to glowing right of it — on an axis a thousand dollars either side (P7, P13, P14, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "rota-cost");
    expect(within(frame).getByText(m.previewCaption({ caption: "payCode" }))).toBeDefined();
    expect(axis(frame)).toEqual(["-$1K", "0", "+$1K"]);
    expect(previewRows(frame)).toEqual(["AGENCY", "ORD", "OT1"]);
    expect(chartRow(previewRow(frame, "AGENCY"))).toEqual({
        title: "AGENCY · $816 → $0 a week", marks: [{ at: undefined, op: "from", fill: undefined }], figures: [{ text: "-$816", tone: "better" }],
    });
    expect(chartRow(previewRow(frame, "ORD"))).toEqual({
        title: "ORD · $103.3K → $104.1K a week", marks: [{ at: undefined, op: "add", fill: "own" }], figures: [{ text: "+$756", tone: "worse" }],
    });
    expect(chartRow(previewRow(frame, "OT1"))).toEqual({
        title: "OT1 · $3.8K → $3.7K a week", marks: [{ at: undefined, op: "from", fill: undefined }], figures: [{ text: "-$126", tone: "better" }],
    });
    // Each change a bar from zero, the middle: a saving to its left, an added cost to its right.
    expect(["AGENCY", "ORD", "OT1"].map(code => {
        const bar = previewRow(frame, code).querySelector("[data-op]")!;
        return [place(bar, "--pv-left"), place(bar, "--pv-width")];
    })).toEqual([[9.2, 40.8], [50, 37.8], [43.7, 6.3]]);
});

// ── The Plan's crop and its day map (P5, P12–P14, P17, P20) ─────────────────

test("the Plan's crop: J-1019 a ghost leaving Press B2 and proposed on Press B3, the confirmed J-1018 it overlapped locked, the now line on both presses at 09:14, each press's booked share before → after (P13, P14, P17, P19, P20, P24)", async () => {
    const { container } = await open();
    const frame = preview(container, "print-j1019");
    expect(previewRows(frame)).toEqual(["Press B2", "Press B3"]);
    // Two hours either side of what the change touches, in whole hours.
    expect(ruler(frame)).toEqual(["07", "11", "15", "18"]);
    const b2 = previewRow(frame, "Press B2"), b3 = previewRow(frame, "Press B3");
    expect(measure(b2, "73 → 45%")).toBe("better");
    expect(measure(b3, "18 → 73%")).toBeUndefined();
    expect(tiles(b2, "J-1019")).toEqual([{ op: "from", fill: undefined, title: "Loyalty cards · 10:00–13:00 · moves to Press B3" }]);
    expect(tiles(b3, "J-1019")).toEqual([{ op: "add", fill: "own", title: "Loyalty cards · 09:30–15:30 · proposed" }]);
    // The confirmed job stands as it is, locked, its lock the Font Awesome lock; the job beside it on B3 unmarked.
    expect(tiles(b2, "J-1018")).toEqual([{ op: undefined, fill: undefined, title: "Market posters · 06:00–12:00 · locked" }]);
    expect(icons(b2.querySelector('[data-preview-tile="J-1018"]')!)).toEqual(["lock"]);
    expect(tiles(b3, "J-1022")).toEqual([{ op: undefined, fill: undefined, title: "Box sleeves · 06:00–09:00" }]);
    expect(icons(b3)).toEqual([]);
    // Now, 09:14, two hours and fourteen minutes into the window's eleven.
    for (const row of [b2, b3]) {
        const now = row.querySelectorAll<HTMLElement>("[data-preview-now]");
        expect(now).toHaveLength(1);
        expect(Number.parseFloat(now[0]!.style.getPropertyValue("--pv-at"))).toBeCloseTo(134 / 660 * 100, 6);
    }
});

test("the Plan's day map: every press a tile under its hall, lit where it takes or changes jobs, a ghost where it only loses one, B3 as it is; the when strip a tick at each job's new time, the backlog's four landing (P5, P12, P13, P14)", async () => {
    const { container } = await open();
    const frame = preview(container, "print-thursday");
    const halls = [...frame.querySelectorAll<HTMLElement>("[data-preview-group]")].map(group => [
        group.getAttribute("data-preview-group"),
        [...group.querySelectorAll<HTMLElement>("[data-preview-tile]")].map(el => [el.textContent, el.getAttribute("data-op") ?? undefined, el.getAttribute("title")]),
    ]);
    expect(halls).toEqual([
        ["Hall A", [
            ["A1", "chg", "Press A1 · 1 print job changes"], ["A2", "chg", "Press A2 · 1 print job changes"], ["A3", "from", "Press A3 · 1 print job moves off"],
        ]],
        ["Hall B", [
            ["B1", "chg", "Press B1 · 2 print jobs change"], ["B2", "chg", "Press B2 · 1 print job changes"], ["B3", undefined, "Press B3 · no change"],
        ]],
    ]);
    const when = frame.querySelector<HTMLElement>("[data-preview-when]")!;
    expect(within(when).getByText("05–14")).toBeDefined();
    expect([...when.querySelectorAll("[data-preview-tick]")].map(el => [el.getAttribute("data-preview-tick"), el.getAttribute("title")])).toEqual([
        ["J-1025", "07:00 · Winter brochure lands here"],
        ["J-1027", "08:00 · Prospectus lands here"],
        ["J-1028", "09:00 · Price lists lands here"],
        ["J-1012", "10:00 · Gift boxes moves here"],
        ["J-1026", "11:30 · Wall calendars lands here"],
    ]);
});

// ── The Allocation's, the Calendar's and the Sheet's crops (P4, P24, P26) ───

test("the Allocation's crop over the kiln yard's May days, no now line; the Calendar's a lane a day; the Sheet's three orders, WO-1007's cells the model's guess (P4, P13, P14, P20, P24, P26)", async () => {
    const { container } = await open();
    const yard = preview(container, "yard-ld2235");
    expect(previewRows(yard)).toEqual(["K-305", "Waiting"]);
    expect(ruler(yard)).toEqual(["May 9", "May 16"]);
    expect(measure(previewRow(yard, "K-305"), "0 → 8 m³")).toBeUndefined();
    expect(measure(previewRow(yard, "Waiting"), "8 → 0 m³")).toBe("better");
    expect(entries(previewRow(yard, "K-305")).map(entry => [entry.op, entry.look])).toEqual([[undefined, "prior"], [undefined, "next"], ["add", undefined]]);
    expect(yard.querySelector("[data-preview-now]")).toBeNull();
    const workshop = preview(container, "workshop-press1");
    expect(previewRows(workshop)).toEqual(["Thu 1", "Sat 3"]);
    expect(measure(previewRow(workshop, "Thu 1"), "overlap 1 → 0")).toBe("better");
    expect(measure(previewRow(workshop, "Sat 3"), "no overlap")).toBeUndefined();
    const orders = preview(container, "orders-ready");
    expect(sheetHead(orders)).toEqual(["Reference", "Status", "Due"]);
    expect(previewRows(orders)).toEqual(["WO-1005", "WO-1007", "WO-1008"]);
    const guess = m.guess({ confidence: "0.69" });
    expect(sheetCells(previewRow(orders, "WO-1007")).map(cell => [cell.column, cell.value, cell.op, cell.guess]))
        .toEqual([["status", "Scheduled", "chg", guess], ["due", "26 Oct 26", "chg", guess]]);
    expect(sheetCells(previewRow(orders, "WO-1005")).map(cell => cell.guess)).toEqual([undefined, undefined]);
});

// ── A record's changed fields, its mix and its groups (P6, P10, P11) ────────

test("a record's changed fields: the Coast price list's list price and its demand, each as it stands struck and as the change leaves it, printed as the row's own form prints them (P6, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "price-coast");
    expect(previewRows(frame)).toEqual(["Coast", "Coast"]);
    expect(fields(frame)).toEqual([
        { caption: "Coast · List price", was: "10.5", now: "11", op: "chg", title: "Coast · List price · 10.5 → 11" },
        { caption: "Coast · Demand / wk", was: "14,200", now: "13,916", op: "chg", title: "Coast · Demand / wk · 14,200 → 13,916" },
    ]);
    // No guess: the option names none.
    expect(frame.querySelector("[data-preview-guess]")).toBeNull();
});

test("a record's mix: the five stores' stock on one axis from zero, each as it stands a hollow dot and proposed a glowing one, its change signed; Station Rd, which keeps its stock, a dot alone (P10, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "stock-split");
    expect(within(frame).getByText("Stock")).toBeDefined();
    expect(axis(frame)).toEqual(["0", "2K", "4K"]);
    const stores = [...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(row => {
        const { title, marks, figures } = chartRow(row);
        return [title, marks.map(mark => [mark.at, mark.op]), figures.map(figure => figure.text)];
    });
    expect(stores).toEqual([
        ["Harbour · 3,800 → 3,200", [["was", undefined], ["now", "chg"]], ["-600"]],
        ["Hillside · 3,000 → 3,400", [["was", undefined], ["now", "chg"]], ["+400"]],
        ["Market St · 2,400 → 2,900", [["was", undefined], ["now", "chg"]], ["+500"]],
        ["Riverside · 1,600 → 1,300", [["was", undefined], ["now", "chg"]], ["-300"]],
        ["Station Rd · 1,200 · no change", [["now", undefined]], ["0"]],
    ]);
    expect(previewRow(frame, "Station Rd").querySelector("[data-same]")?.textContent).toBe("0");
    // On the axis to 4,000: Harbour from 3,800 to 3,200.
    expect([...previewRow(frame, "Harbour").querySelectorAll("[data-at]")].map(dot => place(dot, "--pv-at"))).toEqual([95, 80]);
});

test("a record's groups: the five ranges the minimums change, the most rows first, each counted through the catalogue's index on its range — its track its size, the glowing part the rows that change — then the count and the net change, Notebooks' down (P11, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "stock-minimums");
    // Its head: the field it groups by, as the row's form names it, then what each figure says.
    expect([...previewRow(frame, "Envelopes").parentElement!.firstElementChild!.children].map(el => el.textContent)).toEqual([
        "Range", ...(["changed", "rows", "net"] as const).map(caption => m.previewCaption({ caption })),
    ]);
    const ranges = [...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(row => {
        const { title, marks, figures } = chartRow(row);
        return [title, marks.map(mark => [mark.op, mark.fill]), figures.map(figure => [figure.text, figure.tone]), icons(row)];
    });
    expect(ranges).toEqual([
        ["Envelopes · 412 of 980 change · net +8%", [["chg", "own"]], [["412", undefined], ["+8%", "neither"]], ["caret-up"]],
        ["Labels · 298 of 410 change · net +12%", [["chg", "own"]], [["298", undefined], ["+12%", "neither"]], ["caret-up"]],
        ["Folders · 214 of 520 change · net +5%", [["chg", "own"]], [["214", undefined], ["+5%", "neither"]], ["caret-up"]],
        ["Notebooks · 180 of 300 change · net -4%", [["chg", "own"]], [["180", undefined], ["-4%", "neither"]], ["caret-down"]],
        ["Cards · 136 of 260 change · net +6%", [["chg", "own"]], [["136", undefined], ["+6%", "neither"]], ["caret-up"]],
    ]);
    // Envelopes, the largest range, its whole track; the part that changes 412 of its 980.
    const part = previewRow(frame, "Envelopes").querySelector("[data-op]")!;
    expect([place(part.previousElementSibling!, "--pv-width"), place(part, "--pv-width")]).toEqual([100, 42.04]);
});

// ── The zones and the projection (P8, P9) ───────────────────────────────────

test("the zones: the forty areas a tile each at their place, twelve a row, filled by their round; the six the change moves from Round A in Round B's fill, glowing; each depot its dot; the key each round's count before → after (P9, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "rounds-boundary");
    expect([...frame.querySelectorAll("[data-preview-row]")].map(item => [item.getAttribute("data-preview-row"), item.lastElementChild!.textContent]))
        .toEqual([["Round A", "25 → 19"], ["Round B", "15 → 21"]]);
    const area = (key: string) => frame.querySelector<HTMLElement>(`[data-preview-tile="${key}"]`)!;
    expect(area("C1").parentElement!.style.getPropertyValue("--pv-columns")).toBe("12");
    expect(frame.querySelectorAll("[data-preview-tile], [data-empty]")).toHaveLength(48);
    expect(frame.querySelectorAll("[data-preview-tile]")).toHaveLength(40);
    expect([...frame.querySelectorAll("[data-preview-tile][data-op]")].map(el => [el.getAttribute("data-preview-tile"), el.getAttribute("data-op"), el.getAttribute("data-fill"), el.getAttribute("title")])).toEqual(
        ["G1", "F2", "G2", "F3", "G3", "G4"].map(key => [key, "chg", "own", `${key} · Round A → Round B`]),
    );
    expect(tile(frame, "C1")).toEqual({ op: undefined, fill: undefined, title: "C1 · Round A · no change" });
    // A moved area takes its new round's fill.
    const fill = (key: string) => area(key).style.getPropertyValue("--pv-zone");
    expect(fill("G1")).toBe(fill("H1"));
    expect(fill("G1")).not.toBe(fill("C1"));
    expect([...frame.querySelectorAll("[data-preview-tile]")].filter(el => el.firstElementChild !== null).map(el => [el.getAttribute("data-preview-tile"), el.getAttribute("title")]))
        .toEqual([["B2", "Round A depot · B2"], ["J3", "Round B depot · J3"]]);
});

test("the projection: a line per option over the order's weeks — 2,000, the chosen, glowing; No order, which changes nothing, a dashed ghost; 1,500 thin — the min a warn rule; each label at its line's first rise, No order's over its last run (P8, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "stock-c5");
    expect([...frame.querySelectorAll("polyline")].map(line => [line.getAttribute("data-option"), line.getAttribute("data-line") ?? undefined, line.closest("[data-glow]") !== null]))
        .toEqual([["1,500", undefined, false], ["No order", "asis", false], ["2,000", "chosen", true]]);
    expect(axis(frame, "y")).toEqual(["2K", "min"]);
    expect(within(frame).getByText("min").getAttribute("data-tone")).toBe("warn");
    expect(axis(frame)).toEqual(["9", "11", "13", "16"]);
    expect([...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(label => [label.textContent, label.getAttribute("data-place") ?? undefined, label.hasAttribute("data-chosen")]))
        .toEqual([["1,500", undefined, false], ["No order", "run", false], ["2,000", undefined, true]]);
});

// ── The marks (P15, P16, P21) ───────────────────────────────────────────────

test("stale: the frame dashed, J-1008 as the works now has it, the case's status Stale and its Apply off, saying why (P21, R23)", async () => {
    const { container } = await open();
    const frame = preview(container, "print-stale");
    expect(frame.hasAttribute("data-stale")).toBe(true);
    expect(previewRows(frame)).toEqual(["Press A2"]);
    expect(tiles(previewRow(frame, "Press A2"), "J-1008")).toEqual([{ op: "chg", fill: "own", title: "Seed catalogue · 06:00–16:00 · changed" }]);
    expect(within(head(container, "print-stale")).getByText(m.status({ status: "stale" }))).toBeDefined();
    await press(head(container, "print-stale"));
    const apply = action(container, "print-stale", m.action({ action: "apply" }));
    expect(apply.getAttribute("aria-disabled")).toBe("true");
    expect(apply.getAttribute("title")).toBe(m.applyOff({ why: "stale" }));
    // No other preview is stale.
    expect(CASES.filter(key => preview(container, key).hasAttribute("data-stale"))).toEqual(["print-stale"]);
});

test("a knock-on and a breach: J-1016, pushed by the change, keeps its fill in a dashed ring beside its ghost; J-1023 and the J-1005 it overlaps each take the warning ring and triangle, the press worse (P15, P16, P24)", async () => {
    const { container } = await open();
    const knock = previewRow(preview(container, "print-knock"), "Press B1");
    expect(tiles(knock, "J-1016")).toEqual([
        { op: undefined, fill: undefined, title: "Exhibition book · 09:00–15:00 · knock-on" },
        { op: "from", fill: undefined, title: "Exhibition book · 06:00–12:00 · moves to 09:00–15:00" },
    ]);
    expect([...knock.querySelectorAll("[data-knock]")].map(el => el.getAttribute("data-preview-tile"))).toEqual(["J-1016"]);
    expect(tiles(knock, "J-1024")).toEqual([{ op: "add", fill: "own", title: "Order forms · 06:00–09:00 · proposed" }]);
    const breach = previewRow(preview(container, "print-breach"), "Press A1");
    expect(measure(breach, "33 → 67%")).toBe("worse");
    expect(tiles(breach, "J-1023")).toEqual([{ op: "add", fill: "own", title: "Guide reprint · 07:00–09:00 · proposed · overlaps Menu cards" }]);
    expect(tiles(breach, "J-1005")).toEqual([{ op: undefined, fill: undefined, title: "Menu cards · 06:00–08:00 · overlaps Guide reprint" }]);
    expect([...breach.querySelectorAll<HTMLElement>("[data-breach]")].map(el => [el.getAttribute("data-preview-tile"), icons(el)]))
        .toEqual([["J-1005", ["triangle-exclamation"]], ["J-1023", ["triangle-exclamation"]]]);
    // Nothing else is knocked on or breached in the gallery.
    const flagged = (mark: string) => CASES.filter(key => preview(container, key).querySelector(`[${mark}]`) !== null);
    expect([flagged("data-knock"), flagged("data-breach")]).toEqual([["print-knock"], ["print-breach"]]);
});

// ── Loading (P23), and reading by key (R1) ──────────────────────────────────

test("a preview whose rows are still read draws its placeholders in its final layout, busy, named as reading, its Apply off saying so; the read landing draws the change (P23)", async () => {
    const held = h.e3.hold(jobsRead);
    const ui = await h.mount(ex.decisionQueuePreviews);
    const { container } = ui;
    await waitFor(() => expect(heads(container)).toEqual(CASES));
    await held.holding;
    const frame = () => preview(container, "print-j1019");
    await waitFor(() => expect(frame().getAttribute("aria-busy")).toBe("true"));
    expect(frame().getAttribute("aria-label")).toBe(m.applyOff({ why: "reading" }));
    expect(frame().getAttribute("data-layout")).toBe("lanes");
    // A press's lanes: each its name's placeholder, then its plot washed.
    expect(frame().querySelectorAll("[data-preview-pending]")).toHaveLength(2);
    expect(frame().querySelectorAll('[data-preview-pending] [data-shape="label2"]')).toHaveLength(2);
    // Shown once the reveal's clock has run, never as a flash.
    await waitFor(() => expect(frame().querySelectorAll("[data-unrevealed]")).toHaveLength(0));
    // The print cases wait; the others, which read no job, draw.
    await waitFor(() => expect(drawn(container, "rota-garnet")).toBe(true));
    expect(preview(container, "rota-garnet").getAttribute("aria-busy")).toBeNull();
    await press(head(container, "print-j1019"));
    const apply = () => action(container, "print-j1019", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    expect(apply().getAttribute("title")).toBe(m.applyOff({ why: "reading" }));
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(previewRows(frame())).toEqual(["Press B2", "Press B3"]));
    expect(frame().getAttribute("aria-busy")).toBeNull();
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
});

test("the catalogue's rows the minimums change are read by key, in one request: the catalogue is never read whole (R1, §5.3)", async () => {
    await open();
    expect(h.requests("rows", `records.${ex.catalogue.name}`)).toHaveLength(1);
    expect(h.requests("read", `records.${ex.catalogue.name}`)).toEqual([]);
});

// ── Apply (R16, R29) ────────────────────────────────────────────────────────

test("the Plan crop's Apply drafts J-1019's move and the verdict as one step — the card standing, inert, as its preview settles, J-1019's ghost on Press B2 and its proposal on Press B3 as they were at the click, until it gives way to its receipt — and Save writes the job to Press B3 09:30–15:30 through the target that reads it by its source, and the verdict, a request each (R16, R29, P22)", async () => {
    const { container } = await open();
    const jobs = await h.read(ex.planPrintJobs);
    await press(head(container, "print-j1019"));
    const apply = () => action(container, "print-j1019", m.action({ action: "apply" }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    // The verdict lands the job on Press B3 in the editing, but the card shows what it showed at the click while its
    // preview settles: the ghost where the job was and the proposal where it goes.
    expect([card(container, "print-j1019").hasAttribute("data-applied"), card(container, "print-j1019").hasAttribute("inert")]).toEqual([true, true]);
    const settling = preview(container, "print-j1019");
    expect(settling.hasAttribute("data-applied")).toBe(true);
    expect(tiles(previewRow(settling, "Press B2"), "J-1019")).toEqual([{ op: "from", fill: undefined, title: "Loyalty cards · 10:00–13:00 · moves to Press B3" }]);
    expect(tiles(previewRow(settling, "Press B3"), "J-1019")).toEqual([{ op: "add", fill: "own", title: "Loyalty cards · 09:30–15:30 · proposed" }]);
    expect(container.querySelector('[data-decision-receipt="print-j1019"]')).toBeNull();
    await settleApplied(container, "print-j1019");
    expect(container.querySelector('[data-decision-receipt="print-j1019"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.planPrintJobs.name, ex.previewCases.name].sort());
    // The verdict a field of the case's own row, every other as the model wrote it.
    const saved = (await h.read(ex.previewCases)).get("print-j1019");
    if (saved === undefined || saved.verdict.type !== "applied") throw new Error("print-j1019 was not saved applied");
    const at = saved.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, new Date())).toBeLessThanOrEqual(0);
    expect(caseEqual(saved, { ...ex.previewCaseRows.get("print-j1019")!, verdict: variant("applied", { at }), option: some("1-b3") })).toBe(true);
    const cards = jobs.get("J-1019")!;
    expect(jobsEqual(await h.read(ex.planPrintJobs), new SortedMap([...jobs, ["J-1019", {
        ...cards, press: some("b3"), start: some(new Date("2026-10-20T09:30:00Z")), end: some(new Date("2026-10-20T15:30:00Z")),
    }]], byString))).toBe(true);
});
