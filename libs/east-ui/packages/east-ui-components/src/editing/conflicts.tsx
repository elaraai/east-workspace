/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The conflicts button and its popover — where a person chooses, for each part
 * of a draft another write changed differently, which value stands (the
 * session's drafts carried over, `merge.ts`). The button is first among the
 * history bar's buttons, in both of the bar's forms — it is what turns Save
 * back on — while a conflict waits: the not-equal icon and how many wait, in
 * the warn tone. It never opens by itself. Its popover holds a card for each
 * conflict: the item, named as the collection names its issues, with Go to,
 * which shows the item and selects it (the history bar's `onConflict`, else
 * its issue click); the part's label; Yours and
 * Theirs, a radio group whose choice applies at once as one step of the
 * history, which Undo takes back; and what both began from. A conflict at an
 * item's start or end (the session's `ranges`) shows on its range's one card,
 * labelled Dates, the range whole on each side, its two chosen together. Keep all mine and
 * Use all theirs choose every one, chosen or not, in one step. Once every one
 * is chosen, each card folds to a line saying how, which opens it again, and
 * the button leaves as the popover closes. A host's banner opens it with its
 * Choose ({@link useConflictsOpener}).
 *
 * @packageDocumentation
 */
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentPropsWithRef, type Ref } from "react";
import { Box, Button, chakra, Portal, Tooltip, VisuallyHidden, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faNotEqual } from "@fortawesome/free-solid-svg-icons";
import { SliceEditPopover } from "../slice/edit/index.js";
import { useSlotStyles } from "../theme/slot-styles.js";
import { StringType, equalFor } from "@elaraai/east";
import { conflictViewOf, rangeViewOf, wordRuns, type ConflictView, type RangeEnd } from "./conflict-view.js";
import { EditHistory } from "./history.js";
import type { ConflictPoint } from "./merge.js";
import type { EditingWords } from "./messages.js";
import type { ConflictChoice, ConflictRange, EditIssue, EditSession, EntryConflicts, SettledConflict } from "./session.js";

/** Below this width the frame a history bar sits in is narrow: Go to closes the popover, which would cover the item. */
const NARROW_PX = 480;

/** The most a count shows: past it, `99+`. */
const MOST_COUNTED = 99;
/** Past this many characters, a text reads two lines and opens in place with Show all. */
const LONG_TEXT = 80;
/** How many Skeleton cards stand in while the newest data is read. */
const SKELETONS = 2;

// ── A banner's Choose ───────────────────────────────────────────────────

/** For each session a history bar holds, what opens that bar's conflicts. */
const openers = new WeakMap<object, () => void>();
const openerListeners = new Set<() => void>();
let openerSerial = 0;
const openersMoved = (): void => {
    openerSerial++;
    for (const listener of openerListeners) listener();
};
const subscribeOpeners = (listener: () => void): (() => void) => {
    openerListeners.add(listener);
    return () => { openerListeners.delete(listener); };
};
const openerSnapshot = (): number => openerSerial;

/**
 * What opens the conflicts of the history bar holding a session — a banner's
 * Choose — while a bar holds it.
 *
 * @param session - The session
 * @returns The opener, or `undefined` while no history bar holds the session
 */
export function useConflictsOpener(session: object): (() => void) | undefined {
    useSyncExternalStore(subscribeOpeners, openerSnapshot, openerSnapshot);
    return openers.get(session);
}

/** The sessions a bar holds: its one, or each its history steps through. */
function heldSessions<W>(held: EditSession<W> | EditHistory<W>): (readonly [string, EditSession<W>])[] {
    if (!(held instanceof EditHistory)) return [["", held]];
    return held.keys.flatMap((key) => {
        const session = held.session(key);
        return session === undefined ? [] : [[key, session] as const];
    });
}

// ── The cards ───────────────────────────────────────────────────────────

const textEqual = equalFor(StringType);

