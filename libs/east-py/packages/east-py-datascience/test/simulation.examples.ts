/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StructType, VariantType, ArrayType, FloatType, IntegerType, DateTimeType, variant, example } from "@elaraai/east";
import { Simulation, SimulationConfigType, SimulationTrajectoriesConfigType } from "@elaraai/east-py-datascience";

// Production line state: WIP at each station, completed count
const ProductionState = StructType({
    wip_cutting: IntegerType,
    wip_welding: IntegerType,
    wip_painting: IntegerType,
    completed: IntegerType,
});

// Events: orders arrive, move between stations, finish
const ProductionEvents = VariantType({
    order_arrive: IntegerType,       // batch size
    cutting_done: IntegerType,       // units done
    welding_done: IntegerType,       // units done
    painting_done: IntegerType,      // units done
});

const ProductionScheduledEvent = StructType({ date: DateTimeType, event: ProductionEvents });
const ProductionProcessResult = StructType({
    state: ProductionState,
    events: ArrayType(ProductionScheduledEvent),
});

export const simulationRun = example({
    keywords: ["simulation", "run", "discrete event", "production line", "WIP", "completion", "station"],
    description: "Simulate a production line processing work orders through 3 sequential stations, track WIP and completion",
    fn: East.function([], IntegerType, ($) => {
        // Process handler: route orders through stations sequentially
        const process = East.function(
            [ProductionState, DateTimeType, ProductionEvents],
            ProductionProcessResult,
            ($, state, date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(ProductionScheduledEvent));
                return $.return(event.match({
                    order_arrive: ($, units) => {
                        const result = $.let({
                            state: {
                                wip_cutting: state.wip_cutting.add(units),
                                wip_welding: state.wip_welding,
                                wip_painting: state.wip_painting,
                                completed: state.completed,
                            },
                            events: [{ 
                                date: date.addDays(1n), 
                                event: variant("cutting_done", units) 
                            }],
                        }, ProductionProcessResult);
                        return result;
                    },
                    cutting_done: ($, units) => {
                        const result = $.let({
                            state: {
                                wip_cutting: state.wip_cutting.subtract(units),
                                wip_welding: state.wip_welding.add(units),
                                wip_painting: state.wip_painting,
                                completed: state.completed,
                            },
                            events: [{ 
                                date: date.addDays(1n), 
                                event: variant("welding_done", units) 
                            }],
                        }, ProductionProcessResult);
                        return result;
                    },
                    welding_done: ($, units) => {
                        const result = $.let({
                            state: {
                                wip_cutting: state.wip_cutting,
                                wip_welding: state.wip_welding.subtract(units),
                                wip_painting: state.wip_painting.add(units),
                                completed: state.completed,
                            },
                            events: [{ 
                                date: date.addDays(1n), 
                                event: variant("painting_done", units) 
                            }],
                        }, ProductionProcessResult);
                        return result;
                    },
                    painting_done: ($, units) => {
                        const result = $.let({
                            state: {
                                wip_cutting: state.wip_cutting,
                                wip_welding: state.wip_welding,
                                wip_painting: state.wip_painting.subtract(units),
                                completed: state.completed.add(units),
                            },
                            events: emptyEvents,
                        }, ProductionProcessResult);
                        return result;
                    },
                }));
            }
        );

        const initial_state = $.let({
            wip_cutting: 0n,
            wip_welding: 0n,
            wip_painting: 0n,
            completed: 0n,
        });

        // 2 orders arrive
        const initial_events = $.let([
            { date: new Date("2025-01-01"), event: variant("order_arrive", 5n) },
            { date: new Date("2025-01-02"), event: variant("order_arrive", 3n) },
        ], ArrayType(ProductionScheduledEvent));

        const config = $.let({
            max_events: variant("none", null),
            end_date: variant("none", null),
        }, SimulationConfigType);

        const result = $.let(Simulation.run(
            [ProductionState, ProductionEvents],
            initial_state, initial_events, process, config,
        ));

        // Both orders (5 + 3 = 8 units) should complete through all 3 stations
        return result.final_state.completed;
    }),
    inputs: [],
    returns: 8n,
});

// Simple resources for trajectories example
const InvState = StructType({ stock: IntegerType, orders_filled: IntegerType });
const InvEvents = VariantType({
    demand: IntegerType,
    restock: IntegerType,
});
const InvScheduledEvent = StructType({ date: DateTimeType, event: InvEvents });
const InvProcessResult = StructType({
    state: InvState,
    events: ArrayType(InvScheduledEvent),
});

export const simulationTrajectories = example({
    keywords: ["simulation", "runTrajectories", "Monte Carlo", "inventory", "replenishment", "stochastic", "demand"],
    description: "Run Monte Carlo trajectories of an inventory replenishment policy under deterministic demand",
    fn: East.function([], IntegerType, ($) => {
        // Inventory handler: demand decreases stock, restock increases it
        const process = East.function(
            [InvState, DateTimeType, InvEvents],
            InvProcessResult,
            ($, state, _date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(InvScheduledEvent));
                return $.return(event.match({
                    demand: ($, units) => ({
                        state: {
                            stock: state.stock.subtract(units),
                            orders_filled: state.orders_filled.add(1n),
                        },
                        events: emptyEvents,
                    }),
                    restock: ($, units) => ({
                        state: {
                            stock: state.stock.add(units),
                            orders_filled: state.orders_filled,
                        },
                        events: emptyEvents,
                    }),
                }));
            }
        );

        const initial_state = $.let({ stock: 100n, orders_filled: 0n });
        const initial_events = $.let([
            { date: new Date("2025-01-01"), event: variant("demand", 20n) },
            { date: new Date("2025-01-05"), event: variant("restock", 50n) },
            { date: new Date("2025-01-10"), event: variant("demand", 30n) },
        ], ArrayType(InvScheduledEvent));

        const config = $.let({
            trajectories: 5n,
            seed: variant("some", 42n),
            max_events: variant("none", null),
            end_date: variant("none", null),
        }, SimulationTrajectoriesConfigType);

        const result = $.let(Simulation.runTrajectories(
            [InvState, InvEvents],
            initial_state, initial_events, process, config,
        ));

        // 5 trajectories run
        return result.trajectories.length();
    }),
    inputs: [],
    returns: 5n,
});
