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
 * @packageDocumentation
 */

import { memo, useState } from "react";
import { Box, Button as ChakraButton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioSaveTemplatePayloadType } from "@elaraai/e3-ui/internal";

import { NamePopover } from "../shared/name-popover.js";
import { useStudioMessages } from "./messages.js";

/** Save as template, as the builder draws it. */
type StudioSaveTemplateValue = ValueTypeOf<typeof StudioSaveTemplatePayloadType>;

/** Props of {@link StudioSaveTemplate}. */
export interface StudioSaveTemplateProps {
    /** The open page's title, whether it can be saved, the names taken, and the save. */
    value: StudioSaveTemplateValue;
}

/**
 * Renders Save as template — see the module docs.
 *
 * @param props - What it saves, and how
 * @returns The button, and its popover while open
 */
export const StudioSaveTemplate = memo(function StudioSaveTemplate({ value }: StudioSaveTemplateProps) {
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Record<string, SystemStyleObject>;
    const m = useStudioMessages();
    const [open, setOpen] = useState(false);
    const onSave = value.onSave;
    return (
        <NamePopover
            open={open}
            onOpenChange={(next) => setOpen(next && value.enabled)}
            trigger={
                <ChakraButton variant="outline" disabled={!value.enabled} data-studio-save-template=""
                    {...(value.enabled ? {} : { title: m.templateOpen() })}>
                    {m.saveAsTemplate()}
                </ChakraButton>
            }
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
