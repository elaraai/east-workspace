/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A step card's parts (#936) — #934's `CardPart`s and `CardLine`s as the
 * Query tab draws them (`Query Editor Spec.md` §4.3): words, with joiners in
 * a fixed column so conditions line up; slots, each the `select` trigger —
 * dashed while empty, the danger ink with a problem — which open the
 * autocomplete; inputs, which edit on leaving; chips with their ×; adds,
 * dashed in a row and quiet in a foot; a row's ×; a jq step's code; groups
 * with their own head; and the problem lines under the rows that caused
 * them, with the checker's own sentence on hover and its fixes as buttons.
 *
 * Every part says what it was asked to do through {@link PartActions}; the
 * Query tab makes each one gesture of the editing session. State reaches the
 * styles through data attributes on the `queryBuilder` recipe's slots.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Box, Button, Portal, Tooltip, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas, faCircleExclamation, faCircleInfo, faPlus, faTriangleExclamation, faXmark, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { useValueSync } from "@elaraai/east-ui-components";
import type { CardLine, CardPart, ProblemLine } from "./model/cards.js";
import type { ActionRef, InputRef, RemoveRef, SlotRef } from "./model/refs.js";
import type { QueryWords } from "./model/words.js";
import type { StepFix } from "./steps/check.js";

// A step's and an offer's icons are Font Awesome names; register the free-solid
// set so they resolve by name (idempotent).
library.add(fas);

/** A recipe's styles, by slot. */
export type Styles = Record<string, SystemStyleObject>;

const textEqual = equalFor(StringType);

/** What the parts ask of the Query tab. */
export interface PartActions {
    /** The key of the slot whose autocomplete is open. */
    readonly openSlot: string | undefined;
    /** Opens a slot's autocomplete, hanging from its element. */
    readonly onSlot: (slot: SlotRef, anchor: HTMLElement) => void;
    /** An input typed in and left. */
    readonly onInput: (input: InputRef, raw: string) => void;
    /** A × pressed. */
    readonly onRemove: (ref: RemoveRef) => void;
    /** An add pressed: one that adds, or one that opens a slot, hanging from its element. */
    readonly onAction: (ref: ActionRef, anchor: HTMLElement) => void;
    /** A problem's fix taken. */
    readonly onFix: (fix: StepFix, label: string) => void;
}

/** What drawing the parts needs: the styles of the recipes they are made of, and the words. */
export interface PartStyles {
    /** The `queryBuilder` recipe's. */
    readonly styles: Styles;
    /** The `select` recipe's, small: a slot is its trigger. */
    readonly select: Styles;
    /** The `input` recipe's, small. */
    readonly input: SystemStyleObject;
    /** The `iconButton` recipe's, quiet and extra small. */
    readonly icon: SystemStyleObject;
    /** The `codeBlock` recipe's. */
    readonly code: Styles;
    /** The words. */
    readonly words: QueryWords;
}

/**
 * The parts' styles: the `queryBuilder` recipe's, and the core recipes' a
 * part is made of.
 *
 * @param words - The words
 * @returns The styles, and the words
 */
export function usePartStyles(words: QueryWords): PartStyles {
    const styles = useSlotRecipe({ key: "queryBuilder" })() as Styles;
    const select = useSlotRecipe({ key: "select" })({ size: "sm" }) as Styles;
    const input = useRecipe({ key: "input" })({ size: "xs" }) as SystemStyleObject;
    const icon = useRecipe({ key: "iconButton" })({ size: "xs", variant: "ghost" }) as SystemStyleObject;
    const code = useSlotRecipe({ key: "codeBlock" })() as Styles;
    return { styles, select, input, icon, code, words };
}

/**
 * A slot's key: what its element carries as `data-slot-key`, so the slot a
 * pick opens next is found after the query renders again.
 *
 * @param slot - The slot
 * @returns Its key
 */
export function slotKey(slot: SlotRef): string {
    return [slot.kind, slot.stepId, slot.condId ?? "", slot.id ?? "", slot.at === undefined ? "" : String(slot.at)].join("|");
}

/**
 * A tooltip over a control: the design system's, after a moment's hover.
 *
 * @param props - The words it shows, and the control
 * @returns The control, with its tooltip
 */
