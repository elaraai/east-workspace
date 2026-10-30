/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A lanes crop, drawn (`Decision Queue Spec.md` D8, P13–P17, P19, P20, P24, P25): the
 * Plan's, the Calendar's and the Allocation's ruler over the window, its ticks
 * the window's hours, days or weeks, and a lane a resource the change touches,
 * the Allocation's waiting row, or a day it lands on: its name and its measure
 * before → after in its tone at its head — the Plan's booked share, the
 * Calendar's overlaps, the Allocation's load — and on its plot the grid, the
 * now line where the window holds it that day, and its entries — each at its
 * place in the lane's stack, the change's marked, its ghosts dashed, its lock
 * and its conflict; an Allocation's its bins and its resources' jobs, as the
 * board draws them. What it draws is
 * {@link lanesPreview}'s. Past two lanes, the kind's map (P5, P12): the
 * resources of the kinds the change lands on as tiles under their groups'
 * labels, and the when strip of the new times it gives its events
 * (`lanesMap`'s). The `decisionPreview` recipe draws both from the
 * attributes and the geometry set here.
 *
 * @packageDocumentation
 */

import type { CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { DateTimeType, FloatType, StringType, equalFor } from "@elaraai/east";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { allocationWords } from "../../allocation/model.js";
import { dayStart } from "../../shared/schedule/window.js";
import type { DecisionQueueWords, PreviewCountWords } from "../messages.js";
import { PreviewFrame, flag, staleNames } from "./frame.js";
import { nowShare, type LaneBar, type LaneBreach, type LaneClause, type LaneRow, type LaneUnit, type LaneWindow, type LanesModel } from "./lanes-model.js";
import type { MapModel, MapTile, MapWhen } from "./map-model.js";

const sameDate = equalFor(DateTimeType);
const sameNumber = equalFor(FloatType);
const sameString = equalFor(StringType);

/** A place along the window, as the recipe reads it. */
const at = (share: number): CSSProperties => ({ "--pv-at": `${share * 100}%` } as CSSProperties);

/** Whether a window runs over more than one UTC day: then its times name their day. */
function manyDays(w: LaneWindow): boolean {
    return !sameDate(dayStart(w.from), dayStart(new Date(w.to.getTime() - 1)));
}

/**
 * How a lanes crop words a time: its hour and minute alone; after its weekday, where the window runs over more than one
 * UTC day; after its weekday and date, where its ruler steps by weeks, so a weekday alone names more than one day.
 */
type Dated = "time" | "weekday" | "date";

/** How a window's times are worded ({@link Dated}). */
function datedOf(w: LaneWindow): Dated {
    return w.unit === "week" ? "date" : manyDays(w) ? "weekday" : "time";
}

/** A time, as a lanes crop words it ({@link Dated}). */
function timeText(d: Date, dated: Dated, words: DecisionQueueWords): string {
    switch (dated) {
        case "time": return words.time(d);
        case "weekday": return `${words.weekday(d)} ${words.time(d)}`;
        case "date": return `${dayText(d, words)} ${words.time(d)}`;
    }
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
 * alike; its overlaps so; or its load, a quantity as the Allocation's board words it, its unit after.
 */
function measureText(row: LaneRow, model: LanesModel, words: DecisionQueueWords): string {
    switch (model.measure) {
        case "overlaps": return words.m.previewOverlaps({
            before: words.number(row.before), after: words.number(row.after), n: row.after, same: sameNumber(row.before, row.after), free: row.free,
        });
        case "load": {
            const { quantity } = allocationWords();
            return words.m.previewLoad({ before: quantity(row.before, ""), after: quantity(row.after, model.unit), same: sameNumber(row.before, row.after) });
        }
        case "share": {
            const before = Math.round(row.before * 100), after = Math.round(row.after * 100);
            return words.m.previewShare({ before: words.number(before), after: words.percent(row.after), same: sameNumber(before, after) });
        }
    }
}

/** Whether a clause is of an event the option knocks on (P16): moved, along its lane or onto another. */
const knocked = (c: LaneClause): c is Extract<LaneClause, { kind: "move" | "reschedule" }> => (c.kind === "move" || c.kind === "reschedule") && c.knock;

/**
 * A lanes crop's sentence (P25): what moves where — each with what it breaks once the change is made (P15) — and the
 * knock-ons it pushes (P16), then the entries it leaves pinned (P17) and the rows the model guessed; with nothing marked, the lanes it would land on; stale, what the change touches, which moved after
 * the model's run (P21).
 *
 * @param model - The crop
 * @param guessed - The keys of the changed rows the model guessed (P26)
 * @param stale - Whether the change no longer applies
 * @param words - The queue's words
 * @returns The sentence
 */
export function lanesSentence(model: LanesModel, guessed: readonly string[], stale: boolean, words: DecisionQueueWords): string {
    const { m } = words;
    const dated = datedOf(model.window);
    const time = (d: Date) => timeText(d, dated, words);
    const clause = (c: LaneClause): string => {
        switch (c.kind) {
            case "move": return m.previewEvent({ kind: "move", what: c.what, from: c.from, to: c.to, verb: c.verb, start: time(c.start), end: time(c.end), overlapped: c.overlapped, breach: c.breach });
            case "reschedule": return m.previewEvent({ kind: "reschedule", what: c.what, on: c.on, start: time(c.start), end: time(c.end), overlapped: c.overlapped, breach: c.breach });
            case "add": return m.previewEvent({ kind: "add", what: c.what, on: c.on, verb: c.verb, start: time(c.start), end: time(c.end), breach: c.breach });
            case "remove": return m.previewEvent({ kind: "remove", what: c.what, from: c.from });
            case "change": return m.previewEvent({ kind: "change", what: c.what, on: c.on });
        }
    };
    if (stale) {
        const names = model.clauses.map(c => c.what).filter((what, i, all) => all.findIndex(other => sameString(other, what)) === i);
        return m.previewStale({ names: staleNames(names, words) });
    }
    if (model.clauses.length === 0) return m.previewUnchanged({ names: m.previewList({ items: model.rows.map(row => row.name) }) });
    // The change's own clauses, then the knock-ons the last pushes; knock-ons alone say what moves.
    const own = model.clauses.filter(c => !knocked(c));
    const pushes = own.length === 0 ? [] : model.clauses.filter(knocked);
    return m.previewSentence({
        clauses: (own.length === 0 ? model.clauses : own).map(clause),
        pushes: pushes.length === 0 ? undefined : m.previewPushes({
            pushes: pushes.map(c => (c.kind === "move" ? { what: c.what, onto: c.to, start: time(c.start) } : { what: c.what, was: time(c.was), start: time(c.start) })),
        }),
        marks: model.pinned.map(p => m.previewPinned({ what: p.what, on: p.on })),
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
    const dated = datedOf(model.window);
    // An Allocation's entries are its bins and its resources' jobs, as the board draws them.
    const shape = kind === "allocation" ? "bin" : undefined;
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
                                <Box as="span" css={styles.measure} data-tone={row.tone}>{measureText(row, model, words)}</Box>
                            </Box>
                            <Box css={styles.plot}>
                                {model.grid.map(line => <Box as="span" key={line} css={styles.gridLine} style={at(line)} />)}
                                {nowAt !== undefined && <Box as="span" css={styles.now} style={at(nowAt)} data-preview-now="" />}
                                {row.bars.map(bar => <Bar key={`${bar.key}.${bar.op ?? ""}`} bar={bar} shape={shape} dated={dated} words={words} styles={styles} />)}
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        </PreviewFrame>
    );
}

/** What an entry, or a map's tile, breaks once the change is made, worded (P15): the entry it overlaps, or the check's words. */
function breachText(breach: LaneBreach | undefined, words: DecisionQueueWords): string | undefined {
    return breach === undefined ? undefined : breach.kind === "overlap" ? words.m.previewOverlap({ with: breach.with }) : breach.text;
}

/** An entry's title (P25): what it is and when it runs, and how the change marks it. */
function barTitle(bar: LaneBar, dated: Dated, words: DecisionQueueWords): string {
    const { m } = words;
    const span = (start: Date, end: Date) => m.previewSpan({ start: timeText(start, dated, words), end: timeText(end, dated, words) });
    return m.previewTile({
        what: bar.title, when: span(bar.start, bar.end), op: bar.op,
        to: bar.to === undefined ? undefined : bar.to.name ?? span(bar.to.start, bar.to.end),
        knock: bar.knock, locked: bar.locked,
        breach: breachText(bar.breach, words),
    });
}

/** Props of {@link Bar}. */
interface BarProps {
    /** The entry. */
    readonly bar: LaneBar;
    /** How its kind draws an entry: an Allocation's as a bin, the board's card; else the builder's bar, its own fill kept where the change proposes it. */
    readonly shape: "bin" | undefined;
    /** How its times are worded. */
    readonly dated: Dated;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionPreview` recipe's styles. */
    readonly styles: SlotStyles;
}

/** An entry on a lane: its title, its lock and its conflict. */
function Bar({ bar, shape, dated, words, styles }: BarProps) {
    const place = { "--pv-left": `${bar.left * 100}%`, "--pv-width": `${bar.width * 100}%`, "--pv-lane": `${bar.lane}` } as CSSProperties;
    const proposed = bar.op === "add" || bar.op === "chg";
    return (
        <Box as="span" css={styles.bar} style={place} title={barTitle(bar, dated, words)}
            data-preview-tile={bar.key} data-op={bar.op} data-shape={shape} data-look={bar.look}
            data-fill={shape === undefined && proposed ? "own" : undefined}
            data-knock={flag(bar.knock)} data-breach={flag(bar.breach !== undefined)}>
            <Box as="span" css={styles.barText}>{bar.title}</Box>
            {bar.locked && <Box as="span" css={styles.icon} aria-hidden="true"><FontAwesomeIcon icon={faLock} /></Box>}
            {bar.breach !== undefined && <Box as="span" css={styles.icon} data-tone="warn" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
        </Box>
    );
}

/** What a map's words count with: the events its tiles count, one and many, and the resources its sentence counts. */
export interface MapNouns {
    /** One event, as a tile's title counts it — `print job`. */
    readonly event: string;
    /** Several, as a tile's title and the sentence count them — `print jobs`. */
    readonly events: string;
    /** The resources, as the sentence and the rest of a group's tile count them — `presses`, or `resources` across kinds. */
    readonly resources: string;
}

/** A map, as a preview's read gives it: what it draws, and the nouns its words count with. */
export interface PreviewMap {
    /** What it draws (`lanesMap`'s). */
    readonly model: MapModel;
    /** Its nouns. */
    readonly nouns: MapNouns;
}

/**
 * A map's sentence (P5, P25): how many of the resources the change touches — of how many, where the kinds' every
 * resource is in hand — the one it lands the most events on, those it only takes events off, then the rows the model
 * guessed.
 *
 * @param map - The map
 * @param guessed - The keys of the changed rows the model guessed (P26)
 * @param words - The queue's words
 * @returns The sentence — `10 of 24 presses change; Press C4 takes 4 print jobs, Press A7 and Press C8 lose theirs`
 */
export function mapSentence(map: PreviewMap, guessed: readonly string[], words: DecisionQueueWords): string {
    const { m } = words;
    const { model, nouns } = map;
    const freed = model.freed;
    return m.previewMap({
        n: words.number(model.changed), one: model.changed === 1, of: model.of === undefined ? undefined : words.number(model.of), resources: nouns.resources,
        most: model.most === undefined ? undefined : { name: model.most.name, n: words.number(model.most.n), events: nouns.events },
        freed: freed.length === 0 ? undefined : {
            names: m.previewList({ items: freed.map(f => f.name) }), one: freed.length === 1,
            events: freed.length === 1 && freed[0]!.loses === 1 ? nouns.event : nouns.events,
        },
        guessed: guessed.length === 0 ? undefined : { keys: m.previewList({ items: guessed }), n: guessed.length },
    });
}

/** Props of {@link LanesMap}. */
export interface LanesMapProps {
    /** The target's kind: the frame's height (P2). */
    readonly kind: "plan" | "calendar" | "allocation";
    /** What it draws, and the nouns its words count with. */
    readonly map: PreviewMap;
    /** Its sentence (P25). */
    readonly label: string;
    /** Whether the change no longer applies (P21). */
    readonly stale: boolean;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionPreview` recipe's styles. */
    readonly styles: SlotStyles;
}

/**
 * A builder's map (P5, P12): the resources of the kinds the change lands on, a row of tiles under each group's label —
 * lit where it lands or changes events, a ghost where it only takes them off, ringed where it knocks one on or breaks a
 * rule — and under them the when strip, a tick at each new time it gives an event.
 *
 * @param props - Its kind, what it draws, its sentence and state ({@link LanesMapProps})
 * @returns The map
 */
export function LanesMap({ kind, map, label, stale, words, styles }: LanesMapProps) {
    return (
        <PreviewFrame kind={kind} layout="map" label={label} stale={stale} styles={styles}>
            <Box css={styles.map} data-preview-map="">
                {map.model.rows.map(row => (
                    <Box key={row.group} css={styles.mapRow} data-preview-group={row.group}>
                        <Box as="span" css={styles.mapLabel} title={row.group}>{row.group}</Box>
                        <Box as="span" css={styles.mapTiles}>
                            {row.tiles.map(tile => <Tile key={tile.key} tile={tile} nouns={map.nouns} words={words} styles={styles} />)}
                        </Box>
                    </Box>
                ))}
                {map.model.when !== undefined && <WhenStrip when={map.model.when} words={words} styles={styles} />}
            </Box>
        </PreviewFrame>
    );
}

/** A tile's title (P25): its resource and what the change does there; the rest of a group's, how many resources it stands for. */
function tileTitle(tile: MapTile, nouns: MapNouns, words: DecisionQueueWords): string {
    const { m } = words;
    if (tile.more > 0) return m.previewMapMore({ n: words.number(tile.more), resources: nouns.resources, title: true });
    const count = (n: number): PreviewCountWords | undefined => (n === 0 ? undefined : { n: words.number(n), one: n === 1, noun: n === 1 ? nouns.event : nouns.events });
    return m.previewMapTile({ name: tile.name, takes: count(tile.takes), knocks: count(tile.knocks), loses: count(tile.loses), breach: breachText(tile.breach, words) });
}

/** A map's tile: a resource's short name, marked as the change leaves it; or the count of the rest of its group. */
function Tile({ tile, nouns, words, styles }: { readonly tile: MapTile; readonly nouns: MapNouns; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    return (
        <Box as="span" css={styles.mapTile} title={tileTitle(tile, nouns, words)} data-preview-tile={tile.key} data-op={tile.op}
            data-knock={flag(tile.knocks > 0)} data-breach={flag(tile.breach !== undefined)} data-more={flag(tile.more > 0)}>
            {tile.more > 0 ? words.m.previewMapMore({ n: words.number(tile.more), resources: nouns.resources, title: false }) : tile.label}
        </Box>
    );
}

/** A when strip's window, worded: its hours — the end of the day its 24 — its weekdays, or its weeks' first days. */
function whenText(w: LaneWindow, words: DecisionQueueWords): string {
    const last = new Date(w.to.getTime() - 1);
    switch (w.unit) {
        case "hour": {
            const end = w.to.getUTCHours() === 0 ? 24 : w.to.getUTCHours();
            return words.m.previewSpan({ start: tickText(w.from, "hour", words), end: words.number(end).padStart(2, words.number(0)) });
        }
        case "day": return words.m.previewSpan({ start: words.weekday(w.from), end: words.weekday(last) });
        case "week": return words.m.previewSpan({ start: words.monthDay(w.from), end: words.monthDay(last) });
    }
}

/** The when strip under a map (P12): its window's words, its grid, and a tick at each new time the change gives an event. */
function WhenStrip({ when, words, styles }: { readonly when: MapWhen; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const dated = datedOf(when.window);
    const label = whenText(when.window, words);
    return (
        <Box css={styles.when} data-preview-when="">
            <Box as="span" css={styles.whenLabel} title={label}>{label}</Box>
            <Box as="span" css={styles.whenStrip}>
                {when.grid.map(line => <Box as="span" key={line} css={styles.gridLine} style={at(line)} />)}
                {when.ticks.map(tick => (
                    <Box as="span" key={tick.landing.key} css={styles.whenTick} style={at(tick.at)} data-preview-tick={tick.landing.key}
                        title={words.m.previewWhen({ time: timeText(tick.landing.start, dated, words), what: tick.landing.what, added: tick.landing.added })} />
                ))}
            </Box>
        </Box>
    );
}
