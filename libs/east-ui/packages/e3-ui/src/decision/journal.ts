/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionJournal` — the Decide↔Trust seam (the spec's `Decision.Journal`):
 * the read-back of resolved cases. Each entry is a staged judgement whose
 * verdict is set — how the case left the queue (accepted / rejected /
 * deferred / handoff), when, with the operator's captured knowledge and
 * injected constraints. The exact complement of the queue's projection:
 * the queue shows cases *without* verdicts, the journal shows cases *with*
 * them.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    OptionType,
    StringType,
    some,
    none,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { EastUI, UIComponentType } from '@elaraai/east-ui';

import { DecisionHandleRefType, type DecisionHandleLike } from './bind.js';

// ============================================================================
// Payload — the fixed IR shape the renderer decodes.
// ============================================================================

/**
 * The `DecisionJournal` component payload.
 *
 * @property handle - The surface's decision handle ref (binding descriptors).
 * @property heading - Optional header label (e.g. `"Decision journal"`).
 * @property maxHeight - Optional cap on the journal's height (a CSS length,
 *   e.g. `"320px"`). The header stays pinned; the entries scroll.
 */
export const DecisionJournalPayloadType = StructType({
    handle: DecisionHandleRefType,
    heading: OptionType(StringType),
    maxHeight: OptionType(StringType),
});
/** Type alias for {@link DecisionJournalPayloadType}. */
export type DecisionJournalPayloadType = typeof DecisionJournalPayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const DecisionJournalComponent = EastUI.component("DecisionJournal", DecisionJournalPayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link DecisionJournal.Root}.
 *
 * @property handle - The surface's decision handle from `Decision.bind`.
 * @property heading - Optional header label.
 * @property maxHeight - Optional cap on the journal's height (a CSS length,
 *   e.g. `"320px"`). The header stays pinned; the entries scroll. Unset,
 *   the journal grows with its content.
 */
export interface DecisionJournalOptions {
    handle: DecisionHandleLike;
    heading?: SubtypeExprOrValue<StringType>;
    maxHeight?: SubtypeExprOrValue<StringType>;
}

/**
 * The Decision journal component namespace — the resolved-cases read-back.
 *
 * @remarks
 * Use `DecisionJournal.Root({ handle })` inside a `Reactive` block, with the
 * same handle the queue consumes — as cases resolve they leave the queue and
 * appear here, newest first. The `Component` property is the
 * {@link EastUI.component} carrier the renderer registers against.
 */
export const DecisionJournal: {
    Root(options: DecisionJournalOptions): ExprType<UIComponentType>;
    Component: typeof DecisionJournalComponent;
    Types: { Payload: DecisionJournalPayloadType };
} = {
    /**
     * Build a decision journal bound to a decision handle.
     *
     * @param options - {@link DecisionJournalOptions}. Only `handle` is required.
     * @returns An East expression of {@link UIComponentType}.
     */
    Root(options: DecisionJournalOptions): ExprType<UIComponentType> {
        return DecisionJournalComponent.Root({
            handle: East.value({
                decisions: options.handle.decisions,
                judgements: options.handle.judgements,
                slice: options.handle.sliceInit,
            }, DecisionHandleRefType),
            heading: options.heading !== undefined ? some(options.heading) : none,
            maxHeight: options.maxHeight !== undefined ? some(options.maxHeight) : none,
        });
    },
    /** The internal {@link EastUI.component} carrier renderers register against. */
    Component: DecisionJournalComponent,
    Types: {
        /** The rendered payload struct. */
        Payload: DecisionJournalPayloadType,
    },
} as const;
