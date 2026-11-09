/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The record the Roster's check reads beside its duties (#1551), on e3: the
 * rota, the first step's answer, the slice's `reference` source. The Roster
 * writes its week into it as into the duties' source, and the check is given
 * that week's lines — read through the rota's interval index, never the record
 * whole — which nothing draws: the rail offers none of the rota. Another
 * session's change of the rota reaches the check, the check's fix moves a duty
 * to its line's shift, and a read of the rota that fails is the week's, said
 * once with Retry.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, equalFor } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { editingMessages, type UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, open, press, rosterHarness, settle, slot } from "./harness.test-utils.js";

const h = rosterHarness();
/** The rota, as the request log names its dataset. */
const ROTA = `records.${ex.rosterRotaLines.name}`;
/** A read of the rota — a page, a key search, a read of runs or of rows by key. */
const READS = new Set(["page", "find", "runs", "rows"]);
const rotaRead = (request: E3Request) => READS.has(request.kind) && request.dataset === ROTA;
const decodeState = decodeBeast2For(RecordSliceStateType);
const sameChoice = equalFor(RecordSliceStateType.fields.where.value);
/** The week each source holds, as the example's store keeps it: the duties' and the rota's, each under its `start`. */
const windows = (store: UIStore) => ({
    duties: decodeState(store.read("ex.rosterRota.duty")!).where.get("start"),
    rota: decodeState(store.read("ex.rosterRota.reference")!).where.get("start"),
});
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
/** A week's step, `]` on or `[` back, as the viewer's key. */
async function step(c: HTMLElement, key: "[" | "]") { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); }); await settle(); }
/** Opens the Inspector's Issues tab. */
const issuesTab = (c: HTMLElement) => press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
/** The check's issues over the rota the Issues tab lists: each its title, its detail and its fix's button, if it offers one. */
const rotaIssues = (c: HTMLElement) => [...slot(c, "end").querySelectorAll<HTMLElement>("[data-roster-issue]")]
    .map(issue => [issue.children[0]?.textContent ?? null, issue.children[1]?.textContent ?? null, issue.children[2]?.querySelector("button")?.textContent ?? null])
    .filter(([title]) => title?.startsWith("Rota line") === true);
/** What the check finds over the week of Mon 6 Mar 2028: Mia Hart's Wednesday moved to the late, her Friday taken off, and Ben Moss's Monday late, which no duty carries out. */
const CHANGED = ["Rota line changed", "The rota has Mia Hart on Late now", "Move to Late"];
const GONE = ["Rota line gone", "The rota no longer has Mia Hart on this shift", null];
const MISSING = ["Rota line not on the board", "Ben Moss · Mon Late", null];

describe("the rota the check reads beside the duties (#1551)", () => {
    test("the Roster writes its week into the rota's source as into the duties', and a step of the week moves both", async () => {
        const { container: c, store } = await open(ex.rosterRota);
        const first = windows(store);
        expect(first.duties).toBeDefined();
        expect(sameChoice(first.rota!, first.duties!)).toBe(true);
        await press(toolbar(c).getByRole("button", { name: "Next week" }));
        const next = windows(store);
        expect(sameChoice(next.rota!, next.duties!)).toBe(true);
        expect(sameChoice(next.rota!, first.rota!)).toBe(false);
        await press(toolbar(c).getByRole("button", { name: "Previous week" }));
        expect(sameChoice(windows(store).rota!, first.rota!)).toBe(true);
    });

    test("the check is given the week's lines alone: a duty whose line changed, its fix the line's shift; one whose line is gone; a line no duty carries out — and the next week's are the next week's", async () => {
        const { container: c } = await open(ex.rosterRota);
        await issuesTab(c);
        expect(rotaIssues(c)).toHaveLength(3);
        expect(rotaIssues(c)).toEqual(expect.arrayContaining([CHANGED, GONE, MISSING]));
        // The rota holds one week: the next has no line of it, and no duty over it.
        await press(toolbar(c).getByRole("button", { name: "Next week" }));
        expect(rotaIssues(c)).toEqual([]);
        await press(toolbar(c).getByRole("button", { name: "Previous week" }));
        expect(rotaIssues(c)).toEqual(expect.arrayContaining([CHANGED, GONE, MISSING]));
    });

    test("the rota is read through its interval index, never the record whole", async () => {
        const { container: c } = await open(ex.rosterRota);
        await press(toolbar(c).getByRole("button", { name: "Next week" }));
        expect(h.requests("find", ROTA).length).toBeGreaterThan(0);
        expect(h.requests("read", ROTA)).toEqual([]);
        expect(h.requests("find", ROTA).filter(request => request.query.get("index") !== "roster_rota_lines_by_time")).toEqual([]);
    });

    test("another session's change of the rota reaches the check: Mia Hart's Wednesday back on the early, her duty's line is as the duty has it", async () => {
        const { container: c } = await open(ex.rosterRota);
        await issuesTab(c);
        expect(rotaIssues(c)).toEqual(expect.arrayContaining([CHANGED]));
        const duty = (await h.read(ex.rosterBoardDuties)).get("wed-w-03")!;
        const rota = new SortedMap(await h.read(ex.rosterRotaLines), compareFor(StringType));
        rota.set("wed-w-03", { person: duty.person, shift: duty.shift, start: duty.start, end: duty.end });
        await h.patch(ex.rosterRotaLines, rota);
        await waitFor(() => expect(rotaIssues(c)).toHaveLength(2), { timeout: 15_000 });
        expect(rotaIssues(c)).toEqual(expect.arrayContaining([GONE, MISSING]));
    });

    test("the check's fix moves the duty to its line's shift: its issue goes, and Save writes the duty's shift", async () => {
        const { container: c } = await open(ex.rosterRota);
        await issuesTab(c);
        const changed = [...slot(c, "end").querySelectorAll<HTMLElement>("[data-roster-issue]")].find(issue => issue.children[0]?.textContent === "Rota line changed")!;
        await press(within(changed).getByRole("button", { name: "Move to Late" }));
        expect(rotaIssues(c)).toHaveLength(2);
        expect(rotaIssues(c)).toEqual(expect.arrayContaining([GONE, MISSING]));
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        expect((await h.read(ex.rosterBoardDuties)).get("wed-w-03")!.shift).toBe("late");
    });

    test("a read of the rota that fails is the week's: said once, with Retry, on the board and on the footer's line; Retry, the fault gone, lands the week", async () => {
        const { container: c } = await open(ex.rosterRota);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        const said = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-read-line]")];
        const stop = h.e3.fail(rotaRead, { status: 500, type: "internal", message: "the rota is down" });
        // Two weeks on: a week the Roster has not read ahead.
        await step(c, "]"); await step(c, "]");
        await waitFor(() => expect(said()).toHaveLength(1), { timeout: 15_000 });
        expect(said()[0]!.textContent).toMatch(/^Couldn't read .+Retry$/);
        expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-failed")).toBe(true);
        stop();
        await act(async () => { fireEvent.click(within(said()[0]!).getByRole("button", { name: "Retry" })); });
        await settle();
        await waitFor(() => expect(said()).toHaveLength(0), { timeout: 15_000 });
        expect(slot(c, "main").querySelector("[data-roster-unread]")).toBeNull();
    });

    test("nothing draws the rota: the rail names no source of it", async () => {
        const { container: c } = await open(ex.rosterRota);
        expect(document.querySelector('[data-record-slice-source="reference"]')).toBeNull();
        await press(toolbar(c).getByRole("button", { name: "Next week" }));
        expect(document.querySelector('[data-record-slice-source="reference"]')).toBeNull();
    });
});
