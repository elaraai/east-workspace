/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, type ReactNode } from "react";
import { Box, Field as ChakraField, type FieldRootProps } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Field } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { FrameFieldName } from "../../layout/builder-frame/frame-layer.js";

// Pre-define equality function at module level
const fieldEqual = equivalentFor(Field.Types.Field);

/** East Field value type */
export type FieldValue = ValueTypeOf<typeof Field.Types.Field>;

/**
 * Converts an East UI Field value to Chakra UI Field props.
 * Pure function - easy to test independently.
 */
export function toChakraField(value: FieldValue): FieldRootProps {
    return {
        required: getSomeorUndefined(value.required),
        disabled: getSomeorUndefined(value.disabled),
        invalid: getSomeorUndefined(value.invalid),
        readOnly: getSomeorUndefined(value.readOnly),
    };
}

export interface EastChakraFieldProps {
    value: FieldValue;
    storageKey: string;
    /** A control a renderer draws itself, in place of the payload's — a field form's host-drawn control (#1188). */
    controlNode?: ReactNode | undefined;
    /**
     * What the field's help line holds, drawn by a renderer in place of the payload's text — a field form's help, the
     * bound a number breaks said in its host's tone (#1585): the control is described by it, as by the text.
     */
    helperNode?: ReactNode | undefined;
}

/**
 * Renders an East UI Field value using Chakra UI Field component.
 */
export const EastChakraField = memo(function EastChakraField({ value, storageKey, controlNode, helperNode }: EastChakraFieldProps) {
    const props = useMemo(() => toChakraField(value), [value]);
    const helperText = useMemo(() => getSomeorUndefined(value.helperText), [value.helperText]);
    const errorText = useMemo(() => getSomeorUndefined(value.errorText), [value.errorText]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const schemaKey = useMemo(() => style ? getSomeorUndefined(style.schemaKey) : undefined, [style]);

    return (
        <ChakraField.Root {...props}>
            <ChakraField.Label>
                {value.label}
                {/* The field's key, after its label: the `field` recipe styles it, and wraps it under the label short of room. It is
                    for the eye: the control is named by the label alone, never the label and the key run together. */}
                {schemaKey && <Box as="span" data-field-key="" aria-hidden="true">{schemaKey}</Box>}
            </ChakraField.Label>
            <FrameFieldName.Provider value={value.label}>
                {controlNode ?? <EastChakraComponent value={value.control} storageKey={`${storageKey}.control`} />}
            </FrameFieldName.Provider>
            {(helperNode ?? helperText) && <ChakraField.HelperText>{helperNode ?? helperText}</ChakraField.HelperText>}
            {errorText && <ChakraField.ErrorText>{errorText}</ChakraField.ErrorText>}
        </ChakraField.Root>
    );
}, (prev, next) => fieldEqual(prev.value, next.value) && prev.storageKey === next.storageKey && prev.controlNode === next.controlNode
    && prev.helperNode === next.helperNode);
