/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Flowchart beside another session's removal or change of a state under
 * its drafts (#1599), on e3 itself: the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), over the depot's states, and what the
 * canvas draws of the state read at every change of the page. The state is
 * one no transition names, so removing it changes its record alone.
 *
 * Over the states read whole (`flowchartDepotEditing`) the canvas and its
 * session read the record in the one read, so no read is held; over the
 * states read through their source of the rail (`flowchartDepot`, opened on
 * the parcels' flow) the session reads a state its drafts hold by its key
 * once the source's rows, read again, no longer hold it — so there the
 * session's read is held while the canvas's own rows land.
 *
 * - A state renamed here that another session removes stands as drafted, a
 *   conflict to choose: kept, the next Save puts it back; let go, it leaves.
 *   Read through its source, it stands while the source's rows are read again
 *   without it and the session has yet to read it: taken for a state the
 *   narrowing hides, it left the canvas until the session's read landed.
 * - A state removed here that another session changes stays off the canvas, a
 *   conflict to choose, its card naming the state as the canvas names it:
 *   kept, the next Save removes it; let go, it is back as the other session
 *   left it.
 * - A state removed here and by another session is nothing to choose and
 *   nothing to save, and is never drawn again.
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { SortedMap, StringType, compareFor, none, printFor, type ValueTypeOf } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import type { E3Request } from "../e3-web.test-utils.js";
import { slot } from "../e3-web-mount.test-utils.js";
import { removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { flowchartHarness, settle } from "./flowchart.test-utils.js";

const h = flowchartHarness();
/** The states' record, as its dataset's requests name it. */
const STATES = `records.${ex.depotStates.name}`;
type State = ValueTypeOf<typeof ex.DepotState>;
const compareText = compareFor(StringType);
const printText = printFor(StringType);
/** A state no transition names: parcels set aside, in the hold lane. */
const ASIDE: State = { name: "Set aside", phase: "hold", seq: 9, slots: none, flow: "Parcels" };

/** The states as e3 holds them now. */
const read = () => h.read(ex.depotStates);
/** Another session's write: the states as it leaves them, from the states as e3 holds them now. */
async function theirs(change: (states: Map<string, State>) => void): Promise<void> {
    const states: Map<string, State> = new SortedMap<string, State>(await read(), compareText);
    change(states);
    await h.patch(ex.depotStates, states);
    await settle();
}

/** A state's card. */
const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);

/**
 * The depot mounted over states that hold the one set aside, its canvas read and at rest: its states read whole
 * (`flowchartDepotEditing`) unless another example is given.
 */
async function mounted(example: Parameters<typeof h.mountExample>[0] = ex.flowchartDepotEditing): Promise<HTMLElement> {
    await theirs((states) => { states.set("ASD", ASIDE); });
    const { container: c } = await h.mountExample(example);
    await settle();
    await waitFor(() => expect(node(c, "ASD")).not.toBeNull());
    await waitFor(() => expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true));
    await settle();
    return c;
}

/** The keys a read by key asks for, each as East prints it. */
const keysOf = (request: E3Request): readonly string[] =>
    (request.body === undefined ? undefined : (JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[] }).keys) ?? [];

/** What the shared checks take of the Flowchart, over the state set aside. */
const state = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // Read whole, the canvas and its session read the states in the one read: none is held. Read through their source,
    // the session reads the state by key only once the source's rows hold it no more: the canvas's reads lead it.
    reads: () => false,
    // The session's read of the state its drafts hold, by its key: the canvas's own reads by key — a transition's far
    // end, a new key asked of e3 — name other states.
    byKey: (request: E3Request) => request.dataset === STATES && request.kind === "rows" && keysOf(request).includes(printText("ASD")),
    drawn: () => node(c, "ASD") !== null,
    theirRemoval: () => theirs((states) => { states.delete("ASD"); }),
    held: async () => (await read()).has("ASD"),
    name: "ASD",
});

/** The state removed here: selected, then Delete. */
const remove = (c: HTMLElement) => [
    () => { fireEvent.click(node(c, "ASD")!); },
    () => { fireEvent.keyDown(c.querySelector<HTMLElement>("[data-flowchart-scroll]")!, { key: "Delete" }); },
];
/** The state renamed here: double-clicked into its editor, a label typed, and ⏎. */
const rename = (c: HTMLElement) => [
    () => { fireEvent.doubleClick(node(c, "ASD")!); },
    () => { fireEvent.change(c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!, { target: { value: "Aside here" } }); },
    () => { fireEvent.keyDown(c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!, { key: "Enter" }); },
];

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the state leaves and nothing is left to save", "source"]] as const)(
    "a state renamed here that another session removes stands as drafted while the states are read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await mounted();
        await removedThere({ ...state(c), change: rename(c), look: () => node(c, "ASD")?.textContent ?? null }, choice);
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the state is back as the other session left it", "source"]] as const)(
    "a state removed here that another session changed stays off the canvas while the states are read again, a conflict to choose, its card naming the state: %s", async (_ends, choice) => {
        const c = await mounted();
        await removedHere({ ...state(c), remove: remove(c), theirChange: () => theirs((states) => { states.set("ASD", { ...ASIDE, name: "Aside there" }); }) }, choice);
    });

test("a state removed here and by another session is nothing to choose and nothing to save, and the canvas never draws it again — nor while its states, standing from before the other session's write, are read again", async () => {
    const c = await mounted();
    await removedOnBothSides({ ...state(c), remove: remove(c) });
});

// ── The states read through their source of the rail ──────────────────────

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the state leaves and nothing is left to save", "source"]] as const)(
    "read through its source, a state renamed here that another session removes stands as drafted while the source's rows are read again without it and its session has yet to read it by key — never taken for a state the narrowing hides: %s", async (_ends, choice) => {
        const c = await mounted(ex.flowchartDepot);
        await removedThere({ ...state(c), change: rename(c), look: () => node(c, "ASD")?.querySelector("[data-card-name]")?.textContent ?? null }, choice, "rows");
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the state is back as the other session left it", "source"]] as const)(
    "read through its source, a state removed here that another session changed stays off the canvas, a conflict to choose, its card naming the state: %s", async (_ends, choice) => {
        const c = await mounted(ex.flowchartDepot);
        await removedHere({ ...state(c), remove: remove(c), theirChange: () => theirs((states) => { states.set("ASD", { ...ASIDE, name: "Aside there" }); }) }, choice);
    });

test("read through its source, a state removed here and by another session is nothing to choose and nothing to save, and the canvas never draws it again", async () => {
    const c = await mounted(ex.flowchartDepot);
    await removedOnBothSides({ ...state(c), remove: remove(c) });
});
