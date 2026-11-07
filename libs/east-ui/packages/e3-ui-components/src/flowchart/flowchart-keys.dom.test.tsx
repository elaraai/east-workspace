/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart over records keyed by number (#1549), on e3 itself: a bakery's
 * line (`flowchart-keys.fixtures.ts`) — its stations, its steps and its moves
 * each keyed by number. Every key travels as its text; the renderer orders and
 * seeks the keys at their type, never by their texts, which would put 10
 * before 2.
 *
 * - **The order**: the stations stand 2, 9, 10, and the bench's steps — none
 *   with an order of its own — Weigh, Proof and Mix, 2, 9, 10.
 * - **Issues** lists the moves each leaving a step for one no step is
 *   numbered by their numbers: 2, 9, then 10.
 * - **Find state** reads what is typed as a number: `10` finds step 10 and
 *   `2..11` the steps from 2 up to 11, in their numbers' order — among the
 *   steps drawn where they are read whole, and in their record through e3
 *   where the rail reads them — and a name is no number, which the box says.
 */

import { expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatType, compareFor, type BlockBuilder } from "@elaraai/east";
import { Slice, type UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Flowchart } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/flowchart/flowchart-keys";
import { slot } from "../e3-web-mount.test-utils.js";
import { act, flowchartHarness, settle, type FlowchartTestProps } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness({ "flowchart/flowchart-keys.fixtures": fx });

const m = flowchartMessages;
const compareFloat = compareFor(FloatType);

/** The steps' record, as its dataset's requests name it. */
const STEPS = `records.${fx.keyedSteps.name}`;

/** The line read whole: its stations, its steps and its moves. */
const whole = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const steps = $.let(Data.bind(fx.keyedSteps));
    const moves = $.let(Data.bind(fx.keyedMoves));
    const stations = $.let(Data.bind(fx.keyedStations));
    return {
        states: Flowchart.states(steps, { label: "name", lane: "station" }),
        transitions: Flowchart.transitions(moves, { from: "from", to: "to" }),
        lanes: Flowchart.lanes(stations, { label: "label" }),
    };
};

/** The line, its steps read through their source of the rail. */
const railed = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const slice = $.let(Slice.bindRecords("flowchart.keyed", {
        states: { source: Data.bindPaged(fx.keyedSteps, { indexes: ["flowchart_keyed_steps_by_station"] }) },
    }));
    const steps = $.let(Data.bindPaged(fx.keyedSteps));
    const stations = $.let(Data.bind(fx.keyedStations));
    return {
        slice: { slice },
        states: Flowchart.states(steps, { label: "name", lane: "station" }),
        lanes: Flowchart.lanes(stations, { label: "label" }),
    };
};

/** A step's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);

/** The lanes the canvas draws a header for, by key, in its order. */
const laneKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane-head]")].map((el) => el.getAttribute("data-flowchart-lane-head"));

/** Where the canvas places a card. */
const placeOf = (card: HTMLElement): { readonly top: number; readonly left: number } => ({ top: parseFloat(card.style.top), left: parseFloat(card.style.left) });

/** Some cards of one lane, by key, in the order they stand along it: by where the canvas places each. */
const standing = (c: HTMLElement, keys: readonly string[]): string[] => keys.map((key) => ({ key, at: placeOf(node(c, key)!) }))
    .sort((a, b) => compareFloat(a.at.top, b.at.top) || compareFloat(a.at.left, b.at.left))
    .map(({ key }) => key);

/** The inspector's open tab. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** Issues, each as it reads: what it names, and what it says. */
const issues = (c: HTMLElement): (string | null)[][] => [...panel(c).querySelectorAll("[data-inspector-issue]")]
    .map((el) => [el.querySelector("span:first-child")?.textContent ?? null, el.querySelector("[data-kind]")?.textContent ?? null]);

/** Find's lines, as they read. */
const lines = (): (string | null)[] => screen.getAllByRole("option").map((option) => option.textContent);

/** Mounts a line and waits until the canvas draws step 10. */
async function open(props: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps): Promise<HTMLElement> {
    const { container } = await h.mountFlowchart(props);
    await waitFor(() => expect(node(container, "10")).not.toBeNull());
    await settle();
    return container;
}

test("the stations stand by their numbers — 2, 9, 10 — and the bench's steps, none with an order of its own, Weigh, Proof and Mix by theirs (#1549)", async () => {
    const c = await open(whole);
    expect(laneKeys(c)).toEqual(["2", "9", "10"]);
    expect(standing(c, ["10", "2", "9"])).toEqual(["2", "9", "10"]);
});

test("Issues lists the moves each leaving a step for one no step is numbered, by their numbers: 2, 9, then 10 (#1549)", async () => {
    const c = await open(whole);
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((each) => each.textContent?.startsWith(m.inspectorTab({ tab: "issues" })));
    if (tab === undefined) throw new Error("the inspector holds no Issues tab");
    await act(async () => { fireEvent.click(tab); });
    await settle();
    expect(issues(c)).toEqual([["2", "77"], ["9", "78"], ["10", "79"]].map(([from, to]) => {
        const link = `${from!} → ${to!}`;
        return [m.issueWhere({ kind: "Transition", name: link }), m.issueText({ issue: "end", link, missing: [to!] })];
    }));
});

test("read whole, Find state reads what is typed as a number among the steps drawn: `10` finds step 10, `2..11` the steps from 2 up to 11 in their numbers' order, and a name is no number (#1549)", async () => {
    const c = await open(whole);
    // The box says what it reads a key as.
    const box = within(c).getByPlaceholderText<HTMLInputElement>("Find state (Integer)");
    await userEvent.click(box);
    fireEvent.change(box, { target: { value: "10" } });
    await waitFor(() => expect(within(c).getByText("1 match")).toBeTruthy());
    expect(lines()).toEqual(["10 · Mix"]);
    fireEvent.change(box, { target: { value: "2..11" } });
    await waitFor(() => expect(within(c).getByText("3 matches")).toBeTruthy());
    expect(lines()).toEqual(["2 · Weigh", "9 · Proof", "10 · Mix"]);
    // A pick selects the step, and the box shows its number.
    fireEvent.click(screen.getByRole("option", { name: "9 · Proof" }));
    await waitFor(() => expect(node(c, "9")!.hasAttribute("data-selected")).toBe(true));
    await waitFor(() => expect(box.value).toBe("9"));
    // A name is no step's number: the box says what a key is.
    fireEvent.change(box, { target: { value: "Mix" } });
    await waitFor(() => expect(within(c).getAllByText("Key is Integer").length).toBeGreaterThan(0));
});

test("read through the rail, Find state seeks the steps' record through e3 at their numbers: `10` is one step, and `2..11` those from 2 up to 11 (#1549)", async () => {
    const c = await open(railed);
    const before = h.requests("find", STEPS).length;
    const box = within(c).getByPlaceholderText<HTMLInputElement>("Find state (Integer)");
    await userEvent.click(box);
    fireEvent.change(box, { target: { value: "10" } });
    await waitFor(() => expect(lines()).toEqual(["10 · Mix"]), { timeout: 5_000 });
    // Sought in the record through e3.
    expect(h.requests("find", STEPS).length).toBeGreaterThan(before);
    fireEvent.change(box, { target: { value: "2..11" } });
    await waitFor(() => expect(lines()).toEqual(["2 · Weigh", "9 · Proof", "10 · Mix"]), { timeout: 5_000 });
    fireEvent.click(screen.getByRole("option", { name: "10 · Mix" }));
    await waitFor(() => expect(node(c, "10")!.hasAttribute("data-selected")).toBe(true));
});
