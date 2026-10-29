/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Roster target's preview (`Decision Queue Spec.md` D7, D8, P4, P5,
 * P13–P25): the week the change lands in, read through the duty kind's `rows`
 * — tracked, so the read landing draws it — and drawn at the Roster's own
 * sizes from its own recipe: the people it lands on, at most two, as the
 * People week's crop — their rows 36 tall, a day's duty the Roster's tile in
 * its shift's colour token, an off day its `+ Assign` wash — or, past two, the
 * map by people, rows 16 and marks 12, four of them and the count of the
 * rest. What the change proposes takes the steady glow, what it moves off or
 * removes is a ghost, and each person's hours read before → after
 * ({@link rosterPreview}).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { BlobType, FloatType, SortedMap, StringType, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useSlotStyles, type SlotStyles } from "@elaraai/east-ui-components/internal";
import {
    compareString, rosterContext, rosterDomain, shiftColor, shiftOf, weekWindow,
    type DraftedDuty, type RosterPayload, type StoredDuty,
} from "../../roster/model.js";
import { DAY, weekStart } from "../../shared/schedule/window.js";
import { appliedRows, standingRow, type DecisionTarget } from "../editing.js";
import type { DecisionQueueWords } from "../messages.js";
import { NAMED, PreviewFailed, PreviewFrame, PreviewPending, flag, guessedOf, leftBy, sharedOf, staleNames, type PreviewProps } from "./frame.js";
import { WEEK_DAYS, firstStart, rosterPreview, type RosterPreviewModel, type RosterPreviewRow, type RosterPreviewTile } from "./roster-model.js";

/** A Roster target's kind, decoded. */
type RosterKind = Extract<DecisionTarget["kind"], { type: "roster" }>["value"];

/** What the preview's read gives: the model, a read in flight, or nothing it touches in a week. */
type RosterRead = { readonly state: "ready"; readonly model: RosterPreviewModel } | { readonly state: "pending" } | { readonly state: "empty" };

/** The most people the crop draws: past them, the map (D7). */
const CROP_PEOPLE = 2;
/** The most people the map draws: past them, its count (P5). */
const MAP_PEOPLE = 4;
const PENDING: RosterRead = { state: "pending" };
const EMPTY: RosterRead = { state: "empty" };
const blobEqual = equalFor(BlobType);
const sameHours = equalFor(FloatType);
const stringEqual = equalFor(StringType);
const NOT_LOCKED = (): boolean => false;

/** The duties a read gives, each kept as it was where its bytes are: a read again draws nothing again. */
function keptDuties(read: ReadonlyMap<string, { roles: StoredDuty["roles"]; row: Uint8Array }>, held: ReadonlyMap<string, StoredDuty> | undefined,
    decode: (bytes: Uint8Array) => unknown): ReadonlyMap<string, StoredDuty> {
    const out = new SortedMap<string, StoredDuty>([], compareString);
    let same = held !== undefined && held.size === read.size;
    for (const [key, entry] of read) {
        const was = held?.get(key);
        if (was !== undefined && blobEqual(was.bytes, entry.row)) { out.set(key, was); continue; }
        same = false;
        out.set(key, { roles: entry.roles, bytes: entry.row, row: decode(entry.row) });
    }
    return same && held !== undefined ? held : out;
}

/** Props of {@link RosterPreview}. */
export interface RosterPreviewProps extends PreviewProps {
    /** The target's Roster kind. */
    readonly kind: RosterKind;
}

/**
 * A Roster target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link RosterPreviewProps})
 * @returns The preview
 */
