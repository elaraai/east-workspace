/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Inspector (#1331) over the kiln yard, through the dispatcher, the shared
 * drag layer and the yard's fit served by name: a free slot (A60), a
 * reservation (A61), a resource (A62), the summary (A63, A89), the Issues tab
 * (A64), the drop list (A34, A86), the refusal's note (A40), the connector's
 * Chooser (A8, A21), the words and the marks (A85, A90), the bin kind's own
 * form, a published day and pointer motion (A35). Every word and figure the
 * mock draws for the same day is the mock's; every fit is the yard's answer.
 * Its tabs and a bin are `inspector-bin.dom.test.tsx`'s, the helpers
 * `inspector.test-utils.tsx`'s.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { none, some } from "@elaraai/east";
import { editingMessages, formatters } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { TUE, act, allocationHarness, offering, settle, slot } from "./harness.test-utils.js";
import { allocationWords } from "./model.js";
import { RESERVE_PROBE } from "./table.js";
import { byScore, pane, details, issuesTab, activeTab, card, connector, row, tableRow, libraryCard, toolbar, save, text, headOf, actions, banners, rowsOf, mates, keyField, press, key, tab, button, revealRow, reveal, hover, over, release, cancel, placing, bestOf, whyOf, hour, byDate, byKey, inspectorKit } from "./inspector.test-utils.js";

const h = allocationHarness();
const { open, answerTo } = inspectorKit(h);
/** The yard's bins of Tue 11, as its record holds them. */
const tuesday = async () => [...(await h.read(ex.kilnBins)).values()].filter(bin => byDate(bin.at, TUE) >= 0 && byDate(bin.at, hour(24, 0)) < 0);

describe("a free slot (A60)", () => {
    test("A60 — `Slot · Free`, `B-1 · 00:15`, `Tue 11 May · no arrival · no resource`; every arrival it can book, overdue first in warn, a Book each", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        expect(headOf(c)).toEqual({ kind: "Slot", title: "B-1 · 00:15", when: "Tue 11 May · no arrival · no resource", status: "Free", tone: "neutral", chip: null });
        const books = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-book] [data-allocation-option]")];
        expect(books.map(o => o.getAttribute("data-allocation-option"))).toEqual(["arrival:LD-2231", "arrival:LD-2232", "arrival:LD-2233", "arrival:LD-2234", "arrival:LD-2235", "arrival:LD-2236"]);
        const late = books[0]!.querySelector<HTMLElement>("[title]")!;
        expect([books[0]!.textContent!.startsWith("LD-223121 m³"), late.textContent, late.getAttribute("data-tone")]).toEqual([true, "BRK · R2 · spec MC12 · overdue", "warning"]);
        offering(["N1"]);
        await press(button(books[0]!, "Book"));
        expect(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=arrival]")!.textContent).toContain("LD-2231");
    });

    test("A60 — Reserve a resource: the five best for a reservation, free ones first, each the fit's reason; Reserve reserves the slot on it", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        const answer = answerTo(placing(RESERVE_PROBE));
        const offered = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-reserve] [data-allocation-option]")];
        const lines = offered.map((o): [string, string] => [o.getAttribute("data-allocation-option")!, o.querySelector("[title]")!.textContent!]);
        const fits = [...answer.resources].filter(([, f]) => f.type === "fits");
        for (const [key, line] of lines) expect(line.replace(/^(free|loading) · /, "")).toBe(whyOf(answer, key));
        // Free first, each best first: a resource is loading when a bin of the day is on it (the probe in the slot holds none).
        const loading = new Set((await tuesday()).flatMap(bin => [...bin.kilns.keys()]));
        const ranked = fits.map(([key, f]) => ({ key, score: f.type === "fits" ? f.value.score : 0, loading: loading.has(key) }))
            .sort((x, y) => Number(x.loading) - Number(y.loading) || byScore(y.score, x.score) || byKey(x.key, y.key));
        expect(lines.map(([key, line]) => [key, line.split(" · ")[0]])).toEqual(ranked.slice(0, 5).map(f => [f.key, f.loading ? "loading" : "free"]));
        // Both kinds are among the fits, so the order is the rule's, not the scores'.
        expect([ranked.some(f => f.loading), ranked.some(f => !f.loading)]).toEqual([true, true]);
        expect(details(c).querySelector("[data-allocation-reserve]")!.textContent).toContain("Or drag an arrival or a resource from the library onto this row.");
        offering(["V1"]);
        await press(button(offered[0]!, "Reserve"));
        expect([tableRow(c, "bin:V1").getAttribute("data-kind"), text(tableRow(c, "bin:V1").querySelector("[data-allocation-chip=resource]"))]).toEqual(["reserved", lines[0]![0]]);
    });
});

