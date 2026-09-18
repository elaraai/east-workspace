/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Fuzz testing configuration for patch operations.
 * Shared between unit tests (src/patch/patch.spec.ts) and compliance tests (test/patch.spec.ts).
 *
 * @module
 */

import type { EastType, ValueTypeOf, ArrayType as ArrayTypeT, StructType as StructTypeT } from "../types.js";
import {
    ArrayType,
    StructType,
    VariantType,
    DictType,
    SetType,
    RefType,
    FunctionType,
    IntegerType,
    StringType,
    FloatType,
    BooleanType,
    NullType,
    printType,
} from "../types.js";
import { EastTypeType } from "../type_of_type.js";
import { randomType, randomValueFor, randomRecursiveType, randomSharedRecursiveType, randomFunctionType, seedFuzz, typeFingerprint } from "../fuzz.js";
import { encodeBeast2For } from "../serialization/beast2/index.js";
import { PatchType } from "./type_of_patch.js";
import { diffFor } from "./diff.js";
import { invertFor } from "./invert.js";
import { composeFor } from "./compose.js";

/**
 * A generated test case containing a random type and sample values for testing.
 */
export interface FuzzTestCase<T extends EastType = EastType> {
    /** The randomly generated East type */
    type: T;
    /** String representation of the type for test naming */
    typeName: string;
    /** {@link typeFingerprint} of the type — a name stable across processes */
    fingerprint: string;
    /** Array type for before/after pairs (used by compliance tests) */
    pairsArrayType: ArrayTypeT<StructTypeT<{ before: T; after: T }>>;
    /** Array type for v1/v2/v3 triplets (used by compliance tests) */
    tripletsArrayType: ArrayTypeT<StructTypeT<{ v1: T; v2: T; v3: T }>>;
    /** Value pairs for diff/apply/invert tests */
    pairs: Array<{ before: ValueTypeOf<T>; after: ValueTypeOf<T> }>;
    /** Value triplets for compose tests */
    triplets: Array<{ v1: ValueTypeOf<T>; v2: ValueTypeOf<T>; v3: ValueTypeOf<T> }>;
    /**
     * Per pair, the beast2 bytes of `diff(before, after)` as TypeScript
     * computes and encodes it (`0x…`): the corpus asserts every runtime's
     * diff encodes to these bytes, so a patch is the same value on every
     * runtime — not merely one that applies to the same result (#774).
     */
    diffHex: string[];
    /** Per pair, the bytes of `invertPatch(diff(before, after))`. */
    invertHex: string[];
    /** The type of `composed`: an array of the patch type. */
    composedArrayType: ArrayTypeT<EastType>;
    /**
     * Per triplet, `composePatch(diff(v1, v2), diff(v2, v3))` as TypeScript
     * computes it. Composition is pinned by value equality, not bytes: its
     * result is the same value on every runtime, but each runtime's compose
     * reuses different sub-containers of its inputs and the wire records
     * that sharing.
     */
    composed: ValueTypeOf<EastType>[];
}

/**
 * Options for generating fuzz test cases.
 */
export interface FuzzTestOptions {
    /** Number of random types to generate */
    numTypes?: number;
    /** Number of sample values per type */
    numSamples?: number;
    /** Depth at which sample values stop nesting (default 5) */
    valueDepth?: number;
    /** Include recursive types in generation */
    includeRecursive?: boolean;
    /** Include function types in generation */
    includeFunctions?: boolean;
    /** Recursion below the top level: closed recursive leaves, a recursive
     *  type shared by several fields, random recursive bodies (default true) */
    nestedRecursive?: boolean;
    /** `EastTypeType` as a leaf, with type values as values (default true) */
    includeTypeValues?: boolean;
    /** Maximum retries when generating values for a single type */
    maxValueRetries?: number;
    /** Multiplier for max attempts (numTypes * multiplier) */
    attemptsMultiplier?: number;
    /** Ensure diverse type coverage (at least one of each kind) */
    ensureDiversity?: boolean;
    /** Seed for the deterministic random stream. The generated cases form a
     *  cross-runtime replay corpus whose suite names downstream pins key on,
     *  so generation must reproduce across exports — bump the seed
     *  deliberately to mint a fresh corpus. */
    seed?: number;
}

const DEFAULT_OPTIONS: Required<FuzzTestOptions> = {
    numTypes: 20,
    numSamples: 5,
    valueDepth: 5,
    includeRecursive: true,
    includeFunctions: true,
    nestedRecursive: true,
    includeTypeValues: true,
    maxValueRetries: 20,
    attemptsMultiplier: 3,
    ensureDiversity: true,
    seed: 0xea57,
};

/**
 * Specific type generators to ensure diversity in test coverage.
 * These guarantee we test important type patterns that random generation might miss.
 */
