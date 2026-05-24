/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert } from "../platforms.spec.js";
import { East, IntegerType, StringType, NullType } from "@elaraai/east";
import { Reactive, State, Button, Text, Stat, Stack, UIComponentType } from "@elaraai/east-ui";

// Module-level constant (NOT a capture - in module scope)
const TITLE = "Counter";

// =============================================================================
// Valid Cases - Using describeEast pattern
// =============================================================================

describeEast("Reactive.Root - Valid Cases", (test) => {

    // =========================================================================
    // Basic State Binding
    // =========================================================================

    test("creates reactive with simple state bind", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, $ => {
                const counter = $.let(State.bind([IntegerType], "counter", 0n));
                const count = $.let(counter.read(), IntegerType);
                return Stat.Root("Counter", East.str`${count}`);
            })));

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    test("creates reactive with multiple state binds", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, $ => {
                const keyA = $.let(State.bind([IntegerType], "keyA", 1n));
                const keyB = $.let(State.bind([IntegerType], "keyB", 2n));
                const keyC = $.let(State.bind([StringType], "keyC", "test"));

                const a = $.let(keyA.read(), IntegerType);
                const b = $.let(keyB.read(), IntegerType);
                const c = $.let(keyC.read(), StringType);
                return Text.Root(East.str`${a} ${b} ${c}`);
            })));

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    // =========================================================================
    // Static Content
    // =========================================================================

    test("creates reactive with static content (no state reads)", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, _$ => {
                return Text.Root("Hello, World!");
            })));

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    // =========================================================================
    // Module-Level References (Not Captures)
    // =========================================================================

    test("allows module-level constants (not captures)", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, $ => {
                const counter = $.let(State.bind([IntegerType], "counter", 42n));
                const count = $.let(counter.read(), IntegerType);
                return Stat.Root(TITLE, East.str`${count}`);
            }))
        );

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    // =========================================================================
    // Callbacks Defined Inside
    // =========================================================================

    test("allows callbacks defined inside the body", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, $ => {
                const counter = $.let(State.bind([IntegerType], "counter", 0n));
                const count = $.let(counter.read(), IntegerType);
                return Button.Root(Text.Root(East.str`Count: ${count}`), {
                    onClick: East.function([], NullType, $ => {
                        const inner = $.let(State.bind([IntegerType], "counter", 0n));
                        const current = $.let(inner.read(), IntegerType);
                        $(inner.write(current.add(1n)));
                    }),
                });
            }))
        );

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    test("allows state writes in onClick callbacks", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, _$ => {
                return Button.Root("Increment", {
                    onClick: East.function([], NullType, $ => {
                        const counter = $.let(State.bind([IntegerType], "counter", 0n));
                        const current = $.let(counter.read(), IntegerType);
                        $(counter.write(current.add(1n)));
                    }),
                });
            })));

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });

    // =========================================================================
    // Nested Reactive
    // =========================================================================

    test("allows nested Reactive.Root", $ => {
        const reactive = $.let(Reactive.Root(
            East.function([], UIComponentType, _$ => {
                return Stack.VStack([
                    Text.Root("Header"),
                    Reactive.Root(
                        East.function([], UIComponentType, $ => {
                            const inner = $.let(State.bind([IntegerType], "inner", 99n));
                            const count = $.let(inner.read(), IntegerType);
                            return Text.Root(East.str`${count}`);
                        })
                    ),
                ]);
            })));

        $(Assert.equal(reactive.unwrap().getTag(), "ReactiveComponent"));
    });
});
