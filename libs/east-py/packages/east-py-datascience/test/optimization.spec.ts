/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Iterative optimization platform function tests.
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and export IR for Python execution.
 */
import { East, FloatType, IntegerType, VectorType, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Optimization } from "@elaraai/east-py-datascience";
import * as ex from "./optimization.examples.js";

describeEast("Optimization platform functions", (test) => {

    Assert.examples(test, {
        optimizationCoordinate: ex.optimizationCoordinate,
        optimizationSwap: ex.optimizationSwap,
        optimizationIncremental: ex.optimizationIncremental,
        optimizationGrouped: ex.optimizationGrouped,
    });

    test("iterative finds optimal task-worker assignment", $ => {
        // 5 tasks, 3 workers. skill[task][worker] = match score.
        const skill = $.let([
            [3.0, 1.0, 2.0],   // task 0: best with worker 0
            [1.0, 3.0, 2.0],   // task 1: best with worker 1
            [2.0, 2.0, 3.0],   // task 2: best with worker 2
            [3.0, 2.0, 1.0],   // task 3: best with worker 0
            [1.0, 2.0, 3.0],   // task 4: best with worker 2
        ]);

        // Objective: total skill score for given assignment
        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, assignments) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, East.value(5n)), ($, i) => {
                    const worker = $.let(assignments.get(i));
                    const score = $.let(skill.get(i).get(worker));
                    $.assign(total, total.add(score));
                });
                return $.return(total);
            }
        );

        // Each task can be assigned to worker 0, 1, or 2
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

        const result = $.let(Optimization.iterative(
            objective, spaces, config,
        ));

        $(Assert.equal(result.success, true));
        // Optimal: each task assigned to best worker -> 3+3+3+3+3 = 15.0
        $(Assert.equal(result.best_objective, East.value(15.0)));
    });

    test("iterative respects seed for reproducibility", $ => {
        // Maximize sum of values (trivial but verifies determinism)
        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, params) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, params.length()), ($, i) => {
                    $.assign(total, total.add(params.get(i).toFloat()));
                });
                return $.return(total);
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n, 3n]),
            new BigInt64Array([0n, 1n, 2n, 3n]),
            new BigInt64Array([0n, 1n, 2n, 3n]),
        ]);

        const config = $.let({
            iterations: variant('some', 5n),
            samples: variant('some', 2n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('random', null)),
            random_state: variant('some', 123n),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const result1 = $.let(Optimization.iterative(objective, spaces, config));
        const result2 = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result1.best_objective, result2.best_objective));
    });

    test("iterative works with default config", $ => {
        // Simple: maximize sum with all defaults
        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, params) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, params.length()), ($, i) => {
                    $.assign(total, total.add(params.get(i).toFloat()));
                });
                return $.return(total);
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        // All-none config: use all defaults
        const config = $.let({
            iterations: variant('none', null),
            samples: variant('none', null),
            initial: variant('none', null),
            order: variant('none', null),
            random_state: variant('none', null),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result.success, true));
        // Should find [2, 2] -> 4.0
        $(Assert.equal(result.best_objective, East.value(4.0)));
    });

    test("iterative converges early when no improvement", $ => {
        // Objective: minimize distance from [1, 1, 1]
        // (negative squared distance = maximize to get closer)
        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, params) => {
                const penalty = $.let(0.0);
                $.for(East.Array.range(0n, params.length()), ($, i) => {
                    const diff = $.let(params.get(i).subtract(1n).toFloat());
                    $.assign(penalty, penalty.subtract(diff.multiply(diff)));
                });
                return $.return(penalty);
            }
        );

        // Each param can be 0, 1, or 2. Best is [1, 1, 1] -> penalty 0.0
        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        const config = $.let({
            iterations: variant('some', 100n),
            samples: variant('some', 1n),
            initial: variant('some', variant('first', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('none', null),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result.success, true));
        // Should converge to [1,1,1] -> 0.0
        $(Assert.equal(result.best_objective, East.value(0.0)));
        // Should converge well before 100 iterations
        $(Assert.less(result.iterations, 100n));
    });

    test("swap mode finds optimal permutation for scheduling", $ => {
        // 4 jobs: find execution order minimizing weighted completion time.
        // Optimal by WSPT rule (dur/value ascending): [3, 1, 0, 2]
        //   job 3: dur=3,  cum=3,  val=10 → 30
        //   job 1: dur=5,  cum=8,  val=8  → 64
        //   job 0: dur=10, cum=18, val=1  → 18
        //   job 2: dur=20, cum=38, val=2  → 76
        //   total WCT = 188, negated = -188.0
        const durations = $.let([10.0, 5.0, 20.0, 3.0]);
        const values    = $.let([1.0, 8.0, 2.0, 10.0]);

        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, perm) => {
                const cum = $.let(0.0);
                const total = $.let(0.0);
                $.for(East.Array.range(0n, East.value(4n)), ($, i) => {
                    const idx = $.let(perm.get(i));
                    $.assign(cum, cum.add(durations.get(idx)));
                    $.assign(total, total.add(values.get(idx).multiply(cum)));
                });
                return $.return(total.negate());
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n, 3n]),
            new BigInt64Array([0n, 1n, 2n, 3n]),
            new BigInt64Array([0n, 1n, 2n, 3n]),
            new BigInt64Array([0n, 1n, 2n, 3n]),
        ]);

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

        $(Assert.equal(result.best_objective, East.value(-188.0)));
    });

    test("swap mode with sequential order and first init", $ => {
        // 3 items: maximize sum of position * value.
        // values[i] = weight of item i. Objective = sum(position * value[perm[pos]])
        // values = [1, 3, 2]. Best: put highest value in last position → [0, 2, 1]
        // score = 0*1 + 1*2 + 2*3 = 8, or [2, 0, 1] → 0*2 + 1*1 + 2*3 = 7.
        // Actually: [X, X, 1] puts value 3 at pos 2. [0, 2, 1] → 0*1+1*2+2*3=8
        const values = $.let([1.0, 3.0, 2.0]);

        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, perm) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, East.value(3n)), ($, i) => {
                    const idx = $.let(perm.get(i));
                    $.assign(total, total.add(i.toFloat().multiply(values.get(idx))));
                });
                return $.return(total);
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        const config = $.let({
            iterations: variant('some', 20n),
            samples: variant('some', 1n),
            initial: variant('some', variant('first', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('none', null),
            mode: variant('some', variant('swap', null)),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result.success, true));
        // Optimal: [0, 2, 1] → 0*1 + 1*2 + 2*3 = 8.0
        $(Assert.equal(result.best_objective, East.value(8.0)));
    });

    test("swap mode respects seed for reproducibility", $ => {
        const values = $.let([5.0, 1.0, 3.0, 4.0, 2.0]);

        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, perm) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, East.value(5n)), ($, i) => {
                    const idx = $.let(perm.get(i));
                    $.assign(total, total.add(i.toFloat().multiply(values.get(idx))));
                });
                return $.return(total);
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n, 3n, 4n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n]),
        ]);

        const config = $.let({
            iterations: variant('some', 30n),
            samples: variant('some', 5n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('random', null)),
            random_state: variant('some', 99n),
            mode: variant('some', variant('swap', null)),
            workers: variant('none', null),
        });

        const result1 = $.let(Optimization.iterative(objective, spaces, config));
        const result2 = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result1.best_objective, result2.best_objective));
    });

    test("swap mode converges on 6-element TSP-like problem", $ => {
        // Minimize total distance of a circular tour: sum of |perm[i] - perm[i+1]|
        // Optimal tour visits in order: [0,1,2,3,4,5] or reverse → distance = 5
        const objective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, perm) => {
                const dist = $.let(0.0);
                $.for(East.Array.range(0n, East.value(5n)), ($, i) => {
                    const a = $.let(perm.get(i).toFloat());
                    const b = $.let(perm.get(i.add(1n)).toFloat());
                    $.assign(dist, dist.add(a.subtract(b).abs()));
                });
                return $.return(dist.negate());
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
            new BigInt64Array([0n, 1n, 2n, 3n, 4n, 5n]),
        ]);

        const config = $.let({
            iterations: variant('some', 50n),
            samples: variant('some', 5n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('random', null)),
            random_state: variant('some', 42n),
            mode: variant('some', variant('swap', null)),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterative(objective, spaces, config));

        $(Assert.equal(result.success, true));
        // Optimal distance = 5 (sequential order), negated = -5.0
        $(Assert.equal(result.best_objective, East.value(-5.0)));
    });

    // ── Incremental tests ──────────────────────────────────────────────

    test("incremental finds optimal task-worker assignment", $ => {
        // Same problem as the non-incremental test, but using per-element objective
        const skill = $.let([
            [3.0, 1.0, 2.0],
            [1.0, 3.0, 2.0],
            [2.0, 2.0, 3.0],
            [3.0, 2.0, 1.0],
            [1.0, 2.0, 3.0],
        ]);

        const elementObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, taskIdx) => {
                const worker = $.let(assignments.get(taskIdx));
                return $.return(skill.get(taskIdx).get(worker));
            }
        );

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

        $(Assert.equal(result.success, true));
        // Optimal: 3+3+3+3+3 = 15.0
        $(Assert.equal(result.best_objective, East.value(15.0)));
    });

    test("incremental with swap mode finds optimal permutation", $ => {
        // Per-element: contribution of position i = position * value[perm[i]]
        const values = $.let([1.0, 3.0, 2.0]);

        const elementObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, perm, posIdx) => {
                const itemIdx = $.let(perm.get(posIdx));
                return $.return(posIdx.toFloat().multiply(values.get(itemIdx)));
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        const config = $.let({
            iterations: variant('some', 20n),
            samples: variant('some', 1n),
            initial: variant('some', variant('first', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('none', null),
            mode: variant('some', variant('swap', null)),
            workers: variant('none', null),
        });

        const result = $.let(Optimization.iterativeIncremental(
            elementObjective, spaces, config,
        ));

        $(Assert.equal(result.success, true));
        // Optimal: [0, 2, 1] → 0*1 + 1*2 + 2*3 = 8.0
        $(Assert.equal(result.best_objective, East.value(8.0)));
    });

    test("incremental with parallel workers", $ => {
        // Same task-worker problem, but with workers: 2
        const skill = $.let([
            [3.0, 1.0, 2.0],
            [1.0, 3.0, 2.0],
            [2.0, 2.0, 3.0],
        ]);

        const elementObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, taskIdx) => {
                const worker = $.let(assignments.get(taskIdx));
                return $.return(skill.get(taskIdx).get(worker));
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
            new BigInt64Array([0n, 1n, 2n]),
        ]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 4n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('some', 42n),
            mode: variant('none', null),
            workers: variant('some', 2n),
        });

        const result = $.let(Optimization.iterativeIncremental(
            elementObjective, spaces, config,
        ));

        $(Assert.equal(result.success, true));
        // Optimal: 3+3+3 = 9.0
        $(Assert.equal(result.best_objective, East.value(9.0)));
    });

    test("incremental matches non-incremental result", $ => {
        // Verify incremental produces same result as full objective
        const skill = $.let([
            [3.0, 1.0],
            [1.0, 3.0],
            [2.0, 2.0],
        ]);

        // Full objective
        const fullObjective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, assignments) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, East.value(3n)), ($, i) => {
                    const w = $.let(assignments.get(i));
                    $.assign(total, total.add(skill.get(i).get(w)));
                });
                return $.return(total);
            }
        );

        // Per-element objective
        const elementObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, taskIdx) => {
                const w = $.let(assignments.get(taskIdx));
                return $.return(skill.get(taskIdx).get(w));
            }
        );

        const spaces = $.let([
            new BigInt64Array([0n, 1n]),
            new BigInt64Array([0n, 1n]),
            new BigInt64Array([0n, 1n]),
        ]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 1n),
            initial: variant('some', variant('first', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('none', null),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const fullResult = $.let(Optimization.iterative(fullObjective, spaces, config));
        const incrResult = $.let(Optimization.iterativeIncremental(elementObjective, spaces, config));

        $(Assert.equal(fullResult.best_objective, incrResult.best_objective));
    });

    // ── Grouped tests ─────────────────────────────────────────────────

    test("grouped finds optimal slot-to-worker assignment", $ => {
        // 6 slots, 3 workers. Group objective: per-worker cost.
        const shiftCosts = $.let([10.0, 20.0, 15.0, 25.0, 30.0, 5.0]);
        const nSlots = East.value(6n);

        const groupObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, workerId) => {
                const cost = $.let(0.0);
                $.for(East.Array.range(0n, nSlots), ($, slot) => {
                    $.if(East.equal(assignments.get(slot), workerId), $ => {
                        $.assign(cost, cost.add(shiftCosts.get(slot)));
                    });
                });
                return $.return(cost.negate());
            }
        );

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

        $(Assert.equal(result.success, true));
        // Total cost = -(10+20+15+25+30+5) = -105 (no per-worker penalty)
        $(Assert.equal(result.best_objective, East.value(-105.0)));
    });

    test("grouped with overtime penalty prefers balanced assignment", $ => {
        // 6 slots, 3 workers. Overtime penalty if >2 slots per worker.
        const shiftCosts = $.let([10.0, 10.0, 10.0, 10.0, 10.0, 10.0]);
        const nSlots = East.value(6n);

        const groupObjective = East.function(
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
                // Heavy overtime penalty
                $.if(count.greater(2n), $ => {
                    $.assign(cost, cost.add(count.subtract(2n).toFloat().multiply(100.0)));
                });
                return $.return(cost.negate());
            }
        );

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

        $(Assert.equal(result.success, true));
        // Balanced: 2 each, no overtime. Cost = -(6*10) = -60
        $(Assert.equal(result.best_objective, East.value(-60.0)));
    });

    test("grouped matches full objective result", $ => {
        // Verify grouped produces same result as full objective
        const shiftCosts = $.let([5.0, 10.0, 15.0, 20.0]);
        const nSlots = East.value(4n);
        const nWorkers = East.value(2n);

        const fullObjective = East.function(
            [VectorType(IntegerType)], FloatType,
            ($, assignments) => {
                const total = $.let(0.0);
                $.for(East.Array.range(0n, nWorkers), ($, wid) => {
                    $.for(East.Array.range(0n, nSlots), ($, slot) => {
                        $.if(East.equal(assignments.get(slot), wid), $ => {
                            $.assign(total, total.add(shiftCosts.get(slot)));
                        });
                    });
                });
                return $.return(total.negate());
            }
        );

        const groupObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, workerId) => {
                const cost = $.let(0.0);
                $.for(East.Array.range(0n, nSlots), ($, slot) => {
                    $.if(East.equal(assignments.get(slot), workerId), $ => {
                        $.assign(cost, cost.add(shiftCosts.get(slot)));
                    });
                });
                return $.return(cost.negate());
            }
        );

        const workers = East.Vector.fromArray([0n, 1n]);
        const spaces = $.let([workers, workers, workers, workers]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 1n),
            initial: variant('some', variant('first', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('none', null),
            mode: variant('none', null),
            workers: variant('none', null),
        });

        const fullResult = $.let(Optimization.iterative(fullObjective, spaces, config));
        const groupResult = $.let(Optimization.iterativeGrouped(groupObjective, spaces, config));

        $(Assert.equal(fullResult.best_objective, groupResult.best_objective));
    });

    test("grouped with parallel workers", $ => {
        const shiftCosts = $.let([10.0, 20.0, 15.0]);
        const nSlots = East.value(3n);

        const groupObjective = East.function(
            [VectorType(IntegerType), IntegerType], FloatType,
            ($, assignments, workerId) => {
                const cost = $.let(0.0);
                $.for(East.Array.range(0n, nSlots), ($, slot) => {
                    $.if(East.equal(assignments.get(slot), workerId), $ => {
                        $.assign(cost, cost.add(shiftCosts.get(slot)));
                    });
                });
                return $.return(cost.negate());
            }
        );

        const workers = East.Vector.fromArray([0n, 1n]);
        const spaces = $.let([workers, workers, workers]);

        const config = $.let({
            iterations: variant('some', 10n),
            samples: variant('some', 4n),
            initial: variant('some', variant('random', null)),
            order: variant('some', variant('sequential', null)),
            random_state: variant('some', 42n),
            mode: variant('none', null),
            workers: variant('some', 2n),
        });

        const result = $.let(Optimization.iterativeGrouped(
            groupObjective, spaces, config,
        ));

        $(Assert.equal(result.success, true));
        $(Assert.equal(result.best_objective, East.value(-45.0)));
    });

}, { exportOnly: true });
