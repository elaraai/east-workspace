/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Sheet target's preview (`Decision Queue Spec.md` D7, D8, P3, P4, P13,
 * P14, P16–P18, P21, P23, P25, P26): the rows the change touches as the Sheet
 * draws them — each row's bytes, as it stands and as the change leaves it,
 * projected into the Sheet's row by the Sheet's own `project`, its cells
 * printed as the Sheet's columns print them — the first three at the Sheet's
 * 28, under its first column and the columns the change sets after it
 * ({@link sheetCrop}). The rows as they stand are read through the queue's
 * editing — tracked, so a read landing draws them — the queue's drafts of the
 * record in place.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircle, faLock } from "@fortawesome/free-solid-svg-icons";
import { StringType, decodeBeast2For, equalFor } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { cellText, indexColumns } from "../../sheet/model.js";
import type { SheetRowValue } from "../../sheet/values.js";
import { appliedRows, standingRows, type DecisionTarget } from "../editing.js";
import { CONFIDENCE } from "../figures.js";
import type { DecisionQueueWords } from "../messages.js";
import { PreviewFailed, PreviewFrame, PreviewPending, flag, leftBy, sharedOf, staleNames, type PreviewProps } from "./frame.js";
import { CROP_ROWS, sheetCrop, type SheetCropCell, type SheetCropColumn, type SheetCropInput, type SheetCropModel, type SheetCropRow } from "./sheet-model.js";

/** A Sheet target's kind, decoded. */
type SheetKind = Extract<DecisionTarget["kind"], { type: "sheet" }>["value"];

/** What the preview's read gives: the crop, a read in flight, or no row it touches. */
type SheetRead = { readonly state: "ready"; readonly model: SheetCropModel } | { readonly state: "pending" } | { readonly state: "empty" };

const PENDING: SheetRead = { state: "pending" };
const EMPTY: SheetRead = { state: "empty" };
const decodeRow = decodeBeast2For(Sheet.Types.Row);
const stringEqual = equalFor(StringType);
const NOT_LOCKED = (): boolean => false;
const NO_GUESS = (): number | undefined => undefined;

/**
 * The Sheet's columns as the crop draws them: their heads, where their figures sit, and their cells printed as the
 * Sheet prints them.
 *
 * @param sheet - The Sheet's root
 * @param words - The queue's words: their formatters print the cells
 * @returns The columns, in the Sheet's order
 */
function cropColumns(sheet: SheetKind["sheet"]["sheet"], words: DecisionQueueWords): SheetCropColumn[] {
    return indexColumns(sheet.columns).list.map((meta): SheetCropColumn => ({
        key: meta.key,
        header: meta.header,
        figures: meta.kind === "quantity" || meta.kind === "integer" ? "end" : meta.kind === "date" || meta.kind === "stamped" ? "mono" : undefined,
        print: cell => cellText(cell, meta, words),
    }));
}

/** Props of {@link SheetPreview}. */
export interface SheetPreviewProps extends PreviewProps {
    /** The target's Sheet kind. */
    readonly kind: SheetKind;
}

/**
 * A Sheet target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link SheetPreviewProps})
 * @returns The preview
 */