export function Tip({ label, children }: { label: string; children: ReactElement }) {
    if (label === "") return children;
    return (
        <Tooltip.Root openDelay={250}>
            <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{label}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}

/**
 * An icon button, named for a screen reader and by its tooltip.
 *
 * @param props - Its name, its icon, whether it is off, what it does, and its styles
 * @returns The button
 */
export function IconPart({ label, icon, disabled = false, css, onClick }: {
    label: string; icon: IconDefinition; disabled?: boolean; css: SystemStyleObject | SystemStyleObject[]; onClick: () => void;
}) {
    return (
        <Tip label={label}>
            <chakra.button type="button" css={css} aria-label={label} disabled={disabled} onClick={onClick}>
                <FontAwesomeIcon icon={icon} />
            </chakra.button>
        </Tip>
    );
}

/** An input of a step card: typed in, and edited on leaving. */
const InputPart = memo(function InputPart({ part, ps, actions }: {
    part: Extract<CardPart, { t: "input" }>; ps: PartStyles; actions: PartActions;
}) {
    // Interactive state: the text typed, seeded from the step, re-synced when the step's value moves.
    const [text, setText] = useState(part.value);
    useValueSync(part.value, textEqual, () => setText(part.value));
    const cancelled = useRef(false);
    const commit = () => {
        if (cancelled.current) {
            cancelled.current = false;
            return;
        }
        if (!textEqual(text, part.value)) actions.onInput(part.input, text);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            event.currentTarget.blur();
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            setText(part.value);
            event.currentTarget.blur();
        }
    };
    return (
        <chakra.input css={[ps.input, ps.styles.input!]} value={text}
            aria-label={ps.words.messages.inputLabel({ input: part.input.kind })}
            aria-invalid={part.error ? true : undefined}
            data-width={part.width} data-mono={part.mono ? "" : undefined} data-error={part.error ? "" : undefined}
            onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
    );
});

/** One part of a row. */
function Part({ part, ps, actions, ghost }: { part: CardPart; ps: PartStyles; actions: PartActions; ghost: boolean }) {
    const { styles, words } = ps;
    const m = words.messages;
    switch (part.t) {
        case "word":
            return <Box as="span" css={part.joiner === true ? styles.joiner : styles.word}>{part.text}</Box>;
        case "slot": {
            const key = slotKey(part.slot);
            const open = actions.openSlot === key;
            return (
                <chakra.button type="button" css={[ps.select.trigger!, styles.slot!]} data-slot-key={key}
                    data-empty={part.empty ? "" : undefined} data-error={part.error ? "" : undefined}
                    data-open={open ? "" : undefined} data-mono={part.mono ? "" : undefined}
                    aria-haspopup="listbox" aria-expanded={open}
                    onClick={(event) => actions.onSlot(part.slot, event.currentTarget)}>
                    <Box as="span" css={styles.slotText}>{part.empty ? part.placeholder : part.text}</Box>
                    <Box as="span" css={styles.slotCaret} aria-hidden>▾</Box>
                </chakra.button>
            );
        }
        case "input":
            return <InputPart part={part} ps={ps} actions={actions} />;
        case "chip":
            return (
                <Box as="span" css={styles.chip} data-query-chip="">
                    {part.text}
                    <IconPart label={`${m.remove()} ${part.text}`} icon={faXmark} css={[ps.icon, styles.chipRemove!]}
                        onClick={() => actions.onRemove(part.remove)} />
                </Box>
            );
        case "add": {
            const opens = part.action.kind === "open" && part.action.slot !== undefined ? slotKey(part.action.slot) : undefined;
            return (
                <Button size="xs" variant="ghost" css={styles.add} data-ghost={ghost || part.ghost ? "" : undefined}
                    data-slot-key={opens} onClick={(event) => actions.onAction(part.action, event.currentTarget)}>
                    <FontAwesomeIcon icon={faPlus} />{part.text}
                </Button>
            );
        }
        case "remove":
            return <IconPart label={part.label} icon={faXmark} css={[ps.icon, styles.remove!]} onClick={() => actions.onRemove(part.target)} />;
        case "code":
            return (
                <Box css={ps.code.root} data-query-code="">
                    <Box as="pre" css={ps.code.content}><Box as="code" css={ps.code.code}>{part.text}</Box></Box>
                </Box>
            );
    }
}