describe("a reservation (A61)", () => {
    /** A new reservation of B-1 00:15 on K-305, V1, selected. */
    async function reserved() {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        offering(["V1"]);
        await press(button(details(c).querySelector<HTMLElement>('[data-allocation-reserve] [data-allocation-option="K-305"]')!, "Reserve"));
        return c;
    }

    test("A61 — `New reservation`, `Added · unsaved`, `B-1 · 00:15`, `Reserved on K-305 · no arrival yet`; Assigned to with Remove and Open resource, its fill and meter", async () => {
        const c = await reserved();
        expect(headOf(c)).toEqual({ kind: "New reservation", title: "B-1 · 00:15", when: "Reserved on K-305 · no arrival yet", status: "Added · unsaved", tone: "neutral", chip: "New" });
        const assigned = details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!;
        expect(button(assigned, "Remove").getAttribute("title")).toBe("Remove the reservation · the slot becomes free");
        expect(within(assigned).getByRole("button", { name: "Open resource" })).toBeTruthy();
        expect([text(assigned.querySelector("[data-allocation-fill]")), assigned.querySelector("[data-allocation-meter]") !== null]).toEqual(["0 m³ · takes 4–10", true]);
    });

    test("its key stands among its facts, a field read only — what Search Records finds it by; a new one's, the key it is minted, a draft until Save (#1398)", async () => {
        const c = await reserved();
        expect(keyField(details(c).querySelector<HTMLElement>("[data-allocation-reservation]")!)).toEqual({ label: "Key", value: "V1", readOnly: true, dirty: true });
        await press(save(c));
        await press(tableRow(c, "bin:V1").querySelector("span"));
        expect(keyField(details(c).querySelector<HTMLElement>("[data-allocation-reservation]")!)).toEqual({ label: "Key", value: "V1", readOnly: true, dirty: false });
    });

    test("A61 — Book an arrival: each checked against the resource, one take of it — Book off and `doesn’t fit · …` in warn when refused; a fit fills the reservation", async () => {
        const c = await reserved();
        const take = () => answerTo(ask => ask.type === "take" && ask.value.resource === "K-305");
        const option = (key: string) => details(c).querySelector<HTMLElement>(`[data-allocation-book] [data-allocation-option="${key}"]`)!;
        const said = (key: string) => [option(key).querySelector("[title]")!.textContent, option(key).querySelector("[title]")!.getAttribute("data-tone"), button(option(key), "Book").hasAttribute("disabled")];
        const refusal = take().arrivals.get("LD-2232")!;
        expect(said("arrival:LD-2232")).toEqual([`doesn’t fit · ${refusal.type === "refused" ? refusal.value.reason : ""}`, "warning", true]);
        const fit = take().arrivals.get("LD-2235")!;
        expect(said("arrival:LD-2235")).toEqual([fit.type === "fits" ? fit.value.why : "", null, false]);
        expect(details(c).querySelector("[data-allocation-book]")!.textContent).toContain("Each arrival is checked against K-305. Book is off when it doesn’t fit.");
        offering(["N1"]);
        await press(button(option("arrival:LD-2235"), "Book"));
        expect(c.querySelector("[data-allocation-row='bin:V1']")).toBeNull();
        expect(text(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=resource]"))).toBe("K-305");
    });

    test("A61 — Remove frees the slot; a committed reservation moved says `was …`, and Revert puts it back", async () => {
        const c = await reserved();
        await press(save(c));
        await press(tableRow(c, "bin:V1").querySelector("span"));
        expect([headOf(c).kind, headOf(c).status, headOf(c).tone]).toEqual(["Reserved slot", "Reserved", "info"]);
        // Moved to another kiln through its row's resource Chooser: a draft.
        await press(tableRow(c, "bin:V1").querySelector("[data-allocation-cell-side=resource] [aria-haspopup=listbox]"));
        await press(within(document.querySelector<HTMLElement>("[data-chooser]")!).getByRole("option", { name: /K-601/ }));
        await press(tableRow(c, "bin:V1").querySelector("span"));
        expect([headOf(c).status, text(details(c).querySelector("[data-allocation-was] span"))]).toEqual(["Moved · unsaved", "was K-305 · B-1 00:15"]);
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-was]")!, "Revert"));
        expect(text(tableRow(c, "bin:V1").querySelector("[data-allocation-chip=resource]"))).toBe("K-305");
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Remove"));
        expect(c.querySelector("[data-allocation-row='bin:V1']")).toBeNull();
    });
});

