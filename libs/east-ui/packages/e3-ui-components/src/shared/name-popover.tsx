/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The popover a screen names something new in — a page in Studio's page
 * library and a template in its builder (#997), a query in the query builder
 * (#936). It asks for a name its host does not hold, takes any further fields
 * its host puts under it, and hands the name to its host's write: it closes
 * once the write is made, and says what refused it otherwise, so a name
 * another write took first is never lost silently.
 *
 * It is the design system's edit popover (`SliceEditPopover`), in the grammar
 * of its Save as cohort: the name field with its hint — help while the name
 * is missing, the field's error while its host holds it — and Cancel and
 * the named commit in the foot, both Default, the commit disabled while a
 * hint shows and loading while the write runs. ⏎ in the name commits — the
 * form's own submission, through its commit — and a field its host adds
 * commits by submitting the form (`requestSubmit`); Esc, ×, a click outside
 * and Cancel close it. It is never a modal: the design system's one modal is
 * a confirmation step, not a form.
 *
 * It says no words of its own: its host passes each one, from its own message
 * table. Its layout is the `sliceEdit` recipe's `form` and `field` slots, and
 * its field the `input` recipe's.
 *
 * @packageDocumentation
 */

import { useId, useState, type ReactNode } from "react";
import { Box, Button as ChakraButton, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { SliceEditPopover } from "@elaraai/east-ui-components";

type Styles = Record<string, SystemStyleObject>;

/** Props of {@link NamePopover}. */
export interface NamePopoverProps {
    /** Whether it is open. */
    open: boolean;
    /** Opens or closes it — its trigger, ×, Esc, a click outside, Cancel, or a write that was made. */
    onOpenChange: (open: boolean) => void;
    /** The button it hangs from, whatever opens it. */
    trigger: ReactNode;
    /** Its head — what it makes, and where. */
    label: ReactNode;
    /** The name field's placeholder, and its accessible name. */
    placeholder: string;
    /** The name it offers when it opens. */
    initial: string;
    /** The names its host holds — the new one must be none of them. */
    taken: ReadonlySet<string>;
    /** The hint while the name is empty. */
    missing: string;
    /** The field's error while its host holds the name — given the name, as typed and trimmed. */
    nameTaken: (name: string) => string;
    /** Its commit verb — the commit button's words. */
    confirm: string;
    /** The cancel button's words. */
    cancel: string;
    /** Further fields, under the name. */
    children?: ReactNode;
    /** Makes the thing under the name — resolves to what refused it, or `undefined` once it is made. */
    onConfirm: (name: string) => Promise<string | undefined>;
}

/**
 * Renders the popover — see the module docs.
 *
 * @param props - What it names, in its host's words, and what it does with the name
 * @returns The trigger, and the popover while open
 */
export function NamePopover({
    open, onOpenChange, trigger, label, placeholder, initial, taken, missing, nameTaken, confirm, cancel, children, onConfirm,
}: NamePopoverProps) {
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Styles;
    const input = useRecipe({ key: "input" })({}) as SystemStyleObject;
    const id = useId();
    const [name, setName] = useState(initial);
    const [refused, setRefused] = useState<string | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    // Each time it opens, it starts from the name it offers.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName(initial);
            setRefused(undefined);
            setBusy(false);
        }
    }

    const trimmed = name.trim();
    const isTaken = trimmed !== "" && taken.has(trimmed);
    const submit = async () => {
        if (trimmed === "" || isTaken || busy) return;
        setBusy(true);
        setRefused(undefined);
        try {
            const why = await onConfirm(trimmed);
            if (why === undefined) onOpenChange(false);
            else setRefused(why);
        } catch (err) {
            setRefused(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <SliceEditPopover
            open={open}
            onOpenChange={onOpenChange}
            trigger={trigger}
            label={label}
            footActions={
                <>
                    <ChakraButton type="button" variant="outline" size="xs" disabled={busy} onClick={() => onOpenChange(false)}>
                        {cancel}
                    </ChakraButton>
                    <ChakraButton type="submit" form={`${id}-form`} variant="outline" size="xs" loading={busy}
                        disabled={trimmed === "" || isTaken}>
                        {confirm}
                    </ChakraButton>
                </>
            }
        >
            <chakra.form id={`${id}-form`} css={edit.form} noValidate
                onSubmit={(e: React.FormEvent) => { e.preventDefault(); void submit(); }}>
                <Box css={edit.field}>
                    <chakra.input css={input} value={name} placeholder={placeholder} aria-label={placeholder}
                        autoComplete="off" autoFocus aria-invalid={isTaken ? true : undefined}
                        aria-describedby={trimmed === "" || isTaken ? `${id}-hint` : undefined}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
                    {trimmed === "" && <Box as="span" id={`${id}-hint`} css={edit.hint}>{missing}</Box>}
                    {isTaken && <Box as="span" id={`${id}-hint`} css={edit.hintError}>{nameTaken(trimmed)}</Box>}
                </Box>
                {children}
                {refused !== undefined && <Box as="span" role="alert" css={edit.hintError} data-refused="">{refused}</Box>}
            </chakra.form>
        </SliceEditPopover>
    );
}
