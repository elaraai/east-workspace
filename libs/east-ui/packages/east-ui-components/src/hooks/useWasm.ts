/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useState } from "react";
import { getWasm, getWasmSync } from "../platform/wasm.js";

type EastWasm = import("@elaraai/east-c-wasm/common").EastWasm;

/**
 * Subscribe to the WASM backend readiness.
 *
 * @remarks
 * Returns the WASM instance synchronously if it is already loaded,
 * otherwise returns null and triggers a re-render once it becomes available.
 * If WASM fails to load (or is not installed), this stays null permanently
 * and consumers should fall back to the JS path.
 *
 * @example
 * ```tsx
 * function MyComponent({ ir }) {
 *     const wasm = useWasm();
 *     const compiled = useMemo(() => {
 *         return wasm
 *             ? wasm.compileFromBeast2(encodeIR(ir), platform)
 *             : ir.compile(platform);
 *     }, [ir, wasm]);
 *     // ...
 * }
 * ```
 */
export function useWasm(): EastWasm | null {
    const [wasm, setWasm] = useState<EastWasm | null>(() => getWasmSync());
    useEffect(() => {
        if (wasm) return;
        let mounted = true;
        getWasm().then(w => { if (mounted) setWasm(w); });
        return () => { mounted = false; };
    }, [wasm]);
    return wasm;
}
