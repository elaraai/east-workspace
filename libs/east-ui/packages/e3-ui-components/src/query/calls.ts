/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's calls without the builder (#941) — `@elaraai/e3-ui-components/query`:
 * the root a query reads, its one-shot call and the reading of its answer
 * (`one-shot.ts`), a run's plan and its split call (`plan.ts`), and each call
 * answered in memory where there is no server (`in-memory-call.ts`).
 *
 * It imports neither React nor the renderers — only East and e3's wire types —
 * so a host in Node, where the package's main entry cannot load (its renderers
 * need a DOM), plans and makes a query's calls exactly as the builder does: a
 * CLI, an agent, or a test against an e3 server. The main entry exports the
 * same names.
 *
 * @example
 * ```ts
 * import { planQuery, prepareQuery, queryResultOf, queryRoot } from "@elaraai/e3-ui-components/query";
 * import { oneShotExecute, splitCall } from "@elaraai/e3-api-client";
 *
 * const root = queryRoot([{ name: "orders", path: ordersPath, type: toEastTypeValue(OrdersType) }]);
 * const planned = planQuery(".orders | map(.total) | add", root, new Map([["orders", { bytes, rows }]]));
 * if ("result" in planned) return planned.result;               // the checker's problems
 * const plan = planned.plan;
 * switch (plan.kind) {
 *     case "split":
 *         return queryResultOf(plan.reading, (await splitCall(url, repo, workspace, plan.request, { token })).result);
 *     case "rekey": {
 *         // A re-keyed join (#942): the re-key call, then the join call over its output, by its hash.
 *         const first = await splitCall(url, repo, workspace, plan.first, { token });
 *         const join = first.output === null ? undefined : (await splitCall(url, repo, workspace, plan.join(first.output), { token })).result;
 *         return queryResultOf(plan.reading, plan.answer(first.result, join));
 *     }
 *     case "one_shot":
 *         return queryResultOf(plan.prepared, await oneShotExecute(url, repo, workspace, plan.prepared.request, { token }));
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
    prepareQuery,
    programChecks,
    queryResultOf,
    queryRoot,
    type CheckedProgram,
    type PreparedQuery,
    type QueryOptions,
    type QueryReading,
    type QueryResult,
    type QueryRoot,
    type QueryRootEntry,
} from "./one-shot.js";
export {
    draftPlan,
    weighPlan,
    planQuery,
    splitCallRequest,
    rekeyCallRequests,
    type OneCallWhy,
    type PlanDraft,
    type PlanExplanation,
    type PlanOptions,
    type PlanPath,
    type PlanPrograms,
    type QueryPlan,
    type RekeyCalls,
    type SourceWeight,
} from "./plan.js";
export {
    createInMemoryQueryCall,
    createInMemorySplitCall,
    createInMemorySourceStatus,
    type InMemoryDataset,
    type InMemorySplitCall,
    type InMemorySplitCallOptions,
} from "./in-memory-call.js";
// The calls' shapes, as the builder's seams take them: types only, so nothing of React is reached.
export type { QueryCall, QuerySplitCall, QuerySplitCallOptions, QuerySplitExplain, QuerySourceStatus, SourceStatus } from "./hooks.js";
