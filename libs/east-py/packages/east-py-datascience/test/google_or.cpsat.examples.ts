/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

export const cpsatScheduleJobs = example({
    keywords: ["google or", "cpsat", "cpsatSolve", "scheduling", "no overlap", "interval", "makespan", "constraint programming"],
    description: "Schedule jobs on a single machine with no-overlap constraints, minimize makespan",
    fn: East.function([IntegerType], BooleanType, ($, n_jobs) => {
        // 3 jobs with durations 3, 5, 2. Schedule on one machine with no overlap.
        // Minimize makespan (= max end time).
        // Optimal: jobs packed tightly, makespan = 3 + 5 + 2 = 10

        // Horizon: sum of all durations
        const horizon = 10n;

        const model = $.let({
            int_vars: [
                // Start and end times for each job
                { name: "start_0", lower_bound: 0n, upper_bound: horizon },
                { name: "end_0", lower_bound: 0n, upper_bound: horizon },
                { name: "dur_0", lower_bound: 3n, upper_bound: 3n },
                { name: "start_1", lower_bound: 0n, upper_bound: horizon },
                { name: "end_1", lower_bound: 0n, upper_bound: horizon },
                { name: "dur_1", lower_bound: 5n, upper_bound: 5n },
                { name: "start_2", lower_bound: 0n, upper_bound: horizon },
                { name: "end_2", lower_bound: 0n, upper_bound: horizon },
                { name: "dur_2", lower_bound: 2n, upper_bound: 2n },
                // Makespan variable
                { name: "makespan", lower_bound: 0n, upper_bound: horizon },
            ],
            bool_vars: [
                { name: "_unused" },
            ],
            interval_vars: [
                { name: "job_0", start: "start_0", size: "dur_0", end: "end_0", is_present: variant('none', null) },
                { name: "job_1", start: "start_1", size: "dur_1", end: "end_1", is_present: variant('none', null) },
                { name: "job_2", start: "start_2", size: "dur_2", end: "end_2", is_present: variant('none', null) },
            ],
            constraints: [
                // No overlap: all jobs on same machine
                variant('no_overlap', { intervals: ["job_0", "job_1", "job_2"] }),
                // makespan >= end_0: makespan - end_0 >= 0
                variant('linear', {
                    expr: { terms: [{ var: "makespan", coeff: 1n }, { var: "end_0", coeff: -1n }], constant: 0n },
                    op: variant('greater_equal', null),
                    rhs: 0n,
                }),
                // makespan >= end_1
                variant('linear', {
                    expr: { terms: [{ var: "makespan", coeff: 1n }, { var: "end_1", coeff: -1n }], constant: 0n },
                    op: variant('greater_equal', null),
                    rhs: 0n,
                }),
                // makespan >= end_2
                variant('linear', {
                    expr: { terms: [{ var: "makespan", coeff: 1n }, { var: "end_2", coeff: -1n }], constant: 0n },
                    op: variant('greater_equal', null),
                    rhs: 0n,
                }),
            ],
            // Minimize makespan
            objective: variant('some', variant('minimize', {
                terms: [{ var: "makespan", coeff: 1n }],
                constant: 0n,
            })),
        }, GoogleOr.Types.CpSatModelType);

        const config = $.let({
            max_time_seconds: variant('some', 10.0),
            num_workers: variant('none', null),
            log_search_progress: variant('none', null),
            seed: variant('some', 42n),
            max_solutions: variant('none', null),
        }, GoogleOr.Types.CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        // Optimal makespan = 10 (all jobs packed on one machine)
        return result.objective_value.match({
            some: ($, v) => East.Float.approxEqual(v, 10.0, 0.1),
            none: ($) => false,
        });
    }),
    inputs: [3n],
    returns: true,
});

export const cpsatAssignShifts = example({
    keywords: ["google or", "cpsat", "cpsatSolve", "nurse scheduling", "shift assignment", "boolean variables", "cardinality"],
    description: "Assign nurses to shifts respecting max shifts per nurse and minimum coverage per shift",
    fn: East.function([], BooleanType, ($) => {
        // 3 nurses, 4 shifts. Each nurse works at most 2 shifts, each shift needs at least 1 nurse.
        // Maximize total coverage (= total assignments).

        const model = $.let({
            int_vars: [
                // Dummy int var for interval placeholder
                { name: "_d", lower_bound: 0n, upper_bound: 0n },
            ],
            bool_vars: [
                // nurse_i_shift_j = 1 if nurse i works shift j
                { name: "n0_s0" }, { name: "n0_s1" }, { name: "n0_s2" }, { name: "n0_s3" },
                { name: "n1_s0" }, { name: "n1_s1" }, { name: "n1_s2" }, { name: "n1_s3" },
                { name: "n2_s0" }, { name: "n2_s1" }, { name: "n2_s2" }, { name: "n2_s3" },
            ],
            interval_vars: [
                { name: "_unused_iv", start: "_d", size: "_d", end: "_d", is_present: variant('none', null) },
            ],
            constraints: [
                // Each nurse works at most 2 shifts
                variant('at_most_k', { vars: ["n0_s0", "n0_s1", "n0_s2", "n0_s3"], k: 2n }),
                variant('at_most_k', { vars: ["n1_s0", "n1_s1", "n1_s2", "n1_s3"], k: 2n }),
                variant('at_most_k', { vars: ["n2_s0", "n2_s1", "n2_s2", "n2_s3"], k: 2n }),
                // Each shift needs at least 1 nurse
                variant('at_least_k', { vars: ["n0_s0", "n1_s0", "n2_s0"], k: 1n }),
                variant('at_least_k', { vars: ["n0_s1", "n1_s1", "n2_s1"], k: 1n }),
                variant('at_least_k', { vars: ["n0_s2", "n1_s2", "n2_s2"], k: 1n }),
                variant('at_least_k', { vars: ["n0_s3", "n1_s3", "n2_s3"], k: 1n }),
            ],
            // Maximize total assignments
            objective: variant('some', variant('maximize', {
                terms: [
                    { var: "n0_s0", coeff: 1n }, { var: "n0_s1", coeff: 1n }, { var: "n0_s2", coeff: 1n }, { var: "n0_s3", coeff: 1n },
                    { var: "n1_s0", coeff: 1n }, { var: "n1_s1", coeff: 1n }, { var: "n1_s2", coeff: 1n }, { var: "n1_s3", coeff: 1n },
                    { var: "n2_s0", coeff: 1n }, { var: "n2_s1", coeff: 1n }, { var: "n2_s2", coeff: 1n }, { var: "n2_s3", coeff: 1n },
                ],
                constant: 0n,
            })),
        }, GoogleOr.Types.CpSatModelType);

        const config = $.let({
            max_time_seconds: variant('some', 10.0),
            num_workers: variant('none', null),
            log_search_progress: variant('none', null),
            seed: variant('some', 42n),
            max_solutions: variant('none', null),
        }, GoogleOr.Types.CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        // Max assignments = 6 (3 nurses × 2 shifts each)
        return result.objective_value.match({
            some: ($, v) => East.Float.approxEqual(v, 6.0, 0.1),
            none: ($) => false,
        });
    }),
    inputs: [],
    returns: true,
});

export const cpsatSolveAll = example({
    keywords: ["google or", "cpsat", "cpsatSolveAll", "enumerate", "feasible solutions", "bin packing"],
    description: "Enumerate all valid assignments of 3 items to 2 bins where each bin holds at most 2 items",
    fn: East.function([], BooleanType, ($) => {
        // 3 items (a, b, c) assigned to bin 0 or bin 1.
        // Each bin holds at most 2 items.
        // Enumerate all feasible assignments.

        const model = $.let({
            int_vars: [
                // bin assignment for each item: 0 or 1
                { name: "a", lower_bound: 0n, upper_bound: 1n },
                { name: "b", lower_bound: 0n, upper_bound: 1n },
                { name: "c", lower_bound: 0n, upper_bound: 1n },
            ],
            bool_vars: [
                { name: "_unused" },
            ],
            interval_vars: [
                { name: "_unused_iv", start: "a", size: "a", end: "a", is_present: variant('none', null) },
            ],
            constraints: [
                // Bin 0 holds at most 2: count items in bin 0 <= 2
                // Equivalent: (1-a) + (1-b) + (1-c) <= 2 → -a - b - c + 3 <= 2 → -a - b - c <= -1 → a + b + c >= 1
                // At least 1 item in bin 1
                variant('linear', {
                    expr: { terms: [{ var: "a", coeff: 1n }, { var: "b", coeff: 1n }, { var: "c", coeff: 1n }], constant: 0n },
                    op: variant('greater_equal', null),
                    rhs: 1n,
                }),
                // At most 2 items in bin 1: a + b + c <= 2
                variant('linear', {
                    expr: { terms: [{ var: "a", coeff: 1n }, { var: "b", coeff: 1n }, { var: "c", coeff: 1n }], constant: 0n },
                    op: variant('less_equal', null),
                    rhs: 2n,
                }),
            ],
            // No objective — just feasibility
            objective: variant('none', null),
        }, GoogleOr.Types.CpSatModelType);

        const config = $.let({
            max_time_seconds: variant('some', 10.0),
            num_workers: variant('none', null),
            log_search_progress: variant('none', null),
            seed: variant('some', 42n),
            max_solutions: variant('some', 100n),
        }, GoogleOr.Types.CpSatConfigType);

        const results = $.let(GoogleOr.cpsatSolveAll(model, config));

        // 6 feasible solutions: C(3,1) + C(3,2) = 3 + 3 = 6
        return East.equal(results.length(), 6n);
    }),
    inputs: [],
    returns: true,
});
