/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioSaveTemplate` — the renderer of the `StudioSaveTemplate`
 * extension declared in `@elaraai/e3-ui` (#997): the builder toolbar's Save as
 * template, before Preview and Publish. Its button opens the popover that
 * names the template — offering "<page> template" — and saves the open page,
 * as last saved, under the name: the payload's one commit. A name the project
 * holds is refused in the popover, and so is a name another write took first.
 * While a template is open the button is disabled: a template is not saved
 * again.
 *
 * Its button is the `button` recipe's outline, as its neighbours in the
 * toolbar are; its popover is the Studio's {@link NamePopover}.
 *
 * @packageDocumentation
 */

import { memo, useState } from "react";
import { Box, Button as ChakraButton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioSaveTemplateComponent } from "@elaraai/e3-ui/internal";
import { implementUIComponent } from "@elaraai/east-ui-components";

import { useStudioMessages } from "./messages.js";
import { NamePopover } from "./name-popover.js";

/** The renderer's payload, decoded. */
type StudioSaveTemplateValue = ValueTypeOf<typeof StudioSaveTemplateComponent.schema>;

/** Props of {@link EastChakraStudioSaveTemplate}. */
export interface EastChakraStudioSaveTemplateProps {
    /** The payload, decoded. */
    value: StudioSaveTemplateValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders Save as template — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The button, and its popover while open
 */
export const EastChakraStudioSaveTemplate = memo(function EastChakraStudioSaveTemplate({ value }: EastChakraStudioSaveTemplateProps) {
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
            confirm={m.saveTemplate()}
            onConfirm={async (name) => {
                const refused = await onSave(name);
                return refused.type === "some" ? refused.value : undefined;
            }}
        />
    );
});

implementUIComponent(StudioSaveTemplateComponent, EastChakraStudioSaveTemplate);
