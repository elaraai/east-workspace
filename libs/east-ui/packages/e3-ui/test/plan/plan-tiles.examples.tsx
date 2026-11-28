/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * A Plan's task tiles (#1735), on days wide enough for what they say: three
 * crews' tasks over a working week —
 *
 * - `planTaskTiles`, a day of one task, of two, three and four, and of six,
 *   in every state, on rows of one, two and three lanes: one task takes its
 *   day, two take halves, three or four quarters, and five or more three
 *   tiles and a `+n`; an actual task draws its check, and a label with no
 *   room in its tile drops whole. Its library holds task cards: one dropped
 *   on a crew's day is a proposed task there, which Save commits to the
 *   crews' record.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DateTimeType, DictType, East, OptionType, StringType, StructType, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { EventStateType, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A crew's task: the day it falls on, its lane — none on a row of one — what it says, and its state. */
export const TileTask = StructType({ day: DateTimeType, lane: OptionType(StringType), label: OptionType(StringType), state: EventStateType });

/** A crew: its name, its row's second line, its lanes — none for a row of one — and its tasks by their ids. */
export const TileCrew = StructType({
    label: StringType, sub: OptionType(StringType), lanes: ArrayType(Plan.Types.Lane), tasks: DictType(StringType, TileTask),
});

/** The crews, by their keys. */
export const TileCrews = DictType(StringType, TileCrew);

/** Each weekday of the week of Monday 5 October 2026, by its name. */
const MON = new Date("2026-10-05T00:00:00Z");
const TUE = new Date("2026-10-06T00:00:00Z");
const WED = new Date("2026-10-07T00:00:00Z");
const THU = new Date("2026-10-08T00:00:00Z");
const FRI = new Date("2026-10-09T00:00:00Z");

/** A task's state. */
type TaskState = ValueTypeOf<typeof EventStateType>;

/** The states a task is in, by name. */
const ACTUAL: TaskState = variant("actual", null);
const RUNNING: TaskState = variant("in-progress", null);
const CONFIRMED: TaskState = variant("confirmed", null);
const ADDED: TaskState = variant("proposed", variant("added", null));
const RECOMMENDED: TaskState = variant("proposed", variant("recommended", null));
const REMOVED: TaskState = variant("proposed", variant("removed", null));
const ESTIMATED: TaskState = variant("estimated", null);
const REJECTED: TaskState = variant("rejected", null);

/**
 * The crews: Crew A's days hold one task, two, three, four and six, in
 * every state; Crew B's AM and PM hold one or two, and five on Thursday
 * afternoon; Crew C's three shifts hold one task, two and four.
 */
