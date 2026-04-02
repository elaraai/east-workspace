/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { cpus } from "os";
import { fileURLToPath } from "url";
import { East, ArrayType, FunctionType, IntegerType, StructType, OptionType } from "@elaraai/east";
import type { PlatformFunction, EastTypeValue } from "@elaraai/east/internal";
import { EastError, EAST_IR_SYMBOL, encodeBeast2For, decodeBeast2For } from "@elaraai/east/internal";

// Import platform implementations for worker threads (avoid circular dep with index.ts)
import { ConsoleImpl } from "./console.js";
import { FileSystemImpl } from "./fs.js";
import { PathImpl } from "./path.js";
import { CryptoImpl } from "./crypto.js";
import { TimeImpl } from "./time.js";
import { FetchImpl } from "./fetch.js";
import { RandomImpl } from "./random.js";

const __filename = fileURLToPath(import.meta.url);

/** Platform functions available in worker threads */
const WorkerPlatform: PlatformFunction[] = [
    ...ConsoleImpl,
    ...FileSystemImpl,
    ...PathImpl,
    ...CryptoImpl,
    ...TimeImpl,
    ...FetchImpl,
    ...RandomImpl,
];

/**
 * Configuration options for parallel operations.
 */
export const ParallelConfigType = StructType({
    /** Number of worker threads to use. Defaults to the number of CPU cores. */
    workers: OptionType(IntegerType),
    /** Size of each chunk to process. Defaults to array.length / workers. */
    chunkSize: OptionType(IntegerType),
});

/**
 * Splits an array into chunks of the specified size.
 * @internal
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Maps a function over an array in parallel using worker threads.
 *
 * Distributes the array across multiple worker threads, applies the mapping
 * function to each element in parallel, and collects the results. This enables
 * true CPU parallelism for compute-intensive operations.
 *
 * The mapping function's IR is serialized and sent to workers, where it is
 * recompiled with the Node.js platform functions and executed.
 *
 * This is a platform function for the East language, enabling parallel
 * computation in East programs running on Node.js.
 *
 * @typeParam T - The type of elements in the input array
 * @typeParam R - The type of elements in the output array
 * @param array - The input array to map over
 * @param fn - The East function to apply to each element (T -> R)
 * @returns An array of results with the same length as the input
 *
 * @throws {EastError} When worker execution fails or function IR is unavailable
 *
 * @example
 * ```ts
 * import { East, IntegerType, ArrayType } from "@elaraai/east";
 * import { Parallel } from "@elaraai/east-node-std";
 *
 * // Define a CPU-intensive mapping function
 * const square = East.function([IntegerType], IntegerType, ($, x) => {
 *     return x.multiply(x);
 * });
 *
 * // Use parallel map to process array across multiple cores
 * const processData = East.asyncFunction([ArrayType(IntegerType)], ArrayType(IntegerType), ($, data) => {
 *     return Parallel.map([IntegerType, IntegerType], data, square);
 * });
 *
 * const compiled = await East.compileAsync(processData, Parallel.Implementation);
 * const result = await compiled([1n, 2n, 3n, 4n, 5n]);
 * // result: [1n, 4n, 9n, 16n, 25n]
 * ```
 *
 * @remarks
 * - Workers have access to all Node.js platform functions (Console, FileSystem, etc.)
 * - The number of workers defaults to the number of CPU cores
 * - For small arrays, the overhead of worker creation may exceed the parallelism benefit
 * - The mapping function must be serializable (no closures over external JavaScript variables)
 */
export const parallel_map = East.asyncGenericPlatform(
    "parallel_map",
    ["T", "R"],
    [ArrayType("T"), FunctionType(["T"], "R")],
    ArrayType("R")
);

/**
 * Node.js implementation of parallel platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable parallel operations.
 */