/** A range's conflicts in one entry, gathered into the range's one card. */
interface RangeGroup {
    readonly id: string;
    readonly key: unknown;
    readonly range: ConflictRange;
    /** Each conflict at its start or end: where, its entry's values, and how it is chosen — `undefined` while it waits. */
    readonly points: { readonly point: ConflictPoint; readonly values: EntryConflicts | SettledConflict; readonly choice: ConflictChoice | undefined }[];
}

/** The field a conflict's first step names, if it names one. */
function fieldOf(point: ConflictPoint): string | undefined {
    const first = point.at[0];
    return first !== undefined && first.kind === "field" ? first.name : undefined;
}

/** One conflict, as the popover lists it. */
interface Card {
    /** Its session's key, its entry and its path — or its range: what it is known by while the popover is open. */
    readonly key: string;
    /** The conflict as an issue of its entry: what Go to goes to, and what names its item. */
    readonly issue: EditIssue;
    /** Its item: the entry, as the collection names it, then the steps down to the part's label. */
    readonly item: string;
    /** It, in words. */
    readonly view: ConflictView;
    /** How it is chosen; `undefined` while it waits. */
    readonly choice: ConflictChoice | undefined;
    /** Where the newer value came from, as the source said it when it refused a Save; `undefined` where it said nothing. */
    readonly said: string | undefined;
    /** Choose it — one step of the history. */
    readonly settle: (choice: ConflictChoice) => boolean;
}

/**
 * Every conflict a bar's session or history holds, waiting or chosen, each as
 * a card: each session's in turn, its waiting ones first.
 *
 * @param held - The bar's session, or its history
 * @param words - The words
 * @param where - How the collection names an issue's place
 * @returns The cards
 */
function cardsOf<W>(held: EditSession<W> | EditHistory<W>, words: EditingWords, where: ((issue: EditIssue) => string) | undefined): Card[] {
    const cards: Card[] = [];
    const history = held instanceof EditHistory ? held : undefined;
    for (const [sessionKey, session] of heldSessions(held)) {
        const itemOf = (issue: EditIssue, view: ConflictView) => {
            const named = where?.(issue);
            return [named === undefined || named.length === 0 ? view.name : named, ...view.path].join(" / ");
        };
        // A choice is one step of the history, whichever conflicts it chooses.
        const settleAt = (id: string, paths: readonly string[]) => (to: ConflictChoice) =>
            (history !== undefined ? history.settleConflicts(sessionKey, id, paths, to) : session.settleTogether(id, paths, to));
        const card = (id: string, key: unknown, point: ConflictPoint, values: EntryConflicts | SettledConflict, choice: ConflictChoice | undefined): Card => {
            const view = conflictViewOf(session.draftType, {
                id, key, keyType: session.keyType, at: point.at, was: values.was, draft: values.draft, source: values.source,
            }, words);
            const issue = session.conflictIssue(id, point);
            return { key: `${sessionKey}\u0000${id}\u0000${point.path}`, issue, item: itemOf(issue, view), view, choice, said: values.said, settle: settleAt(id, [point.path]) };
        };
        // A range's card: each end read from its own conflict — as it read before it was chosen — else from the draft as
        // it stands, which a choice leaves there; chosen once every one of its conflicts is chosen alike.
        const rangeCard = ({ id, key, range, points }: RangeGroup): Card => {
            const current = points.find((at) => at.choice === undefined)?.values ?? points[0]!.values;
            const endAt = (field: string): RangeEnd => {
                const at = points.find((p) => { const name = fieldOf(p.point); return name !== undefined && textEqual(name, field); });
                return at === undefined ? { was: current.was, yours: current.draft, theirs: current.draft } : { was: at.values.was, yours: at.values.draft, theirs: at.values.source };
            };
            const view = rangeViewOf(session.draftType, range, { id, key, keyType: session.keyType, start: endAt(range.start), end: endAt(range.end) }, words);
            const issue = session.conflictIssue(id, points[0]!.point);
            const first = points[0]!.choice;
            const choice = points.every((at) => at.choice !== undefined && at.choice === first) ? first : undefined;
            return {
                key: `${sessionKey}\u0000${id}\u0000${range.start}\u0000${range.end}`, issue, item: itemOf(issue, view), view, choice, said: current.said,
                settle: settleAt(id, points.map((at) => at.point.path)),
            };
        };
        // Each conflict in turn, one at an item's start or end gathered into its range's card where its first one shows.
        const items: (Card | RangeGroup)[] = [];
        const groups = new Map<string, RangeGroup>();
        const add = (id: string, key: unknown, point: ConflictPoint, values: EntryConflicts | SettledConflict, choice: ConflictChoice | undefined) => {
            const field = fieldOf(point);
            const range = field === undefined ? undefined : session.ranges.find((r) => textEqual(r.start, field) || textEqual(r.end, field));
            if (range === undefined) { items.push(card(id, key, point, values, choice)); return; }
            const at = `${id}\u0000${range.start}\u0000${range.end}`;
            let group = groups.get(at);
            if (group === undefined) {
                group = { id, key, range, points: [] };
                groups.set(at, group);
                items.push(group);
            }
            group.points.push({ point, values, choice });
        };
        for (const entry of session.conflicts.values()) for (const point of entry.points) add(entry.id, entry.key, point, entry, undefined);
        for (const settled of session.settled) add(settled.id, settled.key, settled.point, settled, settled.choice);
        for (const item of items) cards.push("view" in item ? item : rangeCard(item));
    }
    return cards;
}

