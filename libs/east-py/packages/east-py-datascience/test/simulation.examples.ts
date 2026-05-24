/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StructType, VariantType, ArrayType, IntegerType, DateTimeType, variant, none, example } from "@elaraai/east";
import { Simulation, SimulationConfigType } from "@elaraai/east-py-datascience";

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
            max_events: none,
            end_date: none,
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

