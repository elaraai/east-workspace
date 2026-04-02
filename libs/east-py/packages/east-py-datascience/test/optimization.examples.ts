/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, IntegerType, VectorType, variant, example } from "@elaraai/east";
import { Optimization } from "@elaraai/east-py-datascience";

export const optimizationCoordinate = example({
    keywords: ["optimization", "iterative", "coordinate descent", "discrete", "shift", "scheduling", "production line"],
    description: "Optimize shift start hours across 3 production lines to minimize inter-line idle time using coordinate descent",
    fn: East.function([IntegerType], BooleanType, ($, n_lines) => {
        // Objective: minimize total idle gap between consecutive lines.
        // Each line runs 8 hours, so ideal start gap is 8 (line 0 at 0, line 1 at 8, line 2 at 16).
        // idle = sum of |start[i] - start[i-1] - 8| for adjacent lines.
        // Negate because Optimization.iterative maximizes.
        const objective = $.const(East.function(
            [VectorType(IntegerType)], FloatType,
            ($, start_hours) => {
                const idle_penalty = $.let(0.0);
                $.for(East.Array.range(1n, n_lines), ($, i) => {
                    const gap = $.let(start_hours.get(i).subtract(start_hours.get(i.subtract(1n))));
                    const deviation = $.let(gap.subtract(8n).toFloat().abs());
                    $.assign(idle_penalty, idle_penalty.add(deviation));
                });
                $.return(idle_penalty.negate());
            }
        ));

        // Each line can start at hour 0, 4, 8, 12, 16, or 20
        const shift_options = East.Vector.fromArray([0n, 4n, 8n, 12n, 16n, 20n]);
        const spaces = $.let([shift_options, shift_options, shift_options]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 3n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('some', 42n),
            mode: variant('some', variant('coordinate', null)),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        // Optimal: lines start at 0, 8, 16 — zero idle time, objective = 0.0
        return result.success;
    }),
    inputs: [3n],
    returns: true,
});

export const optimizationSwap = example({
    keywords: ["optimization", "iterative", "swap", "permutation", "scheduling", "job order", "weighted completion time"],
    description: "Find optimal job execution order to minimize weighted completion time using swap mode",
    fn: East.function([], FloatType, ($) => {
        // 4 jobs with durations and priority values.
        // Find execution order minimizing weighted completion time.
        const durations = $.let([10.0, 5.0, 20.0, 3.0]);
        const values = $.let([1.0, 8.0, 2.0, 10.0]);

        const objective = $.const(East.function(
            [VectorType(IntegerType)], FloatType,
            ($, perm) => {
                const cumulative_time = $.let(0.0);
                const total_cost = $.let(0.0);
                $.for(East.Array.range(0n, East.value(4n)), ($, i) => {
                    const job = $.let(perm.get(i));
                    $.assign(cumulative_time, cumulative_time.add(durations.get(job)));
                    $.assign(total_cost, total_cost.add(values.get(job).multiply(cumulative_time)));
                });
                // Negate to minimize (iterative maximizes)
                $.return(total_cost.negate());
            }
        ));

        // Each position can hold any of the 4 jobs — swap mode ensures valid permutations
        const job_indices = East.Vector.fromArray([0n, 1n, 2n, 3n]);
        const spaces = $.let([job_indices, job_indices, job_indices, job_indices]);

        const config = $.let({
            iterations: variant('some', 50n),
            samples: variant('some', 10n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('random', null)),
            random_state: variant('some', 42n),
            mode: variant('some', variant('swap', null)),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        // Optimal WSPT order: job3(3s), job1(5s), job0(10s), job2(20s) → cost = -188.0
        return result.best_objective;
    }),
    inputs: [],
    returns: -188.0,
});