/** A ref given a node, whichever kind it is. */
function assign<T>(ref: Ref<T> | undefined, node: T | null): void {
    if (typeof ref === "function") ref(node);
    else if (ref !== null && ref !== undefined) ref.current = node;
}

/** Props of the button: what it says, and the popover's trigger props, which it takes as its own. */
type ConflictsButtonProps = {
    /** Its tooltip. */
    tip: string;
    /** Its accessible name. */
    label: string;
    /** How many wait, as it shows them; `undefined` once none does. */
    count: string | undefined;
    /** Its styles: the icon button's, then the bar's slot. */
    chrome: (SystemStyleObject | undefined)[];
    /** The count's styles. */
    countChrome: SystemStyleObject | undefined;
    /** Where the bar keeps the button, beside the popover's own ref. */
    anchor: { current: HTMLButtonElement | null };
} & Omit<ComponentPropsWithRef<"button">, "children" | "color">;

/** The button: the popover's trigger, and a tooltip's — the popover's props land on it last, so the toolbar reads its state. */
function ConflictsButton({ tip, label, count, chrome, countChrome, anchor, ref, ...trigger }: ConflictsButtonProps) {
    return (
        <Tooltip.Root openDelay={250}>
            <Tooltip.Trigger asChild>
                <chakra.button type="button" {...trigger} css={chrome} aria-label={label} data-conflicts="" data-settled={count === undefined ? "" : undefined}
                    ref={(node: HTMLButtonElement | null) => { anchor.current = node; assign(ref, node); }}>
                    <FontAwesomeIcon icon={faNotEqual} />
                    {count !== undefined && <Box as="span" css={countChrome} aria-hidden>{count}</Box>}
                </chakra.button>
            </Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}

/**
 * Props of {@link ConflictsControl}.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface ConflictsControlProps<W> {
    /** The bar's session, or the history it steps through. */
    session: EditSession<W> | EditHistory<W>;
    /** The collection's words. */
    words: EditingWords;
    /** Go to an issue — the collection shows where it is: a conflict's Go to. */
    onIssue: (issue: EditIssue) => void;
    /** Where an issue is, in the collection's words — a conflict's item; its entry's key in words by default. */
    where?: ((issue: EditIssue) => string) | undefined;
    /** An issue's text as the collection shows it — what the source said of a conflict's entry; as written by default. */
    issueText?: ((message: string) => string) | undefined;
    /** Locked while a run of the app's optimiser is out: it opens, and its choices are off. */
    locked: boolean;
}

/**
 * The conflicts button and its popover — see the module docs. It follows the
 * session itself, so it stays current wherever the host draws it.
 *
 * @typeParam W - The collection's projection of an entry
 * @param props - The session, the collection's words, and how it goes to and names an issue
 * @returns The button while a conflict waits, or while its popover is open; else nothing
 */
