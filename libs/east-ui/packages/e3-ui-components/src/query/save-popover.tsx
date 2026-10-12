/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `QuerySavePopover` — the query builder's save popover (#936,
 * `Query Editor Spec.md` §4.13). The toolbar's Save… opens it, as Studio's
 * Save as template opens its own: it is the shared {@link NamePopover}, the
 * design system's edit popover, headed "Save query · {name}".
 *
 * - **The name**, offering the open query's. A name another saved query
 *   holds is the field's error, "{name} is taken"; the open query's own is
 *   not, and saving under it updates the query.
 * - **The description**, under the name: one sentence, at most
 *   {@link DESCRIPTION_MAX} characters. Untouched, it holds the sentence
 *   generated from the steps, muted, and says so; once edited it counts its
 *   characters and offers **Use generated**, which returns it to the
 *   generated sentence. A query that has a description opens edited, showing
 *   it.
 * - **Cancel** and **Save**. ⏎ saves from the name, and from the description
 *   unless Shift is held — Shift ⏎ is a new line; Esc cancels.
 *
 * Save hands its host the name and the description — `none` while it is the
 * generated sentence, or cleared; the text as edited and trimmed once it is the author's —
 * and closes once its host has saved; what refused the save shows in the
 * popover, which stays open. While the save runs, Save is loading and Cancel
 * and Save are disabled. Each opening starts from the open query's name and
 * description.
 *
 * Its words are the query builder's message table's, its numbers the
 * locale's; its layout is the `sliceEdit` recipe's, and its description the
 * `input` recipe's field, as its name is.
 *
 * It hangs from Save…, or — the row short of room, Save… folded into the
 * toolbar's ⋯ chip (#1229) — from that chip, as its anchor.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useId, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { OptionType, StringType, equalFor, equivalentFor, none, some, type option } from "@elaraai/east";
import { useValueSync, type SliceEditPopoverAnchor } from "@elaraai/east-ui-components";
import { NamePopover } from "../shared/name-popover.js";
import { DESCRIPTION_MAX } from "./model/words.js";
import { useQueryWords } from "./words.js";

type Styles = Record<string, SystemStyleObject>;

/** A saved query's description: `none` shows the sentence generated from its steps. */
const DescriptionType = OptionType(StringType);
/** The memo's comparison of two descriptions. */
const descriptionEquivalent = equivalentFor(DescriptionType);
/** Whether a description's data changed — what re-syncs the field. */
const descriptionEqual = equalFor(DescriptionType);

/** Props of {@link QuerySavePopover}: what it hangs from — the toolbar's Save… (`trigger`), which its host renders, or the ⋯ chip (`anchor`) — and the rest. */
export type QuerySavePopoverProps = SliceEditPopoverAnchor & {
    /** Whether it is open. */
    open: boolean;
    /** Opens or closes it — its trigger, ×, Esc, a click outside, Cancel, or a save that was made. */
    onOpenChange: (open: boolean) => void;
    /** The open query's name — its head names it, and its name field offers it each time it opens. */
    name: string;
    /** The names the other saved queries hold; the open query's own saved name is not among them. */
    taken: ReadonlySet<string>;
    /** The open query's description: `none` while it is the generated sentence, which the field then shows. */
    description: option<string>;
    /** The sentence generated from the steps (the model's `describeQuery`), `""` while no step is finished. */
    generated: string;
    /** Saves the query under the name, with the description — `none` for the generated sentence — and resolves to what refused the save, or `undefined` once it is saved. */
    onSave: (name: string, description: option<string>) => Promise<string | undefined>;
};

/**
 * Renders the save popover — see the module docs.
 *
 * @param props - The query it saves, and the save
 * @returns The trigger or the anchor, and the popover while open
 */
export const QuerySavePopover = memo(function QuerySavePopover(props: QuerySavePopoverProps) {
    const { open, onOpenChange, name, taken, description, generated, onSave } = props;
    const hangs: SliceEditPopoverAnchor = props.trigger !== undefined ? { trigger: props.trigger } : { anchor: props.anchor };
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Styles;
    const input = useRecipe({ key: "input" })({}) as SystemStyleObject;
    const { messages: m, formatters: f } = useQueryWords();
    const id = useId();

    // The description as the field holds it: `none` while it is the generated
    // sentence. Each time the popover opens it starts from the query's, and it
    // follows the query's when that changes.
    const [draft, setDraft] = useState<option<string>>(description);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setDraft(description);
    }
    useValueSync(description, descriptionEqual, () => setDraft(description));

    // Typing makes it the author's own, starting from what the field shows.
    const onDescription = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(some(e.target.value));
    }, []);
    // ⏎ saves, as it does from the name: it submits the popover's form, whose
    // commit checks the name. Shift ⏎ is a new line, and a key that ends an
    // input method's composition is the composition's.
    const onDescriptionKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
    }, []);
    const restore = useCallback(() => setDraft(none), []);
    // A description cleared is no description: the generated sentence shows in its place.
    const save = (confirmed: string) => {
        const written = draft.type === "some" ? draft.value.trim() : "";
        return onSave(confirmed, written === "" ? none : some(written));
    };

    const edited = draft.type === "some";
    const text = edited ? draft.value : generated;
    const hint = edited
        ? m.descriptionCount({ count: f.number(text.length), max: f.number(DESCRIPTION_MAX), n: text.length })
        : m.descriptionGenerated();
    return (
        <NamePopover
            {...hangs}
            open={open}
            onOpenChange={onOpenChange}
            label={<>{m.saveQuery()} · <Box as="span" css={edit.clauseField}>{name}</Box></>}
            placeholder={m.queryName()}
            initial={name}
            taken={taken}
            missing={m.queryNameMissing()}
            nameTaken={(held) => m.queryNameHeld({ name: held })}
            confirm={m.saveConfirm()}
            cancel={m.cancel()}
            onConfirm={save}
        >
            <Box css={edit.field} data-query-description="">
                <chakra.textarea css={[input, edit.textArea]} rows={3} maxLength={DESCRIPTION_MAX} value={text}
                    placeholder={m.descriptionPlaceholder()} aria-label={m.descriptionPlaceholder()} aria-describedby={`${id}-hint`}
                    data-generated={edited ? undefined : ""} onChange={onDescription} onKeyDown={onDescriptionKey} />
                <Box css={edit.hintRow}>
                    <Box as="span" id={`${id}-hint`} css={edit.hint}>{hint}</Box>
                    {edited && (
                        <chakra.button type="button" css={edit.hintAction} onClick={restore}>{m.restoreGenerated()}</chakra.button>
                    )}
                </Box>
            </Box>
        </NamePopover>
    );
}, (prev, next) =>
    prev.open === next.open && prev.name === next.name && prev.generated === next.generated
    && descriptionEquivalent(prev.description, next.description)
    && Object.is(prev.taken, next.taken) && Object.is(prev.trigger, next.trigger) && Object.is(prev.anchor, next.anchor)
    && Object.is(prev.onOpenChange, next.onOpenChange) && Object.is(prev.onSave, next.onSave));
