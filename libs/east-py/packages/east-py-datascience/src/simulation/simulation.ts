/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Discrete Event Simulation (DES) — Economic Ontology.
 *
 * Provides a generic priority-queue DES engine grounded in an economic ontology:
 * - R (Resources): user-defined struct representing business state
 * - E (Events): user-defined variant where each case is an economic activity
 * - Process handler: defines how events affect resources (match dispatch)
 *
 * Two entry points:
 * - `simulation_run`: single deterministic run
 * - `simulation_run_trajectories`: Monte Carlo with multiple seeds
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    OptionType,
    ArrayType,
    IntegerType,
    DateTimeType,
    FunctionType,
} from "@elaraai/east";

// ============================================================================
// Internal Helper Types
// ============================================================================

/**
 * Scheduled event — a date + event pair.
 * Not exported; users construct these inline.
 */
const ScheduledEventType = StructType({
    date: DateTimeType,
    event: "E",
});

/**
 * Handler return type — new state + new events to schedule.
 */
const ProcessResultType = StructType({
    state: "R",
    events: ArrayType(ScheduledEventType),
});

/**
 * Handler function type — (state, date, event) -> ProcessResult.
 */
const ProcessFnType = FunctionType(
    ["R", DateTimeType, "E"],
    ProcessResultType
);

// ============================================================================
// Single Run Types
// ============================================================================

/**
 * Configuration for a single simulation run.
 */
export const SimulationConfigType = StructType({
    /** Safety limit on number of events processed (default: 100000) */
    max_events: OptionType(IntegerType),
    /** Stop processing events after this date */
    end_date: OptionType(DateTimeType),
});

/**
 * Result of a single simulation run.
 */
export const SimulationResultType = StructType({
    /** Final resource state after all events processed */
    final_state: "R",
    /** Number of events processed */
    events_processed: IntegerType,
    /** Date of the last event processed */
    final_date: DateTimeType,
});

// ============================================================================
// Monte Carlo Types
// ============================================================================

/**
 * Configuration for Monte Carlo simulation trajectories.
 */
export const SimulationTrajectoriesConfigType = StructType({
    /** Number of trajectories to run (required) */
    trajectories: IntegerType,
    /** Base RNG seed — trajectory i uses seed + i */
    seed: OptionType(IntegerType),
    /** Safety limit on events per trajectory (default: 100000) */
    max_events: OptionType(IntegerType),
    /** Stop processing events after this date */
    end_date: OptionType(DateTimeType),
});

/**
 * Result of Monte Carlo simulation trajectories.
 */
