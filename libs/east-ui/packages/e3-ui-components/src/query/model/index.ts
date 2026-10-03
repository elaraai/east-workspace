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

export {
    queryMessages,
    type KindName, type OneKind, type QueryMessages, type SlotKind, type TotalName,
} from "./messages.js";
export {
    DESCRIPTION_MAX, STEP_ICON,
    adjectiveOf, conditionWords, countWords, dataNumber, describeQuery, fieldKind, fieldLabel, fieldLabels, fieldSummaryWords, human, isIdName, leafPath,
    orderKind, parseErrorWords, plainKind, plural, problemWords, queryWords, refLabel, rowsWords, shapeWords, stepWords, valueWords,
    type ProblemWords, type QueryWords, type SummaryLeaf,
} from "./words.js";
export { sameSlot, type ActionRef, type InputKind, type InputRef, type RemoveRef, type SlotRef, type SlotValue } from "./refs.js";
export {
    cardsFor, firstEmptySlot, outlineOf, sourceCard,
    type Card, type CardLine, type CardPart, type OutlineLine, type ProblemLine, type ShapeLine, type SourceCard,
} from "./cards.js";
export {
    activeItem, applyAction, applyInput, applyRemove, applySlot, quickAddOptions, slotEmpty, slotHint, slotItems, slotLabel, slotPlaceholder, stepOptions,
    type SavedOffer, type SlotContext, type SlotItem, type SlotResult, type StepOption,
} from "./slots.js";
export {
    SUMMARY_LIMITS, SummaryCache, leafOf, summaryAt, summaryNeeded,
    type Summary, type SummaryRequest, type SummaryResult, type SummaryRun,
} from "./summaries.js";
