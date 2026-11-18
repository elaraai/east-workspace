/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's model (#934), on top of the canonical steps (#933):
 * plain words, step cards, slots and autocomplete, summaries and the
 * generated description — plain TypeScript over East values, with no React,
 * so the renderers (#935–#939, #1063) stay thin.
 *
 * @packageDocumentation
 */

export type { KindName, OneKind, QueryMessages, SlotKind, TotalName } from "./messages.js";
export { queryMessages } from "./messages-en.js";
export {
    STEP_ICON,
    adjectiveOf, countWords, dataNumber, fieldKind, fieldLabel, fieldLabels, fieldSummaryWords, human, isIdName, leafPath,
    plainKind, plural, queryWords, refLabel, rowsWords, shapeWords, valueWords,
    type QueryWords, type SummaryLeaf,
} from "./words.js";
export { parseErrorWords, problemWords, type ProblemWords } from "./problem-words.js";
export { DESCRIPTION_MAX, conditionWords, describeQuery, orderKind, stepWords } from "./step-words.js";
export { sameSlot, type ActionRef, type InputKind, type InputRef, type RemoveRef, type SlotRef, type SlotValue } from "./refs.js";
export {
    cardsFor, firstEmptySlot, outlineOf, sourceCard,
    type Card, type CardLine, type CardPart, type OutlineLine, type ProblemLine, type ShapeLine, type SourceCard,
} from "./cards.js";
export {
    activeItem, quickAddOptions, slotEmpty, slotHint, slotItems, slotLabel, slotPlaceholder, stepOptions,
    type SavedOffer, type SlotContext, type SlotItem, type StepOption,
} from "./slots.js";
export { applyAction, applyInput, applyRemove, applySlot, type SlotResult } from "./slot-edits.js";
export {
    SUMMARY_LIMITS, SummaryCache, leafOf, summaryAt, summaryNeeded,
    type Summary, type SummaryRequest, type SummaryResult, type SummaryRun,
} from "./summaries.js";