export const SimulationTrajectoriesResultType = StructType({
    /** Array of per-trajectory results */
    trajectories: ArrayType(StructType({
        /** Final resource state */
        final_state: "R",
        /** Number of events processed */
        events_processed: IntegerType,
        /** Date of last event processed */
        final_date: DateTimeType,
    })),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Run a single deterministic discrete event simulation.
 *
 * Events are processed in chronological order from a priority queue.
 * The handler function dispatches on event type (match) and can
 * mutate state and schedule new events.
 *
 * @example
 * ```ts
 * import { East, StructType, VariantType, FloatType, DateTimeType, variant } from "@elaraai/east";
 * import { Simulation } from "@elaraai/east-py-datascience";
 *
 * const Resources = StructType({ cash: FloatType });
 * const Events = VariantType({ income: FloatType, expense: FloatType });
 *
 * const process = East.function(
 *     [Resources, DateTimeType, Events],
 *     StructType({ state: Resources, events: ArrayType(StructType({ date: DateTimeType, event: Events })) }),
 *     ($, state, date, event) => {
 *         return $.return(event.match({
 *             income: ($, amount) => $.return({ state: state.spread({ cash: state.cash.add(amount) }), events: [] }),
 *             expense: ($, amount) => $.return({ state: state.spread({ cash: state.cash.subtract(amount) }), events: [] }),
 *         }));
 *     }
 * );
 *
 * const result = $.let(Simulation.run([Resources, Events], initialState, initialEvents, process, config));
 * ```
 */
export const simulation_run = East.genericPlatform(
    "simulation_run",
    ["R", "E"],
    [
        "R",                            // initial_state
        ArrayType(ScheduledEventType),  // initial_events
        ProcessFnType,                  // process handler
        SimulationConfigType,           // config
    ],
    SimulationResultType
);

/**
 * Run Monte Carlo simulation trajectories.
 *
 * Each trajectory runs the same DES engine with a different RNG seed
 * (base_seed + trajectory_index), enabling stochastic scenario analysis.
 *
 * @example
 * ```ts
 * const result = $.let(Simulation.runTrajectories(
 *     [Resources, Events],
 *     initialState, initialEvents, stochasticProcess,
 *     { trajectories: 100n, seed: variant('some', 42n), max_events: variant('none', null), end_date: variant('none', null) },
 * ));
 * result.trajectories.get(0n).final_state.cash
 * ```
 */
export const simulation_run_trajectories = East.genericPlatform(
    "simulation_run_trajectories",
    ["R", "E"],
    [
        "R",                                    // initial_state
        ArrayType(ScheduledEventType),          // initial_events
        ProcessFnType,                          // process handler
        SimulationTrajectoriesConfigType,       // config
    ],
    SimulationTrajectoriesResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for simulation functions.
 */
export const SimulationTypes = {
    /** Single run configuration */
    ConfigType: SimulationConfigType,
    /** Single run result */
    ResultType: SimulationResultType,
    /** Monte Carlo configuration */
    TrajectoriesConfigType: SimulationTrajectoriesConfigType,
    /** Monte Carlo result */
    TrajectoriesResultType: SimulationTrajectoriesResultType,
} as const;

/**
 * Discrete Event Simulation (DES) — REA Economic Ontology.
 *
 * Generic over:
 * - R: Resources (state struct — the economic resource ontology)
 * - E: Events (variant type — the economic event ontology)
 *
 * The handler function uses match dispatch to define economic processes.
 * Each match branch IS a separate economic process. Process-from-process
 * triggering works by returning new events.
 */
export const Simulation = {
    /**
     * Run a single deterministic discrete event simulation.
     *
     * Events are processed chronologically from a priority queue.
     * The handler function dispatches on event type via match and can
     * mutate state and schedule new events (creating the directed
     * cyclic economic graph).
     *
     * @example
     * ```ts
     * import { East, StructType, VariantType, ArrayType, FloatType, DateTimeType, variant } from "@elaraai/east";
     * import { Simulation, SimulationConfigType } from "@elaraai/east-py-datascience";
     *
     * const Resources = StructType({ cash: FloatType });
     * const Events = VariantType({ income: FloatType, expense: FloatType });
     * const ScheduledEvent = StructType({ date: DateTimeType, event: Events });
     * const ProcessResult = StructType({ state: Resources, events: ArrayType(ScheduledEvent) });
     *
     * const simulate = East.function([], Simulation.Types.ResultType, ($) => {
     *     const process = East.function(
     *         [Resources, DateTimeType, Events],
     *         ProcessResult,
     *         ($, state, date, event) => {
     *             const empty = $.let([] as const, ArrayType(ScheduledEvent));
     *             return $.return(event.match({
     *                 income: ($, amount) => ({
     *                     state: { cash: state.cash.add(amount) },
     *                     events: empty,
     *                 }),
     *                 expense: ($, amount) => ({
     *                     state: { cash: state.cash.subtract(amount) },
     *                     events: empty,
     *                 }),
     *             }));
     *         }
     *     );
     *
     *     const initialState = $.let({ cash: 1000.0 });
     *     const initialEvents = $.let([
     *         { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 500.0), Events) },
     *         { date: $.let(new Date("2025-01-15")), event: $.let(variant("expense", 200.0), Events) },
     *     ], ArrayType(ScheduledEvent));
     *     const config = $.let({
     *         max_events: variant("none", null),
     *         end_date: variant("none", null),
     *     }, SimulationConfigType);
     *
     *     const result = $.let(Simulation.run(
     *         [Resources, Events],
     *         initialState, initialEvents, process, config,
     *     ));
     *     // result.final_state.cash => 1300.0
     *     // result.events_processed => 2n
     *     return $.return(result);
     * });
     * ```
     */
    run: simulation_run,

    /**
     * Run Monte Carlo simulation trajectories.
     *
     * Each trajectory runs the same DES engine with a different RNG seed
     * (base_seed + trajectory_index), enabling stochastic scenario analysis.
     * Use this when the process handler uses Random functions — each trajectory
     * gets a deterministic but distinct seed.
     *
     * @example
     * ```ts
     * import { East, StructType, VariantType, ArrayType, FloatType, DateTimeType, variant } from "@elaraai/east";
     * import { Simulation, SimulationTrajectoriesConfigType } from "@elaraai/east-py-datascience";
     *
     * const Resources = StructType({ cash: FloatType });
     * const Events = VariantType({ income: FloatType, expense: FloatType });
     * const ScheduledEvent = StructType({ date: DateTimeType, event: Events });
     * const ProcessResult = StructType({ state: Resources, events: ArrayType(ScheduledEvent) });
     *
     * const simulate = East.function([], Simulation.Types.TrajectoriesResultType, ($) => {
     *     const process = East.function(
     *         [Resources, DateTimeType, Events],
     *         ProcessResult,
     *         ($, state, date, event) => {
     *             const empty = $.let([] as const, ArrayType(ScheduledEvent));
     *             return $.return(event.match({
     *                 income: ($, amount) => ({
     *                     state: { cash: state.cash.add(amount) },
     *                     events: empty,
     *                 }),
     *                 expense: ($, amount) => ({
     *                     state: { cash: state.cash.subtract(amount) },
     *                     events: empty,
     *                 }),
     *             }));
     *         }
     *     );
     *
     *     const initialState = $.let({ cash: 1000.0 });
     *     const initialEvents = $.let([
     *         { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 500.0), Events) },
     *         { date: $.let(new Date("2025-01-15")), event: $.let(variant("expense", 200.0), Events) },
     *     ], ArrayType(ScheduledEvent));
     *     const config = $.let({
     *         trajectories: 100n,
     *         seed: variant("some", 42n),
     *         max_events: variant("none", null),
     *         end_date: variant("some", new Date("2025-12-31")),
     *     }, SimulationTrajectoriesConfigType);
     *
     *     const result = $.let(Simulation.runTrajectories(
     *         [Resources, Events],
     *         initialState, initialEvents, process, config,
     *     ));
     *     // result.trajectories.length() => 100n
     *     // result.trajectories.get(0n).final_state.cash
     *     return $.return(result);
     * });
     * ```
     */
    runTrajectories: simulation_run_trajectories,

    /**
     * Type definitions for simulation functions.
     */
    Types: SimulationTypes,
} as const;
