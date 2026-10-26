/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board in its frame (#1325, #1372): the toolbar's items, the day's
 * status and its banners, the day stepping and the picker's marks, Publish,
 * the footer's legend, the loading cover and the days either side read ahead
 * (#1398) — over the kiln yard's own records: its bins, and its days, whose
 * row says a day's status. A day not read yet draws at once with its
 * placeholders, under no cover; a day whose read failed says so once; and a
 * started day with no bins says so once, after its read (#1398). The day is the
 * page's own (#1398): another page keeping a view moves neither it nor the
 * window it writes into its source, and a reload opens on the view kept last.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, decodeBeast2For, equalFor, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Request } from "../e3-web.test-utils.js";
import { issueSummary } from "./toolbar.js";
import { compareDate, type Issue } from "./model.js";
import { act, allocationHarness, settle, slot, THU, TUE, TUE_4, WED, width } from "./harness.test-utils.js";

const h = allocationHarness();
/** The bins and the days the windowed board reads a day at a time, as the request log names their datasets. */
const BINS = `records.${ex.kilnBinHistory.name}`, DAYS = `records.${ex.yardDayHistory.name}`;
/** A read of the bins or of the days — a page, a key search, a read of runs or of rows by key (#1351). */
const READS = new Set(["page", "find", "runs", "rows"]);
const dayRead = (request: E3Request) => READS.has(request.kind) && (request.dataset === BINS || request.dataset === DAYS);
const day = printFor(DateTimeType);
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const status = (c: HTMLElement) => c.querySelector("[data-allocation-status]")?.textContent;
const shownDay = (c: HTMLElement) => Number(c.querySelector("[data-allocation-main]")!.getAttribute("data-allocation-day"));

describe("the board's frame", () => {
    test("A1 — one toolbar: the date, the layout (Table, then Timeline), the day's status, the history and Publish", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const bar = toolbar(container);
        expect(bar.getByRole("button", { name: "Choose plan day" })).toBeTruthy();
        expect(bar.getAllByRole("radio").map(r => r.textContent)).toEqual(["Table", "Timeline"]);
        expect(status(container)).toBe("Draft");
        expect(bar.getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
        expect(bar.getByRole("button", { name: "Publish" })).toBeTruthy();
    });

    test("A2 — [ and ] step one day; the arrows step a day", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        expect(shownDay(container)).toBe(TUE.getTime());
        await key(container, "]");
        expect(shownDay(container)).toBe(TUE.getTime() + 86_400_000);
        await key(container, "["); await key(container, "[");
        expect(shownDay(container)).toBe(TUE.getTime() - 86_400_000);
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect(shownDay(container)).toBe(TUE.getTime());
    });

    test("A2 — the picker marks each day of its open month Published · Draft · Not started", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const mark = (date: Date) => picker.querySelector(`[data-time-day="${date.getTime()}"] [data-state]`)?.getAttribute("data-state");
        expect(mark(TUE_4)).toBe("published");
        expect(mark(TUE)).toBe("draft");
        expect(mark(THU)).toBe("empty");
        expect(picker.textContent).toContain("Published · Draft · Not started");
    });

    test("A2 — read a day at a time, the picker marks each day of the month it browses to, the month read as one run of keys", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const marks = () => [...picker.querySelectorAll("[data-time-day]")].map(d => d.querySelector("[data-state]")?.getAttribute("data-state"));
        // May's weeks, Mon 26 Apr to Sun 6 Jun: published to Mon 10, the draft on Tue 11, not started from Wed 12.
        expect(marks()).toEqual([...Array(15).fill("published"), "draft", ...Array(26).fill("empty")]);
        // April's, Mon 29 Mar to Sun 2 May, every day published: 35 days, more than the runtime keeps windows of, read a window a day.
        const before = h.requests().length;
        const history = () => h.requests().slice(before).filter(r => r.dataset === "records.yard_day_history");
        fireEvent.click(within(picker).getByRole("button", { name: "Previous month" }));
        // Counted before anything waits on a timer: reads that evict each other never stop asking, and their landings starve every timer.
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(history().length).toBeLessThanOrEqual(2);
        await settle();
        expect(marks()).toEqual(Array(35).fill("published"));
        // One search for the month's run of keys, and one page of it.
        expect(history().filter(r => r.kind === "find").length).toBe(1);
        expect(history().filter(r => r.kind === "page").map(r => r.query.get("limit"))).toEqual(["35"]);
    });

    test("A3 — a day with no row and no bins is Not started, under the banner `Day not started`", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        expect(container.textContent).not.toContain("Day not started");
        await key(container, "]"); await key(container, "]");
        expect(shownDay(container)).toBe(THU.getTime());
        expect(status(container)).toBe("Not started");
        expect(container.textContent).toContain("Day not started");
    });

    test("A4 — Publish writes the day's row issued, its bins as they were; a published day is read-only under its banner", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const bins = await h.read(ex.kilnBins);
        await press(toolbar(container).getByRole("button", { name: "Publish" }));
        // No draft to save: the day's row alone, issued, one patch of the days.
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.yardDays.name]);
        expect((await h.read(ex.yardDays)).get(TUE)!.state.type).toBe("issued");
        expect(equalFor(ex.kilnBins.type)(await h.read(ex.kilnBins), bins)).toBe(true);
        expect(status(container)).toBe("Published");
        expect(container.textContent).toContain("Published day");
        expect(container.textContent).toContain("Read-only view of the published plan.");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
        // Publish keeps its slot, off: the toolbar never shifts as a day's status changes (#1398, CL1).
        expect(toolbar(container).getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
        expect(toolbar(container).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
    });

    test("A4 — the published example's day, Tue 4, opens read-only", async () => {
        const { container } = await h.mount(ex.allocationPublished);
        expect(shownDay(container)).toBe(TUE_4.getTime());
        expect(status(container)).toBe("Published");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
    });

    test("without `periods`: no status chip and no Publish", async () => {
        const { container } = await h.mount(ex.allocationNoPublish);
        expect(container.querySelector("[data-allocation-status]")).toBeNull();
        expect(toolbar(container).queryByRole("button", { name: "Publish" })).toBeNull();
        expect(toolbar(container).getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
    });

    test("A79 — the footer is the layout's legend only", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const items = () => [...slot(container, "footer").querySelectorAll("[data-allocation-legend]")].map(i => i.textContent);
        expect(items()).toEqual(["Bin", "Draft", "Today's load", "Prior job", "Next job", "Overlap", "Link", "Draft link"]);
        await press(toolbar(container).getByRole("radio", { name: "Table" }));
        expect(items()).toEqual(["Arrival or resource", "Draft", "Empty · drop here", "Reserved", "Free"]);
    });

    test("A80 — the frame is covered until the active day resolves, a day at a time through the window", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        // The day resolved: the frame's main is not busy, and the footer's loading line says nothing (#1398).
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(day(TUE)).toContain("2027-05-11");
    });

    test("#1398, CL6, CL7 — once its day has landed, the board reads the days either side ahead: a step to the next shows it at once with every read held, and asks for the day after it; a step back drops that read, each of its requests aborted on its way to e3", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        // From now on every read of the bins and the days is held on its way to e3.
        const held = h.e3.hold(dayRead);
        const before = h.requests().length;
        await key(container, "]");
        // The day stepped to was read before the step: nothing covers the frame, its main is not busy, and the footer's line says nothing.
        expect(shownDay(container)).toBe(WED.getTime());
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
        // What it asks now is the day after it, read ahead in turn: on its way, none given up.
        const ahead = h.requests().slice(before).filter(dayRead);
        expect(ahead.length).toBeGreaterThan(0);
        expect(ahead.some(request => request.signal.aborted)).toBe(false);
        // Back at the day it opened on, its neighbours read already: nothing reads the day after the next any more, and every request for it is aborted.
        await key(container, "[");
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(ahead.every(request => request.signal.aborted)).toBe(true);
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        await act(async () => { held.release(); });
        await settle();
    });

    test("#1398, CL1 — the cold load is covered at the board's own row pitch, the status, the issues and Publish holding their slots under it", async () => {
        // Every read of the bins and the days held on its way to e3: the day the windowed board opens on is unresolved.
        const held = h.e3.hold(dayRead);
        const { container } = await h.mount(ex.allocationWindowed);
        const cover = container.querySelector<HTMLElement>("[data-builder-loading]");
        expect(cover).not.toBeNull();
        expect(cover!.style.getPropertyValue("--builder-loading-pitch")).toBe("36px");
        const bar = slot(container, "toolbar");
        expect(bar.querySelector("[data-allocation-status]")!.hasAttribute("data-pending")).toBe(true);
        expect(bar.querySelector("[data-allocation-issues]")!.hasAttribute("data-pending")).toBe(true);
        expect(within(bar).getByRole("button", { name: "Publish", hidden: true }).hasAttribute("disabled")).toBe(true);
        expect(container.textContent).not.toMatch(/Not started|Day not started/);
        await act(async () => { held.release(); }); await settle();
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(status(container)).toBe("Draft");
    });

    test("#1398, CL5 — a step to a day not read yet never covers the frame: the toolbar stays live, its status a placeholder — never `Not started` — and Publish in its slot; the day's lanes, hours and resources draw at once, a placeholder where each lane's figures and each today's load go, each lane hour washed, no bin; its read lands in place", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        const main = () => slot(container, "main");
        const bar = () => slot(container, "toolbar");
        const held = h.e3.hold(dayRead);
        // Past the day read ahead, to one not read: two days on.
        await key(container, "]"); await key(container, "]");
        expect(shownDay(container)).toBe(THU.getTime());
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(main().getAttribute("aria-busy")).toBe("true");
        expect(bar().closest("[inert]")).toBeNull();
        // The status, the issues and Publish keep their slots: the status and the issues placeholders, Publish off.
        const chip = bar().querySelector("[data-allocation-status]")!;
        expect([chip.hasAttribute("data-pending"), chip.textContent]).toEqual([true, ""]);
        expect(bar().querySelector("[data-allocation-issues]")!.hasAttribute("data-pending")).toBe(true);
        expect(within(bar()).getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
        // The history keeps its slot as the day read last had it: the toolbar never shifts as the day lands.
        expect(within(bar()).getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
        // The day's lanes, hours and resources at once, unread: no bin, no figure, no false empty.
        expect(main().querySelector("[data-allocation-grid]")!.getAttribute("data-allocation-unread")).toBe("pending");
        expect([main().querySelectorAll("[data-allocation-lane]").length, main().querySelectorAll("[data-allocation-band]").length,
            main().querySelectorAll("[data-allocation-resource]").length].every(n => n > 0)).toBe(true);
        expect(main().querySelector("[data-allocation-card], [data-allocation-load], [data-allocation-read-line]")).toBeNull();
        expect(container.textContent).not.toMatch(/Not started|Day not started|\d bins? ·|No bins on|No rows match/);
        // Past the reveal's delay the placeholders fill: each lane hour washed, each lane's figures and each today's load a placeholder.
        await waitFor(() => expect(main().querySelector("[data-allocation-cell] [data-loading-wash]")).not.toBeNull());
        expect(main().querySelector("[data-allocation-lane] [data-shape]")).not.toBeNull();
        expect(main().querySelector("[data-allocation-resource] [data-allocation-load-pending]")).not.toBeNull();
        // The Table: its bands at once, a placeholder row in each, no row of a slot it has not read.
        await press(within(bar()).getByRole("radio", { name: "Table" }));
        expect(main().querySelector("[data-allocation-unread-row] [data-shape]")).not.toBeNull();
        expect(main().querySelector("[data-allocation-row]")).toBeNull();
        expect(main().textContent).not.toMatch(/Free|Not linked|Committed/);
        // On a phone, the Table's cards and the Timeline's: placeholders where their contents go.
        await width(390);
        expect(main().querySelector("[data-allocation-row-card][data-allocation-unread] [data-shape]")).not.toBeNull();
        await press(within(bar()).getByRole("radio", { name: "Timeline" }));
        expect(main().querySelector("[data-allocation-resource-card][data-allocation-unread] [data-shape]")).not.toBeNull();
        expect(main().textContent).not.toContain("no bins today");
        await width(900);
        // Released, the day lands in place, and its status with it.
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(main().querySelector("[data-allocation-grid]")!.hasAttribute("data-allocation-unread")).toBe(false));
        expect(main().querySelector("[data-loading-wash], [data-allocation-load-pending]")).toBeNull();
        expect(bar().querySelector("[data-allocation-status]")!.hasAttribute("data-pending")).toBe(false);
    });

    test("#1398, CL11 — a day whose read fails once the board has shown keeps its lanes, hours and resources and says so once, across the lane cells of the first row in view, with Retry, and on the footer's line — never `Allocation unavailable`; Retry, the fault gone, lands the day", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        const main = () => slot(container, "main");
        // Every read of the bins and the days fails as e3 fails, for a reason a retry can fix.
        const stop = h.e3.fail(dayRead, { status: 500, type: "internal", message: "the store is down" });
        await key(container, "]"); await key(container, "]");
        const said = () => [...main().querySelectorAll<HTMLElement>("[data-allocation-read-line]")];
        await waitFor(() => expect(said()).toHaveLength(1), { timeout: 15_000 });
        expect(said()[0]!.getAttribute("data-allocation-read-line")).toBe("failed");
        expect(said()[0]!.textContent).toMatch(/^Couldn't read .+Retry$/);
        expect(said()[0]!.style.getPropertyValue("--band-row")).toBe("0");
        expect(container.textContent).not.toContain("Allocation unavailable");
        // Its lanes, hours and resources stay; its lane heads' figures, its lane hours and today's loads blank.
        expect([main().querySelectorAll("[data-allocation-band]").length, main().querySelectorAll("[data-allocation-resource]").length].every(n => n > 0)).toBe(true);
        expect(main().querySelector("[data-allocation-card], [data-loading-wash], [data-allocation-load-pending], [data-allocation-lane] [data-shape]")).toBeNull();
        expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-failed")).toBe(true);
        // The Table says it once too, in its first placeholder row.
        await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Table" }));
        expect(said()).toHaveLength(1);
        expect(said()[0]!.closest("[data-allocation-unread-row]")).not.toBeNull();
        await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Timeline" }));
        stop();
        await act(async () => { fireEvent.click(within(said()[0]!).getByRole("button", { name: "Retry" })); });
        await settle();
        await waitFor(() => expect(said()).toHaveLength(0), { timeout: 15_000 });
        expect(main().querySelector("[data-allocation-grid]")!.hasAttribute("data-allocation-unread")).toBe(false);
    });

    test("#1398, CL13 — a started day with no bins says so once its read lands, across the lane cells of the first row in view, with how to book one: never `Day not started`, nor the narrowing's empty state; its issues' slot held, empty", async () => {
        // Another session takes every bin of Tue 11 off the yard: the day keeps its row, a draft.
        const bins = await h.read(ex.kilnBins);
        for (const [id, bin] of [...bins]) if (compareDate(bin.at, TUE) >= 0 && compareDate(bin.at, WED) < 0) bins.delete(id);
        await h.patch(ex.kilnBins, bins);
        const { container } = await h.mount(ex.allocationKilnYard);
        const said = [...container.querySelectorAll<HTMLElement>("[data-allocation-read-line]")];
        expect(said.map(line => line.getAttribute("data-allocation-read-line"))).toEqual(["empty"]);
        expect(said[0]!.querySelector("[data-loading-empty-message]")!.textContent).toMatch(/^No bins on \S/);
        expect(said[0]!.querySelector("[data-loading-empty-hint]")!.textContent).toBe("· Drag an arrival onto a lane hour");
        expect(status(container)).toBe("Draft");
        expect(container.textContent).not.toContain("Day not started");
        expect(container.querySelector("[data-allocation-narrowed-empty]")).toBeNull();
        const issues = slot(container, "toolbar").querySelector("[data-allocation-issues]")!;
        expect([issues.getAttribute("aria-hidden"), issues.textContent]).toEqual(["true", ""]);
    });

    test("A81 — the issues chip's words: its count of warnings and dangers, its breakdown and `show them`", () => {
        const issue = (kind: "overlap" | "over" | "under", tone: "warning" | "danger" | "neutral") => ({
            kind: variant(kind, null), tone: variant(tone, null), title: "", detail: "", bin: none, resource: none, flag: none, fix: none,
        }) as Issue;
        const custom = { ...issue("over", "neutral"), kind: variant("custom", "Spec mismatch") } as Issue;
        expect(issueSummary([issue("overlap", "warning"), issue("overlap", "warning"), issue("over", "danger"), custom])).toEqual({
            count: 3, label: "3 issues", tip: "2 overlaps · 1 over max · show them", aria: "3 issues, show them",
        });
        expect(issueSummary([issue("under", "warning")]).tip).toBe("1 under min · warnings only, Save still works · show them");
    });
});

