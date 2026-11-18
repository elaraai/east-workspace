/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio visual's values and names, as its tiles show them (#1671): a
 * visual's name, made from its wells — what its tile's eyebrow says when its
 * placement has no title (TIL-1); a value's name — its label, else one made
 * from its measure and its fields' labels — and the format its numbers take,
 * its own or else its field's; a change against a compare, coloured by which way is better
 * (KPI-2); how a value stands to its goal; a number where room is short and
 * the unit said beside it; and a KPI's whole model, read from its answers,
 * its words made.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { none, some, variant, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import type { StudioSourceType, StudioVisualType } from "@elaraai/e3-ui/internal";
import { tickFormatOf, type Formatters, type TickFormatOpt, type ValueFormat } from "@elaraai/east-ui-components";
import { human, plural, type QueryWords } from "../../query/model/words.js";
import { valueText } from "../../query/results-table.js";
import { singular } from "../../query/steps/shape.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import { visualValues, type VisualAsk, type VisualValue } from "../../query/visual/print.js";
import { bucketStart, partsAt, readGroups, readTotal } from "../../query/visual/read.js";
import { capitalised, type StudioMessages } from "../messages.js";

/** A listed source, decoded. */
export type VisualSource = ValueTypeOf<typeof StudioSourceType>;

/** A visual, decoded. */
export type Visual = ValueTypeOf<typeof StudioVisualType>;

/** What a visual draws. */
export type VisualView = Visual["view"];

/** A KPI's view. */
export type KpiView = Extract<VisualView, { type: "kpi" }>["value"];

/** What a visual groups by. */
export type VisualGroup = Extract<VisualView, { type: "list" }>["value"]["item"];

/** How the parts of a line of words are joined: `vs year ago 10.76 · by month`. */
const JOIN = " · ";

/**
 * What a visual's tile draws from once its programs are answered: what each
 * view's renderer takes beside the view itself.
 *
 * @property asks - Its asks, as the printer gave them
 * @property answers - Their answers, in the same order
 * @property source - Its source, as the surface lists it
 */
export interface VisualAsked {
    /** Its asks, as the printer gave them. */
    readonly asks: readonly VisualAsk[];
    /** Their answers, in the same order. */
    readonly answers: readonly VisualAnswer[];
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
}

/**
 * What a visual holds of how many groups, when it holds fewer than its source
 * has (CHT-9): its first N, groups its program cut at its limit, or a rest no
 * fold makes — what its tile says under it.
 *
 * @property shown - How many it holds
 * @property of - How many there are
 */
export interface VisualShown {
    /** How many it holds. */
    readonly shown: number;
    /** How many there are. */
    readonly of: number;
}

/**
 * A group's key in words, as an axis, a row or a slice is labelled: a date
 * bucket by its first instant, in its unit's words — `June 2026`, `Q3 2026`,
 * `Jun 29` for a day or a week; any other key as the query builder's results
 * say a value ({@link valueText}).
 *
 * @param key - The key, as the answer gave it: a bucket's period number
 * @param type - The key's East type
 * @param group - What it groups by, whose bucket a date key is in; `undefined` for a key no group names, as a scatter's split
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The label
 */
export function groupLabel(key: unknown, type: EastType, group: VisualGroup | undefined, words: QueryWords, m: StudioMessages): string {
    if (group !== undefined && group.bucket.type === "some") {
        const unit = group.bucket.value.type;
        // A bucket's key is the period number its program grouped by.
        const start = bucketStart(key as bigint, unit);
        const f = words.formatters;
        switch (unit) {
            case "hour": return f.dateTime(start);
            case "day": case "week": return f.monthDay(start);
            case "quarter": return m.quarterOf({ quarter: Math.floor(start.getUTCMonth() / 3) + 1, year: f.year(start) });
            case "year": return f.year(start);
            case "month": case "auto": return f.monthYear(start);
        }
    }
    return valueText(type, key, words, group?.field);
}

/**
 * The format a value's numbers take, as an axis takes it: its own, where it
 * has one; else the one its field declares — a ratio's, what it is of; none
 * for a count.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @returns The value's format, else its field's; `none` prints a plain number
 */
export function valueFieldFormat(value: VisualValue, source: VisualSource): option<ValueFormat> {
    if (value.format.type === "some") return value.format;
    const measure = value.measure;
    const id = measure.type === "ratio" ? measure.value.of : measure.type === "count" || measure.type === "distinct" ? undefined : measure.value;
    return (id === undefined ? undefined : source.fields.find((field) => field.id === id)?.format) ?? none;
}

/**
 * How much of the calendar an axis's date buckets span: what a short label
 * may leave out.
 *
 * @property oneYear - Whether every bucket is of one year: a month is then `Apr`, a quarter `Q3`
 * @property oneDay - Whether every bucket is of one day: an hour is then `14:00`
 */
export interface BucketSpan {
    /** Whether every bucket is of one year. */
    readonly oneYear: boolean;
    /** Whether every bucket is of one day. */
    readonly oneDay: boolean;
}

/**
 * The span of an axis's date buckets.
 *
 * @param starts - Each bucket's first instant
 * @param f - The locale's formatters
 * @returns What its buckets share
 */
export function bucketSpan(starts: readonly Date[], f: Formatters): BucketSpan {
    const same = (said: (d: Date) => string) => new Set(starts.map(said)).size <= 1;
    return { oneYear: same(f.year), oneDay: same(f.date) };
}

/**
 * A group's key as a chart's axis labels it (TIL-5): short, leaving out what
 * every label of the axis shares — a month of one year `Apr`, of several
 * `Apr 2026`; a quarter `Q3`; an hour of one day `14:00`; a day or a week
 * `Jun 29`. Any other key as a table says it ({@link groupLabel}).
 *
 * @param key - The key, as the answer gave it: a bucket's period number
 * @param type - The key's East type
 * @param group - What it groups by
 * @param span - What the axis's buckets share
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The label
 */
export function axisLabel(key: unknown, type: EastType, group: VisualGroup, span: BucketSpan, words: QueryWords, m: StudioMessages): string {
    if (group.bucket.type === "none") return groupLabel(key, type, group, words, m);
    const unit = group.bucket.value.type;
    const start = bucketStart(key as bigint, unit);
    const f = words.formatters;
    switch (unit) {
        case "hour": return span.oneDay ? f.time(start) : f.dateTime(start);
        case "day": case "week": return f.monthDay(start);
        case "quarter": {
            const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
            return span.oneYear ? m.quarterShort({ quarter }) : m.quarterOf({ quarter, year: f.year(start) });
        }
        case "year": return f.year(start);
        case "month": case "auto": return span.oneYear ? f.month(start) : f.periodRange(start, start, "month");
    }
}

/**
 * A label as it reads mid-sentence: its first letter small, unless the label
 * opens on a capital's run — `SKU`.
 *
 * @param label - The label
 * @returns It, as it reads mid-sentence
 */
export function midSentence(label: string): string {
    const second = label[1];
    if (second === undefined || second !== second.toLowerCase()) return label;
    return label[0]!.toLowerCase() + label.slice(1);
}

/**
 * A source's field's label: the source's, else its name in words.
 *
 * @param source - The source
 * @param id - The field
 * @returns Its label
 */
export function fieldLabel(source: VisualSource, id: string): string {
    const listed = source.fields.find((field) => field.id === id);
    return listed !== undefined ? listed.label : capitalised(human(id));
}

/**
 * A value's name: its label, else one made from what it measures — `Orders`
 * for a count of the orders, `Revenue`, `Average margin`, `Different
 * customers`, `Revenue per unit`.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @param m - The Studio's words
 * @returns The name
 */
export function valueName(value: VisualValue, source: VisualSource, m: StudioMessages): string {
    if (value.label.type === "some") return value.label.value;
    const measure = value.measure;
    switch (measure.type) {
        case "count": return m.valueName({ measure: "count", of: source.name, ofs: "", per: "" });
        case "ratio": {
            const per = singular(midSentence(fieldLabel(source, measure.value.per)));
            return m.valueName({ measure: "ratio", of: midSentence(fieldLabel(source, measure.value.of)), ofs: "", per });
        }
        default: {
            const of = midSentence(fieldLabel(source, measure.value));
            return m.valueName({ measure: measure.type, of, ofs: plural(of), per: "" });
        }
    }
}

/**
 * What a group is, mid-sentence, as a visual's name says what it groups by: a
 * date bucket by its unit — `month` — and any other field by its label —
 * `region`.
 *
 * @param group - The group
 * @param source - The source its field is of
 * @param m - The Studio's words
 * @returns Its words; `undefined` while it names no field
 */
export function groupWords(group: VisualGroup, source: VisualSource, m: StudioMessages): string | undefined {
    if (group.field === "") return undefined;
    if (group.bucket.type === "some") {
        const unit = group.bucket.value.type;
        return m.bucketWord({ unit: unit === "auto" ? "month" : unit });
    }
    return midSentence(fieldLabel(source, group.field));
}

/**
 * A visual's name, made from its wells (TIL-1): what its tile's eyebrow says
 * when its placement has no title of its own. A KPI by its value
 * (`Revenue`); a series chart, a pie or a summary by its first value and
 * what it groups by (`Revenue by month`, `Revenue by region and category`);
 * a combo by its first column and its first line (`Units and revenue per
 * unit by month`); a pivot by its value and both its groups (`Late
 * dispatches by region · month`); a scatter or a list by what a point or a
 * row stands for (`Customers`); records by their source (`Orders`).
 *
 * @param view - What the visual draws
 * @param source - Its source
 * @param m - The Studio's words
 * @returns The name; `undefined` while a well it is named from is empty, and for a slicer
 */
export function visualName(view: VisualView, source: VisualSource, m: StudioMessages): string | undefined {
    const named = (value: VisualValue) => valueName(value, source, m);
    const words = (group: VisualGroup) => groupWords(group, source, m);
    const by = (value: VisualValue | undefined, groups: string | undefined) =>
        (value === undefined || groups === undefined ? undefined : m.visualName({ value: named(value), by: groups }));
    const items = (field: string) => (field === "" ? undefined : m.itemsName({ items: plural(midSentence(fieldLabel(source, field))) }));
    switch (view.type) {
        case "kpi": return named(view.value.value);
        case "chart": {
            const chart = view.value;
            switch (chart.type) {
                case "column": case "bar": case "line": case "area": return by(chart.value.values[0], words(chart.value.x));
                case "combo": {
                    const column = chart.value.columns[0]?.value;
                    const line = chart.value.lines[0]?.value;
                    const x = words(chart.value.x);
                    if (x === undefined) return undefined;
                    if (column === undefined || line === undefined) return by(column ?? line, x);
                    return m.visualName({ value: m.valuesBoth({ first: named(column), second: midSentence(named(line)) }), by: x });
                }
                case "scatter": return items(chart.value.point);
                case "pie": return by(chart.value.value, words(chart.value.slice));
            }
            break;
        }
        case "table": {
            const table = view.value;
            switch (table.type) {
                case "records": return source.name;
                case "summary": {
                    const [first, second] = table.value.rows.map(words);
                    const groups = first === undefined ? undefined : second === undefined ? first : m.groupsBoth({ first, second });
                    return by(table.value.values[0], table.value.rows.length > 1 && second === undefined ? undefined : groups);
                }
                case "pivot": {
                    const rows = words(table.value.rows);
                    const columns = words(table.value.columns);
                    return rows === undefined || columns === undefined ? undefined : by(table.value.value, m.groupsCross({ rows, columns }));
                }
            }
            break;
        }
        case "list": return items(view.value.item.field);
        case "slicer": return undefined;
    }
    return undefined;
}

/**
 * What a drawn visual's tile says at its eyebrow's end (TIL-1): what it
 * groups by (`by week`, `by region · month`), its first value's unit (`AUD`),
 * and what it holds of how many (`7 of 46`), joined — whichever its view
 * has. A KPI, a scatter and a records table have none of the first two: a
 * KPI's unit stands beside its number, and a scatter's axes say theirs.
 *
 * @param view - What the visual draws
 * @param source - Its source
 * @param m - The Studio's words
 * @param shown - What it holds of how many, each formatted; `undefined` when it holds them all
 * @returns The meta; `undefined` with nothing to say
 */
export function visualMeta(view: VisualView, source: VisualSource, m: StudioMessages, shown?: { readonly shown: string; readonly of: string }): string | undefined {
    const parts: string[] = [];
    const by = (words: string | undefined) => {
        if (words !== undefined) parts.push(m.metaBy({ by: words }));
    };
    const unit = (value: VisualValue | undefined) => {
        const label = value === undefined ? undefined : unitLabel(value, source, m);
        if (label !== undefined) parts.push(label);
    };
    switch (view.type) {
        case "chart": {
            const chart = view.value;
            switch (chart.type) {
                case "column": case "bar": case "line": case "area":
                    by(groupWords(chart.value.x, source, m));
                    unit(chart.value.values[0]);
                    break;
                case "combo": by(groupWords(chart.value.x, source, m)); break;
                case "pie": unit(chart.value.value); break;
                case "scatter": break;
            }
            break;
        }
        case "table": {
            if (view.value.type === "pivot") {
                const rows = groupWords(view.value.value.rows, source, m);
                const columns = groupWords(view.value.value.columns, source, m);
                by(rows === undefined || columns === undefined ? undefined : m.groupsCross({ rows, columns }));
            }
            break;
        }
        case "list": unit(view.value.values[0]); break;
        case "kpi": case "slicer": break;
    }
    if (shown !== undefined) parts.push(m.metaShown(shown));
    return parts.length === 0 ? undefined : parts.join(JOIN);
}

/**
 * The format a value's numbers take: its own, else its field's — a ratio's,
 * what it is of; none for a count, which is plain.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @returns The format; `undefined` prints a plain number
 */
export function valueFormat(value: VisualValue, source: VisualSource): TickFormatOpt {
    const format = valueFieldFormat(value, source);
    return format.type === "none" ? undefined : tickFormatOf(format.value);
}

/** A share, as a signed percent with one decimal: what a change says. */
export const CHANGE_FORMAT: TickFormatOpt = variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(1n), signDisplay: none });

