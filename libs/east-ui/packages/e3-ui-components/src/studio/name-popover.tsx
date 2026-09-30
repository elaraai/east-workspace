/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The popover a Studio screen names something new in (#997) — a page in the
 * page library, a template in the builder. It asks for a name the project
 * does not hold, takes any further fields its host puts under it, and hands
 * the name to its host's write: it closes once the write is made, and says
 * what refused it otherwise, so a name another write took first is never
 * lost silently.
 *
 * It is the design system's edit popover (`SliceEditPopover`), in the grammar
 * of its Save as cohort: the name field with its hint — help while the name
 * is missing, the field's error while the project holds it — and Cancel and
 * the named commit in the foot, both Default, the commit disabled while a
 * hint shows and loading while the write runs. It is never a modal: the
 * design system's one modal is a confirmation step, not a form.
 *
 * @packageDocumentation
 */

import { useId, useState, type ReactNode } from "react";
import { Box, Button as ChakraButton, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { SliceEditPopover } from "@elaraai/east-ui-components";
import { useStudioMessages } from "./messages.js";

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
    /** The names the project holds — the new one must be none of them. */
    taken: ReadonlySet<string>;
    /** The hint while the name is empty. */
    missing: string;
    /** Its commit verb — the commit button's words. */
    confirm: string;
    /** Further fields, under the name. */
    children?: ReactNode;
    /** Makes the thing under the name — resolves to what refused it, or `undefined` once it is made. */
    onConfirm: (name: string) => Promise<string | undefined>;
}

/**
 * Renders the popover — see the module docs.
 *
 * @param props - What it names and what it does with the name
 * @returns The trigger, and the popover while open
 */
export function NamePopover({
    open, onOpenChange, trigger, label, placeholder, initial, taken, missing, confirm, children, onConfirm,
}: NamePopoverProps) {
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Styles;
    const input = useRecipe({ key: "input" })({}) as SystemStyleObject;
    const m = useStudioMessages();
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
                        {m.cancel()}
                    </ChakraButton>
                    <ChakraButton type="submit" form={`${id}-form`} variant="outline" size="xs" loading={busy}
                        disabled={trimmed === "" || isTaken}>
                        {confirm}
                    </ChakraButton>
                </>
            }
        >
            <chakra.form id={`${id}-form`} display="contents" noValidate
                onSubmit={(e: React.FormEvent) => { e.preventDefault(); void submit(); }}>
                <Box display="flex" flexDirection="column" gap="{spacing.1}">
                    <chakra.input css={input} value={name} placeholder={placeholder} aria-label={placeholder}
                        autoComplete="off" autoFocus aria-invalid={isTaken ? true : undefined}
                        aria-describedby={trimmed === "" || isTaken ? `${id}-hint` : undefined}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
                    {trimmed === "" && <Box as="span" id={`${id}-hint`} css={edit.hint}>{missing}</Box>}
                    {isTaken && <Box as="span" id={`${id}-hint`} css={edit.hintError}>{m.nameTaken({ name: trimmed })}</Box>}
                </Box>
                {children}
                {refused !== undefined && <Box as="span" role="alert" css={edit.hintError} data-refused="">{refused}</Box>}
            </chakra.form>
        </SliceEditPopover>
    );
}