describe("a resource (A62)", () => {
    test("A62 — `Resource`, Check, `K-207`, `Hall B · min 20 m³ · max 40 m³`; its banner; today's fill and meter; Prior job · Hold · Next job, in the app's words; its bins today; the hint", async () => {
        const c = await open();
        await press(await reveal(c, "K-207"));
        expect(headOf(c)).toEqual({ kind: "Resource", title: "K-207", when: "Hall B · min 20 m³ · max 40 m³", status: "Check", tone: "warning", chip: null });
        expect(banners(c)).toEqual([["Over max", "Over maxK-207 holds 44 m³ against a 40 m³ max · 4 m³ over."]]);
        const fill = details(c).querySelector<HTMLElement>("[data-allocation-fill-section]")!;
        expect([text(fill.querySelector("[data-allocation-fill]")), fill.querySelector("[data-allocation-fill]")!.getAttribute("data-tone")]).toEqual(["44 m³ · max 40 · 4 over", "danger"]);
        expect(rowsOf(fill.querySelector("[data-allocation-facts]"))).toEqual([
            ["Prior job", "job C-3148 · released Fri 7", null], ["Hold", "Tue 11 to Wed 19 · 9 d", null], ["Next job", "Thu 20 · 0 d spare", null],
        ]);
        expect(mates(c)).toEqual([["06:36", "B-2", "LD-2207", "44 m³"]]);
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toContain("Drag a bin’s connector or an arrival onto this row to load it.");
    });

    test("A62, A85 — busy: `busy until Fri 14`, `no bins today` and its hint; free: `not started` and `none planned to Thu 20`; held into its next fill in warn", async () => {
        const c = await open();
        await press(await reveal(c, "K-503"));
        expect([headOf(c).status, rowsOf(details(c).querySelector("[data-allocation-facts]"))[1]![1]]).toEqual(["Busy", "busy until Fri 14"]);
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toBe("Bins on it todayno bins todayBusy resources take no load until their current job is released.");
        await press(await reveal(c, "K-601"));
        const facts = details(c).querySelector("[data-allocation-facts]")!;
        expect([headOf(c).status, ...rowsOf(facts).map(r => r[1])]).toEqual(["Free", "empty in the plan", "not started", "none planned to Thu 20"]);
        expect(facts.children[3]!.hasAttribute("data-absent")).toBe(true);
        await press(await reveal(c, "K-105"));
        expect(rowsOf(details(c).querySelector("[data-allocation-facts]"))[2]).toEqual(["Next job", "Mon 17 · hold overlaps it by 2 d", "warning"]);
    });

    test("A62 — the Table's hint", async () => {
        const c = await open(ex.allocationTable);
        await press((await revealRow(c, "bin:3113")).querySelector("span"));
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Open resource"));
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toContain("Choose it with the resource chevron on a row, or drag it from the Library onto a row.");
    });
});