/** An amount under a header naming its currency: grouped, up to two decimals, no sign of the currency. */
const AMOUNT_FORMAT: TickFormatOpt = variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(2n), signDisplay: none });

/**
 * How a table heads a field's column, and prints its numbers (TBL-5): by its
 * label, a currency field's code after it — `Revenue AUD` — over its amounts
 * grouped, with no currency sign in each cell; any other field in its own
 * format.
 *
 * @param source - The source its fields are of
 * @param id - The field
 * @param m - The Studio's words
 * @returns The column's header, and its numbers' format; `undefined` prints them exactly
 */
export function columnHead(source: VisualSource, id: string, m: StudioMessages): { readonly header: string; readonly format: TickFormatOpt } {
    const label = fieldLabel(source, id);
    const format = source.fields.find((field) => field.id === id)?.format ?? none;
    if (format.type === "none") return { header: label, format: undefined };
    if (format.value.type === "currency") return { header: m.columnUnit({ label, unit: format.value.value.code }), format: AMOUNT_FORMAT };
    return { header: label, format: tickFormatOf(format.value) };
}

/**
 * How a table heads a value's column, and prints its numbers (TBL-2, TBL-3):
 * by its name, a currency's code after it — `Revenue AUD` — over its amounts
 * grouped, with no currency sign in each cell; and its goal, where it has
 * one, a small label of its own after the header — `goal 11.00`. A value of
 * any other field is printed in that field's format; one of none — a count,
 * a sum of units — grouped, to two decimals at most.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The column's header, its numbers' format, and its goal's label; `undefined` with no goal
 */
