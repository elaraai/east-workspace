/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a form's fields hold a number to bounds (#1585): what every builder
 * checks its rows against — through the form's own check and words,
 * `fieldBreaches` — and where a form holds none, it checks nothing.
 *
 * @packageDocumentation
 */

import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";

/**
 * Whether a field holds a number to a least or a most.
 *
 * @param spec - The field, as `Fields.specs` resolved it
 * @returns Whether its editor is a number's with a least or a most
 */
export function isBounded(spec: FieldSpecValue): boolean {
    return spec.editor.type === "number"
        && (getSomeorUndefined(spec.editor.value.min) !== undefined || getSomeorUndefined(spec.editor.value.max) !== undefined);
}
