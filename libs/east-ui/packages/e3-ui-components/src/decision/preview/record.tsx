/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record target's preview (`Decision Queue Spec.md` P6, P10, P11,
 * P21–P26): the rows its change touches, read by key through the record's
 * `entries` — every one in one request — or from the record read whole,
 * drafts in place — tracked, so the read landing draws it — and drawn by what
 * the target declares: its rows'
 * changed fields, as the row's own form prints them (P6); with a `measure`
 * over a record of at most five rows read whole, its mix (P10); with a
 * `group`, the groups it touches, each counted through the target's `source`
 * (P11) — {@link recordFields}, {@link recordMix} and {@link recordGroups}.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCaretUp, faCircle } from "@fortawesome/free-solid-svg-icons";
import { FloatType, StringType, compareFor, equalFor, fromEastTypeValue, type EastType } from "@elaraai/east";
import { fieldFormMessages, fieldText, useTrackedEvaluation, type FieldFormWords } from "@elaraai/east-ui-components";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { rowCodec } from "../../shared/schedule/records.js";
import { appliedRows, draftedRows, standingRows, type DecisionTarget } from "../editing.js";
import { CONFIDENCE, NET } from "../figures.js";
import type { DecisionQueueWords } from "../messages.js";
import { fieldAt } from "../state.js";
import { PreviewFailed, PreviewFrame, PreviewPending, flag, guessedOf, leftBy, staleNames, useHeld, type PreviewProps } from "./frame.js";
import {
    GROUP_ROWS, MIX_ROWS, RECORD_FIELDS, recordFields, recordGroups, recordMix,
    type GroupRow, type MixModel, type MixRowInput, type RecordFieldItem, type RecordFieldSpec, type RecordRowInput,
} from "./record-model.js";

/** A record target's kind, decoded. */
type RecordKind = Extract<DecisionTarget["kind"], { type: "record" }>["value"];

/** How a record's preview lays its rows out. */
type RecordLayout = "fields" | "mix" | "groups";

/** What the preview's read gives: the model by its layout, a read in flight, or nothing to draw. */
type RecordRead =
    | { readonly state: "ready"; readonly layout: "fields"; readonly fields: readonly RecordFieldItem[]; readonly names: readonly string[]; readonly marked: boolean }
    | { readonly state: "ready"; readonly layout: "mix"; readonly mix: MixModel; readonly names: readonly string[]; readonly marked: boolean }
    | { readonly state: "ready"; readonly layout: "groups"; readonly groups: readonly GroupRow[]; readonly names: readonly string[]; readonly marked: boolean }
    | { readonly state: "pending" }
    | { readonly state: "empty" };

const PENDING: RecordRead = { state: "pending" };
const EMPTY: RecordRead = { state: "empty" };
/** No drafted rows: a target with no record the queue writes. */
const NO_DRAFTED: ReadonlyMap<string, Uint8Array | undefined> = new Map();
const stringEqual = equalFor(StringType);
const sameNumber = equalFor(FloatType);
const compareNumber = compareFor(FloatType);

/** The layout a record's target declares, before its rows are read: its rows read whole may still hold too many for a mix. */
function layoutOf(kind: RecordKind): RecordLayout {
    return kind.group.type === "some" ? "groups" : kind.measure.type === "some" && kind.rows.type === "some" ? "mix" : "fields";
}

/** How many rows a layout's placeholder draws. */
const PENDING_ROWS: Readonly<Record<RecordLayout, number>> = { fields: RECORD_FIELDS, mix: MIX_ROWS, groups: GROUP_ROWS };

/** Props of {@link RecordPreview}. */
export interface RecordPreviewProps extends PreviewProps {
    /** The target's record kind. */
    readonly kind: RecordKind;
}

/**
 * A record target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link RecordPreviewProps})
 * @returns The preview
 */
