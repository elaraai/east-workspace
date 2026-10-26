/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder over a paged resource kind checks of its kinds (#1039,
 * #1424): the Plan's and the Calendar's, in each one's name. A builder pages
 * one resource kind; an event kind placed on it is read a cell at a time,
 * through its source of the slice, over the paged kind's rows alone — never its
 * record whole, nor the days in view through a day index (`window`), which
 * would read every event of the window for every resource — so its source
 * lists a series index and a summary index of its record, filed by its
 * resource field over its own times. A refusal names both declarations over
 * the kind's own fields.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType, none, some,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceTileType } from "@elaraai/east-ui/internal";
import type { ScheduleEventKind } from "./events.js";
import type { ScheduleResourceKind } from "./resources.js";

/** A builder's resource kinds, by slot, in order. */
type Resources = readonly (readonly [string, ScheduleResourceKind<EastType, EastType>])[];
/** A builder's event kinds, by slot, in order. */
type Events = readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[];

/** A series or a summary index's place among a source's: which it is, the fields it files by, and its tile. */
const TilingKeyType = StructType({ summary: BooleanType, fields: ArrayType(StringType), tile: RecordSliceTileType });

/**
 * The series index and the summary index a kind placed on a paged resource
 * kind is read through (#1039), as a refusal names them: over the kind's own
 * fields — its resource field, and its own times.
 *
 * @param kind - The event kind
 * @returns The two declarations' words
 */
export function scheduleCellIndexes(kind: ScheduleEventKind<EastType, EastType>): { readonly series: string; readonly summary: string } {
    const filed = `{ key: "${kind.resourceField}", from: "${kind.times.start}", to: "${kind.times.end}"`;
    return {
        series: `e3.recordIndex.series(name, record, ${filed}, tile: "week" })`,
        summary: `e3.recordIndex.summary(name, record, ${filed}, tile: "month" })`,
    };
}

/**
 * What a builder with a paged resource kind checks of its resource kinds
 * (#1199): it pages one source, so one resource kind at most is paged.
 *
 * @param resources - The resource kinds, by slot
 * @param builder - The builder, as its refusal names it (`Plan`, `Calendar`)
 * @param pager - What pages, as the refusal names it (`a canvas`, `a calendar`)
 * @throws {Error} Naming the paged kinds
 */
export function checkSchedulePagedKinds(resources: Resources, builder: string, pager: string): void {
    const paged = resources.filter(([, kind]) => kind.window !== undefined).map(([slot]) => `resources.${slot}`);
    if (paged.length > 1) {
        throw new Error(`${builder}: ${paged.join(" and ")} each page their rows (Data.bindPaged), and ${pager} pages one source — read all but one of them whole`);
    }
}

/**
 * What a builder checks of the event kinds placed on its paged resource kind
 * at build (#1039, #1424): each is read a cell at a time, through its source
 * of the slice, over the paged kind's rows alone — never its record whole, nor
 * the days in view through a day index (`window`). Which indexes the source
 * lists the builder reads only as it is evaluated
 * ({@link checkedScheduleTilings}).
 *
 * @param resources - The resource kinds, by slot
 * @param events - The event kinds, by slot
 * @param sources - The slice's sources, by name
 * @param builder - The builder, as its refusals name it (`Plan`, `Calendar`)
 * @throws {Error} Naming a kind placed on the paged kind and on another, or one with no source of the slice — read whole, or
 *   through its day index — each with the series and summary indexes to declare over the kind's own fields
 */
export function checkSchedulePagedEventKinds(resources: Resources, events: Events, sources: readonly string[], builder: string): void {
    const paged = resources.find(([, kind]) => kind.window !== undefined)?.[0];
    if (paged === undefined) return;
    for (const [slot, kind] of events) {
        if (!kind.takes.includes(paged)) continue;
        const others = kind.takes.filter((s) => s !== paged);
        if (others.length > 0) {
            throw new Error(`${builder}: events.${slot} is placed on resources.${paged}, paged, and on ${others.map((s) => `resources.${s}`).join(" and ")}, ` +
                "read whole — a paged kind's events are read a cell at a time, through a series index that reads its rows alone: " +
                `place events.${slot} on resources.${paged} alone, or read resources.${paged} whole`);
        }
        if (sources.includes(slot)) continue;
        const { series, summary } = scheduleCellIndexes(kind);
        const how = kind.windowed ? "reads the days in view through its day index (`window`)" : "its record is read whole";
        const leave = kind.windowed ? "leave `window` and `backlogWindow` out, and " : "";
        throw new Error(`${builder}: events.${slot} is placed on resources.${paged}, paged, and ${how} — a paged kind's events are read a cell at a ` +
            `time, through the kind's source of the slice: ${leave}name a source after "${slot}", Data.bindPaged(record, { indexes }), listing ` +
            `${series} and ${summary} beside its interval index`);
    }
}

/**
 * An event kind's series and summary indexes (#1039, #1424), checked as the
 * builder is evaluated — its source lists its record's indexes, which a
 * builder reads only then — and refused in words naming the change to make:
 * one filed by another field than the kind's resource, or over other times
 * than its events'; a series index for a kind not placed on a paged resource
 * kind alone; two series, or two summaries, by one tile over the same fields;
 * a series index with no summary beside it, whose shading draws past the cap;
 * and, for a kind placed on a paged resource kind, a source listing no series
 * index — a paged kind's events are read a cell at a time — each naming the
 * indexes to declare over the kind's own fields.
 *
 * @param slot - The event kind's slot
 * @param kind - The event kind
 * @param resources - The resource kinds, by slot
 * @param config - The controls of the kind's source of the slice, its indexes among them
 * @param builder - The builder, as its refusals name it (`Plan`, `Calendar`)
 * @returns The check, an expression run for its refusal
 */
export function checkedScheduleTilings(
    slot: string,
    kind: ScheduleEventKind<EastType, EastType>,
    resources: Resources,
    config: ExprType<RecordSliceConfigType>,
    builder: string,
): ExprType<NullType> {
    const where = `${builder}: events.${slot}'s source lists the`;
    const field = kind.resourceField;
    const { start, end } = kind.times;
    const paged = resources.find(([, r]) => r.window !== undefined)?.[0];
    const whole = kind.takes.filter((s) => s !== paged);
    const alone = paged !== undefined && whole.length === 0 && kind.takes.includes(paged);
    const unpaged = paged === undefined
        ? ", and no resource kind is paged — a series index reads the events of a paged resource kind's rows a window at a time: " +
            "page the resources (Data.bindPaged), or leave the index out"
        : `, and the kind is placed on ${whole.map((s) => `resources.${s}`).join(" and ")}, read whole — a series index reads the events ` +
            `of a paged resource kind's rows a window at a time: list it for a kind placed on resources.${paged} alone, or leave it out`;
    const declare = field === undefined ? undefined : scheduleCellIndexes(kind);
    const check = East.function([RecordSliceConfigType], NullType, ($, held) => {
        // Each index's place by its text, as East prints it: a Dict's key is of an immutable type, and a place holds an Array.
        const seen = $.let(new Map(), DictType(StringType, StringType));
        const series = $.let(none, OptionType(StringType));
        const summary = $.let(none, OptionType(StringType));
        const summaries = $.let(0n, IntegerType);
        $.for(held.indexes, ($2, index) => {
            for (const arm of ["series", "summary"] as const) {
                $2.match(index[arm], {
                    some: ($3, tiling) => {
                        const named = $3.let(East.value(`${where} ${arm} index "`).concat(index.name).concat("\""));
                        // A refusal known at build ends the branch: nothing after it runs.
                        if (field === undefined) {
                            $3.error(named.concat(", and the kind places its events on no resource — a series or a summary index files events by " +
                                "their resource: give the kind `resource`, or leave the index out"));
                            return;
                        }
                        if (arm === "series" && !alone) {
                            $3.error(named.concat(unpaged));
                            return;
                        }
                        // Filed by the kind's resource, over its events' times.
                        $3.if(tiling.key.equal(field).not(), ($4) => {
                            $4.error(named.concat(", filed by \"").concat(tiling.key).concat(`" — a ${builder} reads it by the kind's resource field: key: "${field}"`));
                        });
                        $3.if(tiling.from.equal(start).not().or(() => tiling.to.equal(end).not()), ($4) => {
                            $4.error(named.concat(", over \"").concat(tiling.from).concat("\" to \"").concat(tiling.to)
                                .concat(`" — a ${builder} reads it over the kind's own times: from: "${start}", to: "${end}"`));
                        });
                        if (arm === "series") {
                            $3.assign(series, some(index.name));
                        } else {
                            $3.assign(summary, some(index.name));
                            $3.assign(summaries, summaries.add(1n));
                        }
                        // One of each by a tile over the same fields.
                        const place = $3.let({ summary: arm === "summary", fields: index.fields, tile: tiling.tile }, TilingKeyType);
                        const at = $3.let(East.print(place));
                        $3.if(seen.has(at), ($4) => {
                            const tile = $4.let(tiling.tile.match({
                                day: (_$5) => East.value("day", StringType),
                                week: (_$5) => East.value("week", StringType),
                                month: (_$5) => East.value("month", StringType),
                                quarter: (_$5) => East.value("quarter", StringType),
                                year: (_$5) => East.value("year", StringType),
                            }));
                            $4.error(East.value(`${where} ${arm} indexes "`).concat(seen.get(at)).concat("\" and \"").concat(index.name)
                                .concat("\", each by the ").concat(tile).concat(" over the same fields — list one"));
                        });
                        $3(seen.insert(at, index.name));
                    },
                });
            }
        });
        // A series index's events draw while they fit the cap, its summary's shading past it.
        const noSummary = ($2: BlockBuilder<NullType>, name: ExprType<StringType>) => {
            $2.if(summaries.equal(0n), ($3) => {
                $3.error(East.value(`${where} series index "`).concat(name).concat(`", and no summary index — the ${builder} draws a series ` +
                    `index's events while they fit, and its summary's shading past that: declare ${declare?.summary ?? "e3.recordIndex.summary(name, record, { key, from, to, tile })"} ` +
                    "over the same record and list it beside the series index"));
            });
        };
        if (alone && declare !== undefined) {
            // A kind on a paged resource kind is read a cell at a time (#1039): its source lists a series index and a summary.
            const onPaged = `, and the kind is placed on resources.${paged}, paged — a paged kind's events are read a cell at a time`;
            $.match(series, {
                some: ($2, name) => { noSummary($2 as unknown as BlockBuilder<NullType>, name); },
                none: ($2) => {
                    $2.match(summary, {
                        some: ($3, name) => {
                            $3.error(East.value(`${where} summary index "`).concat(name).concat(`", and no series index${onPaged}, through a ` +
                                `series index: declare ${declare.series} over the same record and list it beside the summary index`));
                        },
                        none: ($3) => {
                            $3.error(`${builder}: events.${slot}'s source lists no series index and no summary index${onPaged}, and shaded past what ` +
                                `the ${builder} draws: declare ${declare.series} and ${declare.summary} over the same record and list them beside its interval index`);
                        },
                    });
                },
            });
        } else {
            $.match(series, { some: ($2, name) => { noSummary($2 as unknown as BlockBuilder<NullType>, name); } });
        }
        return null;
    });
    return check(config);
}
