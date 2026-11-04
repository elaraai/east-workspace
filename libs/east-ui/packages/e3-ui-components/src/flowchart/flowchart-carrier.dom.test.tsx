/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart through its carrier (#1243, #1500; `Flowchart Records Spec.md`
 * R1–R3, R13). `<Flowchart>` returns the flowchart as the `Flowchart`
 * extension — its payload's bytes beside its kind — and the dispatcher hands
 * it to the renderer registered against that kind, decoding the payload's
 * functions against the registered platform: each kind's rows, read from the
 * depot's records on e3 itself — whole, or through its source of the rail; a
 * state's own Details, its kind's `inspector`, which return UI for the
 * inspector; and a select callback, which writes a bound State. Every
 * flowchart here is built by `<Flowchart>` over the app's records, compiled,
 * and rendered through the dispatcher, as an app renders it — and one given a
 * callback for an edit, or a hover card's builder, is refused as it is built.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, FunctionType, NullType, StringType, StructType, compareFor, encodeBeast2For } from "@elaraai/east";
import { State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { programOf } from "../e3-web-mount.test-utils.js";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();

const encodeString = encodeBeast2For(StringType);
const compareString = compareFor(StringType);

/** Every state card drawn, by its key. */
const stateKeys = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node") ?? "");

/** The footer's words. */
const footerText = (container: HTMLElement): string => container.querySelector("[data-frame-slot='footer'] [data-flowchart-footer]")?.textContent ?? "";

/** The depot's states, transitions and lanes, each read whole: a flowchart `<Flowchart>` builds alone, in no Reactive root. */
const view = East.function([], UIComponentType, ($) => {
    const states = $.let(Data.bind(ex.depotStates));
    const transitions = $.let(Data.bind(ex.depotTransitions));
    const lanes = $.let(Data.bind(ex.depotLanes));
    return Flowchart({
        states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
        transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind }),
        lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }),
    });
});

/** What a State holds now. */
const stateOf = (key: string) => East.compile(East.function([], StringType, ($) => {
    const bound = $.const(State.bind([StringType], key, ""));
    return bound.read();
}), getRegisteredPlatformImplementations())();

describe("<Flowchart> through its carrier (#1243, #1500)", () => {
    test("the flowchart is the Flowchart extension — its payload carried as bytes beside its kind — and the dispatcher draws it in its frame", async () => {
        // Built under the runtimes a surface installs, what it reads whole loaded.
        const leave = await h.install({ fn: view });
        const value = programOf({ fn: view })();
        leave();
        if (value.type !== "Extension") throw new Error(`expected the Flowchart extension, got the ${value.type} arm`);
        expect(value.value.kind).toBe("Flowchart");
        const { container } = await h.mount({ fn: view });
        // Every state the record holds, and the ghost of the one transition l10 names that no row is keyed by.
        await waitFor(() => expect(stateKeys(container)).toHaveLength(14));
        expect(container.querySelector('[data-flowchart-node="SCN"]')!.textContent).toContain("Scanned");
        // In its frame (#1245): the canvas in main, the counts in the frame's footer.
        expect(container.querySelector("[data-builder-frame] [data-frame-slot='main'] [data-flowchart-node='SCN']")).not.toBeNull();
        expect(footerText(container)).toContain("11 planned · 2 observed · 1 unresolved");
    });

    test("over records bound to be edited, the decoded kinds read the states and the transitions through their sources of the rail, and the lanes and the decisions whole", async () => {
        const { container } = await h.mountExample(ex.flowchartDepot);
        // The rail opens on the parcels' flow: its ten states, and the ghost of DLV; the returns' are not read.
        await waitFor(() => expect(stateKeys(container)).toContain("DSP"));
        expect(stateKeys(container).sort(compareString)).toEqual(["ARV", "CH*", "CLR", "DLV", "DSP", "HLD", "IND", "LBL", "LDD", "SCN", "SRD"]);
        expect(container.querySelector('[data-flowchart-node="CH*"]')!.textContent).toContain("×14");
        // The parcels' thirteen transitions, the decisions' diamonds on the two they govern, the five lanes.
        expect(footerText(container)).toContain("9 planned · 2 observed · 1 unresolved");
        expect(container.querySelectorAll("[data-flowchart-trigger]")).toHaveLength(2);
        expect(container.querySelectorAll("[data-flowchart-lane]")).toHaveLength(5);
    });
});