export function valueHead(value: VisualValue, source: VisualSource, words: QueryWords, m: StudioMessages): { readonly header: string; readonly format: TickFormatOpt; readonly goal: string | undefined } {
    const name = valueName(value, source, m);
    const { format, unit } = valueUnit(value, source);
    const header = unit === undefined ? name : m.columnUnit({ label: name, unit });
    if (value.goal.type === "none") return { header, format, goal: undefined };
    const declared = valueFieldFormat(value, source);
    return { header, format, goal: m.goalLabel({ goal: shortNumber(value.goal.value, declared.type === "some" ? declared.value : undefined, words.formatters) }) };
}

/**
 * How a value's numbers print where its unit is said apart — a table's
 * header, a list's value (LST-1): a currency's amounts grouped, its code the
 * unit; a value of any other field in that field's format; one of none
 * grouped, to two decimals at most.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @returns Its numbers' format, and its unit — a currency's code; `undefined` for none
 */
export function valueUnit(value: VisualValue, source: VisualSource): { readonly format: TickFormatOpt; readonly unit: string | undefined } {
    const declared = valueFieldFormat(value, source);
    if (declared.type === "none") return { format: AMOUNT_FORMAT, unit: undefined };
    if (declared.value.type === "currency") return { format: AMOUNT_FORMAT, unit: declared.value.value.code };
    return { format: tickFormatOf(declared.value), unit: undefined };
}