export const TILE_CREWS: ValueTypeOf<typeof TileCrews> = new Map([
    // One line in its gutter, so its row is one lane's 25.
    ["crew-a", {
        label: "Crew A", sub: none, lanes: [],
        tasks: new Map([
            // A day of one: the day, its check and its label.
            ["a1", { day: MON, lane: none, label: some("10m"), state: ACTUAL }],
            // Two: halves — the first's label too long beside its check, so it drops.
            ["b1", { day: TUE, lane: none, label: some("2h 30m"), state: ACTUAL }],
            ["b2", { day: TUE, lane: none, label: some("45m"), state: ADDED }],
            // Three: quarters, the last empty — an actual one's check alone, a quarter holding no `10m` beside it.
            ["c1", { day: WED, lane: none, label: some("10m"), state: ACTUAL }],
            ["c2", { day: WED, lane: none, label: some("20m"), state: RUNNING }],
            ["c3", { day: WED, lane: none, label: some("5m"), state: CONFIRMED }],
            // Four: quarters, a proposal, a proposed removal, an estimate and a rejection.
            ["d1", { day: THU, lane: none, label: some("1h"), state: RECOMMENDED }],
            ["d2", { day: THU, lane: none, label: some("2h"), state: REMOVED }],
            ["d3", { day: THU, lane: none, label: some("3h"), state: ESTIMATED }],
            ["d4", { day: THU, lane: none, label: some("4h"), state: REJECTED }],
            // Six: three tiles and a +3 in the last quarter.
            ["e1", { day: FRI, lane: none, label: some("15m"), state: ACTUAL }],
            ["e2", { day: FRI, lane: none, label: some("25m"), state: ACTUAL }],
            ["e3", { day: FRI, lane: none, label: some("35m"), state: CONFIRMED }],
            ["e4", { day: FRI, lane: none, label: some("45m"), state: CONFIRMED }],
            ["e5", { day: FRI, lane: none, label: some("55m"), state: RECOMMENDED }],
            ["e6", { day: FRI, lane: none, label: some("1h"), state: ESTIMATED }],
        ]),
    }],
    ["crew-b", {
        label: "Crew B", sub: some("AM · PM"), lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
        tasks: new Map([
            ["m1", { day: MON, lane: some("am"), label: some("30m"), state: ACTUAL }],
            ["m2", { day: MON, lane: some("pm"), label: some("1h 30m"), state: CONFIRMED }],
            ["t1", { day: TUE, lane: some("am"), label: some("15m"), state: RUNNING }],
            ["t2", { day: TUE, lane: some("am"), label: some("25m"), state: ADDED }],
            ["w1", { day: WED, lane: some("pm"), label: some("2h"), state: ESTIMATED }],
            ["h1", { day: THU, lane: some("am"), label: some("1h"), state: REJECTED }],
            ["h2", { day: THU, lane: some("pm"), label: some("10m"), state: ACTUAL }],
            ["h3", { day: THU, lane: some("pm"), label: some("20m"), state: ACTUAL }],
            ["h4", { day: THU, lane: some("pm"), label: some("30m"), state: CONFIRMED }],
            ["h5", { day: THU, lane: some("pm"), label: some("40m"), state: RECOMMENDED }],
            ["h6", { day: THU, lane: some("pm"), label: some("50m"), state: RECOMMENDED }],
        ]),
    }],
    ["crew-c", {
        label: "Crew C", sub: some("three shifts"),
        lanes: [{ key: "early", label: some("Early") }, { key: "day", label: some("Day") }, { key: "late", label: some("Late") }],
        tasks: new Map([
            ["s1", { day: MON, lane: some("early"), label: some("8h"), state: ACTUAL }],
            ["s2", { day: TUE, lane: some("day"), label: some("8h"), state: CONFIRMED }],
            ["s3", { day: WED, lane: some("late"), label: some("8h"), state: RECOMMENDED }],
            ["s4", { day: THU, lane: some("day"), label: some("4h"), state: ACTUAL }],
            ["s5", { day: THU, lane: some("day"), label: some("4h"), state: CONFIRMED }],
            ["s6", { day: FRI, lane: some("late"), label: some("2h"), state: ACTUAL }],
            ["s7", { day: FRI, lane: some("late"), label: some("2h"), state: RUNNING }],
            ["s8", { day: FRI, lane: some("late"), label: some("2h"), state: CONFIRMED }],
            ["s9", { day: FRI, lane: some("late"), label: some("2h"), state: ADDED }],
        ]),
    }],
]);

/** The crews, a record the Plan pages and saves through its patch door: a week of a few tasks. */
export const planTileCrews = e3.record("plan_tile_crews", TileCrews, {
    initial: TILE_CREWS,
    mutations: (mutation) => ({
        // The crews' patch door: Save commits a dropped task, and a move, through it.
        patch: mutation.patch(),
    }),
});

/** A card in the library's Tasks tab: the task a drop makes — its name, and what its tile says — and its group. */
export const TileCard = StructType({ name: StringType, label: StringType, group: StringType });

/** The library's task cards, by key. */
export const TileCards = DictType(StringType, TileCard);

