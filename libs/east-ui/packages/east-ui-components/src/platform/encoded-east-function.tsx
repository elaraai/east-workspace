/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
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
import { EastErrorDisplay, toEastErrorInfo } from "../reactive/error-display.js";

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
 * Takes Beast2-encoded IR bytes and renders the resulting UI component using
 * the TypeScript closure compiler.
 *
 * {@link EastFunction} is a thin wrapper around this component — it encodes
 * its {@link EastIR} input and delegates rendering here.
 *
 * @example
 * ```tsx
 * const bytes = new Uint8Array(await (await fetch("example.b2")).arrayBuffer());
 * <EncodedEastFunction bytes={bytes} storageKey="example-foo" />
 * ```
 */
export function EncodedEastFunction({ bytes, storageKey }: EncodedEastFunctionProps) {
    const result = useMemo((): CompileResult => {
        const t0 = performance.now();
        try {
            const platform = getRegisteredPlatformImplementations();
            const ir = decodeBeast2For(IRType)(bytes) as FunctionIR;
            const tDecode = performance.now();
            const compiled = compileFunctionIR<[], ValueTypeOf<UIComponentType>>(ir, platform);
            const tCompile = performance.now();
            console.log(
                `[east-fn] decode ${(bytes.length / 1024).toFixed(1)}KB in ${(tDecode - t0).toFixed(1)}ms, compile in ${(tCompile - tDecode).toFixed(1)}ms`,
            );
            return { compiled, error: null };
        } catch (err) {
            return { compiled: null, error: err };
        }
    }, [bytes]);

    if (result.error) {
        const info = toEastErrorInfo(result.error);
        return <EastErrorDisplay title="East Compilation Error" message={info.message} stack={info.stack} />;
    }

    return <EastComponent render={result.compiled!} storageKey={storageKey} />;
}

type CompileResult =
    | {
        compiled: () => ValueTypeOf<UIComponentType>;
        error: null;
    }
    | {
        compiled: null;
        error: unknown;
    };