describe("the summary (A63, A89)", () => {
    test("A63 — `Plan · Tue 11 May`, the title, `3 lanes · 33 resources`; Bins, Loading, Issues and Changes; A89 — the three hints", async () => {
        const c = await open();
        expect(headOf(c)).toMatchObject({ kind: "Plan · Tue 11 May", title: "Kiln loading", when: "3 lanes · 33 resources" });
        const stats = () => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-stat]")].map(s => [...s.children].map(e => e.textContent).concat([s.children[1]!.getAttribute("data-tone") ?? ""]));
        expect(stats()).toEqual([
            ["Bins", "26", "556 m³ · 0 reserved", ""], ["Loading", "21 of 33", "10 free · 2 busy", ""],
            ["Issues", "3", "2 overlaps · 1 over max", "warning"], ["Changes", "0", "all saved", ""],
        ]);
        expect([...details(c).querySelectorAll("[data-allocation-hints] li")].map(li => li.textContent)).toEqual([
            "Select a bin or a resource to inspect it.", "Use the Library to book arrivals and reserve resources.", "Changes wait for Save. Undo and Redo are in the toolbar.",
        ]);
        expect(details(c).querySelector("[data-allocation-scope]")).toBeNull();
        // A draft is counted, and Save is named.
        await press(card(c, "3113"));
        await key(c, "Delete");
        await key(c, "Escape");
        expect(stats()[3]).toEqual(["Changes", "1", "unsaved · Save is in the toolbar", "brand"]);
    });

    test("A63 — the narrowing's note: `10 of 33 resources visible · fits, checks and totals include all`", async () => {
        const c = await open();
        await press(toolbar(c).getByRole("button", { name: "Halls" }));
        await vi.waitFor(() => expect(text(details(c).querySelector("[data-allocation-scope]"))).toBe("19 of 33 resources visible · fits, checks and totals include all"));
        // The counts are the whole day's.
        expect(text(details(c).querySelector('[data-allocation-stat="Loading"]'))).toContain("21 of 33");
    });
});

describe("Issues (A64)", () => {
    test("A64 — grouped, each with its mark and its count; an issue's title and `Show →`, its detail and its fix; the app's listed, not counted", async () => {
        const c = await open();
        await tab(c, "Issues");
        const groups = [...issuesTab(c).querySelectorAll<HTMLElement>("[data-allocation-issue-group]")];
        expect(groups.map(g => [g.firstElementChild!.textContent, g.firstElementChild!.getAttribute("data-tone"), g.firstElementChild!.querySelector("svg")?.getAttribute("data-icon") ?? null])).toEqual([
            ["Overlaps the next job2", "warning", "triangle-exclamation"], ["Over max1", "danger", "circle-exclamation"], ["Spec mismatch11", null, null],
        ]);
        const over = groups[1]!.querySelector<HTMLElement>("[data-allocation-issue]")!;
        expect([...over.children].map(e => e.textContent)).toEqual(["K-207Show", "44 m³ · max 40 · 4 over · over max", "Move LD-2207…"]);
        // The tab counts warnings and dangers, never the yard's neutral Spec mismatch.
        expect(activeTab(c)).toBe("Issues 3");
        expect(groups[2]!.querySelectorAll("[data-allocation-issue]")).toHaveLength(11);
        expect(groups[2]!.querySelector("[data-allocation-issue] button:not([type=button])")).toBeNull();
    });

    test("A64 — `Show →` selects its resource or its bin in Details; a fix opens the bin's resource Chooser", async () => {
        const c = await open();
        await tab(c, "Issues");
        const over = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="over"] [data-allocation-issue]')!;
        await press(button(over, "Show"));
        expect([activeTab(c), headOf(c).kind, headOf(c).title]).toEqual(["Details", "Resource", "K-207"]);
        await tab(c, "Issues");
        await press(button(issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="over"] [data-allocation-issue]')!, "Move LD-2207…"));
        expect([activeTab(c), headOf(c).kind]).toEqual(["Details", "Bin 3109"]);
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        await tab(c, "Issues");
        await press(button(issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="custom:Spec mismatch"] [data-allocation-issue]')!, "Show"));
        expect(headOf(c).kind).toBe("Bin 3102");
    });

    test("A64 — not linked: its fix `Choose a resource` opens the bin's Chooser; with none: `No issues · Every arrival sits within its gap and its max.`", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        await tab(c, "Issues");
        const unlinked = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="unlinked"]')!;
        expect(unlinked.firstElementChild!.textContent).toBe("Not linked1");
        await press(button(unlinked, "Choose a resource"));
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        // Thu 13 has no row and no bin, and no issue.
        await key(c, "]"); await key(c, "]");
        await tab(c, "Issues");
        expect(issuesTab(c).querySelector("[data-allocation-issues-empty]")!.textContent).toBe("No issuesEvery arrival sits within its gap and its max.");
    });
});

