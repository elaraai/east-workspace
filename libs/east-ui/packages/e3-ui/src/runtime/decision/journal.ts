/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<DecisionJournal>` tag — see the export's JSDoc. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { DecisionJournal as DecisionJournalFactory } from "../../decision/journal.js";

/**
 * The resolved-cases read-back — the Decide↔Trust seam. Pass the same
 * `Decision.bind` handle the queue consumes: as cases resolve they leave
 * the queue and appear here, newest first, each entry showing how the case
 * left (accepted / rejected / deferred / handoff), when, the operator's
 * captured knowledge, and any injected constraints.
 *
 * @example
 * ```tsx
 * // .tsx with the `@jsxImportSource @elaraai/east-ui` pragma
 * <DecisionJournal handle={handle} heading="Decision journal" />
 * ```
 *
 * @remarks
 * Carries `DecisionJournal.Types`. Desugars to `DecisionJournal.Root(options)`.
 * The renderer registers against `DecisionJournal.Component` (from
 * `@elaraai/e3-ui/internal`).
 */
export const DecisionJournal: JsxTag<OptionsProps<typeof DecisionJournalFactory.Root>> & {
    Types: typeof DecisionJournalFactory.Types;
} = Object.assign(optionsTag(DecisionJournalFactory.Root), { Types: DecisionJournalFactory.Types });
