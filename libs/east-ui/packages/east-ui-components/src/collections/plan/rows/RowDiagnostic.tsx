/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A diagnostic row's plot (#811) — the row keeps its gutter and its place,
 * and its plot says why it draws nothing.
 *
 * Every instant on a canvas must ride its axis's arm (#631). A row that does
 * not cannot be placed truthfully, so it is not placed at all — and not
 * rolled up either (`derivePlan`) — while the rest of the canvas draws. A row
 * repeating the id of an earlier row (#822) is drawn the same way: never a
 * silent drop, and never a second row answering to one id.
 */

import { Box } from "@chakra-ui/react";
import type { PlanRowDiagnostic } from "../model.js";
import { usePlanWords, type PlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * The one-line reason a diagnostic row draws nothing.
 *
 * @param diagnostic - The row's diagnostic (`PlanDerived.diagnostics`)
 * @param w - The canvas's words (#820)
 * @returns The message
 */
export function diagnosticText(diagnostic: PlanRowDiagnostic, w: PlanWords): string {
    switch (diagnostic.kind) {
        case "axis": return w.m.axisMismatch({ found: diagnostic.found, expected: diagnostic.expected });
        case "duplicate": return w.m.duplicateRow({ id: diagnostic.of });
    }
}

export interface RowDiagnosticProps {
    diagnostic: PlanRowDiagnostic;
    styles: Styles;
    /** R2 context strip — the hatch stays, the words do not fit. */
    ctx?: boolean | undefined;
}

/**
 * Fill a row's plot with its diagnostic.
 *
 * @param props - The diagnostic, the recipe styles and the strip flag
 * @returns The plot content
 */
export function RowDiagnostic({ diagnostic, styles, ctx }: RowDiagnosticProps) {
    const words = usePlanWords();
    return (
        <Box css={styles.rowDiagnostic}
            // The axis kind the row's instants ride, or `duplicate`.
            data-plan-diagnostic={diagnostic.kind === "axis" ? diagnostic.found : "duplicate"}
            data-ctx={ctx === true ? "" : undefined}>
            {diagnosticText(diagnostic, words)}
        </Box>
    );
}
