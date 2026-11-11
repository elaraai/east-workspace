/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's history bar (#879) — Undo, Redo, Discard and Apply
 * over the current checked batch, its status line and issues — shared by every
 * editable collection, in its collection's words, on the `editHistory` slot
 * recipe. While a part of a draft another write changed differently waits to
 * be chosen, the conflicts button leads its buttons, and Apply waits for it
 * (`conflicts.tsx`) — over several records, only while no other record has a
 * change to save. While a Save is out, and until the page reads back what it
 * saved, Save shows it: the live dot in its place, `aria-busy`, at full strength
 * (#1573). Retry refresh takes its place once that read back failed, or has not
 * moved for ten seconds, to ask again. Beside the issues that hold Save, the
 * issues button counts the warnings a collection hands it — an entry that
 * holds no Save but asks a look, a stored value outside its field's bounds
 * (#1585) — its words saying which are warnings; a press goes to the first
 * issue, else the first warning.
 *
 * Where its builder keeps a choice of an automatic Save (`autosave-choice.ts`),
 * Save is a split button: Save, and a chevron that opens the choice — one
 * switch, Autosave, off as it begins, kept for the builder — in the shared
 * edit popover. On, the session's changes are saved a pause after the
 * person's last act (`autosave.ts`, `use-autosave.ts`), each Save shown on the
 * button alone: its words would come and go in the toolbar's row every few
 * seconds. An optimiser's result is never saved by itself: while one waits,
 * the split button — Save and its chevron, one outline — wears the Elara ring
 * and glow, and Save's tooltip and the panel say why.
 *
 * In a phone's frame it is the toolbar's second row (`phone`, `Mobile Builder
 * Frame Spec.md` FR6, FR8): the drafts' count at its start — its number whole
 * or not there at all — then the issues, there whatever their number, off at
 * none, and the four buttons at touch size, Save filled while it would save.
 * The row holds its five squares whatever waits: the conflicts have no button
 * of their own there, the Issues square counting them and opening them — in
 * the frame's bottom panel — while one waits (`conflicts.tsx`). Discard asks
 * first, in the band
 * under the row (ruled 4 Nov 2026: no anchored popover on a phone), never a dialog.
 * Save's chevron is a square of the row on Save's edge, in the row where the
 * row holds its six squares whole — the recipe's rule, over the row's own
 * width, the drafts' count giving way to them until the row holds it too —
 * and its choice opens in the frame's bottom panel, as the row's conflicts do
 * (FR9.3). Where the row is short of a sixth square (ruled 11 Nov 2026: the
 * buttons themselves wherever they fit), More stands in Discard's place and
 * holds the two — the row its five squares still — opening, in the same
 * panel, the Autosave switch and Discard changes: so the switch can be
 * reached at every width, and an author's on is never one nobody can turn off.
 *
 * @packageDocumentation
 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Box, chakra, Portal, Switch, Text, Tooltip, useRecipe, useSlotRecipe, VisuallyHidden, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight, faCheck, faChevronDown, faEllipsis, faRotate, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { EastType, PatchPath } from "@elaraai/east";
import type { EditHistory } from "./history.js";
import type { EditIssue, EditSession } from "./session.js";
import { autosaveChoiceOf, type AutosaveKept } from "./autosave-choice.js";
import { ConflictsControl, type ConflictsSquare } from "./conflicts.js";
import { useDraftsKeeping } from "./keep.js";
import { sessionErrorText, type EditingWords } from "./messages.js";
import { useAutosave, type AutosaveChoice } from "./use-autosave.js";
import { SliceEditPopover } from "../slice/edit/index.js";
import { FrameSessionBand } from "../layout/builder-frame/session-row.js";
import { layerOpen } from "../layout/builder-frame/view-escape.js";

/** A history bar action. */
export type HistoryAction = "undo" | "redo" | "discard" | "apply" | "refresh";

/**
 * How long a read back may not move — nothing read back, and no error — before
 * Retry refresh takes the busy Save's place, to ask again (#1573): a source can
 * go on answering the revision before the Save.
 */
const READ_BACK_STALLED_MS = 10_000;

/**
 * Whether a read back has not moved for {@link READ_BACK_STALLED_MS}: its
 * session's change counter has stood since the read back began waiting, or
 * last moved.
 *
 * @param waiting - Whether a read back waits
 * @param moved - The session's change counter
 * @returns Whether it has stalled
 */
function useStalled(waiting: boolean, moved: number): boolean {
    const [stalledAt, setStalledAt] = useState<number | undefined>(undefined);
    useEffect(() => {
        if (!waiting) return;
        const timer = setTimeout(() => setStalledAt(moved), READ_BACK_STALLED_MS);
        return () => clearTimeout(timer);
    }, [waiting, moved]);
    return waiting && stalledAt === moved;
}

type Styles = Record<string, Record<string, unknown>>;

/**
 * Props of {@link HistoryBar}.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface HistoryBarProps<W> {
    /** The editing session — or one history over several (`EditHistory`, #1194), which reads as one session does. */
    session: EditSession<W> | EditHistory<W>;
    /** The collection's words. */
    words: EditingWords;
    /** An open editor is committed before the requested history action. */
    editing: boolean;
    /** Go to an issue — the collection shows where it is: an issue's, or a conflict's (`EditSession.conflictIssue`) where it gives no `onConflict`. */
    onIssue: (issue: EditIssue) => void;
    /**
     * Go to a conflict's item — a conflict's Go to: what shows the item and
     * selects it, where the collection's issue click opens a list of its
     * issues instead. Handed where the conflict is in its entry, and the
     * conflicts popover's box as it stays open over the page, for the item to
     * land beside it rather than under it — `undefined` where a phone's view,
     * which is no popover, holds the conflicts. `onIssue` by default.
     */
    onConflict?: ((issue: EditIssue, at: PatchPath, popover: DOMRectReadOnly | undefined) => void) | undefined;
    /**
     * A conflict's item in the collection's words, its steps included — a
     * step's own name (`Scanned`), where the steps in words would name it by
     * its place (`Item 2`) or its key: what its card names it. Handed the
     * conflict's path, and the steps in words the card would name it by after
     * the entry's name, to keep those it does not name otherwise.
     * {@link where}'s name, then the steps in words, by default.
     */
    conflictItem?: ((issue: EditIssue, at: PatchPath, steps: readonly string[]) => string | undefined) | undefined;
    /**
     * A conflict's value in the collection's words — a lane's label where a
     * step holds the lane's key, a date as its column writes it: what its
     * card shows for each side. Handed the conflict's issue and path, and the
     * value with its East type; `undefined`, or none given, for the card's own
     * reading of it.
     */
    conflictValue?: ((issue: EditIssue, at: PatchPath, value: unknown, type: EastType | undefined) => string | undefined) | undefined;
    /**
     * Where an issue is, in the collection's words — its row (`J-0002`,
     * `row 4`), as its banners name it ({@link SessionBanners}): what the
     * conflicts popover names a conflict's item by. Its entry's key in words
     * by default.
     */
    where?: ((issue: EditIssue) => string) | undefined;
    /**
     * An issue's text as the collection shows it — its own issues read back
     * in its words, as its banners read them ({@link SessionBanners}): what
     * the conflicts popover shows the source's words for a conflict's entry
     * in. As written by default.
     */
    issueText?: ((message: string) => string) | undefined;
    /** Run an action — the collection first commits what it has open. */
    onAction: (action: HistoryAction) => void;
    /**
     * Undo, Redo, Discard and Apply alone — the form a toolbar short of room
     * folds the bar to ({@link historyToolbarItem}). The status line and the
     * issues button go; an error still shows, and the conflicts button stays:
     * it is what turns Apply back on.
     */
    buttonsOnly?: boolean | undefined;
    /**
     * Whether the bar shows the session's error under its buttons: `true` by
     * default. A host that shows the error itself — a builder's banners
     * ({@link SessionBanners}) — passes `false`, so its toolbar keeps one row.
     */
    showError?: boolean | undefined;
    /**
     * Locked while a run of the app's optimiser is out (#1409, R2): Undo,
     * Redo, Discard and Save are `aria-disabled` and run nothing, their size,
     * their place and the focus kept — never `disabled`, which would drop the
     * focus; the conflicts popover opens, its choices off. `false` by default.
     */
    locked?: boolean | undefined;
    /** The phone's form, the toolbar's second row in a frame of 560 px or less (see the module docs). `false` by default. */
    phone?: boolean | undefined;
    /**
     * On a phone, what the Issues button opens where a host lists them, conflicts too: a tab of its inspector
     * (`Studio Mobile Spec.md` ST7). The button then counts the conflicts, and there is no conflicts button.
     */
    onOpenIssues?: (() => void) | undefined;
    /**
     * The entries beside the issues that hold no Save but ask a look (#1585) — a stored value outside its field's
     * bounds: each its words, `J-1001 · Sheets: at least 0`, and what going to it does, as an issue's Go to does. The
     * issues button counts them, its words saying which are warnings, and goes to the first once no issue is before
     * it. None by default.
     */
    warnings?: readonly { readonly text: string; readonly go: () => void }[] | undefined;
}

/** No warning beside the issues. */
const NO_WARNINGS: NonNullable<HistoryBarProps<unknown>["warnings"]> = [];

/**
 * What the issues button says (#1585): the issues holding Save, then the warnings beside them, which hold none —
 * `2 issues`, `1 warning`, `2 issues · 1 warning` — and its tooltip, what a press goes to.
 */
function issuesWords(words: EditingWords, n: number, warnings: NonNullable<HistoryBarProps<unknown>["warnings"]>): { label: string; tip: string } {
    const { m } = words;
    const issues = m.issues({ n, count: words.number(n) });
    const w = warnings.length;
    if (w === 0) return { label: issues, tip: m.issuesTip({ n, count: words.number(n) }) };
    const said = m.warnings({ n: w, count: words.number(w) });
    if (n === 0) return { label: said, tip: m.warningsTip({ n: w, count: words.number(w), first: warnings[0]!.text }) };
    return { label: m.issuesAndWarnings({ issues, warnings: said }), tip: m.issuesAndWarningsTip({ issues, warnings: said }) };
}

/** Keep an accessible name and a hover/focus tooltip when the control has no text. */
function HistoryButton({ label, tip = label, icon, disabled, locked, styles, onClick, ready, busy, waits, content, expanded, buttonRef, holds, holder }: {
    label: string; tip?: string | undefined; icon: IconDefinition; disabled: boolean; locked: boolean;
    styles: Styles; onClick: () => void;
    /** Its holder's styles — the row's item: a phone's Discard, which its row leaves out where More stands in its place. */
    holder?: Record<string, unknown> | undefined;
    /** Save while it would save: filled, on a phone. */
    ready?: boolean | undefined;
    /** Save while an optimiser's result waits for a person's Save, the automatic Save on: the Elara ring and glow. */
    waits?: boolean | undefined;
    /** Save while a Save is out or its saved state is read back (#1573): `aria-busy`, at full strength over its disabled look. */
    busy?: boolean | undefined;
    /** What it shows in place of its icon: the live dot while a Save is out or read back. */
    content?: ReactNode;
    /** Whether what it opens shows: Discard's question, on a phone. */
    expanded?: boolean | undefined;
    /** The button: where the focus goes back to as what it opened closes. */
    buttonRef?: Ref<HTMLButtonElement> | undefined;
    /** Off, it stays focusable all the same: what it opened is going from under the focus, which it is to take back. */
    holds?: boolean | undefined;
}) {
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = iconRecipe({ size: "sm", variant: "outline" });
    // Run out under the focus — Discard pressed from the keyboard, leaving nothing to discard — it keeps the focus,
    // aria-disabled, until the focus moves on: `disabled` under it, the browser drops the focus to the page. And so one
    // that is to take the focus back from what it opened, off by the time that closes.
    const [focused, setFocused] = useState(false);
    const held = disabled && (focused || holds === true);
    return <Tooltip.Root openDelay={250}>
        <Tooltip.Trigger asChild>
            <chakra.span css={holder as SystemStyleObject | undefined}>
                <chakra.button ref={buttonRef} type="button" css={[iconStyles, styles.button]} aria-label={label} aria-expanded={expanded}
                    disabled={disabled && !held} aria-disabled={locked || held ? true : undefined} aria-busy={busy === true ? true : undefined}
                    data-ready={ready === true ? "" : undefined} data-held={waits === true ? "" : undefined}
                    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                    onMouseDown={event => event.preventDefault()} onClick={locked || disabled ? undefined : onClick}>
                    {content ?? <FontAwesomeIcon icon={icon} />}
                </chakra.button>
            </chakra.span>
        </Tooltip.Trigger>
        <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
    </Tooltip.Root>;
}

/** The drafts' count in words, its number holding the row while its noun goes where the row leaves it no room: `1 change`, then `1`. */
function CountWords({ text }: { text: string }) {
    const at = text.indexOf(" ");
    return at < 0 ? <span>{text}</span> : <><span>{text.slice(0, at)}</span>{" "}<span data-changes-noun="">{text.slice(at + 1)}</span></>;
}

/**
 * A phone's Discard asking first (FR8): the design's words and its two buttons,
 * the focus on Cancel as it opens; Esc is Cancel, wherever the focus is.
 */
function DiscardAsk({ head, title, body, cancel, confirm, styles, confirmCss, cancelCss, onCancel, onConfirm }: {
    head: string; title: string; body: string; cancel: string; confirm: string; styles: Styles;
    confirmCss: SystemStyleObject; cancelCss: SystemStyleObject; onCancel: () => void; onConfirm: () => void;
}) {
    const cancelRef = useRef<HTMLButtonElement | null>(null);
    const onEscape = useRef(onCancel);
    onEscape.current = onCancel;
    useEffect(() => {
        const frame = requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || layerOpen()) return;
            event.preventDefault();
            event.stopPropagation();
            onEscape.current();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, []);
    return <Box css={styles.ask} role="group" aria-label={head} data-history-discard-ask="">
        <Box css={styles.askHead}>{head}</Box>
        <Box css={styles.askTitle}>{title}</Box>
        <Box css={styles.askBody}>{body}</Box>
        <Box css={styles.askActions}>
            <chakra.button ref={cancelRef} type="button" css={[cancelCss, styles.askButton]} onClick={onCancel}>{cancel}</chakra.button>
            <chakra.button type="button" css={[confirmCss, styles.askButton]} data-history-discard-confirm="" onClick={onConfirm}>{confirm}</chakra.button>
        </Box>
    </Box>;
}

/** Props of a button that opens the choice — Save's chevron, or a phone's More: what it says, how the choice stands, and the popover's trigger props, which it takes as its own. */
type AutosaveButtonProps = {
    /** Its accessible name. */
    label: string;
    /** Its tooltip. */
    tip: string;
    /** Whether the automatic Save is on. */
    on: boolean;
    /** Which it is: the chevron beside Save, or a phone's More, which holds Discard too. */
    part: "autosave" | "more";
    /** Its styles: the icon button's, then the bar's slots, as the bar's recipe made them. */
    chrome: readonly (SystemStyleObject | Record<string, unknown> | undefined)[];
} & Omit<ComponentPropsWithRef<"button">, "children" | "color">;

/**
 * A button that opens the choice — the chevron beside Save, or a phone's More: the popover's trigger, and a tooltip's —
 * the popover's props land on it last, so the toolbar reads its state, and its id is the popover's, which the tooltip is
 * told too, as the conflicts button's is.
 */
function AutosaveButton({ label, tip, on, part, chrome, ...trigger }: AutosaveButtonProps) {
    return (
        <Tooltip.Root openDelay={250} ids={trigger.id === undefined ? undefined : { trigger: trigger.id }}>
            <Tooltip.Trigger asChild>
                <chakra.button type="button" {...trigger} css={chrome as SystemStyleObject[]} aria-label={label} {...{ [`data-history-${part}`]: "" }} data-on={on ? "" : undefined}
                    onMouseDown={(event) => event.preventDefault()}>
                    <FontAwesomeIcon icon={part === "more" ? faEllipsis : faChevronDown} />
                </chakra.button>
            </Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}

/**
 * The automatic Save's switch — one row, Autosave, on or off (ruled 11 Nov 2026: a pair of choices to read was one too
 * many), kept as it is flicked — and, while an optimiser's result waits for a person's Save, why.
 */
function AutosaveSwitch({ choice, held, words, styles }: { choice: AutosaveChoice; held: boolean; words: EditingWords; styles: Styles }) {
    const { m } = words;
    return <>
        {/* The theme's switch, its word at the row's start: a switch to whoever asks the page, never a checkbox. */}
        <Switch.Root css={styles.autosaveSwitch} checked={choice.on} onCheckedChange={(details) => choice.set(details.checked)}>
            <Switch.HiddenInput role="switch" />
            <Switch.Label>{m.autosave()}</Switch.Label>
            <Switch.Control />
        </Switch.Root>
        {held && <Box css={styles.autosaveHeld} role="status" data-history-autosave-held="">{m.autosaveHeld()}</Box>}
    </>;
}

/** The automatic Save's choice, beside Save: the chevron, and the panel it opens in the shared edit popover — its switch. */
function AutosaveControl({ choice, held, words, styles }: { choice: AutosaveChoice; held: boolean; words: EditingWords; styles: Styles }) {
    const { m } = words;
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = useMemo(() => iconRecipe({ size: "sm", variant: "outline" }), [iconRecipe]);
    const [open, setOpen] = useState(false);
    const panel = useId();
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={m.apply()} size="sm" flush
            initialFocusEl={() => document.getElementById(panel)?.querySelector<HTMLElement>("input") ?? null}
            trigger={<AutosaveButton part="autosave" label={m.autosaveButton()} tip={m.autosaveTip({ on: choice.on })} on={choice.on} chrome={[iconStyles, styles.button, styles.saveMore]} />}>
            <Box id={panel} css={styles.autosave} data-history-autosave-panel="">
                <AutosaveSwitch choice={choice} held={held} words={words} styles={styles} />
            </Box>
        </SliceEditPopover>
    );
}

/**
 * A phone's More (ruled 11 Nov 2026): where its row is short of Discard and Save's chevron both, the square that stands
 * in Discard's place and holds the two, the row its five squares still. It opens them where the chevron opens its
 * switch — the frame's bottom panel: the Autosave switch, on More as on the chevron while it is on, and Discard changes,
 * which asks no further: the press of More came first, and the button says what it does. Off with nothing to discard;
 * locked, as the row's own is, while a run of the optimiser is out.
 */
function MoreControl({ choice, held, words, styles, discardOff, locked, onDiscard }: {
    choice: AutosaveChoice; held: boolean; words: EditingWords; styles: Styles;
    /** Nothing to discard. */
    discardOff: boolean;
    /** A run of the app's optimiser is out. */
    locked: boolean;
    /** Discard the drafts. */
    onDiscard: () => void;
}) {
    const { m } = words;
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = useMemo(() => iconRecipe({ size: "sm", variant: "outline" }), [iconRecipe]);
    const buttonRecipe = useRecipe({ key: "button" });
    const discardStyles = useMemo(() => buttonRecipe({ variant: "outline", size: "md" }), [buttonRecipe]);
    const [open, setOpen] = useState(false);
    const panel = useId();
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={m.more()} size="sm" flush
            initialFocusEl={() => document.getElementById(panel)?.querySelector<HTMLElement>("input") ?? null}
            trigger={<AutosaveButton part="more" label={m.more()} tip={m.moreTip({ on: choice.on })} on={choice.on} chrome={[iconStyles, styles.button, styles.more]} />}>
            <Box id={panel} css={styles.autosave} data-history-autosave-panel="" data-history-more-panel="">
                <AutosaveSwitch choice={choice} held={held} words={words} styles={styles} />
                <chakra.button type="button" css={[discardStyles, styles.askButton]} disabled={discardOff} aria-disabled={locked && !discardOff ? true : undefined}
                    data-history-discard-confirm="" onClick={locked ? undefined : () => { setOpen(false); onDiscard(); }}>{m.discardAskConfirm()}</chakra.button>
            </Box>
        </SliceEditPopover>
    );
}

