/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { IntegerType, ArrayType, East } from "@elaraai/east";
import { describeEast, Assert, Parallel, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./parallel.examples.js";

describeEast("Parallel platform functions", (test) => {
    Assert.examples(test, { parallelMap: ex.parallelMap });

    test("map applies function to each element", $ => {
        const input = $.let(East.value([1n, 2n, 3n, 4n, 5n]));

        // Define a simple doubling function
        const double = East.function([IntegerType], IntegerType, ($, x) => {
            return x.multiply(2n);
        });

        const result = $.let(Parallel.map([IntegerType, IntegerType], input, double));

        $(Assert.equal(result.length(), 5n));
        $(Assert.equal(result.get(0n), 2n));
        $(Assert.equal(result.get(1n), 4n));
        $(Assert.equal(result.get(2n), 6n));
        $(Assert.equal(result.get(3n), 8n));
        $(Assert.equal(result.get(4n), 10n));
    });

    test("map handles empty array", $ => {
        const input = $.let(East.value([], ArrayType(IntegerType)));

        const identity = East.function([IntegerType], IntegerType, ($, x) => x);
        const result = $.let(Parallel.map([IntegerType, IntegerType], input, identity));

        $(Assert.equal(result.length(), 0n));
    });

    test("map handles small arrays sequentially", $ => {
        // Arrays <= 4 elements run sequentially to avoid worker overhead
        const input = $.let(East.value([1n, 2n, 3n]));

        const square = East.function([IntegerType], IntegerType, ($, x) => {
            return x.multiply(x);
        });

        const result = $.let(Parallel.map([IntegerType, IntegerType], input, square));

        $(Assert.equal(result.get(0n), 1n));
        $(Assert.equal(result.get(1n), 4n));
        $(Assert.equal(result.get(2n), 9n));
    });

    test("map handles large arrays with workers", $ => {
        // Generate array larger than threshold to trigger worker usage
        const input = $.let(East.value([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]));

        const addTen = East.function([IntegerType], IntegerType, ($, x) => {
            return x.add(10n);
        });

        const result = $.let(Parallel.map([IntegerType, IntegerType], input, addTen));

        $(Assert.equal(result.length(), 10n));
        $(Assert.equal(result.get(0n), 11n));
        $(Assert.equal(result.get(9n), 20n));
    });

    test("map preserves order", $ => {
        const input = $.let(East.value([10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n]));

        // Simple transformation to verify order
        const negate = East.function([IntegerType], IntegerType, ($, x) => {
            return x.negate();
        });

        const result = $.let(Parallel.map([IntegerType, IntegerType], input, negate));

        $(Assert.equal(result.get(0n), -10n));
        $(Assert.equal(result.get(7n), -80n));
    });

    test("map handles closures with captured variables", $ => {
        const input = $.let(East.value([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]));
        const multiplier = $.let(East.value(10n));

        // Function captures 'multiplier' from parent scope
        const multiplyBy = East.function([IntegerType], IntegerType, ($, x) => {
            return x.multiply(multiplier);
        });

        const result = $.let(Parallel.map([IntegerType, IntegerType], input, multiplyBy));

        $(Assert.equal(result.length(), 8n));
        $(Assert.equal(result.get(0n), 10n));
        $(Assert.equal(result.get(7n), 80n));
    });
}, { platformFns: NodePlatform });