// ── Functions across the carrier ────────────────────────────────────────────

const LABEL_KEY = "flowchart.carrier.label";
const SELECTED_KEY = "flowchart.carrier.selected";

/**
 * A Reactive flowchart over the depot's records: the states' own Details (their
 * kind's `inspector`) build UI from the label READ from State — a value, not
 * the handle — and a state's click writes its key to State. A label write
 * builds the same records' flowchart again, its own Details capturing another
 * label.
 */
function mountReactive() {
    return h.mountFlowchart(($) => {
        const labelBind = $.let(State.bind([StringType], LABEL_KEY, "ALPHA"));
        const label = $.const(labelBind.read());
        const selected = $.let(State.bind([StringType], SELECTED_KEY, ""));
        const own = $.const(East.function([ex.DepotState, FunctionType([ex.DepotState], NullType)], UIComponentType,
            (_$2, row) => Text.Root(East.str`${label} · ${row.name}`)));
        return {
            states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq", inspector: own }),
            transitions: Flowchart.transitions($.let(Data.bind(ex.depotTransitions)), { from: "src", to: "dst", kind: (t) => t.kind }),
            lanes: Flowchart.lanes($.let(Data.bind(ex.depotLanes)), { label: "label", order: "seq" }),
            onSelectState: selected.write,
        };
    });
}

describe("functions across the carrier (#1243)", () => {
    test("a state's click calls the decoded onSelectState, which writes the bound State", async () => {
        const { container } = await mountReactive();
        await waitFor(() => expect(stateKeys(container)).toContain("SCN"));
        await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-node="SCN"]')!); });
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe("SCN"));
    });

    test("a state's own Details, decoded across the carrier, build the inspector's UI over the state selected, and a closure-only change builds them again (#1250, R13)", async () => {
        const { container } = await mountReactive();
        await waitFor(() => expect(stateKeys(container)).toContain("ARV"));
        const own = () => container.querySelector("[data-frame-slot='end'] [data-inspector-fields='custom']")?.textContent ?? null;
        await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-node="ARV"]')!); });
        await waitFor(() => expect(own()).toBe("ALPHA · Arrived"));
        // Only the function's capture moves: the records are the same, the flowchart's memo (`equivalentFor`) lets it
        // through, and the state's own Details build again with the new label.
        await act(async () => { getStore().write(LABEL_KEY, encodeString("BETA")); });
        await settle();
        await waitFor(() => expect(own()).toBe("BETA · Arrived"));
    });
});

describe("no callback for an edit, and no hover card (#1247, #1250)", () => {
    test("`<Flowchart>` given a callback it took for an edit, or `linkMode`, is refused as the surface is built, naming the editing session", () => {
        const given = {
            onAddState: East.function([StructType({ lane: StringType, key: StringType, label: StringType })], NullType, (_$) => null),
            onCreateLink: East.function([StructType({ from: StringType, to: StringType })], NullType, (_$) => null),
            linkMode: "connect",
        };
        for (const [prop, value] of Object.entries(given)) {
            const built = () => East.function([], UIComponentType, ($) => Flowchart({
                states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name" }),
                [prop]: value,
            } as never));
            expect(built).toThrow(`Flowchart: \`${prop}\` is gone — every gesture is a transaction of the Flowchart's editing session, and Save writes ` +
                "each record through its patch door — bind a kind with Record.bind(record), its record declaring patch: mutation.patch(), to edit it");
        }
    });

    test("`<Flowchart>` given a hover card's builder is refused as the surface is built, naming the inspector and a kind's own Details", () => {
        for (const prop of ["stateHover", "linkHover", "triggerHover"]) {
            const built = () => East.function([], UIComponentType, ($) => Flowchart({
                states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name" }),
                [prop]: East.function([StringType], UIComponentType, (_$, key) => Text.Root(key)),
            } as never));
            expect(built).toThrow(`Flowchart: \`${prop}\` is gone — the inspector shows what is selected, and a kind's own Details is its kind's \`inspector\`: ` +
                "Flowchart.states(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })");
        }
    });
});
