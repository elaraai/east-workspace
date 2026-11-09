/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Inspector (#1331) over the kiln yard, through the dispatcher, the shared
 * drag layer and the yard's fit served by name: its tabs (A55) and a bin (A56–
 * A59). Every word and figure the mock draws for the same day is the mock's;
 * every fit is the yard's answer. The rest of the Inspector's specs are
 * `inspector.dom.test.tsx`'s, their helpers `inspector.test-utils.tsx`'s.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap, StringType, compareFor, none, some } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { allocationHarness, kilnYard, offering, settle, slot } from "./harness.test-utils.js";
import { pane, details, issuesTab, tabs, activeTab, card, connector, row, tableRow, libraryCard, toolbar, undo, save, text, headOf, actions, banners, rowsOf, mates, keyField, press, key, tab, button, revealRow, hover, over, release, cancel, placing, bestOf, whyOf, hour, inspectorKit } from "./inspector.test-utils.js";

const h = allocationHarness();
const { open, answerTo } = inspectorKit(h);

describe("the pane and its tabs (A55)", () => {
    test("A55 — two tabs, Details and Issues with its count; collapsed, the rail's badge is the count", async () => {
        const c = await open();
        expect(tabs(c).map(t => t.textContent)).toEqual(["Details", "Issues 3"]);
        await press(button(pane(c), "Collapse Inspector"));
        expect(pane(c).querySelector("[data-dock-badge]")!.textContent).toBe("3");
        expect(pane(c).querySelector("[data-dock-mark]")!.getAttribute("aria-label")).toBe("3 issues");
        await press(button(pane(c), "Expand Inspector"));
        expect(details(c)).not.toBeNull();
    });

    test("A55 — Details shows the summary with nothing selected, the selection when there is one, and the drop list during a drag", async () => {
        const c = await open();
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
        await press(card(c, "3101"));
        expect(headOf(c).kind).toBe("Bin 3101");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(details(c).querySelector("[data-allocation-drop-head]")!.firstElementChild!.textContent).toBe("Gaps that fit");
        // The selection waits for the drag to end.
        expect(details(c).querySelector("[data-inspector-kind]")).toBeNull();
        await cancel();
        expect(headOf(c).kind).toBe("Bin 3101");
        expect(details(c).querySelector("[data-allocation-drop-head]")).toBeNull();
    });

    test("A55, A8, A22 — an inspection opens Details; a command's selection keeps the tab; a drag shows Details and gives the tab back", async () => {
        const c = await open();
        await tab(c, "Issues");
        expect(activeTab(c)).toBe("Issues 3");
        await press(card(c, "3113"));
        expect(activeTab(c)).toBe("Details");
        await tab(c, "Issues");
        // Delete removes the selected bin, a command: the tab stays.
        await key(c, "Delete");
        expect(activeTab(c)).toBe("Issues 3");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(activeTab(c)).toBe("Details");
        await cancel();
        expect(activeTab(c)).toBe("Issues 3");
    });
});

