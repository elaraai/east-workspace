/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart over the app's records, mounted (#1245, #1251; `Flowchart
 * Records Spec.md` R1–R3, R5, R13), on e3 itself, over the depot's records
 * (`flowchart.test-utils.tsx`): every payload field decodes, and the flowchart
 * is laid out in its frame — its toolbar's items, the canvas in main, the
 * footer's counts and the records' last save, the panes only when given, LR ·
 * TD and find state, each pick revealing its state; the minimap, shown from
 * 25 states unless the payload says; a kind bound to be edited taking the
 * canvas's gestures, and one read only — `readOnly`, or read whole — taking
 * none; and what the kinds read: a kind read whole is read once, another
 * session's commit drawn in place, and states committed into an empty record
 * drawn. jsdom has no layout: the canvas's box measures 0×0 as it mounts, so
 * the canvas lays out at that size, and the toolbar folds nothing.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringType, compareFor, encodeBeast2For, none, some, variant, type BlockBuilder, type ValueTypeOf } from "@elaraai/east";
import { State, type UIComponentType } from "@elaraai/east-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { getStore, keptName } from "@elaraai/east-ui-components/internal";
import { Data, Flowchart, Record, flowchartKeys } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, flowchartHarness, settle, type FlowchartTestProps } from "./flowchart.test-utils.js";

const h = flowchartHarness();

const compareString = compareFor(StringType);

/** A flowchart's props, made in the Reactive root's body where it binds the records. */
type Props = ($: BlockBuilder<UIComponentType>) => FlowchartTestProps;

/** The depot's states, transitions and lanes, each read whole — read only — and whatever else a test gives. */
const readWhole = (more: Partial<FlowchartTestProps> = {}): Props => ($) => ({
    states: Flowchart.states($.let(Data.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
    transitions: Flowchart.transitions($.let(Data.bind(ex.depotTransitions)), { from: "src", to: "dst", kind: (t) => t.kind }),
    lanes: Flowchart.lanes($.let(Data.bind(ex.depotLanes)), { label: "label", order: "seq" }),
    ...more,
});

/** The depot's four records, each bound to be edited through its patch door, and whatever else a test gives. */
const bound = (more: Partial<FlowchartTestProps> = {}): Props => ($) => ({
    states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
    transitions: Flowchart.transitions($.let(Record.bind(ex.depotTransitions)), { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind }),
    lanes: Flowchart.lanes($.let(Record.bind(ex.depotLanes)), { label: "label", order: "seq" }),
    decisions: Flowchart.decisions($.let(Record.bind(ex.depotDecisions)), { label: (d) => d.name, owner: (d) => some(d.owner) }),
    ...more,
});

/** The depot's freshness chip. */
const FRESHNESS = { label: "evidence-2026.06", date: new Date("2026-06-30T00:00:00Z") };

/** Every state card drawn, by its key, in East's order of keys. */
const stateKeys = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node")!).sort(compareString);

/** A state's card. */
const node = (container: HTMLElement, key: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);

/** Waits until the reader has handed the frame what it read — a state drawn — in a task of its own, and settles. */
async function drawn(container: HTMLElement, key = "ARV"): Promise<void> {
    await waitFor(() => expect(node(container, key)).not.toBeNull());
    await settle();
}

/** The toolbar's items, in the row's order, as the toolbar says it laid them out. */
const toolbarItems = (container: HTMLElement): string[] =>
    (container.querySelector("[data-toolbar]")?.getAttribute("data-toolbar-state") ?? "").split(";").filter((part) => part !== "").map((part) => part.split("=")[0]!);

/** The footer's words. */
const footerText = (container: HTMLElement): string => container.querySelector("[data-frame-slot='footer'] [data-flowchart-footer]")?.textContent ?? "";

/** The inspector's open tab's panel. */
const details = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>("[data-frame-slot='end'] [role='tabpanel']:not([hidden])")!;

/** Every state the depot's record holds, and the ghost of DLV, which `l10` names and no row is keyed by. */
const DEPOT_KEYS = ["ARV", "CH*", "CLR", "DLV", "DSP", "HLD", "IND", "INS", "LBL", "LDD", "RCV", "RSD", "SCN", "SRD"];

describe("EastChakraFlowchart over the app's records", () => {
    test("it mounts, decodes every payload field, and lays the flowchart out in its frame: the toolbar's items, the canvas in main, the footer's counts", async () => {
        const { container } = await h.mountFlowchart(readWhole({ freshness: FRESHNESS, inspector: false }));
        await drawn(container);
        const frame = container.querySelector("[data-flowchart-root] > [data-builder-frame]");
        expect(frame).not.toBeNull();
        // One toolbar, the frame's: find state, LR · TD, the freshness chip — no eyebrow of the canvas's own.
        expect(toolbarItems(container)).toEqual(["seek", "orientation", "freshness"]);
        expect(container.querySelectorAll("[data-toolbar]")).toHaveLength(1);
        expect(frame!.querySelector("[data-frame-slot='toolbar'] [data-toolbar-item='seek'] input")).not.toBeNull();
        const segments = [...container.querySelectorAll("[data-flowchart-seg='orientation'] [role='radio']")];
        expect(segments.map((s) => [s.textContent, s.getAttribute("aria-checked")])).toEqual([["LR", "true"], ["TD", "false"]]);
        const chip = container.querySelector("[data-toolbar-item='freshness'] [data-flowchart-freshness]")!;
        expect(chip.textContent).toBe(`evidence-2026.06${formatters("en-US").monthDay(FRESHNESS.date)}`);
        // The canvas fills main.
        expect(frame!.querySelector("[data-frame-slot='main'] > [data-flowchart-body]")).not.toBeNull();
        expect(stateKeys(container)).toEqual(DEPOT_KEYS);
        // The footer counts the transitions' rows (15, the ↻-folded in-place loop among them); the ghost's counts as unresolved.
        expect(footerText(container).replace(/\s+/g, "")).toMatch(/^15transitions/);
        expect(footerText(container)).toContain("11 planned · 2 observed · 1 unresolved");
        // No pane: no library listed, the inspector taken away.
        expect(frame!.querySelector("[data-frame-slot='start'], [data-frame-slot='end']")).toBeNull();
    });

    test("another session's commit is drawn in place: the same frame, its footer counting the transitions the record holds now", async () => {
        const { container } = await h.mountFlowchart(readWhole());
        await drawn(container);
        const frame = container.querySelector("[data-builder-frame]");
        const transitions = await h.read(ex.depotTransitions);
        await h.patch(ex.depotTransitions, new Map([["l1", transitions.get("l1")!], ["l2", transitions.get("l2")!]]));
        await waitFor(() => expect(footerText(container).replace(/\s+/g, "")).toMatch(/^2transitions/));
        expect(footerText(container)).toContain("2 planned · 0 observed");
        expect(container.querySelector("[data-builder-frame]")).toBe(frame);
    });

    test("a kind bound to be edited takes the canvas's gestures; `readOnly`, or a kind read whole, takes none, and its row's form is printed (#1247, R13)", async () => {
        /**
         * What the canvas and Details offer over a state: + LANE, a lane's ×, the state's handles, its rename, and
         * Details' buttons and fields — the form's fields that take typing, and the values it prints, each in its
         * field's box read only, as the shared form prints a value.
         */
        async function offered(ui: RenderResult) {
            const { container } = ui;
            await drawn(container);
            await act(async () => { fireEvent.click(node(container, "ARV")!); });
            await settle();
            const panel = details(container);
            const fields = [...panel.querySelectorAll<HTMLInputElement>("[data-inspector-form='roles'] input")];
            const said = {
                addLane: container.querySelector("[data-flowchart-addlane]") !== null,
                laneDeletes: container.querySelectorAll("[data-flowchart-lane-delete]").length,
                handles: container.querySelectorAll("[data-flowchart-ports='ARV'] [data-flowchart-handle]").length,
                actions: [...panel.querySelectorAll("[data-inspector-action]")].map((button) => button.getAttribute("data-inspector-action")),
                typed: fields.some((field) => !field.readOnly),
                printed: fields.filter((field) => field.readOnly).map((field) => field.value),
            };
            await act(async () => { fireEvent.doubleClick(node(container, "ARV")!); });
            await settle();
            const renamed = container.querySelector("[data-flowchart-stateeditor]") !== null;
            ui.unmount();
            return { ...said, renamed };
        }
        // Read only, the state's label is printed among its fields, and no field takes typing.
        const none = { addLane: false, laneDeletes: 0, handles: 0, actions: [], typed: false, printed: expect.arrayContaining(["Arrived"]), renamed: false };
        expect(await offered(await h.mountFlowchart(bound())))
            .toEqual({ addLane: true, laneDeletes: 5, handles: 4, actions: ["duplicate", "delete"], typed: true, printed: expect.not.arrayContaining(["Arrived"]), renamed: true });
        expect(await offered(await h.mountFlowchart(bound({ readOnly: true })))).toEqual(none);
        expect(await offered(await h.mountFlowchart(readWhole()))).toEqual(none);
    });

    test("a flowchart without a freshness chip has none on its toolbar, and one over empty records has no find state; the canvas's box stays", async () => {
        await h.patch(ex.depotStates, new Map());
        await h.patch(ex.depotTransitions, new Map());
        const { container } = await h.mountFlowchart(readWhole());
        await waitFor(() => expect(container.querySelectorAll("[data-flowchart-lane]")).toHaveLength(5));
        await settle();
        expect(toolbarItems(container)).toEqual(["orientation"]);
        expect(stateKeys(container)).toEqual([]);
        // The canvas's box stays in main, measured, for the states that come.
        expect(container.querySelector("[data-frame-slot='main'] > [data-flowchart-body]")).not.toBeNull();
    });

    test("states committed into a record that was empty are drawn: the canvas's box was measured while it was empty", async () => {
        const states = await h.read(ex.depotStates);
        await h.patch(ex.depotStates, new Map());
        await h.patch(ex.depotTransitions, new Map());
        const { container } = await h.mountFlowchart(readWhole());
        await waitFor(() => expect(container.querySelectorAll("[data-flowchart-lane]")).toHaveLength(5));
        expect(stateKeys(container)).toEqual([]);
        await h.patch(ex.depotStates, states);
        await waitFor(() => expect(stateKeys(container)).toEqual(DEPOT_KEYS.filter((key) => key !== "DLV")));
    });

    test("a kind read whole is read once, whole, where the flowchart renders: one read of each record, and no page of it (R5)", async () => {
        const { container } = await h.mountFlowchart(readWhole());
        await drawn(container);
        const reads = [ex.depotStates, ex.depotTransitions, ex.depotLanes].map((record) => {
            const of = `records.${record.name}`;
            return [record.name, h.requests("read", of).length, h.requests("page", of).length];
        });
        expect(reads).toEqual([[ex.depotStates.name, 1, 0], [ex.depotTransitions.name, 1, 0], [ex.depotLanes.name, 1, 0]]);
    });
});

describe("LR · TD and find state (#1245)", () => {
    /** Each lane header's anchor: middle across the top in LR, start down the side in TD. */
    const anchors = (container: HTMLElement) => [...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.getAttribute("text-anchor"));

    test("LR · TD turns the canvas: a pick checks its segment and lays the lanes out down the side", async () => {
        const { container } = await h.mountFlowchart(readWhole());
        await drawn(container);
        expect(anchors(container)).toEqual(Array(5).fill("middle"));
        await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "TD" })); });
        expect(screen.getByRole("radio", { name: "TD" }).getAttribute("aria-checked")).toBe("true");
        expect(anchors(container)).toEqual(Array(5).fill("start"));
    });

    test("the host's orientation seeds LR · TD, and a new one from the host turns the canvas again", async () => {
        const KEY = "flowchart.dom.orientation";
        const { container } = await h.mountFlowchart(($) => {
            const orientation = $.let(State.bind([Flowchart.Types.Orientation], KEY, variant("TD", null)));
            return { ...readWhole()($), orientation: orientation.read() };
        });
        await drawn(container);
        expect(screen.getByRole("radio", { name: "TD" }).getAttribute("aria-checked")).toBe("true");
        expect(anchors(container)).toEqual(Array(5).fill("start"));
        const encode = encodeBeast2For(Flowchart.Types.Orientation);
        await act(async () => { getStore().write(KEY, encode(variant("LR", null))); });
        await settle();
        await waitFor(() => expect(anchors(container)).toEqual(Array(5).fill("middle")));
        expect(screen.getByRole("radio", { name: "LR" }).getAttribute("aria-checked")).toBe("true");
    });

    test("find state finds the drawn states by key and by label, and a pick selects the state and shows its key in the box", async () => {
        const { container } = await h.mountFlowchart(readWhole());
        await drawn(container);
        const box = within(container).getByPlaceholderText<HTMLInputElement>("Find state");
        await userEvent.click(box);
        // Opened, it lists every state drawn, in their keys' order — the ghost is no state to find.
        await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
            "ARV · Arrived", "CH* · Sort chutes (class)", "CLR · Cleared", "DSP · Dispatched", "HLD · Held", "IND · Inducted", "INS · Inspected",
            "LBL · Relabelled", "LDD · Loaded", "RCV · Received", "RSD · Resent", "SCN · Scanned", "SRD · Sorted",
        ]));
        // Each query is entered as one change. Zag takes a keystroke a microtask after its event, and a script's next
        // keystroke comes as soon as that event is over: React renders the first later, and its write of the box's text
        // can land after the next keystroke, which a script then types onto the text before it ("sor" read "sr").
        fireEvent.change(box, { target: { value: "sor" } });
        // Two labels hold the text, in their keys' order.
        await waitFor(() => expect(within(container).getByText("2 matches")).toBeTruthy());
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["CH* · Sort chutes (class)", "SRD · Sorted"]);
        fireEvent.click(screen.getByRole("option", { name: "CH* · Sort chutes (class)" }));
        await waitFor(() => expect(node(container, "CH*")!.hasAttribute("data-selected")).toBe(true));
        // The box shows what the pick found: its state's key, never its line.
        await waitFor(() => expect(box.value).toBe("CH*"));
        // A key's start: one state. Each query's own count says its answer landed: the list before it may hold the same line.
        fireEvent.change(box, { target: { value: "SR" } });
        await waitFor(() => expect(within(container).getByText("1 match")).toBeTruthy());
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["SRD · Sorted"]);
        fireEvent.click(screen.getByRole("option", { name: "SRD · Sorted" }));
        await waitFor(() => expect(node(container, "SRD")!.hasAttribute("data-selected")).toBe(true));
        await waitFor(() => expect(box.value).toBe("SRD"));
        // Each pick reveals its state: a second selects the state it lands on.
        fireEvent.change(box, { target: { value: "indu" } });
        await waitFor(() => expect(within(container).getByText("1 match")).toBeTruthy());
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["IND · Inducted"]);
        fireEvent.click(screen.getByRole("option", { name: "IND · Inducted" }));
        await waitFor(() => expect(node(container, "IND")!.hasAttribute("data-selected")).toBe(true));
        expect(node(container, "SRD")!.hasAttribute("data-selected")).toBe(false);
        // Nothing found: the Flowchart's words, never the key search's hint that keys are case-sensitive.
        fireEvent.change(box, { target: { value: "zzzz" } });
        await waitFor(() => expect(within(container).getAllByText("No matches").length).toBeGreaterThan(0));
        expect(screen.queryByText(/Keys are case-sensitive/)).toBeNull();
    });
});

describe("the minimap (#1251)", () => {
    /** `n` states over two lanes, in a flow of their own. */
    const crowded = (n: number): Map<string, ValueTypeOf<typeof ex.DepotState>> => new Map(Array.from({ length: n }, (_x, i) => [
        `CH${i + 1}`, { name: `Chute ${i + 1}`, phase: i % 2 === 0 ? "sort" : "dispatch", seq: i + 1, slots: none, flow: "Parcels" },
    ] as const));
    /** The states and the lanes, read whole: no transition, so no ghost. */
    const statesAndLanes = (more: Partial<FlowchartTestProps> = {}): Props => ($) => ({
        states: Flowchart.states($.let(Data.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq" }),
        lanes: Flowchart.lanes($.let(Data.bind(ex.depotLanes)), { label: "label", order: "seq" }),
        ...more,
    });
    /** The minimap, over the canvas in main. */
    const minimap = (container: HTMLElement): Element | null => container.querySelector("[data-frame-slot='main'] [data-flowchart-body] [data-flowchart-minimap]");

    test("left out, it shows once the flowchart draws 25 states: 24 draw none, and the 25th another session commits draws it", async () => {
        await h.patch(ex.depotStates, crowded(24));
        const { container } = await h.mountFlowchart(statesAndLanes());
        await drawn(container, "CH24");
        expect(minimap(container)).toBeNull();
        await h.patch(ex.depotStates, crowded(25));
        await waitFor(() => expect(node(container, "CH25")).not.toBeNull());
        expect(minimap(container)).not.toBeNull();
    });

    test("given, it holds whatever the count: `false` draws none at 25 states, and `true` draws it over the depot's", async () => {
        const depot = await h.read(ex.depotStates);
        await h.patch(ex.depotStates, crowded(25));
        const shut = await h.mountFlowchart(statesAndLanes({ minimap: false }));
        await drawn(shut.container, "CH25");
        expect(minimap(shut.container)).toBeNull();
        shut.unmount();
        await h.patch(ex.depotStates, depot);
        const { container } = await h.mountFlowchart(readWhole({ minimap: true }));
        await drawn(container);
        expect(minimap(container)).not.toBeNull();
    });
});

describe("the frame's panes and footer (#1245)", () => {
    /** The depot's records read whole, the library one author's tab — the decisions' owners — and the flowchart's name. */
    const owned = (name: string): Props => ($) => {
        const owners = $.let(Data.bind(ex.decisionOwners));
        return {
            states: Flowchart.states($.let(Data.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq" }),
            transitions: Flowchart.transitions($.let(Data.bind(ex.depotTransitions)), { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind }),
            lanes: Flowchart.lanes($.let(Data.bind(ex.depotLanes)), { label: "label", order: "seq" }),
            decisions: Flowchart.decisions($.let(Data.bind(ex.depotDecisions)), { label: (d) => d.name, owner: (d) => some(d.owner) }),
            library: [Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => Flowchart.patch(ex.DepotDecision, { owner: o.name }),
            })],
            name,
        };
    };

    test("a library that lists tabs is the start pane, its tabs in order, each counting its cards; the inspector is the end pane", async () => {
        const { container } = await h.mountExample(ex.flowchartDepot);
        await drawn(container);
        const start = container.querySelector("[data-frame-slot='start']")!;
        // Each kind's tab counts its cards (R14); the author's tab its rows.
        await waitFor(() => expect([...start.querySelectorAll("[role='tab']")].map((t) => t.textContent)).toEqual(["Steps 3", "Transitions 3", "Lanes 2", "Owners 3"]));
        // The inspector's tabs (#1250): Details, and Issues with its count — DLV, the end no state is keyed by.
        expect([...container.querySelectorAll("[data-frame-slot='end'] [role='tab']")].map((t) => t.textContent)).toEqual(["Details", "Issues 1"]);
    });

    test("the panes' collapsed state is kept under the flowchart's name", async () => {
        const collapsed = (container: HTMLElement) => container.querySelector("[data-frame-slot='start'] [data-collapsed]") !== null;
        const first = await h.mountFlowchart(owned("depot"));
        await drawn(first.container);
        expect(collapsed(first.container)).toBe(false);
        await act(async () => { fireEvent.click(within(first.container).getByRole("button", { name: "Collapse Library" })); });
        expect(collapsed(first.container)).toBe(true);
        expect(Object.keys(localStorage).some((key) => key.startsWith(keptName(`${flowchartKeys("depot").frame}.start`)))).toBe(true);
        first.unmount();
        // Mounted again under its name, it opens as the viewer left it; another flowchart keeps its own.
        const again = await h.mountFlowchart(owned("depot"));
        await drawn(again.container);
        expect(collapsed(again.container)).toBe(true);
        again.unmount();
        const other = await h.mountFlowchart(owned("returns"));
        await drawn(other.container);
        expect(collapsed(other.container)).toBe(false);
    });

    test("over records bound to be edited, the footer says when they were last saved — today its time, another day its date and its time; over records read whole, nothing (R15)", async () => {
        const states = await h.read(ex.depotStates);
        await h.patch(ex.depotStates, new Map([...states, ["SCN", { ...states.get("SCN")!, name: "Scanned twice" }]]));
        const [newest] = (await h.history(ex.depotStates)).commits;
        const saved = (container: HTMLElement) => container.querySelector("[data-flowchart-saved]")?.textContent ?? null;
        const today = await h.mountFlowchart(bound());
        await drawn(today.container);
        await waitFor(() => expect(saved(today.container)).toBe(` · Saved ${formatters("en-US").time(newest!.at)}`));
        today.unmount();
        // Two days on, the same save: its date and its time.
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        try {
            vi.setSystemTime(new Date(newest!.at.getTime() + 2 * 24 * 60 * 60 * 1000));
            const later = await h.mountFlowchart(bound());
            await drawn(later.container);
            await waitFor(() => expect(saved(later.container)).toBe(` · Saved ${formatters("en-US").dateTime(newest!.at)}`));
            later.unmount();
        } finally {
            vi.useRealTimers();
        }
        // Read whole, a kind has no history: no save to say.
        const { container } = await h.mountFlowchart(readWhole());
        await drawn(container);
        expect(saved(container)).toBeNull();
    });
});
