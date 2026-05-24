/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Discrete Event Simulation platform function tests.
 *
 * Tests use describeEast following east-node conventions.
 * Tests export IR for Python to run (exportOnly: true).
 */
import { East, StructType, VariantType, ArrayType, FloatType, IntegerType, DateTimeType, variant, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Simulation, SimulationConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./simulation.examples.js";

// Shared types for basic tests
const SimpleResources = StructType({ cash: FloatType });
const SimpleEvents = VariantType({
    income: FloatType,
    expense: FloatType,
});
const SimpleScheduledEvent = StructType({ date: DateTimeType, event: SimpleEvents });
const SimpleProcessResult = StructType({
    state: SimpleResources,
    events: ArrayType(SimpleScheduledEvent),
});

describeEast("Simulation platform functions", (test) => {

    Assert.examples(test, { simulationRun: ex.simulationRun });

    test("basic event processing", $ => {
        // Simple handler: income adds to cash, expense subtracts
        const process = East.function(
            [SimpleResources, DateTimeType, SimpleEvents],
            SimpleProcessResult,
            ($, state, _date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(SimpleScheduledEvent));
                return $.return(event.match({
                    income: ($, amount) => ({
                        state: { cash: state.cash.add(amount) },
                        events: emptyEvents,
                    }),
                    expense: ($, amount) => ({
                        state: { cash: state.cash.subtract(amount) },
                        events: emptyEvents,
                    }),
                }));
            }
        );

        const initial_state = $.let({ cash: 100.0 });
        const initial_events = $.let([
            { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 50.0), SimpleEvents) },
            { date: $.let(new Date("2025-01-02")), event: $.let(variant("expense", 30.0), SimpleEvents) },
            { date: $.let(new Date("2025-01-03")), event: $.let(variant("income", 20.0), SimpleEvents) },
        ], ArrayType(SimpleScheduledEvent));

        const config = $.let({
            max_events: none,
            end_date: none,
        }, SimulationConfigType);

        const result = $.let(Simulation.run(
            [SimpleResources, SimpleEvents],
            initial_state, initial_events, process, config,
        ));

        // 100 + 50 - 30 + 20 = 140
        $(Assert.equal(result.final_state.cash, East.value(140.0)));
        $(Assert.equal(result.events_processed, 3n));
    });

    test("event scheduling and cyclic graph", $ => {
        // Income handler schedules a follow-up expense after 1 day
        const process = East.function(
            [SimpleResources, DateTimeType, SimpleEvents],
            SimpleProcessResult,
            ($, state, date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(SimpleScheduledEvent));
                return $.return(event.match({
                    income: ($, amount) => ({
                        state: { cash: state.cash.add(amount) },
                        // Schedule an expense of half the income, 1 day later
                        events: $.let([
                            {
                                date: date.addDays(1n),
                                event: $.let(variant("expense", amount.multiply(0.5)), SimpleEvents),
                            },
                        ], ArrayType(SimpleScheduledEvent)),
                    }),
                    expense: ($, amount) => ({
                        state: { cash: state.cash.subtract(amount) },
                        events: emptyEvents,
                    }),
                }));
            }
        );

        const initial_state = $.let({ cash: 100.0 });
        const initial_events = $.let([
            { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 40.0), SimpleEvents) },
        ], ArrayType(SimpleScheduledEvent));

        const config = $.let({
            max_events: none,
            end_date: none,
        }, SimulationConfigType);

        const result = $.let(Simulation.run(
            [SimpleResources, SimpleEvents],
            initial_state, initial_events, process, config,
        ));

        // income +40, then auto-scheduled expense -20 => 100 + 40 - 20 = 120
        $(Assert.equal(result.final_state.cash, East.value(120.0)));
        $(Assert.equal(result.events_processed, 2n));
    });

    test("end_date cutoff", $ => {
        const process = East.function(
            [SimpleResources, DateTimeType, SimpleEvents],
            SimpleProcessResult,
            ($, state, _date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(SimpleScheduledEvent));
                return $.return(event.match({
                    income: ($, amount) => ({
                        state: { cash: state.cash.add(amount) },
                        events: emptyEvents,
                    }),
                    expense: ($, amount) => ({
                        state: { cash: state.cash.subtract(amount) },
                        events: emptyEvents,
                    }),
                }));
            }
        );

        const initial_state = $.let({ cash: 100.0 });
        const initial_events = $.let([
            { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 10.0), SimpleEvents) },
            { date: $.let(new Date("2025-01-05")), event: $.let(variant("income", 20.0), SimpleEvents) },
            { date: $.let(new Date("2025-01-10")), event: $.let(variant("income", 30.0), SimpleEvents) },
        ], ArrayType(SimpleScheduledEvent));

        // end_date = Jan 6 => only first 2 events processed
        const config = $.let({
            max_events: none,
            end_date: some(new Date("2025-01-06")),
        }, SimulationConfigType);

        const result = $.let(Simulation.run(
            [SimpleResources, SimpleEvents],
            initial_state, initial_events, process, config,
        ));

        // 100 + 10 + 20 = 130 (third event at Jan 10 is after end_date)
        $(Assert.equal(result.final_state.cash, East.value(130.0)));
        $(Assert.equal(result.events_processed, 2n));
    });

    test("collect events in state (event log)", $ => {
        // Resources include an event log that records each event processed
        const LogResources = StructType({
            cash: FloatType,
            event_count: IntegerType,
        });
        const LogEvents = VariantType({
            deposit: FloatType,
            withdraw: FloatType,
        });
        const LogScheduledEvent = StructType({ date: DateTimeType, event: LogEvents });
        const LogProcessResult = StructType({
            state: LogResources,
            events: ArrayType(LogScheduledEvent),
        });

        const process = East.function(
            [LogResources, DateTimeType, LogEvents],
            LogProcessResult,
            ($, state, _date, event) => {
                const emptyEvents = $.let([] as const, ArrayType(LogScheduledEvent));
                // Increment event_count on every event to track processing order
                const newCount = $.let(state.event_count.add(1n));
                return $.return(event.match({
                    deposit: ($, amount) => ({
                        state: { cash: state.cash.add(amount), event_count: newCount },
                        events: emptyEvents,
                    }),
                    withdraw: ($, amount) => ({
                        state: { cash: state.cash.subtract(amount), event_count: newCount },
                        events: emptyEvents,
                    }),
                }));
            }
        );

        const initial_state = $.let({ cash: 500.0, event_count: 0n });
        const initial_events = $.let([
            { date: $.let(new Date("2025-03-01")), event: $.let(variant("deposit", 200.0), LogEvents) },
            { date: $.let(new Date("2025-03-05")), event: $.let(variant("withdraw", 50.0), LogEvents) },
            { date: $.let(new Date("2025-03-10")), event: $.let(variant("deposit", 100.0), LogEvents) },
            { date: $.let(new Date("2025-03-15")), event: $.let(variant("withdraw", 75.0), LogEvents) },
        ], ArrayType(LogScheduledEvent));

        const config = $.let({
            max_events: none,
            end_date: none,
        }, SimulationConfigType);

        const result = $.let(Simulation.run(
            [LogResources, LogEvents],
            initial_state, initial_events, process, config,
        ));

        // 500 + 200 - 50 + 100 - 75 = 675
        $(Assert.equal(result.final_state.cash, East.value(675.0)));
        // All 4 events processed, counter should be 4
        $(Assert.equal(result.final_state.event_count, 4n));
        $(Assert.equal(result.events_processed, 4n));
    });

}, { exportOnly: true });
