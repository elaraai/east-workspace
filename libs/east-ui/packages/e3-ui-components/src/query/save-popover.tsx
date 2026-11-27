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
 *   {@link DESCRIPTION_MAX} characters, its box as tall as the sentence —
 *   never under three lines — so all of it shows (`useGrowWithText`,
 *   east-workspace#1779). Untouched, it holds the sentence
 *   generated from the steps, muted, and says so; once edited it counts its
 *   characters and offers **Use generated**, which returns it to the
 *   generated sentence. A query that has a description opens edited, showing
 *   it.
 * - **The tags** (#1758), under the description: the shared typed form's tags
 *   field, a word or two each, the tags the other saved queries hold suggested
 *   as one is typed, in the app's own list under the field (east-workspace#1779).
 *   ⏎ in it adds the tag typed, or the one chosen in its list.
 * - **Cancel** and **Save**. ⏎ saves from the name, and from the description
 *   unless Shift is held — Shift ⏎ is a new line; Esc cancels, but for one in
 *   the tags field with a tag typed and not Entered, which puts the tag back,
 *   the popover staying (east-workspace#1779). ⌘ or Ctrl ⏎ is the builder's,
 *   which runs the query on it, from any of its fields.
 *
 * Save hands its host the name, the description — `none` while it is the
 * generated sentence, or cleared; the text as edited and trimmed once it is the author's —
 * and the tags, and closes once its host has saved; what refused the save shows in the
 * popover, which stays open. While the save runs, Save is loading and Cancel
 * and Save are disabled. Each opening starts from the open query's name, its
 * description and its tags.
 *
 * Its words are the query builder's message table's, its numbers the
 * locale's; its layout is the `sliceEdit` recipe's, its description the
 * `input` recipe's field, as its name is, and its tags the shared
 * `FieldForm`'s.
 *
 * It hangs from Save…, or — the row short of room, Save… folded into the
 * toolbar's ⋯ chip (#1229) — from that chip, as its anchor.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { OptionType, StringType, equalFor, equivalentFor, none, some, type option } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { FieldForm, composingKey, useGrowWithText, useValueSync, type SliceEditPopoverAnchor } from "@elaraai/east-ui-components";
import { NamePopover } from "../shared/name-popover.js";
import { TagsFormType, TagsType, type Tags } from "../shared/tags-form.js";
import { DESCRIPTION_MAX } from "./model/step-words.js";
import { useQueryWords } from "./words.js";

type Styles = Record<string, SystemStyleObject>;

/** A saved query's description: `none` shows the sentence generated from its steps. */
const DescriptionType = OptionType(StringType);
/** The memo's comparison of two descriptions. */
const descriptionEquivalent = equivalentFor(DescriptionType);
/** Whether a description's data changed — what re-syncs the field. */
const descriptionEqual = equalFor(DescriptionType);

/** The memo's comparison of two sets of tags: a saved query's, as the popover's form edits them (`shared/tags-form.ts`). */
const tagsEquivalent = equivalentFor(TagsType);
/** Whether the tags changed — what re-syncs the field. */
const tagsEqual = equalFor(TagsType);

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
    /** The open query's tags: its tags field starts from them each time it opens. */
    tags: Tags;
    /** The tags the saved queries hold, in East's order: suggested as a tag is typed. Keep it stable: the memo compares it. */
    knownTags: readonly string[];
    /** Saves the query under the name, with the description — `none` for the generated sentence — and the tags, and resolves to what refused the save, or `undefined` once it is saved. */
    onSave: (name: string, description: option<string>, tags: Tags) => Promise<string | undefined>;
    /** A phone's view (QP34): its fields labelled, its head the drafts' count, its Save the Primary. */
    phone?: boolean | undefined;
    /** How many drafts the session holds. */
    pending?: number | undefined;
};

/**
 * Renders the save popover — see the module docs.
 *
 * @param props - The query it saves, and the save
 * @returns The trigger or the anchor, and the popover while open
 */
export const QuerySavePopover = memo(function QuerySavePopover(props: QuerySavePopoverProps) {
    const { open, onOpenChange, name, taken, description, generated, tags, knownTags, onSave, phone = false, pending = 0 } = props;
    const hangs: SliceEditPopoverAnchor = props.trigger !== undefined ? { trigger: props.trigger } : { anchor: props.anchor };
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Styles;
    const input = useRecipe({ key: "input" })({}) as SystemStyleObject;
    const { messages: m, formatters: f } = useQueryWords();
    const id = useId();

    // The description as the field holds it: `none` while it is the generated
    // sentence. Each time the popover opens it starts from the query's, and it
    // follows the query's when that changes.
    const [draft, setDraft] = useState<option<string>>(description);
    // The tags as the field holds them: the query's each time the popover opens, and when the query's change. Save
    // reads them as the field last told them (`latest`): a tag typed and left for Save is told as the press on Save
    // lets go, ahead of its click — the field as it was while the press is held, so the Save stays under it
    // (east-workspace#1779) — or as the keyboard leaves its box, and is saved whether or not the popover has drawn again
    // by then.
    const [tagged, setTagged] = useState<Tags>(tags);
    const latest = useRef<Tags>(tags);
    const hold = useCallback((next: Tags) => {
        latest.current = next;
        setTagged(next);
    }, []);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setDraft(description);
            hold(tags);
        }
    }
    useValueSync(description, descriptionEqual, () => setDraft(description));
    useValueSync(tags, tagsEqual, () => hold(tags));
    // The tags' field, in the builder's words, the saved queries' tags suggested.
    const tagSpecs = useMemo(() => Fields.specs(TagsFormType, { tags: Fields.tags({ label: m.tagsLabel(), help: m.tagsHelp(), options: knownTags }) }), [m, knownTags]);
    const tagForm = useMemo(() => ({ tags: tagged }), [tagged]);
    // The form tells an edit's value typed as its field: the tags.
    const onTags = useCallback((_path: readonly string[], next: unknown) => hold(next as Tags), [hold]);

    // Typing makes it the author's own, starting from what the field shows.
    const onDescription = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(some(e.target.value));
    }, []);
    // ⏎ saves, as it does from the name: it submits the popover's form, whose
    // commit checks the name. Shift ⏎ is a new line, an input method's key is
    // the composition's, and ⌘ or Ctrl ⏎ the builder's.
    const onDescriptionKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || composingKey(e)) return;
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
    }, []);
    const restore = useCallback(() => setDraft(none), []);
    // A description cleared is no description: the generated sentence shows in its place.
    const save = (confirmed: string) => {
        const written = draft.type === "some" ? draft.value.trim() : "";
        return onSave(confirmed, written === "" ? none : some(written), latest.current);
    };

    const edited = draft.type === "some";
    const text = edited ? draft.value : generated;
    // Its box as tall as its sentence, held as it mounts with the popover.
    const [descriptionBox, setDescriptionBox] = useState<HTMLTextAreaElement | null>(null);
    useGrowWithText(descriptionBox, text);
    const hint = edited
        ? m.descriptionCount({ count: f.number(text.length), max: f.number(DESCRIPTION_MAX), n: text.length })
        : m.descriptionGenerated();
    return (
        <NamePopover
            {...hangs}
            open={open}
            onOpenChange={onOpenChange}
            label={phone
                ? <>{m.saveQuery()}{pending > 0 && <> <Box as="span" css={edit.hint}>{m.changesCount({ n: pending, count: f.number(pending) })}</Box></>}</>
                : <>{m.saveQuery()} · <Box as="span" css={edit.clauseField}>{name}</Box></>}
            nameLabel={phone ? m.nameLabel() : undefined}
            nameHelp={phone ? m.nameHelp() : undefined}
            primary={phone}
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
                {phone && <chakra.label css={edit.viewFieldLabel}>{m.descriptionLabel()}</chakra.label>}
                <chakra.textarea ref={setDescriptionBox} css={[input, edit.textArea]} rows={3} maxLength={DESCRIPTION_MAX} value={text}
                    placeholder={m.descriptionPlaceholder()} aria-label={m.descriptionPlaceholder()} aria-describedby={`${id}-hint`}
                    data-generated={edited ? undefined : ""} onChange={onDescription} onKeyDown={onDescriptionKey} />
                <Box css={edit.hintRow}>
                    <Box as="span" id={`${id}-hint`} css={edit.hint}>{hint}</Box>
                    {edited && (
                        <chakra.button type="button" css={edit.hintAction} onClick={restore}>{m.restoreGenerated()}</chakra.button>
                    )}
                </Box>
            </Box>
            <Box data-query-tags="">
                <FieldForm specs={tagSpecs} value={tagForm} onChange={onTags} />
            </Box>
        </NamePopover>
    );
}, (prev, next) =>
    prev.open === next.open && prev.name === next.name && prev.generated === next.generated
    && descriptionEquivalent(prev.description, next.description)
    && tagsEquivalent(prev.tags, next.tags) && Object.is(prev.knownTags, next.knownTags)
    && Object.is(prev.taken, next.taken) && Object.is(prev.trigger, next.trigger) && Object.is(prev.anchor, next.anchor)
    && Object.is(prev.onOpenChange, next.onOpenChange) && Object.is(prev.onSave, next.onSave) && prev.phone === next.phone && prev.pending === next.pending);
