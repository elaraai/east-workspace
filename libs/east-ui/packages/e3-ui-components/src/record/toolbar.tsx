/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's toolbar (`Record - DX Proposal.md` FR2–FR7): left to right the
 * title and the count of the record's rows, the rail over its slice, the
 * status line, Add and Delete, and the history bar — the Sheet's items taken
 * as parts, beside the Record's own.
 *
 * One row, folded by the shared ladder (#952): the rail gives way first, as
 * it does in every builder's toolbar; then the title's count goes, then Add
 * and Delete fold to their icons, and the history folds last. The status
 * line takes the row's slack and nothing more, so it never holds a fold back:
 * a row short of room cuts its words with an ellipsis, down to nothing.
 *
 * In a phone's frame (`Mobile Builder Frame Spec.md` FR2) the row is the
 * title, the rail's summary and its Filters button, and Add as its icon at
 * the row's end; the status line says its words in the footer's band (FR5),
 * Delete is not drawn — a phone has no select column, and a row is deleted
 * from the inspector — and the history is the toolbar's second row.
 *
 * @packageDocumentation
 */

import { Box, chakra, Portal, Tooltip, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, useSlotStyles, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { SheetToolbarParts } from "../sheet/Toolbar.js";
import { recordMessages as m } from "./messages.js";
import type { RecordNoun } from "./status.js";

/** The Record's own fold ranks, after every step of the rail's (#952): the title's count, then Add and Delete to their icons. */
const RECORD_RANK = { count: HOST_RANK, actions: HOST_RANK + 1 } as const;

/** Props of {@link useRecordToolbarItems}. */
export interface RecordToolbarProps {
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The Sheet's toolbar items, as parts: the rail, the Elara eye and the history are the Record's. */
    parts: SheetToolbarParts;
    /** The title; `undefined` for a Record with none, which leads its row with the rail. */
    title: string | undefined;
    /** The record's rows, counted in the viewer's language; `undefined` while not known. */
    count: string | undefined;
    /** The status line's words. */
    status: string;
    /** The Record's word for its rows. */
    noun: RecordNoun;
    /** Add, where the Record adds rows; `undefined` hides it. */
    onAdd: (() => void) | undefined;
    /** Delete of the ticked rows, where the Record deletes rows; `undefined` hides it. */
    onDelete: (() => void) | undefined;
    /** How many of the rows shown are ticked: Delete is off at none. */
    ticked: number;
    /** Whether a gesture may be made now: Add and Delete are off while the session takes none — an Apply out. */
    writable: boolean;
}

/** One of Add and Delete: its icon and, unfolded, its words — its tooltip on hover, the button disabled or not. */
function RecordAction({ css, icon, label, tip, disabled, labelled, part, onClick }: {
    css: SystemStyleObject | SystemStyleObject[];
    icon: IconDefinition;
    label: string;
    tip: string;
    disabled: boolean;
    /** Its words beside its icon; folded, its icon alone, named by its label. */
    labelled: boolean;
    /** What the tests and the visual invariants find it by. */
    part: "add" | "delete";
    onClick: () => void;
}) {
    return (
        <Tooltip.Root openDelay={250}>
            <Tooltip.Trigger asChild>
                {/* A span holds the hover: a disabled button takes no pointer events, and Delete's tooltip says why it is off. */}
                <span>
                    <chakra.button type="button" css={css} aria-label={labelled ? undefined : label} disabled={disabled}
                        data-record-action={part} onClick={onClick}>
                        <FontAwesomeIcon icon={icon} />
                        {labelled && label}
                    </chakra.button>
                </span>
            </Tooltip.Trigger>
            <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
    );
}

/**
 * Builds the Record's toolbar items in the row's order — see the module docs.
 *
 * @param props - What the items show and drive
 * @returns The items, a falsy entry for each the Record has no use for
 */
export function useRecordToolbarItems(props: RecordToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    const { styles, parts, title, count, status, noun, onAdd, onDelete, ticked, writable } = props;
    const buttonRecipe = useRecipe({ key: "button" });
    const iconRecipe = useRecipe({ key: "iconButton" });
    const phoneStyles = useSlotStyles("toolbarPhone");
    const button = [buttonRecipe({ variant: "outline", size: "sm" }), styles.action] as SystemStyleObject[];
    const icon = [iconRecipe({ variant: "outline", size: "sm" }), styles.action] as SystemStyleObject[];
    const addTip = m.addTip({ noun: noun.singular });
    const deleteTip = m.deleteTip({ n: ticked, count: String(ticked) });

    const titleOf = (counted: boolean) => (
        <Box as="span" css={styles.title} data-slot="title">
            <Box as="span" css={styles.titleText} data-slot="titleText">{title}</Box>
            {counted && count !== undefined && <Box as="span" css={styles.titleCount} data-slot="titleCount">{count}</Box>}
        </Box>
    );
    // A phone's row counts the rows in the rail's summary, where there is a rail: the title's count is the row's only count where there is none.
    const titleItem: ToolbarItem | undefined = title === undefined ? undefined : {
        key: "record-title",
        forms: count === undefined ? [titleOf(false)] : [titleOf(true), titleOf(false)],
        rank: RECORD_RANK.count,
        version: count,
        phone: { form: titleOf(parts.rail.length === 0) },
    };

    // The last gesture's words: a live region always there, so a screen reader hears each change of them.
    const statusItem: ToolbarItem = {
        key: "record-status",
        side: "end",
        forms: [<Box as="span" css={styles.status} data-slot="status" role="status" aria-live="polite" title={status === "" ? undefined : status}>{status}</Box>],
        grow: true,
        // A phone's row has no room for them: its footer's band says them.
        phone: { form: null },
    };

    const actionsOf = (labelled: boolean) => (
        <Box as="span" css={styles.actions} data-slot="actions">
            {onAdd !== undefined && (
                <RecordAction css={labelled ? button : icon} icon={faPlus} label={m.add()} tip={addTip} disabled={!writable} labelled={labelled} part="add" onClick={onAdd} />
            )}
            {onDelete !== undefined && (
                <RecordAction css={labelled ? button : icon} icon={faMinus} label={m.delete()} tip={deleteTip} disabled={!writable || ticked === 0} labelled={labelled}
                    part="delete" onClick={onDelete} />
            )}
        </Box>
    );
    const actionsItem: ToolbarItem | undefined = onAdd === undefined && onDelete === undefined ? undefined : {
        key: "record-actions",
        side: "end",
        forms: [actionsOf(true), actionsOf(false)],
        rank: RECORD_RANK.actions,
        // A phone's: Add as its icon at the row's end, after the rail's Filters button; Delete is the inspector's.
        phone: {
            form: onAdd === undefined ? null : (
                <chakra.button type="button" css={phoneStyles.search} aria-label={addTip} title={addTip} disabled={!writable} data-record-action="add" onClick={onAdd}>
                    <FontAwesomeIcon icon={faPlus} />
                </chakra.button>
            ),
            order: 2,
        },
    };

    return [titleItem, ...parts.rail, statusItem, actionsItem, parts.optimise, parts.history];
}