export function SheetPreview({ c, view, target, kind, record, rows, changed, schedule, shared, words, styles }: SheetPreviewProps) {
    const option = view.option;
    const sheet = kind.sheet.sheet;
    const columns = useMemo(() => cropColumns(sheet, words), [sheet, words]);
    const read = useCallback((): SheetRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        if (record === undefined) return EMPTY;
        // A row as the Sheet draws it: its bytes projected by the Sheet's own `project`.
        const project = (key: string, bytes: Uint8Array | undefined): SheetRowValue | undefined =>
            (bytes === undefined ? undefined : decodeRow(sheet.editing.project(bytes, key)));
        const touched: SheetCropInput[] = [], lands: SheetCropInput[] = [];
        const bytesOf = new Map<string, Uint8Array>();
        let marked = true;
        let confidence: (key: string) => number | undefined = NO_GUESS;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) {
                const left = leftBy(row);
                touched.push({ key: row.key, before: project(row.key, row.standing), after: project(row.key, left) });
                const bytes = row.standing ?? left;
                if (bytes !== undefined) bytesOf.set(row.key, bytes);
            }
            const guesses = option?.guesses;
            if (guesses !== undefined) confidence = key => guesses.get(key);
        } else {
            // Stale (P21): the rows the proposal touched, as they stand, marked on their names. Changing nothing (P4): the
            // rows the recommendation touches, as they stand, unmarked, under the columns it would set — where the
            // recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = stale;
            if (o === undefined) return EMPTY;
            const standing = standingRows(schedule, record, target.touched(o.change.patch));
            if (standing.type !== "some") return PENDING;
            for (const [key, bytes] of standing.value) {
                const row = project(key, bytes);
                touched.push({ key, before: row, after: row });
                if (bytes !== undefined) bytesOf.set(key, bytes);
            }
            if (theirs) {
                const applied = appliedRows(schedule, target, record, recommended);
                if (applied.state === "reading") return PENDING;
                if (applied.state === "ready") {
                    for (const [key, bytes] of applied.rows) lands.push({ key, before: project(key, applied.standing.get(key)), after: project(key, bytes) });
                }
            }
        }
        if (touched.length === 0) return EMPTY;
        const knockOn = option?.knockOn;
        const locked = target.locked.type === "some" ? target.locked.value : NOT_LOCKED;
        return {
            state: "ready",
            model: sheetCrop({
                columns, rows: touched, marked, lands, confidence,
                knockOn: key => knockOn?.has(key) === true,
                locked: key => {
                    const bytes = bytesOf.get(key);
                    return bytes !== undefined && locked(bytes, key);
                },
                shared: key => sharedOf(shared, record.key, key),
            }),
        };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, sheet, columns, shared]);
    const { result } = useTrackedEvaluation(read);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its rows:`, result.error);
        return <PreviewFailed kind="sheet" layout="sheet" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="sheet" layout="sheet" rows={CROP_ROWS} cells={1} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="sheet" layout="sheet" label={option?.detail ?? ""} stale={stale} styles={styles} />;
    return <SheetCrop model={got.model} label={sentence(got.model, stale, words)} stale={stale} words={words} styles={styles} />;
}

/**
 * The crop's sentence (P25): the columns the change sets on its rows, the rows it adds and removes — three named, the
 * rest counted — then the rows the model guessed; with nothing marked, the rows drawn; stale, the rows the change
 * touches, which moved after the model's run (P21).
 *
 * @param model - The crop
 * @param stale - Whether the change no longer applies
 * @param words - The queue's words
 * @returns The sentence
 */
function sentence(model: SheetCropModel, stale: boolean, words: DecisionQueueWords): string {
    const { m } = words;
    if (stale) return m.previewStale({ names: staleNames(model.rows.map(row => row.name), words) });
    if (model.clauses.length === 0) return m.previewUnchanged({ names: m.previewList({ items: model.rows.map(row => row.name) }) });
    const named = (rows: readonly string[]) => ({
        rows: rows.slice(0, CROP_ROWS),
        more: rows.length > CROP_ROWS ? words.number(rows.length - CROP_ROWS) : undefined,
    });
    return m.previewSentence({
        clauses: model.clauses.map(clause => (clause.kind === "change"
            ? m.previewCells({ kind: "change", columns: clause.columns, ...named(clause.rows) })
            : m.previewCells({ kind: clause.kind, ...named(clause.rows) }))),
        guessed: model.guessed.length === 0 ? undefined : { keys: m.previewList({ items: model.guessed }), n: model.guessed.length },
    });
}

/** What the crop's parts share. */
interface PartProps {
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
}

/** The crop (P4): the Sheet's head over its first column and the columns the change sets, and the rows it touches, 28 tall. */
function SheetCrop({ model, label, stale, words, styles }: PartProps & { readonly model: SheetCropModel; readonly label: string; readonly stale: boolean }) {
    // The tracks after the first column: the columns drawn, a count only the data knows.
    const tracks = { "--pv-columns": `${Math.max(1, model.columns.length - 1)}` } as CSSProperties;
    return (
        <PreviewFrame kind="sheet" layout="sheet" label={label} stale={stale} styles={styles}>
            <Box css={styles.header} style={tracks} aria-hidden="true">
                {model.columns.map(column => (
                    <Box key={column.key} as="span" css={styles.headerCell} data-align={column.figures === "end" ? "end" : undefined}>{column.header}</Box>
                ))}
            </Box>
            {model.rows.map(row => (
                <Box key={row.key} css={styles.row} style={tracks} data-preview-row={row.name}>
                    <RowName row={row} words={words} styles={styles} />
                    {row.cells.map(cell => <RowCell key={cell.column.key} cell={cell} confidence={row.confidence} words={words} styles={styles} />)}
                </Box>
            ))}
        </PreviewFrame>
    );
}

/** A row's name: its first column's value, its marks, its lock and the `+N` of the other cases changing it (P16–P18). */
function RowName({ row, words, styles }: PartProps & { readonly row: SheetCropRow }) {
    const { m } = words;
    const shared = row.shared > 0 ? { n: words.number(row.shared), one: row.shared === 1 } : undefined;
    return (
        <Box as="span" css={styles.sheetKey} title={m.previewRow({ name: row.name, op: row.op, knock: row.knock, locked: row.locked, shared })}
            data-preview-name="" data-op={row.op} data-fill={row.op !== undefined || row.knock ? "cell" : undefined} data-knock={flag(row.knock)}>
            <span data-value="">{row.name}</span>
            {row.locked && <Box as="span" css={styles.icon} aria-hidden="true"><FontAwesomeIcon icon={faLock} /></Box>}
            {shared !== undefined && <Box as="span" css={styles.shared} data-preview-shared="">{m.previewShared({ n: shared.n })}</Box>}
        </Box>
    );
}

/** A row's cell under a column the crop draws: its value as the change leaves it, its marks and, guessed, the dot (P13, P14, P16, P26). */
function RowCell({ cell, confidence, words, styles }: PartProps & { readonly cell: SheetCropCell; readonly confidence: number | undefined }) {
    const { m } = words;
    const blank = m.previewBlank();
    const title = m.previewCell({
        column: cell.column.header, was: cell.was === "" ? blank : cell.was, is: cell.text === "" ? blank : cell.text, op: cell.op, knock: cell.knock,
    });
    return (
        <Box as="span" css={styles.sheetCell} title={title} data-preview-cell={cell.column.key} data-op={cell.op}
            data-fill={cell.op !== undefined || cell.knock ? "cell" : undefined} data-knock={flag(cell.knock)}
            data-numeric={flag(cell.column.figures === "end")} data-mono={flag(cell.column.figures === "mono")} data-empty={flag(cell.cleared)}>
            {cell.guess && confidence !== undefined && (
                <Box as="span" css={styles.guess} title={m.guess({ confidence: words.value(confidence, CONFIDENCE) })} data-preview-guess="">
                    <FontAwesomeIcon icon={faCircle} />
                </Box>
            )}
            <span data-value="">{cell.cleared ? blank : cell.text}</span>
        </Box>
    );
}