describe("the drop list (A34, A86)", () => {
    test("A34 — a connector's drag lists the three best as drop targets: `Gaps that fit · LD-2201 · 35 m³ · 7-day hold from Tue 11 · ` and the fit's basis; a drop on one links there", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        const head = details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!;
        const answer = answerTo(placing("3101"));
        expect([...head.children].map(e => e.textContent)).toEqual(["Gaps that fit", "LD-2201 · 35 m³", `7-day hold from Tue 11 · ${answer.basis}`]);
        expect(answer.basis).toBe("ranked by load, kind and spare days, and what it leaves for the day's other loads");
        const rows = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-drop-row]")];
        expect(rows.map(r => [r.children[0]!.textContent, r.getAttribute("data-allocation-drop-row"), r.querySelector('[data-drop-row="why"]')!.textContent]))
            .toEqual(bestOf(answer, "K-209").map((k, i) => [String(i + 1), k, whyOf(answer, k)]));
        expect(rows.every(r => r.querySelector("button") === null)).toBe(true);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a resource row, or on a resource here.");
        await over(rows[0]!);
        await release();
        expect(text(card(c, "3101").querySelector("[data-allocation-to]"))).toBe(bestOf(answer, "K-209")[0]);
    });

    test("A34, A86 — a body's drag: `Move bin · LD-2203 · 24 m³ · Between lanes and hours · its resource stays K-109`; a resource card's: `Resource · K-305 · Compact · free today`", async () => {
        const c = await open();
        await hover(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${hour(0, 35).getTime()}"]`)!);
        const head = () => [...details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!.children].map(e => e.textContent);
        expect(head()).toEqual(["Move bin", "LD-2203 · 24 m³", "Between lanes and hours · its resource stays K-109"]);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a lane hour. To change its resource, drag its connector instead.");
        await cancel();
        await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
        await hover(libraryCard(c, "K-305"), c.querySelector(`[data-allocation-cell="B-2|${hour(0, 35).getTime()}"]`)!);
        expect(head()).toEqual(["Resource", "K-305", "Compact · free today"]);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a bin to link it, or on an empty lane hour to reserve that slot.");
        await cancel();
    });

    test("A86 — an arrival's drag says where it drops, on the Timeline and in the Table", async () => {
        const c = await open();
        await hover(libraryCard(c, "arrival:LD-2231"), row(c, "K-101"));
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a resource row or a lane hour, or on a resource here.");
        expect(details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!.children[2]!.textContent!.startsWith("8-day hold from Tue 11 · ")).toBe(true);
        await cancel();
        const t = await open(ex.allocationTable);
        await hover(libraryCard(t, "arrival:LD-2231"), tableRow(t, "slot:B-1|2027-05-11T00:15:00.000"));
        expect(text(details(t).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a free row’s arrival cell, or on a resource here to book its next free bin.");
        await cancel();
        await hover(tableRow(t, "bin:3103").querySelector("[data-allocation-chip=arrival]")!, tableRow(t, "slot:B-1|2027-05-11T00:15:00.000"));
        expect(text(details(t).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a free row’s arrival cell. To change its resource, use the chevron on its row.");
        await cancel();
    });

    test("A34 — a pick, no drag: the same list with a Book each, and `Book puts it in the day’s first free lane slot (B-1 00:15)…`; Book books it onto that resource there", async () => {
        const c = await open();
        await press(libraryCard(c, "arrival:LD-2235"));
        const answer = answerTo(ask => ask.type === "place" && ask.value.subject.type === "arrival" && ask.value.subject.value === "LD-2235");
        const rows = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-drop-row]")];
        expect(rows.map(r => r.getAttribute("data-allocation-drop-row"))).toEqual(bestOf(answer));
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe(
            "Book puts it in the day’s first free lane slot (B-1 00:15). Or click a free lane hour or a ranked resource, or drag it there. Esc clears.");
        offering(["N1"]);
        await press(button(rows[0]!, "Book"));
        expect([text(card(c, "N1").querySelector("[data-allocation-code]")), text(card(c, "N1").querySelector("[data-allocation-to]"))]).toEqual(["LD-2235", bestOf(answer)[0]]);
        await press(save(c));
        const booked = (await h.read(ex.kilnBins)).get("N1")!;
        expect([booked.bay, booked.at]).toEqual(["B-1", hour(0, 15)]);
    });
});

describe("the refusal's note (A40)", () => {
    test("A40 — a refused drop moves nothing; its reason stays at the top of Details, `Not allocated · LD-2201 can’t go into K-101: …`, until dismissed or the next action", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        const note = () => details(c).querySelector<HTMLElement>("[data-allocation-refusal]");
        const answer = answerTo(placing("3101"));
        expect(note()!.textContent).toBe(`Not allocatedLD-2201 can’t go into K-101: ${whyOf(answer, "K-101")}.`);
        expect(details(c).firstElementChild).toBe(note());
        await press(button(note()!, /close|dismiss/i));
        expect(note()).toBeNull();
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        expect(note()).not.toBeNull();
        await press(card(c, "3113"));
        expect(note()).toBeNull();
    });

    test("A88, A40 — each refusal's word before its sentence: Not allocated, Not moved, Not booked, Not reserved", async () => {
        const c = await open();
        const note = () => text(details(c).querySelector("[data-allocation-refusal]"));
        // A connector onto a resource that refuses it.
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        expect(note()).toBe(`Not allocatedLD-2201 can’t go into K-101: ${whyOf(answerTo(placing("3101")), "K-101")}.`);
        // A card's body onto a resource row.
        await hover(card(c, "3103"), row(c, "K-101"));
        await release();
        expect(note()).toBe("Not movedLD-2203 moves between lane hours only. To change its resource, drag its connector.");
        // A Library arrival onto a resource that refuses it.
        await hover(libraryCard(c, "arrival:LD-2232"), row(c, "K-101"));
        await release();
        const booking = answerTo(ask => ask.type === "place" && ask.value.subject.type === "arrival" && ask.value.subject.value === "LD-2232");
        expect(note()).toBe(`Not bookedLD-2232 can’t go into K-101: ${whyOf(booking, "K-101")}.`);
        // A Library resource onto a lane hour it takes no reservation in: K-207, over its max already.
        await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
        const resources = slot(c, "start").querySelector<HTMLElement>('[data-allocation-library="resources"]')!;
        await act(async () => { fireEvent.change(within(resources).getByRole("textbox", { name: "Find a resource or group" }), { target: { value: "K-207" } }); });
        await settle();
        await hover(libraryCard(c, "K-207"), c.querySelector(`[data-allocation-cell="B-1|${hour(0, 15).getTime()}"]`)!);
        await release();
        expect(note()).toBe("Not reservedK-207 can’t take B-1 00:15: over max by 4 m³.");
    });
});

describe("the connector (A8, A21)", () => {
    test("A21 — a click on a connector selects its bin, opens the inspector and its resource Chooser there", async () => {
        const c = await open();
        await press(button(pane(c), "Collapse Inspector"));
        await press(card(c, "3113"));
        await press(connector(c, "3113"));
        expect(pane(c).hasAttribute("data-collapsed")).toBe(false);
        expect(headOf(c).kind).toBe("Bin 3113");
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        // Esc closes it, and keeps the bin.
        await act(async () => { fireEvent.keyDown(details(c).querySelector("[data-chooser] input")!, { key: "Escape" }); }); await settle();
        expect(details(c).querySelector("[data-chooser]")).toBeNull();
        expect(headOf(c).kind).toBe("Bin 3113");
        // The focus is back on the field it opened from, as a popover's goes back to its trigger.
        expect(document.activeElement).toBe(details(c).querySelector("[data-allocation-resource-field]"));
    });
});

describe("the bin kind's own form (`Schedule.events(record, { …, inspector })`)", () => {
    test("its own form in place of the quantity field and the column rows; its writes are drafts of the bins, saved in one request", async () => {
        const c = await open(ex.allocationCustomBin);
        await press(card(c, "3113"));
        const form = details(c).querySelector<HTMLElement>("[data-allocation-bin-form]")!;
        expect([details(c).querySelector('[data-field="quantity"]'), details(c).querySelector("[data-allocation-values]")]).toEqual([null, null]);
        expect([details(c).querySelector('[data-field="lane"]') !== null, details(c).querySelector('[data-field="at"]') !== null]).toEqual([true, true]);
        const instruction = within(form).getByRole("textbox");
        await act(async () => { fireEvent.change(instruction, { target: { value: "Stack under cover" } }); });
        await settle();
        expect(headOf(c).status).toBe("Edited · unsaved");
        expect((await h.read(ex.kilnBins)).get("3113")!.instruction).toEqual(none);
        await press(save(c));
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.kilnBins.name]);
        expect((await h.read(ex.kilnBins)).get("3113")!.instruction).toEqual(some("Stack under cover"));
    });
});

