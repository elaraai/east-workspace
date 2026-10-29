/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A lanes crop, drawn (`Decision Queue Spec.md` D8, P13–P20, P24, P25): the
 * Plan's and the Calendar's — and the Allocation's after them — ruler over the
 * window, its ticks the window's hours, days or weeks, and a lane a resource
 * the change touches, or a day it lands on: its name and its measure before →
 * after in its tone at its head — the Plan's booked share, the Calendar's
 * overlaps — and on its plot the grid, the now line where the window holds it
 * that day, and its entries — each at its place in the lane's stack, the
 * change's marked, its ghosts dashed, its lock, its conflict and the `+N` of
 * the other cases changing it. What it draws is {@link lanesPreview}'s; the
 * `decisionPreview` recipe draws it from the attributes and the geometry set
 * here.
 *
 * @packageDocumentation
 */

import type { CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { DateTimeType, FloatType, equalFor } from "@elaraai/east";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { dayStart } from "../../shared/schedule/window.js";
import type { DecisionQueueWords } from "../messages.js";
import { PreviewFrame, flag } from "./frame.js";
import { nowShare, type LaneBar, type LaneClause, type LaneMeasure, type LaneRow, type LaneUnit, type LaneWindow, type LanesModel } from "./lanes-model.js";

const sameDate = equalFor(DateTimeType);
const sameNumber = equalFor(FloatType);

/** A place along the window, as the recipe reads it. */
const at = (share: number): CSSProperties => ({ "--pv-at": `${share * 100}%` } as CSSProperties);

/** Whether a window runs over more than one UTC day: then its times name their day. */
function manyDays(w: LaneWindow): boolean {
    return !sameDate(dayStart(w.from), dayStart(new Date(w.to.getTime() - 1)));
}

/** A time, as a lanes crop words it: its hour and minute, after its day where the window runs over more than one. */
function timeText(d: Date, days: boolean, words: DecisionQueueWords): string {
    return days ? `${words.weekday(d)} ${words.time(d)}` : words.time(d);
}

/**
 * A day, as a lanes crop words it — a day ruler's tick, a day lane's name: its weekday and its date.
 *
 * @param d - The day, or an instant in it
 * @param words - The queue's words
 * @returns The day's words — `Thu 1`
 */
export function dayText(d: Date, words: DecisionQueueWords): string {
    return `${words.weekday(d)} ${words.number(d.getUTCDate())}`;
}

/** A tick's words: its hour, two places; its day and date; or its week's first day. */
function tickText(d: Date, unit: LaneUnit, words: DecisionQueueWords): string {
    switch (unit) {
        case "hour": return words.number(d.getUTCHours()).padStart(2, words.number(0));
        case "day": return dayText(d, words);
        case "week": return words.monthDay(d);
    }
}

/**
 * A lane's measure, worded (P24): its booked share before → after, in whole percent, or as it stands where they round
 * alike; or its overlaps so.
 */
function measureText(row: LaneRow, measure: LaneMeasure, words: DecisionQueueWords): string {
    if (measure === "overlaps") {
        return words.m.previewOverlaps({
            before: words.number(row.before), after: words.number(row.after), n: row.after, same: sameNumber(row.before, row.after), free: row.free,
        });
    }
    const before = Math.round(row.before * 100), after = Math.round(row.after * 100);
    return words.m.previewShare({ before: words.number(before), after: words.percent(row.after), same: sameNumber(before, after) });
}

/**
 * A lanes crop's sentence (P25): what moves where, then the rows the model guessed; with nothing marked, the lanes it
 * would land on.
 *
 * @param model - The crop
 * @param guessed - The keys of the changed rows the model guessed (P26)
 * @param words - The queue's words
 * @returns The sentence
 */
export function lanesSentence(model: LanesModel, guessed: readonly string[], words: DecisionQueueWords): string {
    const { m } = words;
    const days = manyDays(model.window);
    const time = (d: Date) => timeText(d, days, words);
    const clause = (c: LaneClause): string => {
        switch (c.kind) {
            case "move": return m.previewEvent({ kind: "move", what: c.what, from: c.from, to: c.to, start: time(c.start), end: time(c.end), overlapped: c.overlapped });
            case "reschedule": return m.previewEvent({ kind: "reschedule", what: c.what, on: c.on, start: time(c.start), end: time(c.end), overlapped: c.overlapped });
            case "add": return m.previewEvent({ kind: "add", what: c.what, on: c.on, start: time(c.start), end: time(c.end) });
            case "remove": return m.previewEvent({ kind: "remove", what: c.what, from: c.from });
            case "change": return m.previewEvent({ kind: "change", what: c.what, on: c.on });
        }
    };
    if (model.clauses.length === 0) return m.previewUnchanged({ names: m.previewList({ items: model.rows.map(row => row.name) }) });
    return m.previewSentence({
        clauses: model.clauses.map(clause),
        guessed: guessed.length === 0 ? undefined : { keys: m.previewList({ items: guessed }), n: guessed.length },
    });
}

/** Props of {@link LanesCrop}. */
export interface LanesCropProps {
    /** The target's kind: the frame's height and the lanes' measures (P2). */
    readonly kind: "plan" | "calendar" | "allocation";
    /** What it draws ({@link lanesPreview}). */
    readonly model: LanesModel;
    /** Its sentence (P25). */
    readonly label: string;
    /** Whether the change no longer applies (P21). */
    readonly stale: boolean;
    /** The time the queue counts from: its now line, where the window holds it — on a day lane, on its day (P20). */
    readonly now: Date;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionPreview` recipe's styles. */
    readonly styles: SlotStyles;
}

/**
 * A lanes crop (see the module docs).
 *
 * @param props - Its kind, what it draws, its sentence and state ({@link LanesCropProps})
 * @returns The crop
 */
export function LanesCrop({ kind, model, label, stale, now, words, styles }: LanesCropProps) {
    const days = manyDays(model.window);
    return (
        <PreviewFrame kind={kind} layout="lanes" label={label} stale={stale} styles={styles}>
            <Box css={styles.lanes}>
                <Box css={styles.ruler} aria-hidden="true" data-preview-ruler="">
                    <span />
                    <Box css={styles.rulerPlot}>
                        {model.ticks.filter(tick => tick.labelled).map(tick => (
                            <Box as="span" key={tick.time.getTime()} css={styles.tick} style={at(tick.at)} data-edge={tick.edge}>
                                {tickText(tick.time, model.window.unit, words)}
                            </Box>
                        ))}
                    </Box>
                </Box>
                {model.rows.map(row => {
                    // A day lane's events are drawn its day earlier, so now is too.
                    const nowAt = nowShare(model.window, new Date(now.getTime() - row.origin));
                    return (
                        <Box key={row.key} css={styles.row} style={{ "--pv-lanes": `${row.lanes}` } as CSSProperties} data-preview-row={row.name}>
                            <Box css={styles.rowHead}>
                                <Box as="span" css={styles.rowName} title={row.name}>{row.name}</Box>
                                <Box as="span" css={styles.measure} data-tone={row.tone}>{measureText(row, model.measure, words)}</Box>
                            </Box>
                            <Box css={styles.plot}>
                                {model.grid.map(line => <Box as="span" key={line} css={styles.gridLine} style={at(line)} />)}
                                {nowAt !== undefined && <Box as="span" css={styles.now} style={at(nowAt)} data-preview-now="" />}
                                {row.bars.map(bar => <Bar key={`${bar.key}.${bar.op ?? ""}`} bar={bar} days={days} words={words} styles={styles} />)}
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        </PreviewFrame>
    );
}

/** An entry's title (P25): what it is and when it runs, and how the change marks it. */
function barTitle(bar: LaneBar, days: boolean, words: DecisionQueueWords): string {
    const { m } = words;
    const span = (start: Date, end: Date) => m.previewSpan({ start: timeText(start, days, words), end: timeText(end, days, words) });
    return m.previewTile({
        what: bar.title, when: span(bar.start, bar.end), op: bar.op,
        to: bar.to === undefined ? undefined : bar.to.name ?? span(bar.to.start, bar.to.end),
        knock: bar.knock, locked: bar.locked,
        breach: bar.overlaps === undefined ? undefined : m.previewOverlap({ with: bar.overlaps }),
        shared: bar.shared > 0 ? { n: words.number(bar.shared), one: bar.shared === 1 } : undefined,
    });
}

/** An entry on a lane: its title, its lock and its conflict, and the `+N` of the other cases changing it. */
function Bar({ bar, days, words, styles }: { readonly bar: LaneBar; readonly days: boolean; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const place = { "--pv-left": `${bar.left * 100}%`, "--pv-width": `${bar.width * 100}%`, "--pv-lane": `${bar.lane}` } as CSSProperties;
    return (
        <Box as="span" css={styles.bar} style={place} title={barTitle(bar, days, words)}
            data-preview-tile={bar.key} data-op={bar.op} data-fill={bar.op === "add" || bar.op === "chg" ? "own" : undefined}
            data-knock={flag(bar.knock)} data-breach={flag(bar.overlaps !== undefined)}>
            <Box as="span" css={styles.barText}>{bar.title}</Box>
            {bar.locked && <Box as="span" css={styles.icon} aria-hidden="true"><FontAwesomeIcon icon={faLock} /></Box>}
            {bar.overlaps !== undefined && <Box as="span" css={styles.icon} data-tone="warn" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
            {bar.shared > 0 && <Box as="span" css={styles.shared} data-preview-shared="">{words.m.previewShared({ n: words.number(bar.shared) })}</Box>}
        </Box>
    );
}