/**
 * A row's parts, in order.
 *
 * @param props - The parts, their styles and what they ask
 * @returns The parts
 */
export function Parts({ parts, ps, actions, ghost = false }: { parts: readonly CardPart[]; ps: PartStyles; actions: PartActions; ghost?: boolean }): ReactNode {
    return parts.map((part, i) => <Part key={i} part={part} ps={ps} actions={actions} ghost={ghost} />);
}

/** Each severity's icon. */
const SEVERITY_ICON: Readonly<Record<ProblemLine["severity"], IconDefinition>> = {
    error: faCircleExclamation,
    warning: faTriangleExclamation,
    note: faCircleInfo,
};

/**
 * The problems under a row: each in its severity's ink, the checker's own
 * sentence on hover, and its fixes as buttons.
 *
 * @param props - The problems, their styles and what a fix asks
 * @returns The problem lines
 */
export function Problems({ problems, ps, actions }: { problems: readonly ProblemLine[]; ps: PartStyles; actions: PartActions }): ReactNode {
    const { styles } = ps;
    return problems.map((problem, i) => (
        <Box key={i} css={styles.problem} data-severity={problem.severity} data-query-problem={problem.code}>
            <Box as="span" css={styles.problemIcon} aria-hidden><FontAwesomeIcon icon={SEVERITY_ICON[problem.severity]} /></Box>
            <Tip label={problem.message === problem.text ? "" : problem.message}>
                <Box as="span" css={styles.problemText}>{problem.text}</Box>
            </Tip>
            {problem.fixes.map((fix, j) => (
                <Button key={j} size="xs" variant="outline" data-query-fix="" onClick={() => actions.onFix(fix.fix, fix.label)}>{fix.label}</Button>
            ))}
        </Box>
    ));
}

/**
 * A card's lines: rows, groups with their head and lines, feet, notes and a
 * jq step's code, each with the problems under it.
 *
 * @param props - The lines, their styles and what they ask
 * @returns The lines
 */
export function Lines({ lines, ps, actions }: { lines: readonly CardLine[]; ps: PartStyles; actions: PartActions }): ReactNode {
    const { styles } = ps;
    return lines.map((line, i) => {
        switch (line.kind) {
            case "row":
                return (
                    <Fragment key={i}>
                        <Box css={styles.row} data-query-line="row"><Parts parts={line.parts} ps={ps} actions={actions} /></Box>
                        <Problems problems={line.problems} ps={ps} actions={actions} />
                    </Fragment>
                );
            case "group": {
                const head = line.head ?? [];
                return (
                    <Fragment key={i}>
                        <Box css={styles.group} data-query-line="group">
                            <Parts parts={line.parts} ps={ps} actions={actions} />
                            <Box css={styles.groupBox}>
                                <Box css={styles.groupHead}>
                                    <Parts parts={head.filter(p => p.t !== "remove")} ps={ps} actions={actions} />
                                    <Box css={styles.cardSpacer} />
                                    <Parts parts={head.filter(p => p.t === "remove")} ps={ps} actions={actions} />
                                </Box>
                                <Lines lines={line.lines ?? []} ps={ps} actions={actions} />
                            </Box>
                        </Box>
                        <Problems problems={line.problems} ps={ps} actions={actions} />
                    </Fragment>
                );
            }
            case "foot":
                return (
                    <Fragment key={i}>
                        <Box css={styles.cardFoot} data-query-line="foot"><Parts parts={line.parts} ps={ps} actions={actions} ghost /></Box>
                        <Problems problems={line.problems} ps={ps} actions={actions} />
                    </Fragment>
                );
            case "note":
                return (
                    <Box key={i} as="span" css={styles.note} data-query-line="note">
                        {line.parts.map(p => (p.t === "word" ? p.text : "")).join(" ")}
                    </Box>
                );
            case "code":
                return (
                    <Fragment key={i}>
                        <Parts parts={line.parts} ps={ps} actions={actions} />
                        <Problems problems={line.problems} ps={ps} actions={actions} />
                    </Fragment>
                );
        }
    });
}