describe("words and marks (A85, A90)", () => {
    test("A85 — the field's `Choose the resource · the same list as the Table’s chevron`, the stepper's `One hour earlier` and `One hour later`; A90 — the Chooser's check and ×", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const field = details(c).querySelector<HTMLElement>("[data-allocation-resource-field]")!;
        expect(field.title).toBe("Choose the resource · the same list as the Table’s chevron");
        expect([button(details(c), "One hour earlier").title, button(details(c), "One hour later").title]).toEqual(["One hour earlier", "One hour later"]);
        await press(field);
        const list = details(c).querySelector<HTMLElement>("[data-chooser]")!;
        expect(list.querySelector('[role=group][aria-label="Current"] [aria-label="Current"]')).not.toBeNull();
        expect(list.querySelector('[role=group][aria-label="Doesn’t fit"] [aria-label="Doesn\'t fit"]')).not.toBeNull();
    });
});

describe("a published day", () => {
    test("the inspector still works, read-only: no actions, the form printed, the field closed", async () => {
        const c = await open(ex.allocationPublished);
        await press(card(c, "3001"));
        expect(headOf(c)).toMatchObject({ kind: "Bin 3001", status: "Committed" });
        expect(details(c).querySelector("[data-allocation-bin-actions]")).toBeNull();
        expect(within(details(c)).queryAllByRole("spinbutton")).toHaveLength(0);
        expect(details(c).querySelector<HTMLButtonElement>("[data-allocation-resource-field]")!.disabled).toBe(true);
        expect([...details(c).querySelectorAll("[data-allocation-alternative] button")]).toHaveLength(0);
    });
    test("a bin's lane and time are printed as the rest of its form is — no stepper and no lane segments, which looked editable — and nothing moves it (the hand retest)", async () => {
        const c = await open(ex.allocationPublished);
        await press(card(c, "3001"));
        const section = details(c).querySelector<HTMLElement>("[data-allocation-bin-section]")!;
        expect(section.querySelector("[data-allocation-stepper]")).toBeNull();
        expect(within(section).queryAllByRole("radio")).toHaveLength(0);
        /** A field as the form draws it: its editor, whether its box is read only, and what it prints. */
        const field = (name: string) => {
            const el = section.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
            return [el.getAttribute("data-editor"), el.querySelector("input")?.readOnly, el.querySelector("input")?.value];
        };
        expect(field("lane")).toEqual(["readonly", true, "B-1"]);
        expect(field("at")).toEqual(["readonly", true, formatters().dateTime(new Date(Date.UTC(2027, 4, 4, 6, 15)))]);
        expect(c.querySelector('[data-allocation-card="3001"]')).not.toBeNull();
    });
});