describe("a bin (A56–A59)", () => {
    test("A56 — its eyebrow `Bin 3113` and status Committed, its title `LD-2210 · 32 m³`, its meta, and Unlink and Back to Arrivals", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(headOf(c)).toEqual({ kind: "Bin 3113", title: "LD-2210 · 32 m³", when: "FRN · R2 · spec MC08", status: "Committed", tone: "success", chip: null });
        expect(actions(c)).toEqual(["Unlink", "Back to Arrivals"]);
        expect(banners(c)).toEqual([]);
    });

    test("its key stands first among its facts, a field read only — what Search Records finds it by (#1398)", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const fields = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-bin-section] [data-field]")];
        // The board's own fields first — the key, then where and when it stands and what it holds — then the row's.
        expect(fields.slice(0, 4).map(f => f.getAttribute("data-field"))).toEqual(["key", "lane", "at", "quantity"]);
        expect(keyField(details(c))).toEqual({ label: "Key", value: "3113", readOnly: true, dirty: false });
    });

    test("A56 — a banner per issue: `Over max · K-207 holds 44 m³ against a 40 m³ max · 4 m³ over.`; `Overlaps the next job · The 8-day hold on K-105 runs to Tue 18, 2 d into the job planned Mon 17.`", async () => {
        const c = await open();
        await press(card(c, "3109"));
        expect([headOf(c).status, headOf(c).tone]).toEqual(["Check", "warning"]);
        expect(banners(c)).toEqual([["Over max", "Over maxK-207 holds 44 m³ against a 40 m³ max · 4 m³ over."]]);
        await press(card(c, "3124"));
        expect(banners(c)).toEqual([["Overlaps the next job", "Overlaps the next jobThe 8-day hold on K-105 runs to Tue 18, 2 d into the job planned Mon 17."]]);
        // The yard's Spec mismatch is neutral: listed in Issues, never a banner.
        await press(card(c, "3113"));
        expect(banners(c)).toEqual([]);
    });

    test("A56 — not linked: `Not linked · LD-2210 has no resource. Link it to a gap that fits, or it stays unplaced.`; under min: `… Another arrival can top it up; Save still works.`", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        expect([headOf(c).status, headOf(c).chip]).toEqual(["Not linked · unsaved", "Pending"]);
        expect(banners(c)).toEqual([["Not linked", "Not linkedLD-2210 has no resource. Link it to a gap that fits, or it stays unplaced."]]);
        // Linked to the bulk kiln through the field's Chooser: under its 40 m³ minimum.
        await press(details(c).querySelector("[data-allocation-resource-field]"));
        await press(within(details(c).querySelector<HTMLElement>("[data-chooser]")!).getByRole("option", { name: /K-601/ }));
        expect(banners(c)).toEqual([["Under min", "Under minK-601 holds 32 m³ against a 40 m³ minimum · 8 m³ short. Another arrival can top it up; Save still works."]]);
        expect(headOf(c).status).toBe("Allocated · unsaved");
    });

    test("A56, A76 — a changed committed bin: `Moved · unsaved`, Pending, Revert; Revert puts it back as the day holds it", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "One hour later"));
        expect([headOf(c).status, headOf(c).chip, headOf(c).tone]).toEqual(["Moved · unsaved", "Pending", "neutral"]);
        expect(details(c).querySelector("[data-allocation-time]")!.textContent).toBe("11:35");
        expect(actions(c)).toEqual(["Unlink", "Revert", "Back to Arrivals"]);
        expect(text(details(c).querySelector("[data-allocation-was]"))).toBe("was K-108 · B-2 10:35");
        await press(button(details(c), "Revert"));
        expect([headOf(c).status, details(c).querySelector("[data-allocation-time]")!.textContent]).toEqual(["Committed", "10:35"]);
        expect(details(c).querySelector("[data-allocation-was]")).toBeNull();
        expect(undo(c)).toHaveProperty("disabled", false);
    });

    test("A56, A59, A74 — a new bin: `New bin`, `Added · unsaved` and New, `new booking · not in the plan yet`; not linked, it offers Find a fit; Back to Arrivals returns its arrival", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        const book = details(c).querySelector<HTMLElement>('[data-allocation-option="arrival:LD-2235"]')!;
        offering(["N1"]);
        await press(button(book, "Book"));
        expect(headOf(c)).toMatchObject({ kind: "New bin", title: "LD-2235 · 8 m³", status: "Not linked · unsaved", chip: "New" });
        expect(text(details(c).querySelector("[data-allocation-was]"))).toBe("new booking · not in the plan yet");
        expect(actions(c)).toEqual(["Back to Arrivals", "Find a fit"]);
        await press(button(details(c), "Back to Arrivals"));
        expect(c.querySelector("[data-allocation-row='bin:N1']")).toBeNull();
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
    });

    test("A57 — Lane moves the bin to that lane's slot in the same hour; Bin time steps a slot, its help `B-2 bins at :35 · ± 1 h, 00–23 on Tue 11`; + is off at 23", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const help = () => text(details(c).querySelector('[data-field="at"]')?.querySelector("[data-part=helper-text], [id$=helpertext]") ?? null)
            ?? details(c).querySelector('[data-field="at"]')!.textContent;
        expect(details(c).querySelector('[data-field="at"]')!.textContent).toContain("B-2 bins at :35 · ± 1 h, 00–23 on Tue 11");
        expect(help()).toContain("± 1 h");
        const lanes = within(details(c).querySelector<HTMLElement>('[data-field="lane"]')!).getAllByRole("radio");
        expect(lanes.map(r => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["B-1", "false"], ["B-2", "true"], ["B-3", "false"]]);
        await press(lanes[2]!);
        await press(button(details(c), "One hour earlier"));
        await press(save(c));
        const moved = (await h.read(ex.kilnBins)).get("3113")!;
        expect([moved.bay, moved.at, [...moved.kilns]]).toEqual(["B-3", hour(9, 55), [["K-108", 32]]]);
        expect(details(c).querySelector('[data-field="at"]')!.textContent).toContain("B-3 bins at :55 · ± 1 h, 00–23 on Tue 11");
        await press(card(c, "3126"));
        expect([button(details(c), "One hour later").hasAttribute("disabled"), button(details(c), "One hour earlier").hasAttribute("disabled")]).toEqual([true, false]);
    });

    test("A57 — the app's columns as rows over the bin's row, a warning one in warn-text: `Spec · booked MC08 · measured MC22`; what the bin kind's form edits stands once, as its field", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(rowsOf(details(c).querySelector("[data-allocation-values]"))).toEqual([
            ["Spec", "booked MC08 · measured MC22", "warning"], ["Grade", "R2", null],
        ]);
        // The loading instruction is the form's to edit, and no column says it again.
        expect([...details(c).querySelectorAll('[data-field="instruction"]')].map(f => f.querySelector("label")!.firstChild!.textContent)).toEqual(["Loading instruction"]);
        expect(within(details(c)).queryAllByText(/^Instruction$/)).toEqual([]);
    });

    test("A57, A75 — the quantity is one draft; a bin wholly on its resource stays wholly there, and Saves", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        expect(headOf(c).title).toBe("LD-2210 · 30 m³");
        expect(headOf(c).status).toBe("Edited · unsaved");
        await press(save(c));
        const saved = (await h.read(ex.kilnBins)).get("3113")!;
        expect([saved.m3, [...saved.kilns]]).toEqual([30, [["K-108", 30]]]);
    });

    test("a quantity typed here and otherwise by another session is one conflict — its split across kilns changes with it — under the board's word for a quantity", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        // Another session books the same bin at 45 m³, on its one kiln.
        const bins = await h.read(ex.kilnBins);
        const next = new SortedMap(bins, compareFor(StringType));
        next.set("3113", { ...next.get("3113")!, m3: 45, kilns: new SortedMap([["K-108", 45]], compareFor(StringType)) });
        await h.patch(ex.kilnBins, next);
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')?.textContent).toContain(editingMessages.bannerConflicts({ n: 1, count: "1" })));
        const [conflict, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        expect(document.querySelector("[data-conflict-card]")!.textContent).toContain("QTY");
        expect([conflict!.yours, conflict!.theirs?.split(",").slice(0, 2).join(",")]).toEqual(["Yours, 30", "Theirs, 45"]);
    });

    test("two Saves at once, of different fields of one bin: the one that lands first reads its own back beside the other's and is done, never left waiting on it", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        // The other session's loading instruction on the same bin commits just after this Save, before this session has read its own back.
        await h.followed(ex.kilnBins, () => { fireEvent.click(save(c)); }, (now) => {
            const others = new SortedMap(now, compareFor(StringType));
            others.set("3113", { ...others.get("3113")!, instruction: some("Turn the stacks") });
            return others;
        });
        const saved = (await h.read(ex.kilnBins)).get("3113")!;
        expect([saved.m3, saved.instruction]).toEqual([30, some("Turn the stacks")]);
        await waitFor(() => {
            expect(slot(c, "toolbar").textContent).not.toContain(editingMessages.historyStatus({ status: "reconciling" }));
            expect(headOf(c).status).not.toBe("Edited · unsaved");
        });
        expect(c.querySelector("[data-session-banner]")).toBeNull();
    });

    test("A58 — Assigned to: the field, the fill and its meter with the min tick, the group line, Prior job · Hold · Next job, in the app's words, its bins today and the batch line", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const assigned = details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!;
        expect(text(assigned.querySelector("[data-allocation-resource-field]"))).toBe("K-108");
        expect(text(assigned.querySelector("[data-allocation-fill]"))).toBe("32 m³ · takes 16–32");
        const meter = assigned.querySelector<HTMLElement>("[data-allocation-meter]")!;
        expect([meter.firstElementChild!.querySelector<HTMLElement>("div")!.style.width, meter.querySelector<HTMLElement>("[data-allocation-min]")!.style.left]).toEqual(["100%", "50%"]);
        expect(assigned.textContent).toContain("Hall A · min 16 m³ · max 32 m³");
        expect(rowsOf(assigned.querySelector("[data-allocation-facts]"))).toEqual([
            ["Prior job", "job C-3143 · released Mon 10", null], ["Hold", "Tue 11 to Mon 17 · 7 d", null], ["Next job", "Thu 20 · 2 d spare · the plan had this charge on Wed 12", null],
        ]);
        expect(mates(c)).toEqual([["10:35", "B-2", "LD-2210", "32 m³", "current"]]);
        expect(text(assigned.querySelector("[data-allocation-batch]"))).toBe("One bin fills it.");
        // K-304 holds five bins: batched.
        await press(card(c, "3110"));
        expect(text(details(c).querySelector("[data-allocation-batch]"))).toBe("Batched · 5 bins · 7 m³");
        expect(mates(c).map(m => m[2])).toEqual(["LD-2206", "LD-2208", "LD-2209", "LD-2211", "LD-2218"]);
        expect(mates(c).find(m => m.includes("current"))![2]).toBe("LD-2208");
    });

    test("A58, A48 — the field opens the Chooser in the pane, the Table's sections, each the fit's; a choice re-links the bin, one draft", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(details(c).querySelector("[data-allocation-resource-field]"));
        const list = details(c).querySelector<HTMLElement>("[data-chooser]")!;
        const sections = [...list.querySelectorAll("[role=group]")].map(g => g.getAttribute("aria-label"));
        expect(sections).toEqual(["Current", "Gaps that fit", "Doesn’t fit"]);
        const fits = [...list.querySelectorAll('[role=group][aria-label="Gaps that fit"] [role=option]')].map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent);
        const answer = answerTo(placing("3113"));
        expect(fits).toEqual(bestOf(answer, "K-108").slice(0, fits.length));
        expect(fits).toEqual(["K-103", "K-601"]);
        await press(within(list).getByRole("option", { name: /K-103/ }));
        expect(details(c).querySelector("[data-chooser]")).toBeNull();
        expect(document.activeElement).toBe(details(c).querySelector("[data-allocation-resource-field]"));
        expect([text(details(c).querySelector("[data-allocation-resource-field]")), headOf(c).status]).toEqual(["K-103", "Allocated · unsaved"]);
        expect(text(card(c, "3113").querySelector("[data-allocation-to]"))).toBe("K-103");
        await press(undo(c));
        expect(text(details(c).querySelector("[data-allocation-resource-field]"))).toBe("K-108");
    });

    test("A58 — not linked: `+ Choose a resource` in warn, and the layout's hint", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        const field = details(c).querySelector<HTMLElement>("[data-allocation-resource-field]")!;
        expect([field.textContent, field.hasAttribute("data-unlinked")]).toEqual(["+ Choose a resource", true]);
        expect(details(c).querySelector("[data-allocation-assigned]")!.textContent).toContain("Or drag the bin’s connector onto a resource row.");
        expect(details(c).querySelector("[data-allocation-alternatives]")!.firstElementChild!.textContent).toBe("Gaps that fit");
        const t = await open(ex.allocationTable);
        await press(within(await revealRow(t, "bin:3113")).getByRole("button", { name: "Unlink LD-2210 from K-108" }));
        await press(tableRow(t, "bin:3113").querySelector("span"));
        expect(details(t).querySelector("[data-allocation-assigned]")!.textContent).toContain("Or use the chevron on its row in the table.");
    });

    test("A58 — `Open resource →` selects the resource; a bin of it today selects that bin", async () => {
        const c = await open();
        await press(card(c, "3110"));
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Open resource"));
        expect(headOf(c)).toMatchObject({ kind: "Resource", title: "K-304" });
        await press(details(c).querySelector('[data-allocation-mate="3114"]'));
        expect(headOf(c).kind).toBe("Bin 3114");
    });

    test("A59 — other gaps that fit: the three best, its resource excepted, each its rank, the fit's reason and Move; Move re-links it", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const answer = answerTo(placing("3113"));
        const shown = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-alternative]")];
        expect(shown.map(o => [o.children[0]!.textContent, o.getAttribute("data-allocation-alternative"), o.children[1]!.lastElementChild!.textContent, o.children[2]!.textContent]))
            .toEqual(bestOf(answer, "K-108").map((k, i) => [String(i + 1), k, whyOf(answer, k), "Move"]));
        await press(button(shown[0]!, "Move"));
        expect(text(card(c, "3113").querySelector("[data-allocation-to]"))).toBe(bestOf(answer, "K-108")[0]);
    });

    test("A59 — with no other gap: `no other free gap is long enough`", async () => {
        const c = await open();
        // Every kiln but K-108 drying a charge through the plan day: busy, none takes the bin.
        const kilns = await h.read(ex.kilns);
        const busy = new SortedMap([...kilns].map(([k, kiln]) => [k, k === "K-108" ? kiln
            : { ...kiln, charges: [{ label: "C-9000", start: new Date("2027-05-01T00:00:00Z"), end: new Date("2027-06-01T00:00:00Z") }] }] as const), compareFor(StringType));
        await h.patch(ex.kilns, busy);
        await press(card(c, "3113"));
        expect(text(details(c).querySelector("[data-allocation-alternatives]"))).toBe("Other gaps that fitno other free gap is long enough");
    });

    test("A59 — the arrival's details (`Settings`)", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(rowsOf(details(c).querySelector("[data-allocation-details] dl"))).toEqual([["Settings", "Schedule KS-7 · 80 °C · equalise 12 h · direct", null]]);
    });
});

