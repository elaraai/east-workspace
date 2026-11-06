/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's narrowing over the depot's records (#1502, `Flowchart
 * Records Spec.md` R5, R6, D7, D11; R11, R12, R14), on e3 itself
 * (`flowchart.test-utils.tsx`): one rail, its `Slice.bindRecords`, the states'
 * and the transitions' sources narrowing those kinds and each list of cards'
 * the tab that names it.
 *
 * - **Hide** (the default): a transition kept whose end the states' narrowing
 *   leaves out has that end read by key, every such end in one request —
 *   found, the transition is hidden with it; absent, the end is a ghost,
 *   listed in Issues (D7).
 * - **Dim**: every state read, none by key; what the narrowing leaves out
 *   drawn as context, selected by no path; a ghost faded once every
 *   transition naming it is.
 * - **A draft the rail hides** waits in its session through a remount, and
 *   Save writes it with the rest (R11); a Save that takes a state out of the
 *   narrowing says so in the footer's shared notice (R12).
 * - **A new narrowing** keeps what the canvas drew, main busy, while it is read
 *   (R5); each list of cards follows its own source (R14); and a choice builds
 *   the flowchart no more (#1354).
 *
 * The rail is written as its chips write it: each source's state in the UI
 * store, under the rail's key and the source's name.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages, formatters } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import type { E3Request } from "../e3-web.test-utils.js";
import { programOf, reloadPage, slot } from "../e3-web-mount.test-utils.js";
import { countBuilds } from "../shared/builds.test-utils.js";
import { act, flowchartHarness, press, settle } from "./flowchart.test-utils.js";
import { measureLibrary } from "./library-measure.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();
// The Library measured as a browser lays it: its lists of cards render.
measureLibrary();

const m = flowchartMessages;
const WORDS = formatters("en-US");
const SAVE = editingMessages.apply();
const printText = printFor(StringType);
const compareString = compareFor(StringType);
const statesEqual = equalFor(ex.depotStates.type);

/** The depot's rail, as `Slice.bindRecords` keys it. */
const DEPOT = "flowchart.depot";
/** The dimmed depot's rail. */
const DIMMED = "flowchart.depotDimmed";
/** The states' record, as its dataset's requests name it. */
const STATES = `records.${ex.depotStates.name}`;
/** The transitions' record. */
const TRANSITIONS = `records.${ex.depotTransitions.name}`;

/** The depot's parcels' states: what the rail's opening choice keeps. */
const PARCELS = ["ARV", "CH*", "CLR", "DSP", "HLD", "IND", "LBL", "LDD", "SCN", "SRD"];

type Where = ValueTypeOf<RecordSliceWhereType>;

/** A narrowing: each field's values chosen, printed as the rail prints them. */
function where(choices: { readonly [field: string]: readonly string[] }): Where {
    return new SortedMap(Object.entries(choices).map(([field, values]) => [field, variant("values", values.map((value) => printText(value)))]), compareString);
}

/** No choice at all: the source's record whole. */
const WHOLE: Where = where({});

/** Writes a source's narrowing, as the rail's chips do, and settles. */
async function narrow(rail: string, source: string, next: Where): Promise<void> {
    const key = `${rail}.${source}`;
    const store = StateRuntime.getStore();
    const held = store.read(key);
    const state = held === undefined ? { where: next, preset: none, resolution: none } : { ...decodeBeast2For(RecordSliceStateType)(held), preset: none, where: next };
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
}

/** A source's narrowing, as the rail holds it. */
const whereOf = (rail: string, source: string): Where => decodeBeast2For(RecordSliceStateType)(StateRuntime.getStore().read(`${rail}.${source}`)!).where;

/** A read by key's body, as the request log holds it: the keys it reads, each as East prints it, in East's order. */
const keysOf = (request: E3Request): string[] =>
    [...((JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[] }).keys ?? [])].sort(compareString);

// ── Reading the flowchart ─────────────────────────────────────────────────

const node = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
const link = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-flowchart-link="${key}"]`);
/** What a state's card says it is, its details drawn under it: the key and the name its head writes; `null` for a state not drawn. */
const cardHead = (c: HTMLElement, key: string): (string | null)[] | null => {
    const card = node(c, key);
    return card === null ? null : [card.querySelector("[data-card-key]")?.textContent ?? null, card.querySelector("[data-card-name]")?.textContent ?? null];
};
/** The states drawn, ghosts among them, in East's order of their keys. */
const stateKeys = (c: HTMLElement): string[] =>
    [...c.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node") ?? "").sort(compareString);
/** The states drawn as context, in East's order of their keys. */
const context = (c: HTMLElement): string[] =>
    [...c.querySelectorAll("[data-flowchart-node][data-context]")].map((el) => el.getAttribute("data-flowchart-node") ?? "").sort(compareString);
/** What waits on Save, as the footer counts it. */
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const pendingOf = (n: number): string => ` · ${m.footerPending({ n, count: WORDS.number(n) })}`;

/** The library's tabs, as they read: each name and its count. */
const libraryTabs = (c: HTMLElement) => [...slot(c, "start").querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
/** The library's open panel. */
const libraryPanel = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** The open panel's cards' keys, in order. */
const cardKeys = (c: HTMLElement) => [...libraryPanel(c).querySelectorAll("[data-library-item]")].map((card) => card.getAttribute("data-library-item"));

/** The inspector's open panel. */
const inspectorPanel = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** What its Details shows. */
const showing = (c: HTMLElement) => inspectorPanel(c).querySelector("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector") ?? null;
/** Its Issues, each as it reads: what it names, what it says and how, and which of the rail's choices hide it. */
const issueLines = (c: HTMLElement) => [...inspectorPanel(c).querySelectorAll("[data-inspector-issue]")].map((el) => [
    el.querySelector("span:first-child")?.textContent ?? null,
    el.querySelector("[data-kind]")?.textContent ?? null,
    el.querySelector("[data-kind]")?.getAttribute("data-kind") ?? null,
    ...(el.querySelector("[data-inspector-issue-hidden]") === null ? [] : [el.querySelector("[data-inspector-issue-hidden]")!.textContent]),
]);
/** DSP → DLV's issue: its far end no state is keyed by. */
const DLV_ISSUE = [m.issueWhere({ kind: "Transition", name: "DSP → DLV" }), m.issueText({ issue: "end", link: "DSP → DLV", missing: ["DLV"] }), "warning"];

/** Clicks an element, as a pointer does, and lets the flowchart settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Opens a tab of a pane — `start`, the library; `end`, the inspector — by its name. */
async function openTab(c: HTMLElement, pane: "start" | "end", name: string): Promise<void> {
    const tab = [...slot(c, pane).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no ${pane} tab ${name}`);
    await click(tab);
}

/** Types a field of the inspector's new text, and commits it with ⏎. */
async function retype(c: HTMLElement, key: string, text: string): Promise<void> {
    const box = within(inspectorPanel(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!).getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(box);
    if (text !== "") await user.type(box, text);
    await user.type(box, "{Enter}");
    await settle();
}

/** Mounts an example as a ui task draws it, and waits until the canvas draws `first`. */
async function open(example: { fn: { toIR(): unknown } }, first: string): Promise<HTMLElement> {
    const { container } = await h.mountExample(example);
    await waitFor(() => expect(node(container, first)).not.toBeNull());
    return container;
}

// ============================================================================
// Hide and dim (R6, D7, D11)
// ============================================================================

describe("hide and dim (#1502, R6, D7)", () => {
    test("under hide, the ends the states' narrowing leaves out are read by key, every one in one request: one found hides its transition with it; one absent is a ghost, listed in Issues", async () => {
        // A transition of the parcels' flow into RCV, a state of the returns' flow the rail's opening choice leaves out.
        const transitions = await h.read(ex.depotTransitions);
        const crossing = new SortedMap(transitions, compareString);
        crossing.set("x1", { src: "CLR", dst: "RCV", kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" });
        await h.patch(ex.depotTransitions, crossing);
        const c = await open(ex.flowchartDepot, "ARV");
        // One request reads both ends: DLV, which no state is keyed by, and RCV.
        expect(h.requests("rows", STATES).map(keysOf)).toEqual([[printText("DLV"), printText("RCV")]]);
        // RCV found: CLR → RCV is hidden with it — neither drawn, and no issue.
        expect([link(c, "x1"), node(c, "RCV")]).toEqual([null, null]);
        // DLV absent: drawn as a ghost — no state row — and listed in Issues, alone.
        expect(stateKeys(c)).toEqual([...PARCELS, "DLV"].sort(compareString));
        expect(node(c, "DLV")!.textContent).toBe(`DLV${m.noStateRow()}`);
        await openTab(c, "end", "Issues");
        expect(issueLines(c)).toEqual([DLV_ISSUE]);
        // The states' choice cleared: RCV is read with the rest, and CLR → RCV drawn into it; DLV is still no state's.
        await narrow(DEPOT, "states", WHOLE);
        await waitFor(() => expect(link(c, "x1")).not.toBeNull());
        expect(cardHead(c, "RCV")).toEqual(["RCV", "Received"]);
        expect(issueLines(c)).toEqual([DLV_ISSUE]);
    });

    test("under dim, every state is read — none by key — and those the narrowing leaves out draw as context, selected by no path: a transition into one draws as itself; an end no state is keyed by is a ghost, listed in Issues, faded once every transition naming it is", async () => {
        const c = await open(ex.flowchartDepotDimmed, "HLD");
        // Every state read, the returns' beside the parcels': none asked for by key, and DLV, no state's, a ghost.
        expect(stateKeys(c)).toEqual([...PARCELS, "INS", "RCV", "RSD", "DLV"].sort(compareString));
        expect(h.requests("rows", STATES)).toEqual([]);
        // The parcels' Hold lane in focus: HLD and CLR draw as themselves, every other state as context.
        expect(context(c)).toEqual(["ARV", "CH*", "DSP", "IND", "INS", "LBL", "LDD", "RCV", "RSD", "SCN", "SRD"]);
        // SRD → HLD, into the focus from a state outside it: drawn as itself, its end SRD faded and selected by no click.
        expect(link(c, "l6")).not.toBeNull();
        await click(node(c, "SRD")!);
        expect(showing(c)).toBe("flowchart");
        await click(node(c, "HLD")!);
        expect(showing(c)).toBe("state");
        // DSP → DLV draws as itself, so its ghost does, and Issues lists it.
        expect(node(c, "DLV")!.hasAttribute("data-context")).toBe(false);
        await openTab(c, "end", "Issues");
        expect(issueLines(c)).toEqual([DLV_ISSUE]);
        // The transitions narrowed to the returns' flow: DSP → DLV draws as context, its ghost with it, and no issue is left.
        await narrow(DIMMED, "transitions", where({ flow: ["Returns"] }));
        await waitFor(() => expect(node(c, "DLV")!.hasAttribute("data-context")).toBe(true));
        expect([link(c, "l10"), link(c, "r1") !== null]).toEqual([null, true]);
        expect(inspectorPanel(c).querySelector("[data-inspector-no-issues]")).not.toBeNull();
    });
});

// ============================================================================
// Drafts out of view, and Save (R11, R12)
// ============================================================================

describe("drafts out of view, and Save (R11, R12)", () => {
    test("a draft the rail hides waits in its session through a remount, Issues listing it; Save writes it with the rest, and the record reads it back", async () => {
        const before = await h.commits(ex.depotStates);
        const stored = await h.read(ex.depotStates);
        let c = await open(ex.flowchartDepot, "CLR");
        await click(node(c, "CLR")!);
        await retype(c, "label", "Cleared at the desk");
        expect(pending(c)).toBe(pendingOf(1));
        // The rail moves to the returns' flow: CLR is drawn no more, its draft waiting.
        await narrow(DEPOT, "states", where({ flow: ["Returns"] }));
        await waitFor(() => expect(node(c, "CLR")).toBeNull());
        expect(pending(c)).toBe(pendingOf(1));
        // The page reloads in the same tab, and the flowchart mounts again under the same narrowing: the draft still waits.
        reloadPage();
        c = (await h.mountExample(ex.flowchartDepot)).container;
        await narrow(DEPOT, "states", where({ flow: ["Returns"] }));
        await waitFor(() => expect(stateKeys(c)).toEqual(["INS", "RCV", "RSD"]));
        expect(pending(c)).toBe(pendingOf(1));
        await openTab(c, "end", "Issues");
        await waitFor(() => expect(issueLines(c)).toEqual([[
            m.issueWhere({ kind: "State", name: "CLR" }), m.issueText({ issue: "waiting", name: "CLR" }), "warning",
            m.hiddenBy({ filters: ["Flow: Returns"], also: [] }),
        ]]));
        // Save writes it, through the states' patch door, though the rail hides it.
        await press(SAVE);
        expect(pending(c)).toBe(pendingOf(0));
        expect(statesEqual(await h.read(ex.depotStates), new SortedMap([...stored, ["CLR", { ...stored.get("CLR")!, name: "Cleared at the desk" }]], compareString))).toBe(true);
        expect(await h.commits(ex.depotStates)).toEqual(["patch", ...before]);
        expect(inspectorPanel(c).querySelector("[data-inspector-no-issues]")).not.toBeNull();
        // The rail's choice cleared: CLR read back as e3 holds it, nothing waiting on it.
        await narrow(DEPOT, "states", WHOLE);
        await waitFor(() => expect(cardHead(c, "CLR")).toEqual(["CLR", "Cleared at the desk"]));
        expect(pending(c)).toBe(pendingOf(0));
    });

    test("a Save that takes a state out of the narrowing says so in the footer's shared notice, and reads the states by key, never whole", async () => {
        const c = await open(ex.flowchartDepot, "CLR");
        await click(node(c, "CLR")!);
        await retype(c, "flow", "Returns");
        await press(SAVE);
        await waitFor(() => expect(c.querySelector("[data-record-save-notice]")?.textContent).toBe("1 state left this view"));
        // CLR stands in the returns' flow now, which the rail hides.
        expect([node(c, "CLR"), pending(c)]).toEqual([null, pendingOf(0)]);
        expect((await h.read(ex.depotStates)).get("CLR")!.flow).toBe("Returns");
        expect([h.requests("read", STATES), h.requests("read", TRANSITIONS)]).toEqual([[], []]);
    });
});

// ============================================================================
// A new narrowing, the lists of cards, and the example as it is (R5, R14)
// ============================================================================

describe("a new narrowing, and the library's sources (R5, R14)", () => {
    test("a new narrowing covers nothing while it is read: what the canvas drew kept and main busy, the toolbar, the panes and the footer live; it draws once it lands", async () => {
        const c = await open(ex.flowchartDepot, "ARV");
        const frame = c.querySelector<HTMLElement>("[data-builder-frame]")!;
        const drawn = stateKeys(c);
        // Every read of the states held on its way to e3.
        const reading = h.e3.hold((request) => request.dataset === STATES && request.kind !== "mutate");
        await narrow(DEPOT, "states", where({ flow: ["Returns"] }));
        await reading.holding;
        expect(frame.hasAttribute("data-loading"), "the frame is not covered").toBe(false);
        expect(["toolbar", "start", "end", "footer"].filter((name) => slot(c, name).closest("[inert], [aria-hidden='true']") !== null), "no region is hidden").toEqual([]);
        expect(slot(c, "main").getAttribute("aria-busy")).toBe("true");
        expect(stateKeys(c)).toEqual(drawn);
        await act(async () => { reading.release(); });
        await settle();
        // The returns' states, every parcels' transition hidden with its ends.
        await waitFor(() => expect(stateKeys(c)).toEqual(["INS", "RCV", "RSD"]));
        expect([slot(c, "main").getAttribute("aria-busy"), frame.hasAttribute("data-loading")]).toEqual(["false", false]);
    });

    test("each list of cards follows its own source: its tab shows the cards the source shows, counted; a source the rail empties says so, with a Clear for that source alone; collapsed, the badge counts the first tab's", async () => {
        const c = await open(ex.flowchartDepot, "ARV");
        await waitFor(() => expect(libraryTabs(c)).toEqual(["Steps 3", "Transitions 3", "Lanes 2", "Owners 3"]));
        await narrow(DEPOT, "stepCards", where({ group: ["Sort"] }));
        await narrow(DEPOT, "moveCards", where({ group: ["Decisions"] }));
        await waitFor(() => expect(libraryTabs(c)).toEqual(["Steps 1 of 3", "Transitions 1 of 3", "Lanes 2", "Owners 3"]));
        await waitFor(() => expect(cardKeys(c)).toEqual(["chutes"]));
        await openTab(c, "start", "Transitions");
        await waitFor(() => expect(cardKeys(c)).toEqual(["routed"]));
        // A group no lane card stands in: the Lanes tab says so, and its Clear clears the lane cards' source alone.
        await openTab(c, "start", "Lanes");
        await narrow(DEPOT, "laneCards", where({ group: ["Yard"] }));
        await waitFor(() => expect(libraryTabs(c)[2]).toBe("Lanes 0 of 2"));
        const said = libraryPanel(c).querySelector<HTMLElement>("[data-library-empty]")!;
        // The tab named mid-sentence, as the empty state words it.
        const name = m.libraryTab({ tab: "lanes" }).toLocaleLowerCase(WORDS.locale);
        expect(said.textContent).toBe(`${m.libraryNarrowed({ tab: "lanes", name })}${m.libraryNarrowedHint({ tab: "lanes", name })}Clear filters`);
        await click(within(said).getByRole("button"));
        await waitFor(() => expect(libraryTabs(c)[2]).toBe("Lanes 2"));
        expect([whereOf(DEPOT, "laneCards").size, whereOf(DEPOT, "stepCards").size, whereOf(DEPOT, "moveCards").size]).toEqual([0, 1, 1]);
        // Collapsed: the badge counts what the first tab shows.
        await click(within(slot(c, "start")).getByRole("button", { name: `Collapse ${m.libraryPane()}` }));
        expect(slot(c, "start").querySelector("[data-dock-badge]")!.getAttribute("title")).toBe("1");
    });

    test("the depot example, mounted as it is: its rail's sources on the toolbar — the states', the transitions', the evidence whose services weigh the details, and each list of cards' — its tabs counted, and its states and transitions read through their sources, never whole", async () => {
        const c = await open(ex.flowchartDepot, "ARV");
        await waitFor(() => expect(libraryTabs(c)).toEqual(["Steps 3", "Transitions 3", "Lanes 2", "Owners 3"]));
        const sources = new Set([...slot(c, "toolbar").querySelectorAll("[data-record-slice-source]")].map((el) => el.getAttribute("data-record-slice-source") ?? ""));
        expect([...sources].sort(compareString)).toEqual(["evidence", "laneCards", "moveCards", "states", "stepCards", "transitions"]);
        // The parcels' flow, as the rail opens: its states, and DLV, no state's.
        expect(stateKeys(c)).toEqual([...PARCELS, "DLV"].sort(compareString));
        expect([h.requests("read", STATES), h.requests("read", TRANSITIONS)]).toEqual([[], []]);
    });

    test("a choice on the rail builds the flowchart no more: the canvas and a list of cards follow it over the payload it mounted with (#1354)", async () => {
        const builds = countBuilds("Flowchart", programOf(ex.flowchartDepot));
        try {
            const { container: c } = await h.mount(ex.flowchartDepot, { drag: false, storageKey: "flowchart-example", program: builds.program });
            await waitFor(() => expect(node(c, "ARV")).not.toBeNull());
            const mounted = [builds.runs, builds.decodes];
            expect(Math.min(...mounted)).toBeGreaterThan(0);
            await narrow(DEPOT, "states", where({ flow: ["Returns"] }));
            await waitFor(() => expect(stateKeys(c)).toEqual(["INS", "RCV", "RSD"]));
            await narrow(DEPOT, "stepCards", where({ group: ["Sort"] }));
            await waitFor(() => expect(libraryTabs(c)[0]).toBe("Steps 1 of 3"));
            expect([builds.runs, builds.decodes], "no choice builds the body again or decodes a payload").toEqual(mounted);
        } finally {
            builds.restore();
        }
    });
});
