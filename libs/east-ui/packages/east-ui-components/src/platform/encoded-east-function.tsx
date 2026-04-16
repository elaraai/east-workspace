/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useMemo } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import {
    decodeBeast2For,
    compileFunctionIR,
    IRType,
    type FunctionIR,
} from "@elaraai/east/internal";
import { EastComponent } from "./state-hooks.js";
import { getRegisteredPlatformImplementations } from "./registry.js";
import { useWasm } from "../hooks/useWasm.js";
import { EastErrorDisplay, toEastErrorInfo } from "../reactive/error-display.js";

type CompiledFunction = import("@elaraai/east-c-wasm/common").CompiledFunction;

/**
 * Props for the {@link EncodedEastFunction} component.
 */
export interface EncodedEastFunctionProps {
    /**
     * Beast2-encoded IR bytes for a zero-argument East function returning a UI
     * component.
     *
     * Typically pre-fetched by the consumer (e.g. via `fetch()`).
     */
    bytes: Uint8Array;
    /** Storage key prefix for persisting component state */
    storageKey: string;
}

/**
 * Canonical primitive for rendering a pre-encoded East UI function.
 *
 * @remarks
 * Takes Beast2-encoded IR bytes and renders the resulting UI component.
 * Uses the WASM backend ({@link useWasm}) for compilation when available,
 * falling back to the JS closure-compiler otherwise.
 *
 * {@link EastFunction} is a thin wrapper around this component — it encodes
 * its {@link EastIR} input and delegates rendering here.
 *
 * Owns the full compile + render + cleanup lifecycle, including releasing
 * WASM handles on unmount or input change.
 *
 * @example
 * ```tsx
 * const bytes = new Uint8Array(await (await fetch("example.b2")).arrayBuffer());
 * <EncodedEastFunction bytes={bytes} storageKey="example-foo" />
 * ```
 */
export function EncodedEastFunction({ bytes, storageKey }: EncodedEastFunctionProps) {
    const wasm = useWasm();

    const result = useMemo((): CompileResult => {
        const backend = wasm ? "wasm" : "ts";
        const t0 = performance.now();
        try {
            const platform = getRegisteredPlatformImplementations();
            if (wasm) {
                const wasmFn = wasm.compileFromBeast2(bytes, platform);
                // eslint-disable-next-line no-console
                console.log(`[east-compile] ${backend} ${(bytes.length / 1024).toFixed(1)}KB in ${(performance.now() - t0).toFixed(1)}ms`);
                return {
                    compiled: () => wasmFn() as ValueTypeOf<UIComponentType>,
                    wasmFn,
                    error: null,
                };
            }
            // JS fallback: decode bytes → IR → closure-compile
            const ir = decodeBeast2For(IRType)(bytes) as FunctionIR;
            const compiled = compileFunctionIR<[], ValueTypeOf<UIComponentType>>(ir, platform);
            // eslint-disable-next-line no-console
            console.log(`[east-compile] ${backend} ${(bytes.length / 1024).toFixed(1)}KB in ${(performance.now() - t0).toFixed(1)}ms`);
            return { compiled, wasmFn: null, error: null };
        } catch (err) {
            return { compiled: null, wasmFn: null, error: err };
        }
    }, [bytes, wasm]);

    // Release WASM handle on unmount or recompile
    useEffect(() => {
        const fn = result.wasmFn;
        return () => { fn?.free(); };
    }, [result]);

    if (result.error) {
        const info = toEastErrorInfo(result.error);
        return <EastErrorDisplay title="East Compilation Error" message={info.message} stack={info.stack} />;
    }

    return <EastComponent render={result.compiled!} storageKey={storageKey} />;
}

type CompileResult =
    | {
        compiled: () => ValueTypeOf<UIComponentType>;
        wasmFn: CompiledFunction | null;
        error: null;
    }
    | {
        compiled: null;
        wasmFn: null;
        error: unknown;
    };
