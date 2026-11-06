/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's reader (`read.ts`, #1502, `Flowchart Records Spec.md` R5)
 * over the depot's records, on e3 itself (`flowchart.test-utils.tsx`): it
 * hands the frame what it read only as that moves. The frame renders the
 * reader again each time it takes what it is handed, so a reader handing a
 * new object at every render would never stop: rendered again over the same
 * rows it hands nothing, and each hand-over as the records change says
 * something new.
 */

import { useMemo, useState } from "react";
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor } from "@elaraai/east";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, flowchartHarness, settle } from "./flowchart.test-utils.js";
import { FlowchartDataReader, type FlowchartData } from "./read.js";

const h = flowchartHarness();

const compareString = compareFor(StringType);

/** The depot's states, transitions and lanes, bound as an app binds them, through the Flowchart's payload. */
const payload = East.function([], Flowchart.Types.Payload, ($) => Flowchart.Payload({
    states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
    transitions: Flowchart.transitions($.let(Record.bind(ex.depotTransitions)), { from: "src", to: "dst", kind: (t) => t.kind }),
    lanes: Flowchart.lanes($.let(Record.bind(ex.depotLanes)), { label: "label", order: "seq" }),
}));

/**
 * The reader as the frame holds it, over the payload built under the runtimes a surface installs: `onData` hears each
 * hand-over, and a button renders it again, as the frame does each time it takes one.
 */
function Reader({ onData }: { onData: (data: FlowchartData) => void }) {
    const value = useMemo(() => payload.toIR().compile(getRegisteredPlatformImplementations())(), []);
    const [renders, setRenders] = useState(0);
    return (
        <>
            <button type="button" data-renders={renders} onClick={() => setRenders((n) => n + 1)}>Render again</button>
            <FlowchartDataReader value={value} attempt={0} onData={onData} />
        </>
    );
}

/** Whether two hand-overs say the same: what is held, hidden with its ends and failed the same objects, and what is read the same. */
const same = (a: FlowchartData, b: FlowchartData): boolean => a.ready === b.ready && a.loading === b.loading && a.filtering === b.filtering
    && Object.is(a.reading, b.reading) && Object.is(a.error, b.error) && Object.is(a.held, b.held) && Object.is(a.hiddenWith, b.hiddenWith)
    && Object.is(a.failures, b.failures);

/** Renders the reader again `times` times, each render settled. */
async function renderAgain(button: HTMLElement, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.click(button); });
        await settle();
    }
}

describe("the reader (R5)", () => {
    test("hands the frame what it read only as that moves: rendered again over the same rows it hands nothing, and each hand-over as a state changes says something new", async () => {
        const handed: FlowchartData[] = [];
        const { container } = await h.mount({ fn: payload }, { storageKey: "flowchart-read", view: <Reader onData={(data) => { handed.push(data); }} /> });
        await waitFor(() => expect([handed.at(-1)?.ready, handed.at(-1)?.loading]).toEqual([true, false]));
        const again = within(container).getByRole("button", { name: "Render again" });

        // Read once, and rendered again five times over the same rows: nothing more handed.
        const landed = handed.length;
        await renderAgain(again, 5);
        expect([again.getAttribute("data-renders"), handed.length]).toEqual(["5", landed]);

        // Another session renames a state: the new rows are handed once they land, each hand-over on the way saying something new.
        const before = handed.at(-1)!;
        const states = await h.read(ex.depotStates);
        const renamed = new SortedMap(states, compareString);
        renamed.set("SRD", { ...states.get("SRD")!, name: "Sort hall" });
        await h.patch(ex.depotStates, renamed);
        await waitFor(() => expect([Object.is(handed.at(-1)!.held.states, before.held.states), handed.at(-1)!.loading]).toEqual([false, false]));
        expect(handed.length).toBeGreaterThan(landed);
        expect(handed.filter((data, i) => i > 0 && same(data, handed[i - 1]!)).length).toBe(0);

        // Rendered again over the rows as they now stand: nothing more handed.
        const moved = handed.length;
        await renderAgain(again, 5);
        expect([again.getAttribute("data-renders"), handed.length]).toEqual(["10", moved]);
    });
});
