/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useFieldContext } from "@chakra-ui/react";

/** What names and describes an input: the ids of its field's label and of its help. */
export interface FieldNaming {
    /** The field's label, which names the input. */
    "aria-labelledby"?: string;
    /** The field's help and its error, which describe the input. */
    "aria-describedby"?: string;
}

/**
 * Names an input by the Field it stands in (#1147): the field's label names
 * it and the field's help describes it, as they do the field's own control.
 *
 * @remarks
 * A Field's label is `for` the one control it holds. An input that draws more
 * than one focusable part — a date and a time — or keeps its value in a hidden
 * input beside the box a person types in — a tags input — has parts the label
 * does not reach, which this names. Outside a Field it names nothing, and the
 * input is named as its own value says.
 *
 * @returns The attributes to spread on the part, empty outside a Field
 */
export function useFieldNaming(): FieldNaming {
    const field = useFieldContext();
    return field === undefined ? {} : {
        "aria-labelledby": field.ids.label,
        ...(field.ariaDescribedby !== undefined && { "aria-describedby": field.ariaDescribedby }),
    };
}