describe("pointer motion (A35)", () => {
    test("A35 — a drag's motion repaints nothing in the inspector: its drop list says no quantity again", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(details(c).querySelector("[data-allocation-drop-head]")).not.toBeNull();
        const said = vi.spyOn(allocationWords(), "quantity");
        for (const [i, key] of ["K-102", "K-103", "K-104", "K-101"].entries()) await over(row(c, key), 20 + i);
        expect(said).not.toHaveBeenCalled();
        await cancel();
    });
});

describe("the keyboard kept as a control goes with its view (#1398)", () => {
    /** A Details control the focus is put on, then pressed: what holds the focus after. */
    async function pressFocused(control: HTMLElement): Promise<Element> {
        control.focus();
        expect(document.activeElement).toBe(control);
        await press(control);
        return document.activeElement ?? document.body;
    }
    /** What a heading the focus is on names: whether it is its view's home, its kind and its title. */
    const named = (el: Element) => [el.hasAttribute("data-focus-home"), text(el.querySelector("[data-inspector-kind]")), text(el.querySelector("[data-inspector-title]"))];

    test("Back to Arrivals takes the bin away: the focus lands on the summary's heading, never on the page's body", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const focused = await pressFocused(button(details(c), "Back to Arrivals"));
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
        expect(focused).not.toBe(document.body);
        expect(named(focused)).toEqual([true, "Plan · Tue 11 May", "Kiln loading"]);
    });

    test("Unlink goes with the bin's actions: the focus lands on the bin's heading, never on the page's body", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const focused = await pressFocused(button(details(c), "Unlink"));
        expect(actions(c)).not.toContain("Unlink");
        expect(focused).not.toBe(document.body);
        expect(named(focused)).toEqual([true, "Bin 3113", "LD-2210 · 32 m³"]);
    });
});

