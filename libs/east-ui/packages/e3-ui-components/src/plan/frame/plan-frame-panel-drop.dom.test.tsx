/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's library panel as its palette (#1259, `Plan Builder Spec.md`
 * §4.4, §9.6): an author's tab's cards drag onto the rows of `data` whose
 * series makes an item of a card (`edit.create`) — by the pointer, or carried
 * from the keyboard — as the `add` a Library's card beside the Plan makes,
 * the card's tab its source and its row key its key, so `canDrop` and
 * `create` read it unchanged; the Plan takes its own panel's cards with no
 * `id` or `sources`. A Plan with no row that makes an item of a card — none
 * declares `create`, those that do cannot be placed, the row is of a kind
 * that holds no discrete objects, or no editing session would hold the item —
 * drags nothing from its panel.
 *
 * Pointer geometry is stubbed through `document.elementFromPoint` (jsdom has
 * no layout), as in `../plan-drop.dom.test.tsx`; a keyboard carry steps
 * between stubbed rects (#608).
 */

import { describe, test, expect } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, BooleanType, DateTimeType, DictType, East, NullType, StringType, StructType, variant } from "@elaraai/east";
import { DragEventType, Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, editingMessages, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { announced, layOut, pointAt, press, stubScrollIntoView, tick } from "@elaraai/east-ui-components/testing";
import { Plan, PlanPayloadType } from "@elaraai/e3-ui/internal";
import { EastChakraPlanPayload, type PlanValue } from "./index.js";
import { entry, mount, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

planHarness();

/** Each Plan is mounted under the page's drag layer, so its cards drag. */
const DRAG = { drag: true } as const;

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** A press's job. */
const Job = StructType({ key: StringType, start: DateTimeType, end: DateTimeType });
/** A press: its name, and its jobs. */
const Press = StructType({ name: StringType, jobs: ArrayType(Job) });
/** A palette card: its name, and the family of thing it is. */
const Card = StructType({ name: StringType, family: StringType });

const PRESSES = new Map([["p1", { name: "Press 1", jobs: [] }], ["p2", { name: "Press 2", jobs: [] }]]);
/** The presses, each running a job in the first week. */
const BUSY = new Map([
    ["p1", { name: "Press 1", jobs: [{ key: "j1", start: W27, end: W28 }] }],
    ["p2", { name: "Press 2", jobs: [{ key: "j2", start: W27, end: W28 }] }],
]);
const CARDS = new Map([["job-poster", { name: "Poster run", family: "job" }], ["van-drop", { name: "Van drop", family: "delivery" }]]);

/** The presses' twelve weeks. */
const WEEKS = Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" });
/** Twelve steps on the number arm — another arm than the presses' jobs ride. */
const STEPS = Plan.axis.number({ window: { min: 1, max: 13 }, step: 1 });

/**
 * Two presses over twelve weeks, their palette the Plan's own library panel,
 * the last gesture in the footer. With `create`, a press makes a job of a
 * card dropped on it, a week long from the bucket it lands in, and `canDrop`
 * takes a job only; with `move`, a press's jobs move but no card becomes one.
 * Misplaced, each press runs a job — its instants times — on an axis held in
 * a variable on the number arm, so each draws as its diagnostic. Not
 * editable, the Plan has no editing session to hold a gesture.
 *
 * @param takes - What the presses' series declares: `create`, or a move's fields alone
 * @param options - `misplaced`: whether the presses' jobs ride another arm than the axis's; `editable`: whether the Plan has `editing` (it has unless false)
 * @returns The Plan's program
 */
function palettePlan(takes: "create" | "move", { misplaced = false, editable = true }: { misplaced?: boolean; editable?: boolean } = {}) {
    const seed = misplaced ? BUSY : PRESSES;
    const axisValue = misplaced ? STEPS : WEEKS;
    return East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const presses = $.const(State.bind([DictType(StringType, Press)], "plan-1259.presses", seed));
        const cards = $.const(CARDS, DictType(StringType, Card));
        const lastBind = $.const(State.bind([StringType], "plan-1259.last", "none"));
        const onPatch = $.const(East.function([Plan.Types.PatchEvent(Press)], NullType, ($2, event) => {
            $2(lastBind.write(East.str`${event.origin.getTag()} · ${event.label}`));
        }));
        // A job goes on a press; a card of another family is refused, and anything else moves.
        const canDrop = $.const(East.function([DragEventType], BooleanType, ($2, event) => {
            const yes = $2.const(true, BooleanType);
            return event.match({
                add: ($3, add) => {
                    const card = $3.let(add.from.key);
                    return cards.has(card).and(() => cards.get(card).family.equal("job"));
                },
            }, () => yes);
        }));
        const last = $.let(lastBind.read());
        // Held in a variable, the axis's arm is not seen at build.
        const axis = $.let(axisValue);
        return Plan({
            axis,
            data: presses,
            series: [Plan.series.span(Press, {
                key: "press", title: "Presses", label: (p) => p.name,
                runs: (p) => p.jobs.map((_$2, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.key, state: "added" })),
                edit: takes === "create"
                    ? { items: "jobs", create: (drop) => ({ key: drop.from.key, start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(1n) }) }
                    : { items: "jobs", key: "key", start: "start", end: "end" },
            })],
            ...(editable ? { editing: { onUpdate: presses.write, onPatch } } : {}),
            canDrop,
            library: [Plan.library.tab(cards, { name: "Palette", icon: "palette", label: (c) => c.name, group: (c) => c.family })],
            footer: [{ text: East.str`LAST · ${last}`, end: true }],
        });
    }))), getRegisteredPlatformImplementations());
}

