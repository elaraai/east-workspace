/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, BooleanType, example } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

export const sklearnStandardScaler = example({
    keywords: ["sklearn", "standardScalerFit", "standardScalerTransform", "scaling", "normalization", "zero mean", "unit variance", "sensor"],
    description: "Standardize sensor feature matrix (zero mean, unit variance) before modelling",
    fn: East.function([], IntegerType, ($) => {
        // Raw sensor readings with different scales
        // Features: pressure (kPa), temperature (°C), vibration (mm/s)
        const X_raw = $.let(East.Matrix.fromArray([
            [101.0, 22.0, 0.5],
            [102.0, 25.0, 1.2],
            [99.0,  28.0, 0.8],
            [103.0, 21.0, 1.5],
            [100.0, 24.0, 0.3],
        ]));

        // Fit scaler on training data
        const scaler = $.let(Sklearn.standardScalerFit(X_raw));

        // Transform to standardized features
        const X_scaled = $.let(Sklearn.standardScalerTransform(scaler, X_raw));

        // Shape preserved: 5 samples × 3 features
        return X_scaled.rows();
    }),
    inputs: [],
    returns: 5n,
});

export const sklearnMinMaxScaler = example({
    keywords: ["sklearn", "minMaxScalerFit", "minMaxScalerTransform", "scaling", "normalize", "0-1", "neural network"],
    description: "Normalize process variables to [0,1] range for neural network input",
    fn: East.function([], IntegerType, ($) => {
        // Process variables with wide value ranges
        // Features: flow_rate (L/min), pressure (bar), rpm
        const X_raw = $.let(East.Matrix.fromArray([
            [50.0, 3.0, 1500.0],
            [75.0, 4.5, 2200.0],
            [60.0, 3.8, 1800.0],
            [90.0, 5.0, 2500.0],
        ]));

        const scaler = $.let(Sklearn.minMaxScalerFit(X_raw));
        const X_scaled = $.let(Sklearn.minMaxScalerTransform(scaler, X_raw));

        // Shape preserved: 4 samples × 3 features
        return X_scaled.rows();
    }),
    inputs: [],
    returns: 4n,
});

export const sklearnRobustScaler = example({
    keywords: ["sklearn", "robustScalerFit", "robustScalerTransform", "scaling", "robust", "median", "IQR", "outlier"],
    description: "Scale features robustly using median/IQR for data with measurement outliers",
    fn: East.function([], IntegerType, ($) => {
        // Sensor data with occasional outlier readings
        // Features: temperature, humidity
        const X_raw = $.let(East.Matrix.fromArray([
            [22.0, 45.0],
            [23.0, 48.0],
            [21.0, 44.0],
            [24.0, 50.0],
            [95.0, 200.0],  // outlier: faulty sensor reading
        ]));

        const scaler = $.let(Sklearn.robustScalerFit(X_raw));
        const X_scaled = $.let(Sklearn.robustScalerTransform(scaler, X_raw));

        // Shape preserved: 5 samples × 2 features
        return X_scaled.getRow(0n).length();
    }),
    inputs: [],
    returns: 2n,
});

export const sklearnLabelEncoder = example({
    keywords: ["sklearn", "labelEncoderFit", "labelEncoderTransform", "labelEncoderInverseTransform", "encoding", "categorical", "integer", "equipment type"],
    description: "Encode categorical equipment type IDs to contiguous integers, then decode back",
    fn: East.function([], BooleanType, ($) => {
        // Equipment type IDs with gaps (e.g. from a database)
        const labels = $.let(East.Vector.fromArray([10n, 25n, 10n, 42n, 25n]));

        // Fit: learns mapping 10→0, 25→1, 42→2
        const encoder = $.let(Sklearn.labelEncoderFit(labels));

        // Transform to contiguous integers
        const encoded = $.let(Sklearn.labelEncoderTransform(encoder, labels));

        // Inverse transform back to original IDs
        const decoded = $.let(Sklearn.labelEncoderInverseTransform(encoder, encoded));

        // Round-trip should recover original labels
        return decoded.get(0n).equal(10n)
            .and(() => decoded.get(3n).equal(42n));
    }),
    inputs: [],
    returns: true,
});

export const sklearnOrdinalEncoder = example({
    keywords: ["sklearn", "ordinalEncoderFit", "ordinalEncoderTransform", "encoding", "ordinal", "categorical", "multi-column"],
    description: "Encode multi-column categorical features (shift, line, product) to ordinals",
    fn: East.function([], IntegerType, ($) => {
        // Each column is a categorical feature encoded as float IDs
        // Column 0: shift (1.0=morning, 2.0=afternoon, 3.0=night)
        // Column 1: line (10.0=lineA, 20.0=lineB)
        const X_categorical = $.let(East.Matrix.fromArray([
            [1.0, 10.0],
            [2.0, 20.0],
            [3.0, 10.0],
            [1.0, 20.0],
        ]));

        const encoder = $.let(Sklearn.ordinalEncoderFit(X_categorical));
        const X_encoded = $.let(Sklearn.ordinalEncoderTransform(encoder, X_categorical));

        // Shape preserved: 4 samples × 2 features, values now 0-indexed
        return X_encoded.rows();
    }),
    inputs: [],
    returns: 4n,
});