/**
 * The history bar: a visible serial apply state, where a failed refresh and a
 * write of unknown outcome each have their own retry.
 *
 * @typeParam W - The collection's projection of an entry
 * @param props - The session, the collection's words, and its callbacks
 * @returns The bar
 */
export function HistoryBar<W>(props: HistoryBarProps<W>) {
    // Where its builder keeps a choice of an automatic Save, the bar binds one to the page while it is mounted.
    const choice = autosaveChoiceOf(props.session);
    return choice === undefined ? <Bar {...props} autosave={undefined} /> : <AutosavingBar {...props} choice={choice} />;
}

/** The bar over a session whose builder keeps a choice of an automatic Save: bound to the page, and to that choice. */
function AutosavingBar<W>({ choice, ...props }: HistoryBarProps<W> & { choice: AutosaveKept }) {
    const autosave = useAutosave(props.session, choice, { editing: props.editing, locked: props.locked === true });
    return <Bar {...props} autosave={autosave} />;
}

/** The bar itself, given its builder's choice of an automatic Save where it keeps one. */
function Bar<W>({
    session, words, editing, onAction, onIssue, onConflict, conflictItem, conflictValue, where, issueText, buttonsOnly = false, showError = true, locked = false, phone = false,
    onOpenIssues, warnings = NO_WARNINGS, autosave,
}: HistoryBarProps<W> & { autosave: AutosaveChoice | undefined }) {
    const buttonRecipe = useRecipe({ key: "button" });
    // A phone's Discard asks first (FR8), in the band under the row.
    const [asking, setAsking] = useState(false);
    const band = useContext(FrameSessionBand);
    const discardRef = useRef<HTMLButtonElement | null>(null);
    const recipe = useSlotRecipe({ key: "editHistory" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const { m } = words;
    const readiness = session.readiness;
    const status = session.status;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    const pending = session.pending;
    // An open editor is committed before Undo, Discard and Save: each is on for it while the session takes a gesture —
    // and Save only while a Save could be sent, so one unresolved shows on it, off, with an editor open as with none.
    const commitEditor = editing && session.writable;
    const commitToSave = editing && session.canSend;
    const message = session.stale ? m.historyStatus({ status: "stale" })
        : session.carrying ? m.historyStatus({ status: "carrying" })
        : status !== "idle" ? m.historyStatus({ status })
        : undefined;
    // A Save out, or its saved state being read back, until the page holds it (#1573): Save shows it, the live dot in its
    // place. A read back that failed, or has not moved for a while, is Retry refresh's to ask again — read from the
    // sessions that read back, not from another's error.
    const readBack = session.readBack;
    const stalled = useStalled(readBack === "waiting", session.getSnapshot());
    const saving = status === "applying" || (status === "reconciling" && readBack === "waiting" && !stalled);
    // An automatic Save is shown on Save alone, as any Save is: its words in the row would come and go every few seconds.
    const statusLine = autosave?.on === true && saving ? undefined : message;
    // An optimiser's result waits for a person's Save, the automatic Save on: Save wears the Elara ring, and says why.
    const held = autosave?.on === true && session.autosaveHeld;
    // What Undo or Redo left waits for one too (ruled 11 Nov 2026): no automatic Save sends a step back, and Save says so.
    const stepped = autosave?.on === true && session.autosaveStepped;
    const n = issues.length;
    const unsettled = session.unsettled;
    // Save waits for the conflicts to be chosen aria-disabled, never disabled: it keeps the focus, and its Tooltip says why.
    // Only while nothing else can be saved: over several records a conflict holds back its own record's changes alone.
    const waiting = status !== "unknown" && unsettled > 0 && !session.canApply;
    // Drafts a reload would lose, or that a reload could not restore: said under the buttons where the bar says its error.
    const keeping = useDraftsKeeping(session);
    const keepingText = keeping.state === "unkept" ? m.bannerUnkept({ reason: keeping.reason })
        : keeping.state === "lost" ? m.bannerLost({ reason: keeping.reason }) : undefined;
    const discardOff = !session.canDiscard || (pending === 0 && !commitEditor);
    const saveOff = !waiting && status !== "unknown" && !session.canApply && !commitToSave;
    if (phone) {
        const askingNow = asking && !discardOff;
        // The focus back on Discard before what holds it goes — or on More, where the row has since put it in Discard's place.
        const stopAsking = () => {
            const discard = discardRef.current;
            const gone = discard?.parentElement !== null && discard?.parentElement !== undefined && getComputedStyle(discard.parentElement).display === "none";
            (gone ? discard.closest("[data-slot=history]")?.querySelector<HTMLElement>("[data-history-more]") ?? discard : discard)?.focus({ preventScroll: true });
            setAsking(false);
        };
        const ask = askingNow && <DiscardAsk head={m.discardAskHead()} title={m.discardAskTitle({ n: pending, count: words.number(pending) })} body={m.discardAskBody()}
            cancel={m.discardAskCancel()} confirm={m.discardAskConfirm()} styles={styles}
            cancelCss={buttonRecipe({ variant: "outline", size: "md" })} confirmCss={buttonRecipe({ variant: "solid", size: "md" })}
            onCancel={stopAsking} onConfirm={() => { stopAsking(); onAction("discard"); }} />;
        return <Box data-slot="history" data-history-form="phone" data-history-locked={locked ? "" : undefined} css={styles.root}>
            <Box css={styles.actions}>
                {/* The row's start: what a Save is doing, else the drafts' count — a chip while there are any, which says how
                    many figures its number holds, for the row to show the number whole or not at all. */}
                <Box css={styles.summary} role="status" aria-live="polite" data-history-summary={statusLine !== undefined ? "message" : "count"}>
                    {statusLine !== undefined ? <Text as="span" css={styles.status}>{statusLine}</Text>
                        : (() => {
                            const counted = m.historyChanges({ n: pending, count: words.number(pending) });
                            if (pending === 0) return <Box as="span" css={styles.changes}>{counted}</Box>;
                            const space = counted.indexOf(" ");
                            return <Box as="span" css={styles.changes} data-changes="" style={{ "--history-figures": (space < 0 ? counted : counted.slice(0, space)).length } as CSSProperties}>
                                <CountWords text={counted} />
                            </Box>;
                        })()}
                </Box>
                {/* The issues there whatever their number, off at none (FR6.3) — and the conflicts with them: the row holds its
                    five squares whatever waits, so while a conflict waits, or they show, the square is theirs to open, named
                    as their own button is, and the focus comes back to it as they close. A host that lists them in a view of
                    its own opens that (ST7). */}
                {(() => {
                    const square = (conflicts: ConflictsSquare | undefined) => {
                        const shown = n + unsettled;
                        const all = shown + warnings.length;
                        const theirs = conflicts !== undefined && conflicts.shown ? conflicts : undefined;
                        const said = theirs ?? issuesWords(words, shown, warnings);
                        return <HistoryButton styles={styles} label={said.label} tip={said.tip} locked={false} icon={faTriangleExclamation} disabled={all === 0 && theirs === undefined}
                            expanded={theirs?.open} buttonRef={conflicts?.button} holds={conflicts?.closing}
                            onClick={() => { if (theirs !== undefined) theirs.toggle(); else if (onOpenIssues !== undefined) onOpenIssues(); else if (issues[0]) onIssue(issues[0]); else warnings[0]?.go(); }}
                            content={all === 0 ? undefined : <Box as="span" css={styles.issuesCount} data-history-issues=""><FontAwesomeIcon icon={faTriangleExclamation} /><span>{words.number(all)}</span></Box>} />;
                    };
                    return onOpenIssues === undefined
                        ? <ConflictsControl session={session} words={words} onIssue={onConflict ?? onIssue} where={where} item={conflictItem} value={conflictValue} issueText={issueText} locked={locked} square={square} />
                        : <><VisuallyHidden aria-live="polite" data-conflicts-said="">{unsettled > 0 ? m.conflictsAppeared({ n: unsettled, count: words.number(unsettled) }) : ""}</VisuallyHidden>{square(undefined)}</>;
                })()}
                <HistoryButton styles={styles} label={m.undo()} tip={m.undoTip()} icon={faArrowRotateLeft} disabled={!session.canUndo && !commitEditor} locked={locked} onClick={() => onAction("undo")} />
                <HistoryButton styles={styles} label={m.redo()} tip={m.redoTip()} icon={faArrowRotateRight} disabled={!session.canRedo} locked={locked} onClick={() => onAction("redo")} />
                {/* Discard, and — where the builder keeps a choice of an automatic Save — More after it: the row shows Discard
                    where it holds it and Save's chevron both, and More in its place where it is short of them (the recipe's
                    rule, over the row's own width). */}
                <HistoryButton styles={styles} label={m.discard()} tip={m.discardTip()} icon={faXmark} disabled={discardOff} locked={locked} expanded={askingNow} buttonRef={discardRef}
                    holder={autosave === undefined ? undefined : styles.fits} onClick={() => setAsking(!asking)} />
                {autosave !== undefined && <MoreControl choice={autosave} held={held} words={words} styles={styles} discardOff={discardOff} locked={locked} onDiscard={() => onAction("discard")} />}
                {(() => {
                    const save = status === "reconciling" && !saving ? <HistoryButton styles={styles} label={m.retryRefresh()} icon={faRotate} disabled={false} locked={locked} onClick={() => onAction("refresh")} />
                        : <HistoryButton styles={styles} label={status === "unknown" ? m.retryRequest() : m.apply()}
                            tip={waiting ? m.applySettleFirst({ n: unsettled, count: words.number(unsettled) }) : saving ? message : held ? m.applyHeld() : stepped ? m.applyStepped() : undefined}
                            icon={status === "unknown" ? faRotate : faCheck} disabled={saveOff} ready={!saveOff && !waiting && status === "idle"} busy={saving} waits={held}
                            content={saving ? <Box as="span" css={styles.live} aria-hidden data-history-live="" /> : undefined}
                            locked={locked || waiting} onClick={() => onAction("apply")} />;
                    return autosave === undefined ? save
                        : <Box css={styles.save} data-history-save="">{save}<AutosaveControl choice={autosave} held={held} words={words} styles={styles} /></Box>;
                })()}
            </Box>
            {ask !== false && (band !== null ? createPortal(ask, band) : ask)}
        </Box>;
    }
    const said = issuesWords(words, n, warnings);
    const counted = n + warnings.length;
    return <Box data-slot="history" data-history-form={buttonsOnly ? "buttons" : "full"} data-history-locked={locked ? "" : undefined} css={styles.root}>
        <Box css={styles.actions}>
            {!buttonsOnly && statusLine !== undefined && <Text role="status" aria-live="polite" css={styles.status}>{statusLine}</Text>}
            {/* The conflicts button first, before Issues: it is what turns Save back on. */}
            <ConflictsControl session={session} words={words} onIssue={onConflict ?? onIssue} where={where} item={conflictItem} value={conflictValue} issueText={issueText} locked={locked} />
            {!buttonsOnly && <Box data-slot="historyIssues" data-empty={counted === 0 ? "" : undefined} data-warnings={warnings.length > 0 ? "" : undefined} css={styles.issues}>
                <HistoryButton styles={styles} label={said.label} tip={said.tip} locked={false}
                    icon={faTriangleExclamation} disabled={counted === 0} onClick={() => { if (issues[0]) onIssue(issues[0]); else warnings[0]?.go(); }} />
            </Box>}
            <HistoryButton styles={styles} label={m.undo()} tip={m.undoTip()} icon={faArrowRotateLeft} disabled={!session.canUndo && !commitEditor} locked={locked} onClick={() => onAction("undo")} />
            <HistoryButton styles={styles} label={m.redo()} tip={m.redoTip()} icon={faArrowRotateRight} disabled={!session.canRedo} locked={locked} onClick={() => onAction("redo")} />
            <HistoryButton styles={styles} label={m.discard()} tip={m.discardTip()} icon={faXmark} disabled={discardOff} locked={locked} onClick={() => onAction("discard")} />
            {(() => {
                const save = status === "reconciling" && !saving ? <HistoryButton styles={styles} label={m.retryRefresh()} icon={faRotate} disabled={false} locked={locked} onClick={() => onAction("refresh")} />
                    : <HistoryButton styles={styles} label={status === "unknown" ? m.retryRequest() : m.apply()}
                        tip={waiting ? m.applySettleFirst({ n: unsettled, count: words.number(unsettled) }) : saving ? message : held ? m.applyHeld() : stepped ? m.applyStepped() : undefined}
                        icon={status === "unknown" ? faRotate : faCheck} disabled={saveOff} busy={saving} waits={held}
                        content={saving ? <Box as="span" css={styles.live} aria-hidden data-history-live="" /> : undefined}
                        locked={locked || waiting} onClick={() => onAction("apply")} />;
                return autosave === undefined ? save
                    : <Box css={styles.save} data-history-save="">{save}<AutosaveControl choice={autosave} held={held} words={words} styles={styles} /></Box>;
            })()}
        </Box>
        {showError && session.error !== undefined && <Text css={styles.error} role="alert">{sessionErrorText(session.error, words)}</Text>}
        {showError && session.error === undefined && keepingText !== undefined && <Text css={styles.notice} data-history-keeping="">{keepingText}</Text>}
    </Box>;
}