export function ConflictsControl<W>({ session, words, onIssue, where, issueText, locked }: ConflictsControlProps<W>) {
    const serial = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    const { m } = words;
    const bar = useSlotStyles("editHistory");
    const styles = useSlotStyles("editConflicts");
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = useMemo(() => iconRecipe({ size: "sm", variant: "outline" }), [iconRecipe]);
    const [open, setOpen] = useState(false);
    const [opener] = useState(() => () => setOpen(true));
    const anchor = useRef<HTMLButtonElement | null>(null);
    const bodyId = useId();

    // A banner's Choose opens this bar's popover, for each session it holds.
    const ours = useRef(new Set<object>());
    useEffect(() => {
        const now = new Set<object>(heldSessions(session).map(([, held]) => held));
        let moved = false;
        for (const held of ours.current) {
            if (now.has(held)) continue;
            if (Object.is(openers.get(held), opener)) openers.delete(held);
            ours.current.delete(held);
            moved = true;
        }
        for (const held of now) {
            if (Object.is(openers.get(held), opener)) continue;
            openers.set(held, opener);
            ours.current.add(held);
            moved = true;
        }
        if (moved) openersMoved();
    }, [session, serial, opener]);
    useEffect(() => {
        const held = ours.current;
        return () => {
            for (const session of held) if (Object.is(openers.get(session), opener)) openers.delete(session);
            held.clear();
            openersMoved();
        };
    }, [opener]);

    const waiting = session.unsettled;
    const chosen = session.chosen;
    const shown = waiting > 0 || (open && chosen > 0);
    // Nothing left to choose, and nothing chosen to show: it closes.
    useEffect(() => { if (!shown && open) setOpen(false); }, [shown, open]);

    // The cards, read while it is open: each keeps its place, and one new to it goes last.
    const order = useRef(new Map<string, number>());
    const cards = useMemo(() => {
        if (!open) {
            order.current = new Map();
            return [];
        }
        const seen = order.current;
        const all = cardsOf(session, words, where);
        for (const card of all) if (!seen.has(card.key)) seen.set(card.key, seen.size);
        return all.sort((a, b) => seen.get(a.key)! - seen.get(b.key)!);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the session is mutable: its serial says it moved
    }, [open, session, serial, words, where]);
    const done = cards.length > 0 && cards.every((card) => card.choice !== undefined);
    // The lines a person opened again, once every one was chosen.
    const [reopened, setReopened] = useState<ReadonlySet<string>>(() => new Set());
    const off = locked || session.carrying;

    // A card that leaves while it holds the focus hands it to the card now in its place.
    const focused = useRef<{ key: string; index: number } | undefined>(undefined);
    useLayoutEffect(() => {
        const was = focused.current;
        if (was === undefined || cards.some((card) => card.key === was.key)) return;
        focused.current = undefined;
        const active = document.activeElement;
        if (active !== null && active !== document.body) return;
        const next = cards[Math.min(was.index, cards.length - 1)];
        if (next === undefined) return;
        document.getElementById(bodyId)?.querySelector<HTMLElement>(`[data-conflict-seq="${order.current.get(next.key)}"] :is(input, button)`)?.focus();
    }, [cards, bodyId]);

    const n = cards.length;
    const count = waiting > MOST_COUNTED ? `${words.number(MOST_COUNTED)}+` : words.number(waiting);
    const tip = waiting > 0
        ? (locked ? m.conflictsLockedTip({ n: waiting, count: words.number(waiting) }) : m.conflictsTip({ n: waiting, count: words.number(waiting) }))
        : m.conflictsSettled({ n: chosen, count: words.number(chosen) });
    // The cards whose long values are open in place.
    const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
    const close = () => { setOpen(false); setReopened(new Set()); setOpened(new Set()); };
    const goTo = (card: Card) => {
        onIssue(card.issue);
        // In a narrow frame the popover would cover the item: it closes, and the button stays. A frame not laid out has no width.
        const frame = anchor.current?.closest<HTMLElement>("[data-toolbar]") ?? anchor.current?.parentElement;
        const width = frame?.getBoundingClientRect().width ?? 0;
        if (width > 0 && width < NARROW_PX) close();
    };
    // Where the newer value came from — what the source said, else that it changed — then what both began from.
    const sourceOf = (card: Card): string => (card.said === undefined ? m.conflictChangedSince() : issueText?.(card.said) ?? card.said);
    const contextOf = (card: Card): string => [sourceOf(card), ...(card.view.was === undefined ? [] : [m.conflictWas({ value: card.view.was })])].join(" · ");
    // A value longer than its two lines opens in place with Show all, never in a second popover.
    const long = (card: Card) => [[card.view.yours, card.view.yoursForm], [card.view.theirs, card.view.theirsForm]]
        .some(([value, form]) => form === "text" && (value!.length > LONG_TEXT || value!.includes("\n")));
    const choiceRow = (card: Card, seq: number, choice: ConflictChoice) => {
        const checked = card.choice === choice;
        const name = choice === "draft" ? m.conflictYours() : m.conflictTheirs();
        const value = choice === "draft" ? card.view.yours : card.view.theirs;
        const form = choice === "draft" ? card.view.yoursForm : card.view.theirsForm;
        // Open, two texts mark the words that differ in each.
        const isOpen = opened.has(card.key);
        const runs = isOpen && card.view.yoursForm === "text" && card.view.theirsForm === "text" ? wordRuns(card.view.yours, card.view.theirs) : undefined;
        const shown = runs === undefined ? value
            : (choice === "draft" ? runs.a : runs.b).map((run, i) => (run.differs ? <mark key={i}>{run.text}</mark> : <Fragment key={i}>{run.text}</Fragment>));
        // Theirs reads with where it came from and what both began from, as the line under it shows them.
        const said = choice === "draft" ? [name, value] : [name, value, contextOf(card)];
        return (
            // Off while a run is out: aria-disabled, never disabled, so it keeps its place and the focus.
            <chakra.label css={styles.choice} data-checked={checked ? "" : undefined} data-disabled={off ? "" : undefined} data-choice={choice}>
                <chakra.input type="radio" css={styles.radio} name={`${bodyId}-${seq}`} value={choice} checked={checked} aria-disabled={off ? true : undefined}
                    aria-label={said.join(", ")} onChange={() => { if (!off) card.settle(choice); }} />
                <Box as="span" css={styles.radioMark} aria-hidden />
                <Box as="span" css={styles.choiceName}>{name}</Box>
                <Box as="span" css={styles.choiceValue} data-form={form} data-open={isOpen ? "" : undefined}>{shown}</Box>
            </chakra.label>
        );
    };
    const head = (card: Card, itemId?: string) => (
        <Box css={styles.head}>
            <Box as="span" css={styles.mark} data-chosen={card.choice === undefined ? undefined : ""} aria-hidden>
                {card.choice !== undefined && <FontAwesomeIcon icon={faCheck} />}
            </Box>
            <Box as="span" id={itemId} css={styles.item} data-conflict-item="">{card.item}</Box>
            <chakra.button type="button" css={styles.goTo} data-conflict-go="" onClick={() => goTo(card)}>{m.conflictGoTo()}</chakra.button>
        </Box>
    );
    const cardOf = (card: Card, index: number) => {
        const seq = order.current.get(card.key)!;
        const track = { onFocus: () => { focused.current = { key: card.key, index }; } };
        const label = card.view.label;
        if (done && !reopened.has(card.key)) {
            const how = card.choice === "source" ? m.conflictTaken({ value: card.view.theirs }) : m.conflictKept({ value: card.view.yours });
            return (
                <Box key={card.key} css={styles.card} data-conflict-card="" data-conflict-seq={seq} {...track}>
                    {head(card)}
                    <chakra.button type="button" css={styles.line} onClick={() => setReopened((was) => new Set([...was, card.key]))}>
                        {[...(label.length === 0 ? [] : [label.join(", ")]), how].join(" · ")}
                    </chakra.button>
                </Box>
            );
        }
        const labelId = `${bodyId}-${seq}-label`;
        const itemId = `${bodyId}-${seq}-item`;
        return (
            <Box key={card.key} css={styles.card} data-conflict-card="" data-conflict-seq={seq} data-waiting={card.choice === undefined ? "" : undefined} {...track}>
                {head(card, itemId)}
                {label.length > 0 && <Box id={labelId} css={styles.label}>{label.join(" · ")}</Box>}
                <Box role="radiogroup" aria-labelledby={label.length > 0 ? `${itemId} ${labelId}` : itemId} css={styles.choices}>
                    {choiceRow(card, seq, "draft")}
                    {choiceRow(card, seq, "source")}
                </Box>
                <Box css={styles.context} aria-hidden>{contextOf(card)}</Box>
                {long(card) && (
                    <chakra.button type="button" css={styles.showAll} aria-expanded={opened.has(card.key)} data-conflict-show=""
                        onClick={() => setOpened((was) => { const next = new Set(was); if (next.has(card.key)) next.delete(card.key); else next.add(card.key); return next; })}>
                        {opened.has(card.key) ? m.conflictShowLess() : m.conflictShowAll()}
                    </chakra.button>
                )}
            </Box>
        );
    };
    return (
        <>
            {/* Said as conflicts appear, from a region there before them. */}
            <VisuallyHidden aria-live="polite" data-conflicts-said="">{waiting > 0 ? m.conflictsAppeared({ n: waiting, count: words.number(waiting) }) : ""}</VisuallyHidden>
            {shown && (
                <SliceEditPopover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} label={session.carrying ? m.conflictsTitle() : <>{m.conflictsTitle()} · <Box as="span" css={styles.headCount}>{words.number(n)}</Box></>} size="lg" flush
                    initialFocusEl={() => {
                        // The first conflict still waiting, else the first card.
                        const at = document.getElementById(bodyId);
                        return at?.querySelector<HTMLElement>("[data-waiting] input") ?? at?.querySelector<HTMLElement>("[data-conflict-card] button") ?? null;
                    }}
                    trigger={
                        <ConflictsButton tip={tip} label={waiting > 0 ? m.conflicts({ n: waiting, count: words.number(waiting) }) : tip}
                            count={waiting > 0 ? count : undefined} chrome={[iconStyles, bar.conflicts]} countChrome={bar.conflictsCount} anchor={anchor} />
                    }
                    footActions={<>
                        <Button size="xs" variant="outline" aria-disabled={off ? true : undefined} onClick={() => { if (!off) session.settleAll("draft"); }}>{m.conflictsKeepAll()}</Button>
                        <Button size="xs" variant="outline" aria-disabled={off ? true : undefined} onClick={() => { if (!off) session.settleAll("source"); }}>{m.conflictsTakeAll()}</Button>
                    </>}>
                    <Box id={bodyId} data-conflicts-body="">
                        {session.carrying ? (
                            // Still checking: the live dot and its line, then Skeleton cards in the cards' final layout.
                            <>
                                <Box css={styles.notice} data-conflicts-notice="checking"><Box as="span" css={styles.live} aria-hidden />{m.historyStatus({ status: "carrying" })}</Box>
                                {Array.from({ length: SKELETONS }, (_, i) => <Box key={i} css={styles.skeleton} data-conflict-skeleton="" aria-hidden><span /><span /><span /></Box>)}
                            </>
                        ) : (
                            <>
                                {done
                                    ? <Box css={styles.intro} data-done=""><FontAwesomeIcon icon={faCheck} />
                                        {(session.pending > 0 ? m.conflictsSettled : m.conflictsSettledNothing)({ n, count: words.number(n) })}</Box>
                                    : <Box css={styles.intro}>{m.conflictsIntro()}</Box>}
                                {locked && <Box css={styles.notice} data-conflicts-notice="locked"><Box as="span" css={styles.live} aria-hidden />{m.conflictsLocked()}</Box>}
                                {cards.map(cardOf)}
                            </>
                        )}
                    </Box>
                </SliceEditPopover>
            )}
        </>
    );
}
