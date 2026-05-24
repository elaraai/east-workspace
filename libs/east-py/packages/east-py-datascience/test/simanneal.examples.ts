/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, IntegerType, VectorType, variant, example, some, none } from "@elaraai/east";
import { SimAnneal } from "@elaraai/east-py-datascience";

export const simannealOptimizeAssignment = example({
    keywords: ["simanneal", "optimize", "simulated annealing", "assignment", "cost matrix", "discrete"],
    description: "Assign tasks to workers minimizing total completion time given a cost matrix",
    fn: East.function([], BooleanType, ($) => {
        // Cost matrix: cost[task][worker]. 3 tasks, 3 workers.
        // task 0 best with worker 2 (cost 1), task 1 best with worker 0 (cost 2), task 2 best with worker 1 (cost 1)
        const costs = $.let([
            East.Vector.fromArray([5.0, 4.0, 1.0]),  // task 0
            East.Vector.fromArray([2.0, 6.0, 3.0]),  // task 1
            East.Vector.fromArray([4.0, 1.0, 5.0]),  // task 2
        ]);

        // Energy: sum of cost[task][assignment[task]] — lower is better
        const energy = $.const(East.function(
            [SimAnneal.Types.DiscreteStateType], FloatType,
            ($, state) => {
                const total_cost = $.let(0.0);
                $.match(state, {
                    int_array: ($, assignments) => {
                        $.for(East.Array.range(0n, East.value(3n)), ($, task) => {
                            const worker = $.let(assignments.get(task));
                            $.assign(total_cost, total_cost.add(costs.get(task).get(worker)));
                        });
                    },
                    bool_array: ($) => { $.assign(total_cost, 999.0); },
                });
                $.return(total_cost);
            }
        ));

        // Move: cycle one task's assignment to the next worker
        const move = $.const(East.function(
            [SimAnneal.Types.DiscreteStateType], SimAnneal.Types.DiscreteStateType,
            ($, state) => {
                const result = $.let(state);
                $.match(state, {
                    int_array: ($, assignments) => {
                        // Rotate first worker assignment
                        const new_assignments = $.let(East.Vector.fromArray([
                            assignments.get(0n).add(1n).remainder(3n),
                            assignments.get(1n),
                            assignments.get(2n),
                        ]));
                        $.assign(result, variant("int_array", new_assignments));
                    },
                    bool_array: ($, arr) => { $.assign(result, variant("bool_array", arr)); },
                });
                $.return(result);
            }
        ));

        // Start with all tasks assigned to worker 0
        const initial = $.let(variant("int_array", East.Vector.fromArray([0n, 0n, 0n])), SimAnneal.Types.DiscreteStateType);

        const config = $.let({
            t_max: some(100.0),
            t_min: some(0.01),
            steps: some(1000n),
            updates: none,
            auto_schedule: none,
            random_state: some(42n),
        }, SimAnneal.Types.ConfigType);

        const result = $.let(SimAnneal.optimize(initial, energy, move, config));

        return result.success;
    }),
    inputs: [],
    returns: true,
});

export const simannealOptimizePermutation = example({
    keywords: ["simanneal", "optimizePermutation", "simulated annealing", "permutation", "scheduling", "weighted tardiness"],
    description: "Find best job sequence on a single machine to minimize total weighted tardiness",
    fn: East.function([], BooleanType, ($) => {
        // 4 jobs: processing times, due dates, weights
        const processing_times = $.let(East.Vector.fromArray([10.0, 5.0, 20.0, 3.0]));
        const due_dates = $.let(East.Vector.fromArray([15.0, 10.0, 40.0, 8.0]));
        const weights = $.let(East.Vector.fromArray([1.0, 8.0, 2.0, 10.0]));

        // Energy: total weighted tardiness = sum(weight[j] * max(0, completion[j] - due[j]))
        const energy = $.const(East.function(
            [VectorType(IntegerType)], FloatType,
            ($, sequence) => {
                const current_time = $.let(0.0);
                const total_tardiness = $.let(0.0);
                $.for(East.Array.range(0n, East.value(4n)), ($, i) => {
                    const job = $.let(sequence.get(i));
                    $.assign(current_time, current_time.add(processing_times.get(job)));
                    // tardiness = max(0, completion - due_date)
                    const tardiness = $.let(current_time.subtract(due_dates.get(job)));
                    const clamped = $.let(tardiness.greaterThan(0.0).ifElse(() => tardiness, () => 0.0));
                    $.assign(total_tardiness, total_tardiness.add(weights.get(job).multiply(clamped)));
                });
                $.return(total_tardiness);
            }
        ));

        // Initial sequence: 0, 1, 2, 3
        const initial = $.let(East.Vector.fromArray([0n, 1n, 2n, 3n]));

        const config = $.let({
            t_max: some(1000.0),
            t_min: some(0.1),
            steps: some(5000n),
            updates: none,
            auto_schedule: none,
            random_state: some(42n),
        }, SimAnneal.Types.ConfigType);

        const result = $.let(SimAnneal.optimizePermutation(initial, energy, config));

        return result.success;
    }),
    inputs: [],
    returns: true,
});

export const simannealOptimizeSubset = example({
    keywords: ["simanneal", "optimizeSubset", "simulated annealing", "subset selection", "maintenance", "budget", "knapsack"],
    description: "Select which maintenance tasks to perform within a limited budget, maximizing reliability improvement",
    fn: East.function([FloatType], BooleanType, ($, budget) => {
        // 6 maintenance tasks with costs and reliability benefit scores
        const task_costs = $.let(East.Vector.fromArray([5.0, 12.0, 3.0, 8.0, 15.0, 7.0]));
        const task_benefits = $.let(East.Vector.fromArray([4.0, 10.0, 2.0, 7.0, 13.0, 6.0]));

        // Energy: negate total benefit (minimization), with penalty if over budget
        const energy = $.const(East.function(
            [VectorType(BooleanType)], FloatType,
            ($, selection) => {
                const total_cost = $.let(0.0);
                const total_benefit = $.let(0.0);
                $.for(East.Array.range(0n, East.value(6n)), ($, i) => {
                    $.if(selection.get(i), $ => {
                        $.assign(total_cost, total_cost.add(task_costs.get(i)));
                        $.assign(total_benefit, total_benefit.add(task_benefits.get(i)));
                    });
                });
                // Heavy penalty for exceeding budget
                const penalty = $.let(
                    total_cost.greaterThan(budget).ifElse(
                        () => total_cost.subtract(budget).multiply(100.0),
                        () => 0.0
                    )
                );
                // Negate benefit (SA minimizes) + add penalty
                $.return(total_benefit.negate().add(penalty));
            }
        ));

        // Start with no tasks selected
        const initial = $.let(East.Vector.fromArray([false, false, false, false, false, false]));

        const config = $.let({
            t_max: some(500.0),
            t_min: some(0.1),
            steps: some(3000n),
            updates: none,
            auto_schedule: none,
            random_state: some(42n),
        }, SimAnneal.Types.ConfigType);

        const result = $.let(SimAnneal.optimizeSubset(initial, energy, config));

        return result.success;
    }),
    inputs: [25.0],
    returns: true,
});