/**
 * A value's unit, as a tile says it beside its number (KPI-1): a currency's
 * code — `AUD`; a count's source, mid-sentence — `orders`; a count of
 * different values, what is counted — `customers`; a ratio's, what it is of
 * per one of what it is per — `AUD/unit`. A value of any other field has
 * none: its name says what it is.
 *
 * @param value - The value
 * @param source - The source its fields are of
 * @param m - The Studio's words
 * @returns The unit; `undefined` for none
 */
export function unitLabel(value: VisualValue, source: VisualSource, m: StudioMessages): string | undefined {
    const measure = value.measure;
    switch (measure.type) {
        case "count": return midSentence(source.name);
        case "distinct": return plural(midSentence(fieldLabel(source, measure.value)));
        case "ratio": {
            const of = valueUnit(value, source).unit ?? midSentence(fieldLabel(source, measure.value.of));
            return m.unitPer({ unit: of, per: singular(midSentence(fieldLabel(source, measure.value.per))) });
        }
        default: return valueUnit(value, source).unit;
    }
}

/** A currency's amount with its cents, and no sign of the currency: `10.00`, `1,284.50`. */
const CENTS_FORMAT: TickFormatOpt = variant("number", { minimumFractionDigits: some(2n), maximumFractionDigits: some(2n), signDisplay: none });