/**
 * A Plan of a heat row per press, its palette the library panel — each row
 * flagged on the wire to take a card, as no series could flag a heat row.
 *
 * @returns The payload
 */
function flaggedHeat(): PlanValue {
    const payload = East.compile(East.function([], PlanPayloadType, ($) => {
        const presses = $.const(State.bind([DictType(StringType, Press)], "plan-1259.heat", PRESSES));
        const cards = $.const(CARDS, DictType(StringType, Card));
        return Plan.Payload({
            axis: Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }),
            data: presses,
            series: [Plan.series.heat(Press, { key: "load", title: "Load", label: (p) => p.name, cells: () => Plan.heatCells([]) })],
            editing: { onUpdate: presses.write },
            library: [Plan.library.tab(cards, { name: "Palette", label: (c) => c.name })],
        });
    }), getRegisteredPlatformImplementations())();
    if (payload.plan.rows.type !== "inline") throw new Error("expected an inline canvas");
    const blocks = payload.plan.rows.value.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r, edits: { ...r.edits, drop: true } })) }));
    return { ...payload, plan: { ...payload.plan, rows: variant("inline", blocks) as PlanValue["plan"]["rows"] } };
}

/** The panel's open tab. */
const panel = (c: HTMLElement) => slot(c, "start")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** A palette card, by its key. */
const cardOf = (c: HTMLElement, key: string) => panel(c).querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;

/** A press's row. */
const rowOf = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(rowAt(entry("press", press)))!;

/** A press's drop cell: its plot. */
const cellOf = (c: HTMLElement, press: string) => rowOf(c, press).querySelector<HTMLElement>("[data-drag-cell]")!;

/** The press's jobs as its runs name them. */
const runsOf = (c: HTMLElement, press: string) =>
    [...rowOf(c, press).querySelectorAll<HTMLElement>("[data-run]")].map((run) => [run.getAttribute("data-run"), run.getAttribute("aria-label")]);

/** Carries a card by the pointer over a press — the drag in flight there. */
function carryOver(c: HTMLElement, key: string, press: string) {
    fireEvent.pointerDown(cardOf(c, key), { clientX: 0, clientY: 0 });
    pointAt(cellOf(c, press));
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
}