export function RosterPreview({ c, view, target, kind, record, rows, changed, schedule, shared, words, styles }: RosterPreviewProps) {
    const roster = kind.roster;
    const roles = useSlotStyles("rosterBuilder");
    const domain = useMemo(() => rosterDomain(roster.duty.rowType), [roster]);
    const context = useMemo(() => rosterContext(roster), [roster]);
    const held = useRef<ReadonlyMap<string, StoredDuty> | undefined>(undefined);
    const option = view.option;
    const read = useCallback((): RosterRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        const duty = (key: string, bytes: Uint8Array | undefined): DraftedDuty | undefined =>
            (bytes === undefined ? undefined : { bytes, roles: roster.duty.read(bytes, key), row: domain.decodeRow(bytes) });
        const before = new Map<string, DraftedDuty | undefined>(), after = new Map<string, DraftedDuty | undefined>();
        const lands = new Map<string, DraftedDuty | undefined>();
        let marked = true;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) {
                before.set(row.key, duty(row.key, row.standing));
                after.set(row.key, duty(row.key, leftBy(row)));
            }
        } else {
            // Stale (P21): the rows the proposal touched, as they stand, its own marks dashed. Changing nothing (P4): the
            // rows the recommendation touches, and the people it would land them on, as they stand, unmarked — where the
            // recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = stale;
            if (o === undefined || record === undefined) return EMPTY;
            for (const key of target.touched(o.change.patch)) {
                const got = standingRow(schedule, record, key);
                if (got.type !== "some") return PENDING;
                const d = duty(key, got.value.type === "some" ? got.value.value : undefined);
                before.set(key, d);
                after.set(key, d);
            }
            if (theirs) {
                const applied = appliedRows(schedule, target, record, recommended);
                if (applied.state === "reading") return PENDING;
                if (applied.state === "ready") for (const [key, bytes] of applied.rows) lands.set(key, duty(key, bytes));
            }
        }
        const first = firstStart([...before.values(), ...after.values()]);
        if (first === undefined) return EMPTY;
        const start = weekStart(first, roster.settings.weekStart.type === "sunday");
        const window = weekWindow(start);
        const got = roster.duty.rows(window.from, window.to);
        if (got.type !== "some") return PENDING;
        const stored = keptDuties(got.value, held.current, domain.decodeRow);
        held.current = stored;
        // The queue's own drafts of the duty record — verdicts drafted before this one — in their place.
        const drafts = new Map<string, DraftedDuty | undefined>();
        if (record !== undefined) {
            for (const id of schedule.draftsOf(record.key).keys()) {
                if (before.has(id)) continue;
                const drafted = standingRow(schedule, record, id);
                if (drafted.type === "some") drafts.set(id, duty(id, drafted.value.type === "some" ? drafted.value.value : undefined));
            }
        }
        const knockOn = option?.knockOn;
        const locked = target.locked.type === "some" ? target.locked.value : NOT_LOCKED;
        return {
            state: "ready",
            model: rosterPreview({
                domain, roster, context, start, stored, drafts, before, after, lands, marked,
                knockOn: key => knockOn?.has(key) === true,
                locked: (bytes, key) => locked(bytes, key),
                shared: key => (record === undefined ? 0 : sharedOf(shared, record.key, key)),
            }),
        };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, roster, domain, context, shared]);
    const { result } = useTrackedEvaluation(read);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its week:`, result.error);
        return <PreviewFailed kind="roster" layout="roster" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="roster" layout="roster" rows={CROP_PEOPLE} cells={WEEK_DAYS} words={words} styles={styles} />;
    if (got.state === "empty") {
        return <PreviewFrame kind="roster" layout="roster" label={option?.detail ?? ""} stale={stale} styles={styles} />;
    }
    const model = got.model;
    const map = model.rows.length > CROP_PEOPLE;
    const label = sentence(model, words, guessedOf(view.option?.guesses, changed), map, stale);
    return map
        ? <PeopleMap model={model} label={label} stale={stale} words={words} styles={styles} roles={roles} roster={roster} />
        : <Crop model={model} label={label} stale={stale} words={words} styles={styles} roles={roles} roster={roster} />;
}

/** The day of the week a preview's day is. */
function dayOf(model: RosterPreviewModel, day: number): Date {
    return new Date(model.start.getTime() + day * DAY);
}

/**
 * The preview's sentence (P25): what moves where — a map's, how many of the staff change, how many of them gain or
 * change shifts and who loses them — and the rows the model guessed; stale, whose shifts the change touched (P21).
 */
function sentence(model: RosterPreviewModel, words: DecisionQueueWords, guessed: readonly string[], map: boolean, stale: boolean): string {
    const { m } = words;
    const named = (rows: readonly RosterPreviewRow[]) => m.previewList({ items: rows.map(row => row.name) });
    if (stale) return m.previewStale({ names: staleNames(model.rows.map(row => row.name), words), whose: true });
    const when = (day: number) => words.weekday(dayOf(model, day));
    const days = (list: readonly number[]) => m.previewList({ items: list.map(when) });
    const clauses = model.clauses.map(clause => {
        switch (clause.kind) {
            case "move": return m.previewClause({ kind: "move", from: clause.from, to: clause.to, what: clause.shift, n: clause.days.length, days: days(clause.days) });
            case "add": case "remove": return m.previewClause({ kind: clause.kind, who: clause.who, what: clause.shift, n: clause.days.length, days: days(clause.days) });
            case "reschedule":
                return m.previewClause({ kind: "reschedule", who: clause.who, what: clause.shift, when: when(clause.day), toWhat: clause.toShift, toWhen: when(clause.toDay) });
            case "change": return m.previewClause({ kind: "change", who: clause.who, what: clause.shift, when: when(clause.day) });
        }
    });
    if (clauses.length === 0) return m.previewUnchanged({ names: named(model.rows) });
    const guess = guessed.length === 0 ? undefined : { keys: m.previewList({ items: guessed }), n: guessed.length };
    if (!map) return m.previewSentence({ clauses, guessed: guess });
    // A map counts who changes (P5): those the change leaves fewer duties lose shifts, named while few; the rest gain or change theirs.
    const lose = model.rows.filter(row => row.duties.after < row.duties.before);
    const gain = model.rows.length - lose.length;
    return m.previewSentence({
        clauses: [m.previewShifts({
            gain: gain === 0 ? undefined : { n: words.number(gain), one: gain === 1 },
            lose: lose.length === 0 ? undefined : lose.length > NAMED ? { n: words.number(lose.length) } : { names: named(lose), one: lose.length === 1 },
        })],
        people: { n: words.number(model.rows.length), of: words.number(model.people) },
        guessed: guess,
    });
}

/** A row's measure, worded (P4): hours before → after, or against the contract; an agency's requests. */
function measureText(row: RosterPreviewRow, words: DecisionQueueWords, compact: boolean): string {
    const { m } = words;
    const measure = row.measure;
    if (measure.kind === "requests") return m.previewRequests({ n: words.number(measure.n), one: measure.n === 1 });
    return m.previewHours({
        before: words.number(measure.before), after: words.number(measure.after), same: sameHours(measure.before, measure.after),
        contract: measure.contract === undefined || measure.contract <= 0 ? undefined : words.number(measure.contract), compact,
    });
}

/** What the views share. */
interface ViewProps {
    readonly model: RosterPreviewModel;
    readonly label: string;
    readonly stale: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    /** The Roster's own recipe: its tile, its off day's wash and its mark. */
    readonly roles: SlotStyles;
    readonly roster: RosterPayload;
}

/** An entry's fill: its shift's colour token, as the Roster draws it (P19). */
function fillOf(roster: RosterPayload, shift: string): CSSProperties | undefined {
    const color = shiftColor(shiftOf(roster, shift));
    return color === undefined ? undefined : { "--roster-fill": color.fill, "--roster-ink": color.ink } as CSSProperties;
}

/** An entry's title (P25): its shift and day, and how the change marks it. */
function tileTitle(tile: RosterPreviewTile, day: Date, roster: RosterPayload, words: DecisionQueueWords): string {
    const { m } = words;
    return m.previewTile({
        what: shiftOf(roster, tile.shift)?.label ?? tile.shift, when: `${words.weekday(day)} ${words.number(day.getUTCDate())}`,
        op: tile.op, to: tile.to, knock: tile.knock, locked: tile.locked, breach: tile.breach,
        shared: tile.shared > 0 ? { n: words.number(tile.shared), one: tile.shared === 1 } : undefined,
    });
}

/** The day head's caption: the weekday's letter, as the Roster's month letters it, and the date, two places. */
function DayHead({ date, words, styles }: { readonly date: Date; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    return (
        <Box as="span" css={styles.headerCell}>
            {words.weekday(date).slice(0, 1).toLocaleUpperCase(words.locale)}
            <b>{words.number(date.getUTCDate()).padStart(2, words.number(0))}</b>
        </Box>
    );
}

/** The crop (P4): the people the change lands on, as the People week draws them. */
function Crop({ model, label, stale, words, styles, roles, roster }: ViewProps) {
    return (
        <PreviewFrame kind="roster" layout="roster" label={label} stale={stale} styles={styles}>
            <Box css={styles.header} aria-hidden="true">
                <Box as="span" css={styles.headerCell} />
                {Array.from({ length: WEEK_DAYS }, (_, day) => <DayHead key={day} date={dayOf(model, day)} words={words} styles={styles} />)}
            </Box>
            {model.rows.map(row => (
                <Box key={row.key} css={styles.row} data-preview-row={row.name}>
                    <Box css={styles.rowHead}>
                        <Box as="span" css={styles.rowName}>{row.name}</Box>
                        <Box as="span" css={styles.measure} data-tone={row.tone}>{measureText(row, words, false)}</Box>
                    </Box>
                    {row.days.map((tiles, day) => (
                        <Box key={day} css={styles.cell}>
                            {tiles.length === 0
                                ? <Box as="span" css={[roles.assign, styles.off]} data-preview-off="" />
                                : tiles.map(tile => <Tile key={`${tile.key}.${tile.op ?? ""}`} tile={tile} day={dayOf(model, day)} words={words} styles={styles} roles={roles} roster={roster} />)}
                        </Box>
                    ))}
                </Box>
            ))}
        </PreviewFrame>
    );
}

/** A duty's tile in the crop: the Roster's tile, its shift's code, its marks, its lock and its rule broken, and the `+N` of other cases. */
function Tile({ tile, day, words, styles, roles, roster }: {
    readonly tile: RosterPreviewTile; readonly day: Date; readonly words: DecisionQueueWords; readonly styles: SlotStyles; readonly roles: SlotStyles;
    readonly roster: RosterPayload;
}) {
    const shift = shiftOf(roster, tile.shift);
    return (
        <Box as="span" css={[roles.tile, styles.tile]} style={fillOf(roster, tile.shift)} title={tileTitle(tile, day, roster, words)}
            data-preview-tile={tile.key} data-op={tile.op} data-fill={tile.op === "add" || tile.op === "chg" ? "own" : undefined}
            data-knock={flag(tile.knock)} data-breach={flag(tile.breach !== undefined)}>
            <span data-tile-label="">{shift?.code ?? tile.shift}</span>
            {tile.locked && <Box as="span" css={styles.icon} aria-hidden="true"><FontAwesomeIcon icon={faLock} /></Box>}
            {tile.breach !== undefined && <Box as="span" css={styles.icon} data-tone="warn" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
            {tile.shared > 0 && <Box as="span" css={styles.shared} data-preview-shared="">{words.m.previewShared({ n: words.number(tile.shared) })}</Box>}
        </Box>
    );
}

/** The map by people (P5): every person the change touches as the People month marks them, four rows, then the count of the rest. */
function PeopleMap({ model, label, stale, words, styles, roles, roster }: ViewProps) {
    const { m } = words;
    const shown = model.rows.slice(0, MAP_PEOPLE);
    const more = model.rows.length - shown.length;
    return (
        <PreviewFrame kind="roster" layout="people" label={label} stale={stale} styles={styles}>
            <Box css={styles.people}>
                <Box css={styles.peopleRow} data-head="" aria-hidden="true">
                    <span />
                    {Array.from({ length: WEEK_DAYS }, (_, day) => (
                        <Box as="span" key={day} css={styles.peopleDay}>{words.weekday(dayOf(model, day)).slice(0, 1).toLocaleUpperCase(words.locale)}</Box>
                    ))}
                </Box>
                {shown.map(row => (
                    <Box key={row.key} css={styles.peopleRow} data-preview-row={row.name}>
                        <Box css={styles.peopleName}>
                            <Box as="span" css={styles.rowName}>{row.name}</Box>
                            <Box as="span" css={styles.measure} data-tone={row.tone}>{measureText(row, words, true)}</Box>
                        </Box>
                        {row.days.map((tiles, day) => {
                            // A day's mark: what the change leaves there, else what it moves off.
                            const tile = tiles.find(t => t.op !== "from" && t.op !== "del") ?? tiles[0];
                            if (tile === undefined) return <Box as="span" key={day} css={[roles.mark, styles.mark]} data-off="" />;
                            return (
                                <Box as="span" key={day} css={[roles.mark, styles.mark]} style={fillOf(roster, tile.shift)} title={tileTitle(tile, dayOf(model, day), roster, words)}
                                    data-preview-tile={tile.key} data-op={tile.op} data-fill={tile.op === "add" || tile.op === "chg" ? "own" : undefined}
                                    data-knock={flag(tile.knock)} data-breach={flag(tile.breach !== undefined)}>
                                    {shiftOf(roster, tile.shift)?.code ?? tile.shift}
                                </Box>
                            );
                        })}
                    </Box>
                ))}
                <Box css={styles.count}>
                    <Box as="span" css={styles.countText}>{more > 0 ? m.previewMorePeople({ n: words.number(more) }) : ""}</Box>
                    <Box as="span" css={styles.countFigure}>{m.previewCount({ n: words.number(model.rows.length), of: words.number(model.people) })}</Box>
                </Box>
            </Box>
        </PreviewFrame>
    );
}