/**
 * A number of a declared format where room is short — a tile's number, an
 * axis tick, a bar's end (KPI-1, TIL-5): with no sign of a currency, whose
 * code is said apart ({@link unitLabel}).
 *
 * @param n - The number
 * @param declared - The format its field or its axis declares; `undefined` for none
 * @param f - The locale's formatters
 * @param of - A number it is read beside, whose magnitude and decimals it takes — a goal beside its gap, an axis's end beside its ticks
 * @param trim - Whether zeros that end its decimals are left off, as an axis's ticks read
 * @returns The text
 *
 * @remarks
 * - From ten thousand: three significant digits of its magnitude — `3.84M`,
 *   `612k` — or, trimmed, `2.5M`, `25k`.
 * - A currency's amount under ten thousand keeps its cents: `11.42`, `10.00`
 *   — but not trimmed: an axis's ticks read `2,000`, `11.5`.
 * - Any other number under ten thousand is as it is: `1,284`.
 * - A share or a date is as its format prints it.
 */
export function shortNumber(n: number, declared: ValueFormat | undefined, f: Formatters, of?: number, trim = false): string {
    if (declared !== undefined && declared.type !== "currency" && declared.type !== "number" && declared.type !== "compact") return f.value(n, tickFormatOf(declared));
    if (declared?.type === "currency" && !trim && Math.abs(of ?? n) < 10_000) return f.value(n, CENTS_FORMAT);
    return f.short(n, of, trim);
}

/**
 * A value's number where room is short ({@link shortNumber}), in its field's
 * format: `3.84M`, `612k`, `1,284`, `11.42`.
 *
 * @param n - The number
 * @param value - The value it is of
 * @param source - The source its fields are of
 * @param f - The locale's formatters
 * @param of - A number it is read beside, whose magnitude and decimals it takes — a goal beside its gap
 * @returns The text
 */
export function shortValue(n: number, value: VisualValue, source: VisualSource, f: Formatters, of?: number): string {
    const declared = valueFieldFormat(value, source);
    return shortNumber(n, declared.type === "some" ? declared.value : undefined, f, of);
}

