/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioSaveTemplate` — the builder toolbar's Save as template (#997), before
 * Preview and Publish. Its button opens the popover that names the template —
 * offering "<page> template" — and saves the open page, as last saved, under
 * the name: one commit. A name the project holds is refused in the popover,
 * and so is a name another write took first. While a template is open the
 * button is disabled: a template is not saved again.
 *
 * Its button is the `button` recipe's outline, as its neighbours in the
 * toolbar are; its popover is the shared {@link NamePopover}, in the Studio's
 * words.
 *
 * On a row short of room the button folds into the toolbar's ⋯ chip (#1229),
 * whose menu's Save as template… opens the same popover: its host then holds
 * it open and hangs it from the chip, as its `anchor`.
 *
 * @packageDocumentation
 */

import { memo, useState, type ReactNode } from "react";
import { Box, Button as ChakraButton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioSaveTemplatePayloadType } from "@elaraai/e3-ui/internal";

import { NamePopover } from "../shared/name-popover.js";
import { useStudioMessages } from "./messages.js";

/** Save as template, as the builder draws it. */
type StudioSaveTemplateValue = ValueTypeOf<typeof StudioSaveTemplatePayloadType>;

/** Props of {@link StudioSaveTemplate}: its button, or the chip its host hangs it from, open while its host says. */
export type StudioSaveTemplateProps = {
    /** The open page's title, whether it can be saved, the names taken, and the save. */
    value: StudioSaveTemplateValue;
} & (
    | { anchor?: undefined }
    | {
        /** The chip it hangs from — the toolbar's ⋯, whose menu opened it. */
        anchor: ReactNode;
        /** Whether it is open. */
        open: boolean;
        /** Opens or closes it. */
        onOpenChange: (open: boolean) => void;
    }
);

/**
 * Renders Save as template — see the module docs.
 *
 * @param props - What it saves, and how
 * @returns The button, or the chip, and its popover while open
 */
export const StudioSaveTemplate = memo(function StudioSaveTemplate(props: StudioSaveTemplateProps) {
    const { value } = props;
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Record<string, SystemStyleObject>;
    const m = useStudioMessages();
    const [own, setOwn] = useState(false);
    const open = props.anchor === undefined ? own : props.open;
    const setOpen = props.anchor === undefined ? setOwn : props.onOpenChange;
    const onSave = value.onSave;
    const button = (
        <ChakraButton variant="outline" disabled={!value.enabled} data-studio-save-template=""
            {...(value.enabled ? {} : { title: m.templateOpen() })}>
            {m.saveAsTemplate()}
        </ChakraButton>
    );
    return (
        <NamePopover
            open={open}
            onOpenChange={(next) => setOpen(next && value.enabled)}
            {...(props.anchor === undefined ? { trigger: button } : { anchor: props.anchor })}
            label={<>{m.saveAsTemplate()} · <Box as="span" css={edit.clauseField}>{value.title}</Box></>}
            placeholder={m.templateName()}
            initial={m.templateNameFor({ page: value.title })}
            taken={value.taken}
            missing={m.templateNameMissing()}
            nameTaken={(name) => m.nameTaken({ name })}
            confirm={m.saveTemplate()}
            cancel={m.cancel()}
            onConfirm={async (name) => {
                const refused = await onSave(name);
                return refused.type === "some" ? refused.value : undefined;
            }}
        />
    );
});