export function RecordPreview({ c, view, target, kind, record, rows, changed, schedule, words, styles, applied }: RecordPreviewProps) {
    const option = view.option;
    const formWords = useMemo((): FieldFormWords => ({ ...words, m: fieldFormMessages }), [words]);
    const codec = useMemo(() => rowCodec(kind.rowType), [kind.rowType]);
    // The record's fields, each read, compared and printed as its form does.
    const specs = useMemo(() => kind.fields.map((spec): RecordFieldSpec => {
        const equal = equalFor(fromEastTypeValue(spec.type) as EastType) as (a: unknown, b: unknown) => boolean;
        return { label: spec.label, read: row => fieldAt(row, spec.path), equal, print: value => fieldText(spec, value, formWords) };
    }), [kind.fields, formWords]);
    const read = useCallback((): RecordRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        // The rows the change touches, as they stand and as it leaves them, in its order.
        const touched = new Map<string, { before: Uint8Array | undefined; after: Uint8Array | undefined }>();
        const landed = new Map<string, Uint8Array | undefined>();
        let marked = true;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) touched.set(row.key, { before: row.standing, after: leftBy(row) });
        } else {
            // Stale (P21): the rows the proposal touched, as they stand. Changing nothing (P4): the rows the
            // recommendation touches, as they stand, unmarked — where the recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = false;
            if (o === undefined || record === undefined) return EMPTY;
            const standing = standingRows(schedule, record, target.touched(o.change.patch));
            if (standing.type !== "some") return PENDING;
            for (const [key, bytes] of standing.value) touched.set(key, { before: bytes, after: bytes });
            if (theirs) {
                const applied = appliedRows(schedule, target, record, recommended);
                if (applied.state === "reading") return PENDING;
                if (applied.state === "ready") for (const [key, bytes] of applied.rows) landed.set(key, bytes);
            }
        }
        const nameOf = (bytes: Uint8Array | undefined, key: string) => (bytes === undefined || kind.label.type !== "some" ? key : kind.label.value(bytes, key));
        const measureOf = (bytes: Uint8Array | undefined, key: string) => (bytes === undefined || kind.measure.type !== "some" ? undefined : kind.measure.value(bytes, key));
        const confidence = (key: string) => option?.guesses?.get(key);
        const names = [...touched].map(([key, row]) => nameOf(row.after ?? row.before, key));
        // A group a row: the groups the change touches, each counted through the target's source (P11).
        if (kind.group.type === "some") {
            const group = kind.group.value;
            const groups = recordGroups([...touched].map(([key, row]) => {
                const bytes = row.after ?? row.before;
                return { group: bytes === undefined ? key : group.of(bytes, key), before: measureOf(row.before, key), after: measureOf(row.after, key) };
            }), name => {
                const n = group.count(name);
                return n.type === "some" ? Number(n.value) : undefined;
            });
            return groups === undefined ? PENDING : { state: "ready", layout: "groups", groups, names, marked };
        }
        // A mix: every row of a record of at most five, read whole, the drafts in place (P10).
        if (kind.measure.type === "some" && kind.rows.type === "some") {
            const all = kind.rows.value();
            if (all.type !== "some") return PENDING;
            if (all.value.size <= MIX_ROWS) {
                const inputs: MixRowInput[] = [];
                const keys = new Set([...all.value.keys(), ...touched.keys()]);
                // The queue's own drafts of the record — verdicts drafted before this one — in their place.
                const drafted = record === undefined ? NO_DRAFTED : draftedRows(schedule, record);
                for (const key of keys) {
                    const standing = drafted.has(key) ? drafted.get(key) : all.value.get(key);
                    const change = touched.get(key);
                    const after = change === undefined ? standing : change.after;
                    inputs.push({ key, name: nameOf(after ?? standing, key), before: measureOf(standing, key), after: measureOf(after, key), confidence: confidence(key) });
                }
                return { state: "ready", layout: "mix", mix: recordMix(inputs, marked), names, marked };
            }
        }
        // Its fields (P6): those the change sets, or the recommendation would, each as its form prints it.
        const decode = (bytes: Uint8Array | undefined) => (bytes === undefined ? undefined : codec.decode(bytes));
        const inputs: RecordRowInput[] = [...touched].map(([key, row]) => ({
            key, name: nameOf(row.after ?? row.before, key), before: decode(row.before), after: decode(row.after), confidence: confidence(key),
        }));
        const lands: string[] = [];
        for (const [key, bytes] of landed) {
            const was = decode(touched.get(key)?.before), is = decode(bytes);
            for (const spec of specs) {
                if (was === undefined || is === undefined || !spec.equal(spec.read(was), spec.read(is))) lands.push(spec.label);
            }
        }
        return { state: "ready", layout: "fields", fields: recordFields({ specs, rows: inputs, lands, marked }), names, marked };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, kind, codec, specs]);
    const { result: live } = useTrackedEvaluation(read);
    const result = useHeld(live, applied);
    const stale = rows === "stale";
    const pending = layoutOf(kind);
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its rows:`, result.error);
        return <PreviewFailed kind="record" layout={pending} words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="record" layout={pending} rows={PENDING_ROWS[pending]} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="record" layout={pending} label={option?.detail ?? ""} stale={stale} applied={applied} styles={styles} />;
    const { m } = words;
    const guessed = guessedOf(option?.guesses, changed);
    const guess = guessed.length === 0 ? undefined : { keys: m.previewList({ items: guessed }), n: guessed.length };
    const lead = (said: string) => (stale ? m.previewStale({ names: staleNames(got.names, words) })
        : !got.marked ? m.previewUnchanged({ names: staleNames(got.names, words) ?? m.previewList({ items: got.names.slice(0, 1) }) }) : said);
    switch (got.layout) {
        case "fields": {
            const tips = got.fields.map(f => fieldTip(f, words));
            return (
                <PreviewFrame kind="record" layout="fields" label={lead(m.previewFields({ fields: tips, guessed: guess }))} stale={stale} applied={applied} styles={styles}>
                    {got.fields.map((f, i) => <FieldBlock key={`${f.key}.${f.field}`} field={f} tip={tips[i]!} words={words} styles={styles} />)}
                </PreviewFrame>
            );
        }
        case "mix": {
            const moved = got.mix.rows.filter(row => !row.same).map(row => ({ name: row.name, was: words.number(row.was), now: words.number(row.now) }));
            return (
                <PreviewFrame kind="record" layout="mix" label={lead(m.previewMix({ rows: moved, guessed: guess }))} stale={stale} applied={applied} styles={styles}>
                    <Mix model={got.mix} name={target.name} words={words} styles={styles} />
                </PreviewFrame>
            );
        }
        case "groups": {
            const net = (row: GroupRow) => (row.net === undefined ? undefined : words.value(row.net, NET, true));
            const label = lead(m.previewGroups({ groups: got.groups.map(row => ({ name: row.name, n: words.number(row.n), net: net(row) })) }));
            const field = kind.group.type === "some" ? kind.group.value.field : "";
            const caption = kind.fields.find(spec => spec.path.length === 1 && stringEqual(spec.path[0]!, field))?.label ?? field;
            return (
                <PreviewFrame kind="record" layout="groups" label={label} stale={stale} applied={applied} styles={styles}>
                    <Groups groups={got.groups} caption={caption} marked={got.marked} net={net} words={words} styles={styles} />
                </PreviewFrame>
            );
        }
    }
}

/** A field's title (P25): its row's and its own name, and its value as it stands and as the change leaves it. */
function fieldTip(f: RecordFieldItem, words: DecisionQueueWords): string {
    const { m } = words;
    return m.previewField({ row: f.row, field: f.field, was: f.was ?? m.previewBlank(), is: f.is ?? m.previewBlank(), changed: f.changed });
}

/** A guessed value's dot (P26), titled with its confidence. */
function Guess({ confidence, words, styles }: { readonly confidence: number; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    return (
        <Box as="span" css={styles.guess} title={words.m.guess({ confidence: words.value(confidence, CONFIDENCE) })} data-preview-guess="">
            <FontAwesomeIcon icon={faCircle} />
        </Box>
    );
}

/** One field's block (P6): its caption, its value as it stands struck through where the change sets it, and its chip. */
function FieldBlock({ field, tip, words, styles }: { readonly field: RecordFieldItem; readonly tip: string; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const { m } = words;
    const op = !field.changed ? undefined : field.was === undefined ? "add" : field.is === undefined ? "del" : "chg";
    return (
        <Box css={styles.field} data-preview-row={field.row}>
            <Box as="span" css={styles.fieldName}>{m.previewFieldName({ row: field.row, field: field.field })}</Box>
            <Box css={styles.fieldLine}>
                <Box as="span" css={styles.fieldWas}>{field.changed && op !== "add" ? field.was : ""}</Box>
                <Box as="span" css={styles.fieldNow} title={tip} data-op={op} data-preview-field={field.field}>
                    {field.confidence !== undefined && <Guess confidence={field.confidence} words={words} styles={styles} />}
                    {(op === "del" ? field.was : field.is) ?? m.previewBlank()}
                </Box>
            </Box>
        </Box>
    );
}

/** A plot's place, as the recipe reads it. */
const at = (name: string, percent: number): CSSProperties => ({ [name]: `${percent}%` }) as CSSProperties;

/** A record's mix (P10): its rows on one axis from zero, the value held hollow and the one proposed glowing, joined. */
function Mix({ model, name, words, styles }: { readonly model: MixModel; readonly name: string; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const { m } = words;
    return (
        <Box css={styles.chart}>
            <Box css={styles.chartHead} aria-hidden="true">
                <Box as="span" css={styles.chartCaption}>{name}</Box>
                <Box css={styles.chartTicks} data-preview-axis="x">{model.ticks.map(tick => <span key={tick}>{words.compact(tick)}</span>)}</Box>
                <Box as="span" css={styles.chartCaption} data-align="end">{m.previewCaption({ caption: "change" })}</Box>
            </Box>
            {model.rows.map(row => {
                const from = Math.min(row.wasAt, row.nowAt);
                return (
                    <Box key={row.key} css={styles.chartRow} data-preview-row={row.name}
                        title={m.previewMeasure({ name: row.name, was: words.number(row.was), now: words.number(row.now), same: row.same })}>
                        <Box as="span" css={styles.chartName}>
                            {row.confidence !== undefined && <Guess confidence={row.confidence} words={words} styles={styles} />}
                            {row.name}
                        </Box>
                        <Box css={styles.chartPlot}>
                            <Box as="span" css={styles.rail} />
                            {!row.same && <Box as="span" css={styles.span} style={{ ...at("--pv-left", from), ...at("--pv-width", Math.abs(row.nowAt - row.wasAt)) }} />}
                            {!row.same && <Box as="span" css={styles.dot} data-at="was" style={at("--pv-at", row.wasAt)} />}
                            <Box as="span" css={styles.dot} data-at="now" data-op={row.same ? undefined : "chg"} data-fill={row.same ? undefined : "own"}
                                style={at("--pv-at", row.nowAt)} />
                        </Box>
                        <Box as="span" css={styles.chartFigure} data-same={flag(row.same)}>
                            {row.same ? words.number(0) : words.value(row.now - row.was, undefined, true)}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}

/** The groups a change touches (P11): each one's track its size, the part that changes glowing, its count and its net change. */
function Groups({ groups, caption, marked, net, words, styles }: {
    readonly groups: readonly GroupRow[]; readonly caption: string; readonly marked: boolean; readonly net: (row: GroupRow) => string | undefined;
    readonly words: DecisionQueueWords; readonly styles: SlotStyles;
}) {
    const { m } = words;
    return (
        <Box css={styles.chart}>
            <Box css={styles.chartHead} aria-hidden="true">
                <Box as="span" css={styles.chartCaption}>{caption}</Box>
                <Box as="span" css={styles.chartCaption}>{m.previewCaption({ caption: "changed" })}</Box>
                <Box as="span" css={styles.chartCaption} data-align="end">{m.previewCaption({ caption: "rows" })}</Box>
                <Box as="span" css={styles.chartCaption} data-align="end">{m.previewCaption({ caption: "net" })}</Box>
            </Box>
            {groups.map(row => {
                const change = net(row);
                const trend = row.net === undefined || sameNumber(row.net, 0) ? undefined : compareNumber(row.net, 0) > 0 ? faCaretUp : faCaretDown;
                return (
                    <Box key={row.name} css={styles.chartRow} data-preview-row={row.name}
                        title={m.previewGroup({ name: row.name, n: words.number(row.n), of: words.number(row.of), net: change })}>
                        <Box as="span" css={styles.chartName}>{row.name}</Box>
                        <Box css={styles.chartPlot}>
                            <Box as="span" css={styles.track} style={at("--pv-width", row.size)} />
                            <Box as="span" css={styles.part} data-op={marked ? "chg" : undefined} data-fill="own" style={at("--pv-width", row.part)} />
                        </Box>
                        <Box as="span" css={styles.chartFigure}>{words.number(row.n)}</Box>
                        <Box as="span" css={styles.chartFigure} data-tone="neither">
                            {trend !== undefined && <Box as="span" css={styles.trend} aria-hidden="true"><FontAwesomeIcon icon={trend} /></Box>}
                            {change ?? ""}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}
