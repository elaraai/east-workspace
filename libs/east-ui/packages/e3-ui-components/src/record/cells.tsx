/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cells of the kinds only a Record draws (`Record - DX Proposal.md`
 * C1–C10), each from its row's cells and its column's payload, its look a
 * data attribute on the record recipe's slots:
 *
 * - **title** (C1) — the title, its neutral initials before it with `avatar`;
 * - **person** (C2) — the member's initials and label, or a dashed ring and the
 *   words for no one;
 * - **boolean** (C3) — a checkbox;
 * - **cycle** and **toggle** (C4–C6) — a chip as wide as its column's widest
 *   label, a scale's member up the heat ramp and any other in its tone's
 *   wash; or the mark look, a scale's pips — a toggle's one — or a valence's
 *   dot and word;
 * - **age** (C7) — whole units to the Record's clock, days and weeks to its
 *   day, a dot once it is stale;
 * - **audit** (C8, C9) — the date, and in blame mode the verb and who; while
 *   the row's drafts change its fields, PENDING and how many;
 * - **trace** (east-workspace#1728) — the row's series as east-ui's Trace, one
 *   unnamed track across the cell, its steps as tall as the row fits: Trace's
 *   compact 22 in a 36 or 32 row, its condensed 15 in a 28 row;
 * - **sparkline** (east-workspace#1729) — the row's series as east-ui's
 *   Sparkline, a line or an area across the cell's room, in the record
 *   recipe's colour, its hover its last value and its range;
 * - **meter** (east-workspace#1730) — the row's value against its max as
 *   east-ui's Meter, its bar and percent at the Record's density, in the tone
 *   the row's tone cell names; a max not read, or one the app's max or tone
 *   threw over, a max of 0 or below, and a max or a value that is no finite
 *   number, an empty bar, its hover saying why — else the value, the max and
 *   the share;
 * - **an absent value** (C10) — in the column's words, else a dash.
 *
 * A row the record does not hold yet has no age and no audit to show. Every
 * other kind draws as the Sheet's cell content draws it (C11).
 *
 * @packageDocumentation
 */

import type { CSSProperties, ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FloatType, IntegerType, StringType, defaultValue, equalFor, lessFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { DensityLiteral } from "@elaraai/east-ui";
import { Meter, Sparkline, Trace } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { EastChakraSparkline } from "@elaraai/east-ui-components";
import { EastChakraMeter, EastChakraTrace, formatDatePattern, type MeterValue, type SlotStyles, type TraceValue } from "@elaraai/east-ui-components/internal";
import type { SheetRowChanges } from "../sheet/index.js";
import { resolveMember, type SheetColumnIndex, type SheetColumnMeta, type SheetRegisterIndex } from "../sheet/model.js";
import type { SheetCellValue, SheetColumnKindValue, SheetRowValue } from "../sheet/values.js";
import type { SheetWords } from "../sheet/words.js";
import { ageOf, type RecordTime } from "./clock.js";
import { recordMessages as m, type RecordMeterNoShare } from "./messages.js";

const stringEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);
const floatLess = lessFor(FloatType);

/** A display column's kind, decoded (east-workspace#1726): a trace's, a sparkline's or a meter's, each with its part's own options and its words for no value. */
export type RecordDisplayKind = Extract<SheetColumnKindValue, { type: "trace" | "sparkline" | "meter" }>;

/** Whether a column's kind is a display column's: what a cell and Details draw with an east-ui part. */
export function isDisplayKind(kind: SheetColumnKindValue): kind is RecordDisplayKind {
    return kind.type === "trace" || kind.type === "sparkline" || kind.type === "meter";
}

/** A trace column's kind, decoded: Trace's own parts, and its words for no series. */
type RecordTraceKind = Extract<RecordDisplayKind, { type: "trace" }>["value"];

/** A sparkline column's kind, decoded: Sparkline's own type and its scale, and its words for no series. */
type RecordSparklineKind = Extract<RecordDisplayKind, { type: "sparkline" }>["value"];

/** A meter column's kind, decoded: the cells a row's max and its tone are read into, and its words for no value. */
type RecordMeterKind = Extract<RecordDisplayKind, { type: "meter" }>["value"];

/** A Trace's payload and its style with nothing set: East's defaults for their types, which a cell sets its parts on. */
const TRACE = defaultValue<typeof Trace.Types.Trace>(Trace.Types.Trace);
const TRACE_STYLE = defaultValue<typeof Trace.Types.Style>(Trace.Types.Style);

/** A Sparkline's payload with nothing set; its style, the box it fills — its colour none, the record recipe's (`currentColor`). */
const SPARKLINE = defaultValue<typeof Sparkline.Types.Sparkline>(Sparkline.Types.Sparkline);
const SPARKLINE_STYLE = some({ ...defaultValue<typeof Sparkline.Types.Style>(Sparkline.Types.Style), width: some("100%"), height: some("100%") });

/** A cell's Trace spans its whole width: the plot gutter's mode, no room kept at either side for a name. */
const NO_GUTTER = some({ left: some("0px"), right: some("0px") });

/** A Meter's payload with nothing set, which a cell sets its value, max, tone and density on — its label none: the header names it. */
const METER = defaultValue<typeof Meter.Types.Meter>(Meter.Types.Meter);

/** Meter's tones, as its type has them: a meter's tone cell names one by its case. */
type MeterTone = ValueTypeOf<typeof Meter.Types.Meter.fields.tone.cases.some>;
const TONES: ReadonlySet<string> = new Set(Object.keys(Meter.Types.Meter.fields.tone.cases.some.cases));
/** Whether a tone cell's words name one of Meter's tones. */
const isTone = (name: string): name is MeterTone["type"] => TONES.has(name);

/** What a meter's cell draws from its row (east-workspace#1730): its value, the row's max — `undefined` while none is read — and its tone. */
interface RecordMeterRead {
    value: number;
    max: number | undefined;
    tone: MeterTone["type"] | undefined;
    /** Whether the app's max or tone threw over the row: its max cell holds the error's message (`cellsAt`). */
    failed: boolean;
}

/**
 * What a meter's cell reads (east-workspace#1730): its value, and the row's max and tone from the cells they are read into.
 *
 * @param kind - The column's kind
 * @param cell - The cell: the value's Float, or none
 * @param cells - The row's cells
 * @returns The value, the max and the tone; `undefined` for a row with no value
 */
function meterRead(kind: RecordMeterKind, cell: SheetCellValue | undefined, cells: ReadonlyMap<string, SheetCellValue>): RecordMeterRead | undefined {
    if (cell?.type !== "Float") return undefined;
    const max = cells.get(kind.max);
    const toneKey = getSomeorUndefined(kind.tone);
    const tone = toneKey === undefined ? undefined : cells.get(toneKey);
    return {
        value: cell.value,
        max: max?.type === "Float" ? max.value : undefined,
        tone: tone?.type === "String" && isTone(tone.value) ? tone.value : undefined,
        failed: max?.type === "String",
    };
}

/**
 * Why a meter draws no share (east-workspace#1730): never a division by a max that is not above 0, nor a share of a max
 * or a value that is no finite number — East's order puts NaN above every number, so `0 < NaN` holds there.
 *
 * @param read - The row's value, max and tone
 * @returns Why — its max not read, or not readable; its max no finite number, or 0 or below; its value no finite number — or `undefined` where it draws a share
 */
function noShareOf(read: RecordMeterRead): RecordMeterNoShare | undefined {
    if (read.failed) return "failed";
    if (read.max === undefined) return "unread";
    if (!Number.isFinite(read.max)) return "max";
    if (!floatLess(0, read.max)) return "low";
    return Number.isFinite(read.value) ? undefined : "value";
}

/** Whether a meter draws a share: {@link noShareOf} finds no reason it can't. */
const shares = (read: RecordMeterRead): read is RecordMeterRead & { max: number } => noShareOf(read) === undefined;

/**
 * The Meter a meter column draws a row's value with (east-workspace#1730): its share of the row's max, in the row's tone, at
 * the density given — and with no share to draw, an empty bar.
 *
 * @param read - The row's value, max and tone
 * @param density - Meter's density
 * @returns The Meter's payload
 */
function meterOf(read: RecordMeterRead, density: DensityLiteral): MeterValue {
    const share = shares(read);
    return {
        ...METER,
        value: share ? read.value : 0,
        max: some(share ? read.max : 1),
        tone: read.tone === undefined ? none : some(variant(read.tone, null)),
        density: some(variant(density, null)),
    };
}

/**
 * A meter cell's hover (east-workspace#1730): its value, the row's max and the share, each in the viewer's language — or,
 * with no share to draw, why.
 *
 * @param read - The row's value, max and tone
 * @param words - The viewer's words
 * @returns The hover
 */
/**
 * What a sparkline's cell says on hover (east-workspace#1729): its last value and its range, over the values that are
 * finite numbers — a last value that is none the Record's dash (east-workspace#1734's review).
 *
 * @param values - The series
 * @param words - The viewer's words
 * @returns The hover; `undefined` for a series with no finite value, which says the column's words
 */
export function sparklineSays(values: readonly number[], words: SheetWords): string | undefined {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return undefined;
    const last = values[values.length - 1]!;
    return m.sparklineTitle({ last: Number.isFinite(last) ? words.number(last) : m.absent(), min: words.number(Math.min(...finite)), max: words.number(Math.max(...finite)) });
}

function meterSays(read: RecordMeterRead, words: SheetWords): string {
    const value = words.number(read.value);
    if (shares(read)) return m.meterTitle({ value, max: words.number(read.max), percent: words.percent(read.value / read.max) });
    // The max said where it is a number: a NaN's words or an infinity's say nothing a person reads.
    const max = read.max !== undefined && Number.isFinite(read.max) ? words.number(read.max) : undefined;
    return m.meterNoShare({ value, max, why: noShareOf(read)! });
}

/** What a cell of a Record's own kind draws, and what it says on hover. */
export interface RecordCellView {
    /** What the cell holds. */
    content: ReactNode;
    /** Its hover; `undefined` where it says nothing beyond its value. */
    title: string | undefined;
}

/** What a cell of a Record's own kind is drawn from. */
export interface RecordCellInput {
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The cell's column. */
    meta: SheetColumnMeta;
    /** The cell's row: its key, and the rule cells an audit reads. */
    row: SheetRowValue;
    /** The cell. */
    cell: SheetCellValue | undefined;
    /** The registers, by name. */
    registers: SheetRegisterIndex;
    /** What the row's drafts changed; `undefined` for a row no gesture has touched. */
    changes: SheetRowChanges | undefined;
    /** The Record's time: what an age counts to. */
    time: RecordTime;
    /** The Sheet's words: the counts in the viewer's language. */
    words: SheetWords;
    /** A cycle's or a toggle's chip's least width in characters: its column's widest label. */
    chip: number | undefined;
    /** The Record's density: how tall a trace's steps stand in its rows. */
    density: DensityLiteral;
}

/**
 * The Trace a trace column draws a series with (east-workspace#1728): one unnamed track — the header names it — its steps
 * across the width it is given, at the column's `now`, `axis`, `scale`, `future` and `domain`.
 *
 * @param kind - The column's kind
 * @param values - The series
 * @param density - Trace's density: compact's 22px steps, or condensed's 15px, its values unshown
 * @returns The Trace's payload
 */
function traceOf(kind: RecordTraceKind, values: number[], density: "compact" | "condensed"): TraceValue {
    return {
        ...TRACE,
        tracks: [{ name: "", values }],
        now: kind.now,
        axis: kind.axis,
        density: some(variant(density, null)),
        scale: some(kind.scale),
        future: some(kind.future),
        domain: kind.domain,
        style: some({ ...TRACE_STYLE, plotGutter: NO_GUTTER }),
    };
}

/**
 * The Sparkline a sparkline column draws a series with (east-workspace#1729): a line or an area filling the box it is
 * given, on the column's `domain` where it has one, in the record recipe's colour.
 *
 * @param kind - The column's kind
 * @param values - The series
 * @returns The Sparkline's payload
 */
function sparklineOf(kind: RecordSparklineKind, values: number[]): ValueTypeOf<typeof Sparkline.Types.Sparkline> {
    return { ...SPARKLINE, data: values, type: some(kind.type), domain: kind.domain, style: SPARKLINE_STYLE };
}

/** What {@link RecordDisplay} draws. */
export interface RecordDisplayProps {
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The display column's kind. */
    kind: RecordDisplayKind;
    /** The cell: a series or a value, or none. */
    cell: SheetCellValue | undefined;
    /** The row's cells: where a meter reads its max and its tone. */
    cells: ReadonlyMap<string, SheetCellValue>;
    /** The density it stands at, the Record's rows' or Details': a Trace's steps at its compact, or at its condensed in a condensed row; a Meter's at its own. */
    density: DensityLiteral;
    /** Where it is drawn: a row's cell, or Details' field. */
    place: "cell" | "details";
    /** Where the part keeps its state. */
    storageKey: string;
}

/**
 * A display column's value (east-workspace#1726): its series as east-ui's Trace or Sparkline, or its value against its
 * max as a Meter, read only — in a row's cell and in Details' field alike — or, for none or an empty series, the
 * column's words for it, else a dash (C10).
 *
 * @param props - The cell, the row's cells, its column's kind, the density it stands at, and where it is drawn
 * @returns The part, or the absent words
 */
export function RecordDisplay({ styles, kind, cell, cells, density, place, storageKey }: RecordDisplayProps) {
    const absent = <Box as="span" css={styles.absent} data-slot="absent">{getSomeorUndefined(kind.value.absent) ?? m.absent()}</Box>;
    if (kind.type === "meter") {
        const read = meterRead(kind.value, cell, cells);
        if (read === undefined) return absent;
        return (
            <Box css={styles.display} data-slot="display" data-kind="meter" data-place={place}>
                <EastChakraMeter value={meterOf(read, density)} storageKey={storageKey} />
            </Box>
        );
    }
    if (cell?.type !== "Series" || cell.value.length === 0) return absent;
    const steps = density === "condensed" ? "condensed" : "compact";
    return (
        <Box css={styles.display} data-slot="display" data-kind={kind.type} data-place={place} data-density={kind.type === "trace" ? steps : undefined}>
            {kind.type === "trace"
                ? <EastChakraTrace value={traceOf(kind.value, cell.value, steps)} storageKey={storageKey} />
                : <EastChakraSparkline value={sparklineOf(kind.value, cell.value)} />}
        </Box>
    );
}

/**
 * A name's initials (C1): the first letters of its first and last words, its
 * dots left out — `A. Morgan` is `AM`; a single word, its first letter.
 *
 * @param name - The name
 * @returns The initials, as written: the recipe sets their case
 */
function initialsOf(name: string): string {
    const parts = name.replace(/\./g, "").split(/\s+/).filter((part) => part !== "");
    if (parts.length === 0) return "";
    const first = [...parts[0]!][0] ?? "";
    return parts.length === 1 ? first : first + ([...parts[parts.length - 1]!][0] ?? "");
}

/**
 * A scale's member's look (C5): the first empty, the rest up the heat ramp
 * to its fourth step, evenly — of three members, the second's the second step
 * and the third's the fourth. The footer's legend draws its chips so (FT2).
 *
 * @param at - The member's place in the register; `-1` for a key no member has
 * @param n - How many members the register has
 * @returns The look
 */
export function heatOf(at: number, n: number): string {
    return at <= 0 || n < 2 ? "none" : `heat-${Math.max(1, Math.round((4 * at) / (n - 1)))}`;
}

/**
 * The label a register's member shows for the key a cell holds, as the
 * Sheet's cells show it: the key itself where no member has it.
 *
 * @param registers - The registers
 * @param register - The column's register
 * @param key - The key
 * @returns The label
 */
function labelFor(registers: SheetRegisterIndex, register: string | undefined, key: string): string {
    const member = resolveMember(registers, register, key);
    return member !== undefined && stringEqual(member.key, key) && member.label !== "" ? member.label : key;
}

/**
 * Each cycle's and toggle's chip's least width in characters, by column key
 * (C4): its widest label, one width a column, so its states line up.
 *
 * @param columns - The columns drawn
 * @param registers - The registers
 * @returns The widths
 */
export function chipWidths(columns: SheetColumnIndex, registers: SheetRegisterIndex): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    for (const meta of columns.list) {
        const kind = meta.raw.kind;
        const labels = kind.type === "toggle" ? [kind.value.on, kind.value.off]
            : kind.type === "cycle" ? (registers.byName.get(kind.value.register) ?? []).map((member) => (member.label !== "" ? member.label : member.key))
                : undefined;
        if (labels !== undefined) out.set(meta.key, labels.reduce((n, label) => Math.max(n, [...label].length), 0));
    }
    return out;
}

/**
 * A cell of one of the kinds only a Record draws — see the module docs.
 *
 * @param input - The cell, its row and its column, and what they are read against
 * @returns What the cell draws and says on hover; `undefined` for a Sheet kind, which the Sheet's cell content draws
 */
export function recordCell(input: RecordCellInput): RecordCellView | undefined {
    const { styles, meta, row, cell, registers, changes, time, words, chip, density } = input;
    const kind = meta.raw.kind;
    // A chip's least width: its column's widest label, at the chip's own face.
    const chipStyle = { "--record-chip-ch": chip ?? 0 } as CSSProperties;
    switch (kind.type) {
        case "title": {
            const title = cell?.type === "String" ? cell.value : "";
            if (title === "") return { content: null, title: undefined };
            return {
                content: (
                    <>
                        {kind.value.avatar && <Box as="span" css={styles.avatar} data-slot="avatar" aria-hidden="true">{initialsOf(title)}</Box>}
                        <Box as="span" css={styles.titleCell} data-slot="titleCell">{title}</Box>
                    </>
                ),
                title: m.titleTitle({ title, id: row.id }),
            };
        }
        case "person": {
            const key = cell?.type === "String" ? cell.value : "";
            if (key === "") {
                const nobody = getSomeorUndefined(kind.value.unassigned) ?? m.unassigned();
                return {
                    content: (
                        <>
                            <Box as="span" css={styles.nobody} data-slot="nobody" role="img" aria-label={nobody} />
                            <Box as="span" css={styles.personLabel} data-slot="personLabel" data-nobody="" aria-hidden="true">{nobody}</Box>
                        </>
                    ),
                    title: undefined,
                };
            }
            const label = labelFor(registers, kind.value.register, key);
            return {
                content: (
                    <>
                        <Box as="span" css={styles.avatar} data-slot="avatar" aria-hidden="true">{initialsOf(label)}</Box>
                        <Box as="span" css={styles.personLabel} data-slot="personLabel">{label}</Box>
                    </>
                ),
                title: label,
            };
        }
        case "boolean": {
            const on = cell?.type === "Boolean" && cell.value;
            return {
                content: (
                    <Box as="span" css={styles.box} data-slot="box" data-on={on ? "" : undefined} role="checkbox" aria-checked={on} aria-label={meta.header}>
                        {on && <FontAwesomeIcon icon={faCheck} />}
                    </Box>
                ),
                title: undefined,
            };
        }
        case "toggle": {
            if (cell?.type !== "Boolean") return { content: <Box as="span" css={styles.absent} data-slot="absent">{m.absent()}</Box>, title: undefined };
            const state = cell.value ? kind.value.on : kind.value.off;
            // What the record holds, while a draft changed it.
            const held = changes !== undefined && changes.dirty.has(meta.key) ? changes.held?.get(meta.key) : undefined;
            return {
                content: kind.value.look.type === "mark"
                    ? (
                        <Box as="span" css={styles.pips} data-slot="pips" role="img" aria-label={state}>
                            <Box as="span" css={styles.pip} data-slot="pip" data-on={cell.value ? "" : undefined} />
                        </Box>
                    )
                    : <Box as="span" css={styles.chip} data-slot="chip" data-look={cell.value ? "heat-4" : "none"} style={chipStyle}>{state}</Box>,
                title: m.stateTitle({ header: meta.header, state, was: held?.type === "Boolean" ? (held.value ? kind.value.on : kind.value.off) : undefined }),
            };
        }
        case "cycle": {
            const key = cell?.type === "String" ? cell.value : "";
            if (key === "") return { content: <Box as="span" css={styles.absent} data-slot="absent">{m.absent()}</Box>, title: undefined };
            const members = registers.byName.get(kind.value.register) ?? [];
            const at = members.findIndex((member) => stringEqual(member.key, key));
            const member = members[at];
            const label = member === undefined ? key : member.label !== "" ? member.label : member.key;
            const tone = member === undefined ? undefined : getSomeorUndefined(member.tone)?.type;
            const held = changes !== undefined && changes.dirty.has(meta.key) ? changes.held?.get(meta.key) : undefined;
            const content = kind.value.look.type === "chip"
                ? (
                    <Box as="span" css={styles.chip} data-slot="chip" style={chipStyle}
                        data-look={kind.value.scale ? heatOf(at, members.length) : tone === undefined || tone === "neutral" ? "none" : tone}>
                        {label}
                    </Box>
                )
                : kind.value.scale
                    // A scale's pips: one for each member after the first, filled up to the cell's.
                    ? (
                        <Box as="span" css={styles.pips} data-slot="pips" role="img" aria-label={label}>
                            {members.slice(1).map((_member, j) => <Box key={j} as="span" css={styles.pip} data-slot="pip" data-on={j < at ? "" : undefined} />)}
                        </Box>
                    )
                    : (
                        <Box as="span" css={styles.mark} data-slot="mark" data-tone={tone ?? "neutral"}>
                            <Box as="span" css={styles.markDot} data-slot="markDot" aria-hidden="true" />
                            <Box as="span" css={styles.markWord} data-slot="markWord">{label}</Box>
                        </Box>
                    );
            return {
                content,
                // A member's hover is its name, its `meta`, where it has one.
                title: m.stateTitle({
                    header: meta.header,
                    state: member === undefined ? label : getSomeorUndefined(member.meta) ?? label,
                    was: held?.type === "String" ? labelFor(registers, kind.value.register, held.value) : undefined,
                }),
            };
        }
        case "age": {
            const age = changes?.added === true ? undefined : ageOf(meta, cell, time);
            // The column's own words for no moment say themselves on hover too, where a narrow column ends them in an ellipsis.
            const absent = getSomeorUndefined(kind.value.absent);
            if (age === undefined) return { content: <Box as="span" css={styles.absent} data-slot="absent">{absent ?? m.absent()}</Box>, title: absent };
            const count = words.number(age.n);
            return {
                content: (
                    <>
                        {age.stale && <Box as="span" css={styles.staleDot} data-slot="staleDot" role="img" aria-label={m.stale()} />}
                        <Box as="span" css={styles.age} data-slot="age" data-stale={age.stale ? "" : undefined}>{count}</Box>
                    </>
                ),
                title: m.ageTitle({
                    count, one: integerEqual(age.n, 1n), unit: age.unit, stale: age.stale,
                    threshold: age.threshold === undefined ? undefined : words.number(age.threshold),
                }),
            };
        }
        case "audit": {
            const blame = kind.value.mode.type === "blame";
            // While the row's drafts change its fields: how many, in either mode (C9).
            if (changes !== undefined && !changes.added && changes.fields > 0) {
                const count = words.number(changes.fields);
                return {
                    content: (
                        <>
                            <Box as="span" css={styles.pending} data-slot="pending"><Box as="span" css={styles.pendingDot} data-slot="pendingDot" aria-hidden="true" />{m.pending()}</Box>
                            <Box as="span" css={styles.pendingMeta} data-slot="pendingMeta">{m.pendingMeta({ count, one: changes.fields === 1, blame })}</Box>
                        </>
                    ),
                    title: m.pendingTitle({ count }),
                };
            }
            if (changes?.added === true || cell?.type !== "DateTime") {
                const absent = getSomeorUndefined(kind.value.absent);
                return { content: <Box as="span" css={styles.absent} data-slot="absent">{absent ?? m.absent()}</Box>, title: absent };
            }
            // Who and what: the rule cells the column names, each a String, or none.
            const verbCell = row.cells.get(kind.value.verb);
            const byCell = row.cells.get(kind.value.by);
            const verb = verbCell?.type === "String" ? verbCell.value : "";
            const by = byCell?.type === "String" ? byCell.value : "";
            const said = m.auditMeta({ verb, by });
            return {
                content: (
                    <>
                        <Box as="span" css={styles.auditDate} data-slot="auditDate">{formatDatePattern("YYYY-MM-DD", cell.value)}</Box>
                        {blame && said !== "" && <Box as="span" css={styles.auditMeta} data-slot="auditMeta">{said}</Box>}
                    </>
                ),
                title: m.auditTitle({ when: formatDatePattern("YYYY-MM-DD HH:mm", cell.value), verb, by }),
            };
        }
        case "trace":
        case "sparkline":
        case "meter": {
            // A trace's steps say their label, value and whether measured on hover, Trace's own words; a sparkline's
            // cell its last value and its range; a meter's its value, the row's max and the share. No value, the column's
            // words, said on hover too where a narrow column ends them in an ellipsis.
            const content = <RecordDisplay styles={styles} kind={kind} cell={cell} cells={row.cells} density={density} place="cell"
                storageKey={`record.${meta.key}.${kind.type}`} />;
            if (kind.type === "meter") {
                const read = meterRead(kind.value, cell, row.cells);
                return { content, title: read === undefined ? getSomeorUndefined(kind.value.absent) : meterSays(read, words) };
            }
            const values = cell?.type === "Series" ? cell.value : [];
            const said = values.length === 0 ? getSomeorUndefined(kind.value.absent)
                : kind.type === "trace" ? undefined
                    : sparklineSays(values, words) ?? getSomeorUndefined(kind.value.absent);
            return { content, title: said };
        }
        default:
            return undefined;
    }
}