/** The view the board keeps for a reload, as storage holds it: its key, and what it keeps. */
function keptView(): { key: string; view: { layout: string; date: number } } {
    const key = Object.keys(localStorage).find(name => name.endsWith(".view"))!;
    return { key, view: JSON.parse(localStorage.getItem(key)!) as { layout: string; date: number } };
}
const printState = printFor(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
/** The bins' source as the page's store holds it: the window the board writes into it, beside its narrowing. */
const binSource = () => printState(decodeState(getStore().read("ex.allocationKilnYard.bin")!));
/** A day, in ms. */
const DAY_MS = 86_400_000;
/** How many reads the board has asked of e3: of a record or a dataset, whole, by its pages, its keys or its runs. */
const readsAsked = () => h.requests().filter(request => READS.has(request.kind) || request.kind === "read").length;

describe("the day is the page's own (#1398)", () => {
    test("another page keeping a view — a second tab on the same board — moves neither this page's day nor the window it writes into its source, and reads nothing for it; a reload opens on the view kept last", async () => {
        const { container, unmount } = await h.mount(ex.allocationKilnYard);
        // A step keeps the view for a reload: the day after, its window written into the bins' source.
        await key(container, "]");
        const before = { day: shownDay(container), source: binSource() };
        const { key: kept, view } = keptView();
        expect(view.date).toBe(before.day);
        // Another page keeps a view three days on, and this page hears it as a browser tells it.
        const theirs = JSON.stringify({ ...view, date: view.date + 3 * DAY_MS });
        const reads = readsAsked();
        await act(async () => {
            const was = localStorage.getItem(kept);
            localStorage.setItem(kept, theirs);
            window.dispatchEvent(new StorageEvent("storage", { key: kept, oldValue: was, newValue: theirs, storageArea: localStorage }));
        });
        await settle();
        expect({ day: shownDay(container), source: binSource() }).toEqual(before);
        expect(readsAsked(), "nothing read for it").toBe(reads);
        expect(localStorage.getItem(kept), "nothing written back over it").toBe(theirs);
        // A reload — a page of its own — opens on the view kept last.
        unmount();
        StateRuntime.initializeStore(new UIStore());
        const reloaded = await h.mount(ex.allocationKilnYard);
        expect(shownDay(reloaded.container)).toBe(view.date + 3 * DAY_MS);
    });
});