/** The task cards: a short group and a long, each saying the length of the task it makes. */
export const TILE_CARDS: ValueTypeOf<typeof TileCards> = new Map([
    ["callout", { name: "Call-out", label: "45m", group: "Short" }],
    ["inspect", { name: "Inspection", label: "1h", group: "Short" }],
    ["install", { name: "Install", label: "2h 30m", group: "Long" }],
    ["survey", { name: "Survey", label: "3h", group: "Long" }],
    ["service", { name: "Service", label: "4h", group: "Long" }],
]);

/** The library's task cards, an input the Plan reads whole: a drop names the card it made its task from. */
export const planTileCards = e3.input("plan_tile_cards", TileCards, variant("value", TILE_CARDS));

/**
 * The crews' tasks over a working week, a day a column, each a tile in its
 * day: one task takes its day, two take halves, three or four quarters, and
 * five or more show three and a `+n` counting the rest, whose menu lists
 * them. Every state: an actual task with its check, one in progress, a
 * confirmed one, proposals, a proposed removal, an estimate and a rejection.
 * A label too long for its tile beside its check drops whole; the tile's name
 * and its hover still say it. On rows of one lane, two and three.
 *
 * Its library holds task cards: one dragged onto a crew's day is a proposed
 * task there, saying its length — across the day's lanes, as a drop names no
 * lane — and a tile moves to another day or crew. Each is a draft, which Save
 * commits through the crews' patch door.
 */
export const planTaskTiles = example({
    keywords: [
        "Plan", "Plan.series.buckets", "buckets", "tiles", "task tiles", "day", "days", "halves", "quarters", "+n", "more",
        "lanes", "Plan.Types.Lane", "AM", "PM", "states", "actual", "check", "in-progress", "confirmed", "proposed", "removed",
        "estimated", "rejected", "label", "library", "Plan.library.tab", "cards", "drag", "drop", "edit", "create",
        "editing", "record", "Record.bind", "e3.record", "patch", "Save", "Data.bindPaged", "#1735",
    ],
    description: "Crews' tasks over a working week as a Plan's task tiles, a day a column: one task takes its day, two take halves, three or four quarters, and five or more three tiles and a +n — every state, an actual task's check, a label that drops whole where its tile has no room for it, on rows of one, two and three lanes; task cards in its library, one dropped on a crew's day a proposed task there, a draft Save commits to the crews' record",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The crews, paged by the canvas, and their record, which Save commits a draft to.
            const crews = $.let(Data.bindPaged(planTileCrews));
            const record = $.let(Record.bind(planTileCrews));
            // The library's cards, by key: a drop names the card it made its task from.
            const cards = $.let(Data.bind(planTileCards));
            const palette = $.let(cards.read());
            return <Plan
                axis={Plan.axis({ window: { min: MON, max: new Date("2026-10-10T00:00:00Z") }, resolution: "day", resolutions: ["day", "week"] })}
                data={crews}
                library={[Plan.library.tab(palette, {
                    name: "Tasks", icon: "list-check",
                    label: (card) => card.name, meta: (card) => some(card.label), group: (card) => card.group,
                })]}
                record={record}
                series={[
                    Plan.series.buckets(TileCrew, {
                        key: "crews", title: "Crews",
                        label: (crew) => crew.label, sub: (crew) => crew.sub, lanes: (crew) => crew.lanes,
                        events: Plan.items("tasks", { at: "day" }, (t) => ({ lane: t.lane, label: t.label, state: t.state })),
                        // A card dropped on a crew's day: a proposed task there, saying its length — across the day's lanes,
                        // as a drop names no lane.
                        edit: {
                            create: (drop) => ({
                                day: drop.at.unwrap("time"), lane: none, label: some(palette.get(drop.from.key).label), state: ADDED,
                            }),
                        },
                    }),
                ]} />;
        }}</Reactive>
    )),
    inputs: [],
});