/**
 * Whether a value lies on its goal's wrong side (CHT-4, TBL-3): under it
 * where higher is better, over it where lower is.
 *
 * @param value - The value
 * @param at - What it is
 * @returns Whether it misses its goal; false for a value with none
 */
export function wrongSideOfGoal(value: VisualValue, at: number): boolean {
    if (value.goal.type === "none") return false;
    return value.better.type === "higher" ? at < value.goal.value : at > value.goal.value;
}

/**
 * The query builder's words as a Studio visual says them (NFR-5): an absent
 * value in words — `no data` — where the builder's results show a dash.
 *
 * @param words - The query builder's words and formatters
 * @param m - The Studio's words
 * @returns The words a visual's tables print with
 */
export function visualWords(words: QueryWords, m: StudioMessages): QueryWords {
    return { ...words, messages: { ...words.messages, resultMissing: () => m.noValue() } };
}

/** A share of a goal, as a whole percent: `85% of goal`. */
const SHARE_FORMAT: TickFormatOpt = variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(0n), signDisplay: none });

/**
 * A change of a value against a compare.
 *
 * @property delta - The value less the compare
 * @property share - The delta as a share of the compare; `undefined` against nothing
 * @property tone - Its valence: a rise is positive where higher is better, and a fall where lower is (KPI-2)
 */
export interface ValueChange {
    /** The value less the compare. */
    readonly delta: number;
    /** The delta as a share of the compare's size; `undefined` against a compare of 0. */
    readonly share: number | undefined;
    /** Its valence. */
    readonly tone: "positive" | "negative" | "neutral";
}

/**
 * A value's change against a compare, coloured by which way is better
 * (KPI-2): with `lower`, a fall is positive.
 *
 * @param value - The value
 * @param compare - What it is compared with
 * @param better - Which way is better
 * @returns The change
 */
export function changeOf(value: number, compare: number, better: "higher" | "lower"): ValueChange {
    const delta = value - compare;
    const rose = delta > 0;
    const fell = delta < 0;
    const good = better === "higher" ? rose : fell;
    const bad = better === "higher" ? fell : rose;
    return { delta, share: compare === 0 ? undefined : delta / Math.abs(compare), tone: good ? "positive" : bad ? "negative" : "neutral" };
}

/**
 * How a value stands to its goal.
 *
 * @property goal - The goal
 * @property share - How far to it, from 0 to 1: the progress bar's fill
 * @property gap - How far it is from the goal, either way
 * @property over - Whether it is past the goal
 */
export interface GoalStanding {
    /** The goal. */
    readonly goal: number;
    /** How far to it, from 0 to 1: the progress bar's fill. */
    readonly share: number;
    /** How far it is from the goal, either way. */
    readonly gap: number;
    /** Whether it is past the goal. */
    readonly over: boolean;
}

/**
 * How a value stands to its goal (KPI-1).
 *
 * @param value - The value
 * @param goal - Its goal
 * @returns The standing
 */
export function goalOf(value: number, goal: number): GoalStanding {
    const share = goal === 0 ? (value >= 0 ? 1 : 0) : Math.min(1, Math.max(0, value / goal));
    return { goal, share, gap: Math.abs(goal - value), over: value > goal };
}

/**
 * A KPI's change, in its words.
 *
 * @property change - The change itself
 * @property text - What its pill says: a count's change as a number of it (`−12`), any other's as a share of what it is against (`+6.1%`)
 */
export interface KpiChange {
    /** The change itself. */
    readonly change: ValueChange;
    /** What its pill says. */
    readonly text: string;
}

/**
 * A KPI, read from its answers.
 *
 * @property value - Its value; `undefined` for "no data"
 * @property text - Its value in short, with no sign of its unit — `3.84M`; `undefined` for "no data"
 * @property unit - Its unit, said beside it — `AUD`, `orders`, `AUD/unit`; `undefined` for none
 * @property change - Its change against its compare; `undefined` with no compare, or none to make
 * @property trend - Its value along its trend field, a bucket a point in time order; empty with no trend
 * @property goal - How it stands to its value's goal; `undefined` with no goal, or no value
 * @property annotation - Its one line of annotation: what its change is against, with what that was, its trend's
 *   bucket and, when less is better, so — `vs year ago 10.76 · by month` — then how far to its goal and the gap —
 *   `85% of goal 4.50M · 0.66M to go`; `undefined` with neither
 */
