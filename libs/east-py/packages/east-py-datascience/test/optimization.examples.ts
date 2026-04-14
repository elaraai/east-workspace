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
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        // Optimal: lines start at 0, 8, 16 — zero idle time, objective = 0.0
        return result.success;
    }),
    inputs: [3n],
    returns: true,
});

export const optimizationIncremental = example({
    keywords: ["optimization", "iterative", "incremental", "element", "per-element", "rostering", "assignment", "coordinate descent"],
    description: "Optimize task-worker assignment using incremental per-element contributions",
    fn: East.function([], FloatType, ($) => {
        // 5 tasks, 3 workers. skill[task][worker] = match score.
        // Element objective: contribution of task i = skill[i][assignment[i]]
        const skill = $.let([
            [3.0, 1.0, 2.0],   // task 0: best with worker 0
            [1.0, 3.0, 2.0],   // task 1: best with worker 1
            [2.0, 2.0, 3.0],   // task 2: best with worker 2
            [3.0, 2.0, 1.0],   // task 3: best with worker 0
            [1.0, 2.0, 3.0],   // task 4: best with worker 2
        ]);

        const elementObjective = $.const(East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, taskIdx) => {
                const worker = $.let(assignments.get(taskIdx));
                $.return(skill.get(taskIdx).get(worker));
            }
        ));

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 3n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('some', 42n),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterativeIncremental(
            elementObjective, spaces, config,
        ));

        // Optimal: each task assigned to best worker -> 3+3+3+3+3 = 15.0
        return result.best_objective;
    }),
    inputs: [],
    returns: 15.0,
});

export const optimizationGrouped = example({
    keywords: ["optimization", "iterative", "grouped", "group", "per-value", "rostering", "bin packing", "assignment"],
    description: "Optimize slot-to-worker rostering using grouped per-value contributions",
    fn: East.function([], FloatType, ($) => {
        // 6 shift slots assigned to 3 workers (IDs 0-2).
        // Each worker's cost = sum of shift costs for their assigned slots.
        // Penalty if a worker has > 2 slots (overtime).
        const shiftCosts = $.let([10.0, 20.0, 15.0, 25.0, 30.0, 5.0]);
        const nSlots = East.value(6n);

        const groupObjective = $.const(East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, workerId) => {
                const cost = $.let(0.0);
                const count = $.let(0n);
                $.for(East.Array.range(0n, nSlots), ($, slot) => {
                    $.if(East.equal(assignments.get(slot), workerId), $ => {
                        $.assign(cost, cost.add(shiftCosts.get(slot)));
                        $.assign(count, count.add(1n));
                    });
                });
                // Overtime penalty: 50 per extra slot beyond 2
                $.if(count.greater(2n), $ => {
                    $.assign(cost, cost.add(count.subtract(2n).toFloat().multiply(50.0)));
                });
                $.return(cost.negate());
            }
        ));

        // Each slot can be assigned to worker 0, 1, or 2
        const workers = East.Vector.fromArray([0n, 1n, 2n]);
        const spaces = $.let([workers, workers, workers, workers, workers, workers]);

        const config = $.let({
            iterations: variant('some', 20n),
            samples: variant('some', 5n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('some', 42n),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterativeGrouped(
            groupObjective, spaces, config,
        ));

        // Optimal: 2 slots each, no overtime. Total cost = -(10+20+15+25+30+5) = -105
        return result.best_objective;
    }),
    inputs: [],
    returns: -105.0,
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
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        // Optimal WSPT order: job3(3s), job1(5s), job0(10s), job2(20s) → cost = -188.0
        return result.best_objective;
    }),
    inputs: [],
    returns: -188.0,
});