function getDiverseTypes(includeRecursive: boolean, includeFunctions: boolean, nestedRecursive: boolean, includeTypeValues: boolean): EastType[] {
    const types: EastType[] = [
        // Variants (often missed by random generation)
        VariantType({ none: NullType, some: IntegerType }),
        VariantType({ ok: StringType, err: StructType({ code: IntegerType, message: StringType }) }),

        // Nested variants
        VariantType({
            leaf: FloatType,
            branch: ArrayType(IntegerType),
        }),

        // Ref types
        RefType(IntegerType),
        RefType(StructType({ x: FloatType, y: FloatType })),

        // Nested collections
        ArrayType(VariantType({ a: IntegerType, b: StringType })),
        DictType(StringType, VariantType({ value: FloatType, missing: NullType })),

        // Struct with variant field
        StructType({
            id: IntegerType,
            status: VariantType({ active: NullType, inactive: StringType }),
        }),

        // Set with different key types
        SetType(IntegerType),

        // Deeply nested
        ArrayType(ArrayType(IntegerType)),
        DictType(StringType, DictType(StringType, IntegerType)),
    ];

    // Add recursive types if enabled
    if (includeRecursive) {
        // Add multiple recursive type patterns
        for (let i = 0; i < 3; i++) {
            types.push(randomRecursiveType());
        }
        if (nestedRecursive) {
            // A recursive type reached through a container before itself,
            // random bodies, and recursion nested in recursion (#770).
            types.push(randomSharedRecursiveType());
            types.push(randomRecursiveType({ randomBody: true }));
            types.push(ArrayType(randomRecursiveType({ randomBody: true })));
        }
    }

    // Type values: the shape every IR annotation travels as
    if (includeTypeValues) {
        types.push(
            EastTypeType,
            StructType({ a: ArrayType(EastTypeType), b: EastTypeType, c: ArrayType(EastTypeType) }),
        );
    }

    // Add function types if enabled
    if (includeFunctions) {
        types.push(
            // Simple function
            FunctionType([IntegerType], StringType),
            // Function with multiple args
            FunctionType([IntegerType, StringType], BooleanType),
            // Random function types
            randomFunctionType(),
            randomFunctionType(),
        );
    }

    return types;
}

/**
 * Generate fuzz test cases with random types and values.
 *
 * This function generates random East types and corresponding sample values
 * for testing patch operations. It handles recursive types gracefully by
 * retrying value generation when max recursion depth is exceeded.
 *
 * @param options Configuration options
 * @returns Array of test cases
 */
export function generateFuzzTestCases(options: FuzzTestOptions = {}): FuzzTestCase[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    // Reseed at entry so the corpus reproduces regardless of what consumed
    // the stream earlier in the process.
    seedFuzz(opts.seed);
    const testCases: FuzzTestCase[] = [];
    const seenTypes = new Set<string>();

    // Helper to try adding a type to test cases
    const tryAddType = (type: EastType): boolean => {
        const typeName = printType(type);

        // Skip duplicates
        if (seenTypes.has(typeName)) {
            return false;
        }

        try {
            const genValue = randomValueFor(type, { maxDepth: opts.valueDepth });

            // Helper to safely generate a value (retry on depth exceeded)
            const safeGenValue = (): any => {
                for (let retry = 0; retry < opts.maxValueRetries; retry++) {
                    try {
                        return genValue();
                    } catch (e) {
                        if ((e as Error).message?.includes("max recursion depth")) {
                            continue;
                        }
                        throw e;
                    }
                }
                throw new Error("max recursion depth");
            };

            // Generate value pairs
            const pairs: Array<{ before: any; after: any }> = [];
            for (let j = 0; j < opts.numSamples; j++) {
                pairs.push({ before: safeGenValue(), after: safeGenValue() });
            }

            // Generate triplets for compose tests
            const triplets: Array<{ v1: any; v2: any; v3: any }> = [];
            for (let j = 0; j < opts.numSamples; j++) {
                triplets.push({ v1: safeGenValue(), v2: safeGenValue(), v3: safeGenValue() });
            }

            // Create array types for East runtime iteration
            const pairsArrayType = ArrayType(StructType({ before: type, after: type }));
            const tripletsArrayType = ArrayType(StructType({ v1: type, v2: type, v3: type }));

            // The reference patch values and their bytes, for the runtimes
            // to match byte for byte.
            const patchType = PatchType(type);
            const diff = diffFor(type);
            const invert = invertFor(type);
            const compose = composeFor(type);
            const encode = encodeBeast2For(patchType);
            const hex = (patch: any) => `0x${Buffer.from(encode(patch)).toString("hex")}`;
            const diffs = pairs.map(({ before, after }) => diff(before, after));
            const diffHex = diffs.map(hex);
            const invertHex = diffs.map((patch) => hex(invert(patch)));
            const composed = triplets.map(({ v1, v2, v3 }) => compose(diff(v1, v2), diff(v2, v3)));

            seenTypes.add(typeName);
            testCases.push({
                type,
                typeName,
                fingerprint: typeFingerprint(type),
                pairsArrayType,
                tripletsArrayType,
                pairs,
                triplets,
                diffHex,
                invertHex,
                composedArrayType: ArrayType(patchType),
                composed,
            });
            return true;
        } catch (e) {
            // Skip types that fail to generate values
            if ((e as Error).message?.includes("max recursion depth")) {
                return false;
            }
            throw e;
        }
    };

    // First, add diverse types to ensure coverage
    if (opts.ensureDiversity) {
        const diverseTypes = getDiverseTypes(opts.includeRecursive, opts.includeFunctions, opts.nestedRecursive, opts.includeTypeValues);
        for (const type of diverseTypes) {
            if (testCases.length >= opts.numTypes) break;
            tryAddType(type);
        }
    }

    // Fill remaining slots with random types
    let attempts = 0;
    const maxAttempts = opts.numTypes * opts.attemptsMultiplier;

    while (testCases.length < opts.numTypes && attempts < maxAttempts) {
        attempts++;

        // Generate a random type
        const type = randomType(0, {
            includeRecursive: opts.includeRecursive,
            includeFunctions: opts.includeFunctions,
            nestedRecursive: opts.nestedRecursive,
            includeTypeValues: opts.includeTypeValues,
        });

        tryAddType(type);
    }

    return testCases;
}
