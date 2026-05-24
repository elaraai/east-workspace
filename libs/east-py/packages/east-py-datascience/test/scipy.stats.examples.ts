/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, IntegerType, example } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

export const scipyStatsDescribe = example({
    keywords: ["scipy", "statsDescribe", "descriptive statistics", "mean", "variance", "skew", "kurtosis", "processing time"],
    description: "Compute summary statistics (mean, variance, skew, kurtosis) for daily order processing times",
    fn: East.function([], IntegerType, ($) => {
        // Daily order processing times in minutes (slightly right-skewed)
        const processing_times = $.let(East.Vector.fromArray([
            12.5, 14.0, 11.8, 15.2, 13.1, 16.7, 12.9, 14.5, 13.8, 18.3,
        ]));

        const result = $.let(Scipy.statsDescribe(processing_times));

        // Return observation count
        return result.count;
    }),
    inputs: [],
    returns: 10n,
});

export const scipyCorrelation = example({
    keywords: ["scipy", "statsPearsonr", "statsSpearmanr", "correlation", "equipment age", "failure rate"],
    description: "Measure Pearson correlation between equipment age and failure rate",
    fn: East.function([], BooleanType, ($) => {
        // Equipment ages (years) and corresponding annual failure rates
        const ages = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 5.0, 7.0, 10.0]));
        const failure_rates = $.let(East.Vector.fromArray([0.02, 0.03, 0.05, 0.08, 0.12, 0.18]));

        const pearson = $.let(Scipy.statsPearsonr(ages, failure_rates));

        // Strong positive correlation expected (older → more failures)
        return pearson.correlation.greaterThan(0.95);
    }),
    inputs: [],
    returns: true,
});

export const scipyPercentile = example({
    keywords: ["scipy", "statsPercentileOfScore", "percentile", "lead time", "distribution", "rank"],
    description: "Find what percentile a specific lead time falls at relative to historical distribution",
    fn: East.function([FloatType], FloatType, ($, query_lead_time) => {
        // Historical supplier lead times in days
        const historical_lead_times = $.let(East.Vector.fromArray([
            3.0, 5.0, 7.0, 10.0, 14.0,
        ]));

        // What percentile does the query lead time fall at?
        return Scipy.statsPercentileOfScore(historical_lead_times, query_lead_time);
    }),
    inputs: [14.0],
    returns: 100.0,
});

export const scipyRobustStats = example({
    keywords: ["scipy", "statsRobust", "robust statistics", "median", "IQR", "MAD", "outlier", "cycle time"],
    description: "Compute median, IQR, and MAD for cycle times with measurement outliers",
    fn: East.function([], BooleanType, ($) => {
        // Cycle times with outliers (500.0 is a measurement error)
        const cycle_times = $.let(East.Vector.fromArray([
            22.0, 24.0, 23.0, 25.0, 21.0, 500.0, 24.0, 22.0, 23.0, 26.0,
        ]));

        const result = $.let(Scipy.statsRobust(cycle_times));

        // Median should be robust to the 500.0 outlier (around 23-24)
        // IQR should be small (data is tight except outlier)
        return result.median.greaterThan(20.0).and(() => result.median.lessThan(30.0));
    }),
    inputs: [],
    returns: true,
});