describe("the refusals holding Save (#1525)", () => {
    test("the yard's check refusing a bin is listed first in Issues, by its code, and reachable: the warning button and Show select it, its banner over its form and its field ringed, and a grade clears it", async () => {
        const c = (await h.mount(kilnYard({ ready: true }))).container;
        const user = userEvent.setup();
        const issueCount = () => Number(tabs(c).find(t => t.textContent!.startsWith("Issues"))!.textContent!.replace(/\D/g, "") || "0");
        const counted = issueCount();
        await press(card(c, "3113"));
        const grade = () => within(details(c).querySelector<HTMLElement>('[data-field="gradeMeasured"]')!).getByRole("textbox");
        await user.clear(grade());
        await user.keyboard("{Enter}");
        await settle();
        expect(save(c)).toHaveProperty("disabled", true);
        // Its panel: the refusal over its form, the field it names ringed.
        expect(banners(c)[0]).toEqual(["Not saved yet", "Not saved yetGrade measured: Measure the grade"]);
        expect([...details(c).querySelectorAll("[data-issue]")].map(f => f.getAttribute("data-field"))).toEqual(["gradeMeasured"]);
        // With nothing selected, the history's warning button selects it again.
        await key(c, "Escape");
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
        await press(toolbar(c).getByRole("button", { name: editingMessages.issues({ n: 1, count: "1" }) }));
        expect(headOf(c).kind).toBe("Bin 3113");
        // The Issues tab: the refusal first, by its bin's code, counted with the issues.
        await tab(c, "Issues");
        expect(issueCount()).toBe(counted + 1);
        const group = issuesTab(c).querySelector<HTMLElement>("[data-allocation-issue-group]")!;
        expect([group.getAttribute("data-allocation-issue-group"), group.firstElementChild!.textContent]).toEqual(["refusals", "Not saved yet1"]);
        const line = group.querySelector<HTMLElement>('[data-allocation-issue="refusal"]')!;
        expect([line.querySelector("[title]")!.textContent, line.lastElementChild!.textContent]).toEqual(["LD-2210", "Grade measured: Measure the grade"]);
        await press(button(line, "Show"));
        expect([activeTab(c), headOf(c).kind]).toEqual(["Details", "Bin 3113"]);
        // A grade clears it, and Save is on.
        await user.type(grade(), "R3{Enter}");
        await settle();
        expect(save(c)).toHaveProperty("disabled", false);
        expect(banners(c)).toEqual([]);
        expect(issueCount()).toBe(counted);
    });

    test("a reservation the yard's check refuses is set right in its own panel: its fields a bin's, the one the refusal names ringed, and a grade clears it", async () => {
        const c = (await h.mount(kilnYard({ ready: true }))).container;
        const user = userEvent.setup();
        // K-305, free today, dropped from the Library on B-1 00:15: a new reservation, its grade empty.
        await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
        await hover(libraryCard(c, "K-305"), c.querySelector(`[data-allocation-cell="B-1|${hour(0, 15).getTime()}"]`)!);
        offering(["V1"]);
        await release();
        await press(card(c, "V1"));
        expect(headOf(c).kind).toBe("New reservation");
        expect(save(c)).toHaveProperty("disabled", true);
        expect(banners(c)[0]).toEqual(["Not saved yet", "Not saved yetGrade measured: Measure the grade"]);
        const section = details(c).querySelector<HTMLElement>("[data-allocation-reservation]")!;
        expect([...section.querySelectorAll("[data-issue]")].map(f => f.getAttribute("data-field"))).toEqual(["gradeMeasured"]);
        await user.type(within(section.querySelector<HTMLElement>('[data-field="gradeMeasured"]')!).getByRole("textbox"), "R3{Enter}");
        await settle();
        expect(save(c)).toHaveProperty("disabled", false);
        expect(banners(c)).toEqual([]);
    });
});

describe("the app's values failing (#1526)", () => {
    test("a reservation the yard's values fail to make is none: the drop records nothing, the board stands, and the console says why", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const c = (await h.mount(kilnYard({ failingValues: true }))).container;
            const before = c.querySelectorAll("[data-allocation-card]").length;
            await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
            await hover(libraryCard(c, "K-305"), c.querySelector(`[data-allocation-cell="B-1|${hour(0, 15).getTime()}"]`)!);
            await release();
            expect(c.querySelectorAll("[data-allocation-card]")).toHaveLength(before);
            expect(undo(c)).toHaveProperty("disabled", true);
            expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^\[Allocation\] a new .+ could not be made from the app's values:$/), expect.anything());
            // The board still takes a gesture: a bin pressed opens in Details.
            await press(card(c, "3113"));
            expect(headOf(c).kind).toBe("Bin 3113");
        } finally {
            logged.mockRestore();
        }
    });
});