export interface KpiModel {
    /** Its value; `undefined` for "no data". */
    readonly value: number | undefined;
    /** Its value in short, with no sign of its unit; `undefined` for "no data". */
    readonly text: string | undefined;
    /** Its unit, said beside it; `undefined` for none. */
    readonly unit: string | undefined;
    /** Its change against its compare; `undefined` with no compare, or none to make. */
    readonly change: KpiChange | undefined;
    /** Its value along its trend field, a bucket a point in time order; empty with no trend. */
    readonly trend: readonly number[];
    /** How it stands to its value's goal; `undefined` with no goal, or no value. */
    readonly goal: GoalStanding | undefined;
    /** Its one line of annotation; `undefined` with nothing to say. */
    readonly annotation: string | undefined;
}

/**
 * A KPI's model, from its answers (KPI-1 to KPI-3): its value in short with
 * its unit, its change against its compare, its trend and its goal, and the
 * one line that says what they are against — each absent where its well is
 * empty, so nothing is drawn in its place. Its name is its tile's eyebrow
 * ({@link visualName}).
 *
 * @param kpi - The KPI
 * @param asks - Its asks, as the printer gave them
 * @param answers - Their answers
 * @param source - Its source
 * @param m - The Studio's words
 * @param f - The locale's formatters
 * @returns The model
 */
export function kpiModel(
    kpi: KpiView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, m: StudioMessages, f: Formatters,
): KpiModel {
    const values = visualValues(variant("kpi", kpi));
    const total = readTotal(asks, answers, values);
    const made = (index: number) => (total === undefined ? undefined : partsAt(total.parts, index));
    const value = made(0);
    const compared = made(1);
    const compare = kpi.compare.type === "some" ? kpi.compare.value : undefined;
    const bucket = asks.find((ask) => ask.role === "trend")?.bucket;
    // The one line of annotation: what the change is against, then the goal.
    const notes: string[] = [];
    let change: KpiChange | undefined;
    if (compare !== undefined && value !== undefined && compared !== undefined) {
        const of = changeOf(value, compared, kpi.value.better.type);
        notes.push(
            // What it was, beside the value: at the value's scale.
            m.changeAgainst({ period: compare.period.type, name: midSentence(valueName(compare, source, m)), value: shortValue(compared, compare, source, f, value) }),
            ...(bucket === undefined ? [] : [m.trendBy({ unit: m.bucketWord({ unit: bucket }) })]),
            ...(kpi.value.better.type === "lower" ? [m.lowerBetter()] : []),
        );
        const text = kpi.value.measure.type === "count" || of.share === undefined ? f.value(of.delta, valueFormat(kpi.value, source), true) : f.value(of.share, CHANGE_FORMAT, true);
        change = { change: of, text };
    }
    const trend = kpi.trend.type === "none" ? [] : (readGroups(asks, answers, values, "trend")?.groups ?? [])
        .map((group) => partsAt(group.parts, 0))
        .filter((point): point is number => point !== undefined);
    let goal: GoalStanding | undefined;
    if (kpi.value.goal.type === "some" && value !== undefined) {
        goal = goalOf(value, kpi.value.goal.value);
        // The goal and the gap share a scale: the larger of the value and the goal.
        const scale = Math.max(Math.abs(value), Math.abs(goal.goal));
        const target = shortValue(goal.goal, kpi.value, source, f, scale);
        // How far to it is the value over the goal, past 100% once it is passed; a goal of 0 has none.
        notes.push(
            goal.goal === 0 ? m.goalOf({ goal: target }) : m.goalShare({ share: f.value(value / goal.goal, SHARE_FORMAT), goal: target }),
            m.goalGap({ gap: shortValue(goal.gap, kpi.value, source, f, scale), over: goal.over }),
        );
    }
    return {
        value,
        text: value === undefined ? undefined : shortValue(value, kpi.value, source, f),
        unit: unitLabel(kpi.value, source, m),
        change, trend, goal,
        annotation: notes.length === 0 ? undefined : notes.join(JOIN),
    };
}