describe("a conflict's Go to", () => {
    test("selects its bin and shows its details, as its issue's Show does", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        // Another bin selected, and the Issues open, before another session sets the same quantity otherwise.
        await press(card(c, "3101"));
        await tab(c, "Issues");
        const bins = await h.read(ex.kilnBins);
        bins.set("3113", { ...bins.get("3113")!, m3: 28 });
        await h.patch(ex.kilnBins, bins);
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        const [conflict, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        // The bin wears the warn ring while the conflict waits.
        expect(card(c, "3113").hasAttribute("data-conflict")).toBe(true);
        await press(conflict!.goTo());
        expect([card(c, "3113").hasAttribute("data-selected"), card(c, "3101").hasAttribute("data-selected"), activeTab(c)?.startsWith("Details")]).toEqual([true, false, true]);
    });
});

describe("the conflicts example (allocationConflicts)", () => {
    test("an m³ typed here, then Someone else saves, is one card under the board's word for a quantity, its split going with it, the bin wearing the ring", async () => {
        const c = await open(ex.allocationConflicts);
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        // Someone else's save puts 1 m³ more on each of the bin's kilns, its m³ with them.
        const before = (await h.read(ex.conflictBins)).get("3113")!;
        await press(within(c).getByRole("button", { name: "Someone else saves" }));
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        const [conflict, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        expect(document.querySelector("[data-conflict-card]")!.textContent).toContain("QTY");
        expect([conflict!.yours, conflict!.theirs?.split(",").slice(0, 2).join(",")]).toEqual(["Yours, 30", `Theirs, ${before.m3 + before.kilns.size}`]);
        expect(card(c, "3113").hasAttribute("data-conflict")).toBe(true);
    });

    test("a bin moved to another bay here, then Someone else saves, is one conflict at its time: Theirs takes it back to its own bay at their minute, nothing left to save", async () => {
        const c = await open(ex.allocationConflicts);
        const was = (await h.read(ex.conflictBins)).get("3113")!;
        // A free hour of another bay: each bay at its own minute, the move writes the bay and the time.
        const into = [...c.querySelectorAll<HTMLElement>("[data-allocation-cell]")].find((cell) => !cell.getAttribute("data-allocation-cell")!.startsWith(`${was.bay}|`))!;
        await hover(card(c, "3113"), into);
        await release();
        await press(within(c).getByRole("button", { name: "Someone else saves" }));
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        const [conflict, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        await press(conflict!.radio("source"));
        // Their minute, and its own bay with it: the bin is theirs whole, and nothing is left to save.
        expect(document.body.textContent).toContain(editingMessages.conflictsSettledNothing({ n: 1, count: "1" }));
        expect(save(c)).toHaveProperty("disabled", true);
    });

    test("from another day, its card names the bin as it does on its own, and Go to goes back to its day and selects it", async () => {
        const c = await open(ex.allocationConflicts);
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        await press(within(c).getByRole("button", { name: "Someone else saves" }));
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        const named = (await conflictCards(c))[0]!.item;
        // The next day: the bin is drawn nowhere, and its card names it as it did.
        await key(c, "]");
        expect(c.querySelector('[data-allocation-card="3113"]')).toBeNull();
        const [conflict] = await conflictCards(c);
        expect(conflict!.item).toBe(named);
        await press(conflict!.goTo());
        await waitFor(() => expect(c.querySelector('[data-allocation-card="3113"]')?.hasAttribute("data-selected")).toBe(true));
    });
});
