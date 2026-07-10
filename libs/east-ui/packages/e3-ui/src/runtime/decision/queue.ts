/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<DecisionQueue>` tag — see the export's JSDoc. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { DecisionQueue as DecisionQueueFactory } from "../../decision/queue.js";

/**
 * Decision queue — surfaces an `ArrayType(DecisionType)`-bound dataset as a
 * prioritised, actionable list (the entry surface for Decide). Pass the
 * `Data.bind(…, { patch })` handle as
 * `value`; Apply / Modify write back through the binding (Modify's edit diffs
 * into the patch overlay).
 *
 * @example
 * ```tsx
 * // .tsx with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, ArrayType } from "@elaraai/east";
 * import { Reactive, Text, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Decision, DecisionQueue } from "@elaraai/e3-ui";
 *
 * const surface = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const view = $.let(Data.bind(decisionsTask, { mode: "direct", patch: decisionPatch }));
 *         return (
 *             <DecisionQueue
 *                 value={view}
 *                 modify={(decision, update) => <Text>{decision.title}</Text>}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @example
 * ```tsx
 * // Grouped queue — `groupBy` mounts the Group-by toolbar (built-in Urgency /
 * // Kind / None plus the custom `groups` accessors); sections collapse.
 * <DecisionQueue
 *     handle={handle}
 *     heading="Decisions waiting"
 *     groupBy="urgency"
 *     groups={{
 *         'Value band': d => d.value.greater(50000.0).ifElse(() => 'High', () => 'Standard'),
 *     }}
 *     collapsible
 * />
 * ```
 *
 * @remarks
 * Carries `DecisionQueue.Types`. Desugars to `DecisionQueue.Root(options)`. The
 * renderer registers against `DecisionQueue.Component` (from
 * `@elaraai/e3-ui/internal`).
 */
export const DecisionQueue: JsxTag<OptionsProps<typeof DecisionQueueFactory.Root>> & {
    Types: typeof DecisionQueueFactory.Types;
} = Object.assign(optionsTag(DecisionQueueFactory.Root), { Types: DecisionQueueFactory.Types });