describe("the library panel's cards on the rows that take them (#1259)", () => {
    test("a card dragged from the panel onto a press drafts the job its series makes of it, with no `id` or `sources`; Save keeps it", async () => {
        const { container: c } = mount(palettePlan("create"), DRAG);
        await settle();
        expect(cardOf(c, "job-poster").hasAttribute("data-draggable")).toBe(true);
        carryOver(c, "job-poster", "p1");
        expect(cellOf(c, "p1").hasAttribute("data-drop-active")).toBe(true);
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
        await settle();
        // jsdom's zero-width rect puts the pointer in the first week.
        expect(announced()).toBe("Poster run was dropped on Press 1, Week of Jun 29, 2026.");
        expect(rowOf(c, "p1").hasAttribute("data-draft")).toBe(true);
        expect(runsOf(c, "p1")).toEqual([["job-poster", expect.stringMatching(/^job-poster, Jun 29, 2026 – Jul 6, 2026/)]]);
        // The gesture, as `onPatch` heard it: the card's key, on the press's name.
        expect(slot(c, "footer")!.textContent).toContain("LAST · drop · Drop job-poster on Press 1");
        // Saved, the press holds the job: no longer a draft, still drawn.
        fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() }));
        await settle();
        expect(rowOf(c, "p1").hasAttribute("data-draft")).toBe(false);
        expect(runsOf(c, "p1").map(([key]) => key)).toEqual(["job-poster"]);
    });

    test("`canDrop` refuses a card of another family: the press is lit refused, and the drop drafts nothing", async () => {
        const { container: c } = mount(palettePlan("create"), DRAG);
        await settle();
        carryOver(c, "van-drop", "p1");
        expect(cellOf(c, "p1").hasAttribute("data-drop-invalid")).toBe(true);
        expect(cellOf(c, "p1").hasAttribute("data-drop-active")).toBe(false);
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
        await settle();
        expect(announced()).toBe("Van drop was not dropped.");
        expect(rowOf(c, "p1").hasAttribute("data-draft")).toBe(false);
        expect(runsOf(c, "p1")).toEqual([]);
        expect(slot(c, "footer")!.textContent).toContain("LAST · none");
    });

    test("from the keyboard: Space picks a card up in the panel, the arrows carry it onto a press and along its weeks, and Space drops it there", async () => {
        stubScrollIntoView();
        const { container: c } = mount(palettePlan("create"), DRAG);
        await settle();
        const card = cardOf(c, "job-poster");
        const [p1, p2] = [cellOf(c, "p1"), cellOf(c, "p2")];
        // The card in the panel at the left; the presses' plots stacked to
        // its right, their twelve weeks 100px each.
        layOut(new Map([
            [card, { left: 0, top: 0, width: 240, height: 40 }],
            [p1, { left: 300, top: 0, width: 1200, height: 40 }],
            [p2, { left: 300, top: 40, width: 1200, height: 40 }],
        ]));
        card.focus();
        press("Space");
        await tick();
        expect(card.hasAttribute("data-dragging")).toBe(true);
        press("ArrowRight");
        expect(p1.hasAttribute("data-drop-active")).toBe(true);
        expect(announced()).toBe("Poster run is over Press 1, Week of Jun 29, 2026.");
        press("ArrowRight");
        expect(announced()).toBe("Poster run is over Press 1, Week of Jul 6, 2026.");
        press("ArrowDown");
        expect(p2.hasAttribute("data-drop-active")).toBe(true);
        expect(announced()).toBe("Poster run is over Press 2, Week of Jul 6, 2026.");
        press("Space");
        await settle();
        expect(announced()).toBe("Poster run was dropped on Press 2, Week of Jul 6, 2026.");
        expect(rowOf(c, "p2").hasAttribute("data-draft")).toBe(true);
        expect(runsOf(c, "p2")).toEqual([["job-poster", expect.stringMatching(/^job-poster, Jul 6, 2026 – Jul 13, 2026/)]]);
        expect(runsOf(c, "p1")).toEqual([]);
    });

    test("a Plan whose rows make no item of a card drags nothing from its panel — though its runs move on its rows", async () => {
        const { container: c } = mount(palettePlan("move"), DRAG);
        await settle();
        // The rows are drop cells, for their own runs' moves…
        expect(c.querySelectorAll("[data-plan-row] [data-drag-cell]")).toHaveLength(2);
        // …and the panel's cards, which no row takes, are no drag sources.
        expect(panel(c).querySelectorAll("[data-library-item]")).toHaveLength(2);
        expect(panel(c).querySelector("[data-draggable]")).toBeNull();
    });

    test("a Plan whose rows that make an item of a card cannot be placed — their instants ride another arm — drags nothing from its panel", async () => {
        const { container: c } = mount(palettePlan("create", { misplaced: true }), DRAG);
        await settle();
        // Each press draws as its diagnostic, which takes no drop.
        expect(c.querySelectorAll("[data-plan-diagnostic]")).toHaveLength(2);
        expect(c.querySelectorAll("[data-drag-cell]")).toHaveLength(0);
        expect(panel(c).querySelector("[data-draggable]")).toBeNull();
    });

    test("a Plan with no `editing` drags nothing from its panel — though its rows make an item of a card, nothing would hold one", async () => {
        const { container: c } = mount(palettePlan("create", { editable: false }), DRAG);
        await settle();
        expect(c.querySelectorAll("[data-plan-row]")).toHaveLength(2);
        expect(c.querySelectorAll("[data-drag-cell]")).toHaveLength(0);
        expect(panel(c).querySelectorAll("[data-library-item]")).toHaveLength(2);
        expect(panel(c).querySelector("[data-draggable]")).toBeNull();
    });

    test("a row of a kind that holds no discrete objects takes no card, whatever its flag says — so the panel drags nothing", async () => {
        const { container: c } = render(
            <ChakraProvider value={system}>
                <DragLayerProvider>
                    <EastChakraPlanPayload value={flaggedHeat()} storageKey="plan-1259-heat" />
                </DragLayerProvider>
            </ChakraProvider>,
        );
        await settle();
        expect(c.querySelectorAll("[data-plan-row]")).toHaveLength(2);
        expect(c.querySelectorAll("[data-drag-cell]")).toHaveLength(0);
        expect(panel(c).querySelectorAll("[data-library-item]")).toHaveLength(2);
        expect(panel(c).querySelector("[data-draggable]")).toBeNull();
    });
});