const ParallelImpl: PlatformFunction[] = [
    parallel_map.implement((T: EastTypeValue, R: EastTypeValue) => async (...args: unknown[]): Promise<unknown> => {
        const array = args[0] as unknown[];
        const fn = args[1] as (...inputs: unknown[]) => unknown;

        try {
            // For small arrays, just run sequentially to avoid worker overhead
            if (array.length <= 4) {
                return array.map(item => fn(item));
            }

            // Verify the function has IR attached
            const ir = (fn as any)[EAST_IR_SYMBOL];
            if (!ir) {
                throw new Error("Function does not have attached IR. Ensure you're passing an East function.");
            }

            // Build the function type and serialize using Beast2
            const fnType = FunctionType([T], R);
            const encodeFn = encodeBeast2For(fnType);
            const encodedFn = encodeFn(fn as any);

            // Serialize the input array using Beast2
            const arrayType = ArrayType(T);
            const encodeArray = encodeBeast2For(arrayType);

            const numWorkers = Math.min(cpus().length, array.length);
            const chunkSize = Math.ceil(array.length / numWorkers);
            const chunks = chunkArray(array, chunkSize);

            // Encode each chunk
            const encodedChunks = chunks.map(chunk => encodeArray(chunk));

            // Spawn workers and process chunks
            const promises = encodedChunks.map((encodedChunk, index) => {
                return new Promise<unknown[]>((resolve, reject) => {
                    const worker = new Worker(__filename, {
                        workerData: {
                            encodedChunk,
                            encodedFn,
                            inputType: T,
                            outputType: R,
                            chunkIndex: index,
                        },
                    });

                    worker.on("message", (result: unknown[]) => {
                        resolve(result);
                    });

                    worker.on("error", (err) => {
                        reject(err);
                    });

                    worker.on("exit", (code) => {
                        if (code !== 0) {
                            reject(new Error(`Worker exited with code ${code}`));
                        }
                    });
                });
            });

            // Wait for all workers and flatten results
            const results = await Promise.all(promises);
            return results.flat();
        } catch (err: any) {
            throw new EastError(`Parallel map failed: ${err.message}`, {
                location: [{ filename: "parallel_map", line: 0n, column: 0n }],
                cause: err,
            });
        }
    }),
];

/**
 * Grouped parallel execution platform functions.
 *
 * Provides parallel computation capabilities for East programs running on Node.js
 * using worker threads for true CPU parallelism.
 *
 * @example
 * ```ts
 * import { East, IntegerType, ArrayType } from "@elaraai/east";
 * import { Parallel } from "@elaraai/east-node-std";
 *
 * // Define a function to apply to each element
 * const double = East.function([IntegerType], IntegerType, ($, x) => {
 *     return x.multiply(2n);
 * });
 *
 * // Process array in parallel
 * const processArray = East.asyncFunction([ArrayType(IntegerType)], ArrayType(IntegerType), ($, arr) => {
 *     return Parallel.map([IntegerType, IntegerType], arr, double);
 * });
 *
 * const compiled = await East.compileAsync(processArray, Parallel.Implementation);
 * const result = await compiled([1n, 2n, 3n, 4n]);
 * // result: [2n, 4n, 6n, 8n]
 * ```
 */
export const Parallel = {
    /**
     * Maps a function over an array in parallel using worker threads.
     *
     * Distributes work across multiple CPU cores for compute-intensive operations.
     * The mapping function is serialized and executed in worker threads.
     *
     * @typeParam T - The type of elements in the input array
     * @typeParam R - The type of elements in the output array
     * @param typeArgs - Type arguments as `[T, R]`
     * @param array - The input array to map over
     * @param fn - The East function to apply to each element
     * @returns An array of results
     * @throws {EastError} When worker execution fails
     *
     * @example
     * ```ts
     * const square = East.function([IntegerType], IntegerType, ($, x) => x.multiply(x));
     *
     * const processData = East.asyncFunction([ArrayType(IntegerType)], ArrayType(IntegerType), ($, data) => {
     *     return Parallel.map([IntegerType, IntegerType], data, square);
     * });
     *
     * const compiled = await East.compileAsync(processData, Parallel.Implementation);
     * const result = await compiled([1n, 2n, 3n, 4n, 5n]);
     * // result: [1n, 4n, 9n, 16n, 25n]
     * ```
     */
    map: parallel_map,

    /**
     * Node.js implementation of parallel platform functions.
     *
     * Pass this to {@link East.compileAsync} to enable parallel operations.
     */
    Implementation: ParallelImpl,

    /**
     * Type definitions for parallel operations.
     */
    Types: {
        /** Configuration options for parallel operations */
        Config: ParallelConfigType,
    },
} as const;

// Export for backwards compatibility
export { ParallelImpl };

// =============================================================================
// Worker Thread Logic
// =============================================================================

/** Handles execution when this module is loaded as a worker thread. */
function runWorker(): void {
    if (!isMainThread && workerData) {
        const data = workerData as {
            encodedChunk: Uint8Array;
            encodedFn: Uint8Array;
            inputType: EastTypeValue;
            outputType: EastTypeValue;
            chunkIndex: number;
        };

        try {
            // Decode the input array chunk
            const arrayType = ArrayType(data.inputType);
            const decodeArray = decodeBeast2For(arrayType);
            const chunk = decodeArray(data.encodedChunk) as unknown[];

            // Decode and compile the function with WorkerPlatform
            const fnType = FunctionType([data.inputType], data.outputType);
            const decodeFn = decodeBeast2For(fnType, { platform: WorkerPlatform });
            const compiledFn = decodeFn(data.encodedFn) as (input: unknown) => unknown;

            // Apply the function to each item in the chunk
            const results = chunk.map(item => compiledFn(item));

            // Send results back to main thread
            parentPort?.postMessage(results);
        } catch (err: any) {
            throw new Error(`Worker ${data.chunkIndex} failed: ${err.message}`);
        }
    }
}

runWorker();
