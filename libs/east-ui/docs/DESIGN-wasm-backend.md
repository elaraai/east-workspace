# Design: Optional WASM Backend for East UI

## Problem

East UI currently compiles and executes East IR via the JavaScript compiler (`ir.compile(platform)`). For large UI programs with many closures, this is slow — the JS compiler walks the IR tree, generates closures, and executes them interpretively.

The C backend (`east-c-wasm`) compiles and executes the same IR 4-5x faster, and we've already built the infrastructure: direct beast2→IRNode decoder, WASM direct memory bridge, platform function support.

## Current Flow

```
EastIR.ir (FunctionIR)
    ↓ ir.compile([...StateImpl, ...OverlayImpl])    // JS compiler
    ↓ compiled()                                     // JS execution
    → UIComponentType value (EastVariant/EastStruct)
    ↓ <EastChakraComponent value={result} />         // React rendering
```

Entry point: `EastFunction` component in `east-ui-components/src/platform/hooks.tsx` line 245.

## Proposed Flow (WASM)

```
EastIR.ir (FunctionIR)
    ↓ encodeBeast2For(IRType)(ir)                    // Serialize IR to bytes
    ↓ wasm.compileFromBeast2(bytes, [...StateImpl, ...OverlayImpl])
    ↓ compiled()                                     // WASM execution
    → UIComponentType value (plain JS objects via direct memory bridge)
    ↓ <EastChakraComponent value={result} />         // React rendering
```

## Key Design Decisions

### 1. Optional — not required

The WASM backend is an opt-in enhancement. If `@elaraai/east-c-wasm` is not
installed or WASM initialization fails, fall back to the JS compiler silently.

### 2. Value representation compatibility

The WASM direct memory bridge returns:
- **Variants**: `{ type: string, value: unknown }` — matches `EastVariant` shape
- **Structs**: plain objects `{ field1: val1, field2: val2 }` — matches `EastStruct` shape
- **Arrays**: JS `Array` — same
- **Sets**: `SortedSet` — same as JS compiler
- **Dicts**: `SortedMap` — same as JS compiler
- **Scalars**: `BigInt`, `number`, `string`, `boolean`, `null` — same

The `EastChakraComponent` dispatcher uses `match()` which reads `.type` and
`.value` on variants — this works with both `EastVariant` instances and plain
`{ type, value }` objects.

### 3. Platform functions work transparently

`compileFromBeast2(bytes, platform)` accepts the same `PlatformFunction[]`
array as `ir.compile(platform)`. The WASM platform bridge handles JS↔C
argument marshalling. StateImpl and OverlayImpl work as-is.

### 4. IR serialization happens once

The beast2-encoded IR bytes can be memoized alongside the EastIR object —
serialize once, compile on every render as needed (the WASM compile is ~60ms
for 2.27MB IR, vs ~300ms+ for JS).

## Implementation

### New file: `east-ui-components/src/platform/wasm-backend.ts`

```typescript
import type { PlatformFunction } from "@elaraai/east/internal";
import type { EastIR } from "@elaraai/east";

/** Lazy-initialized WASM instance (singleton). */
let wasmInstance: any | null = null;
let wasmInitPromise: Promise<any> | null = null;
let wasmFailed = false;

/**
 * Try to initialize the WASM backend.  Returns the EastWasm instance
 * or null if @elaraai/east-c-wasm is not available.
 */
export async function getWasmBackend(): Promise<any | null> {
    if (wasmFailed) return null;
    if (wasmInstance) return wasmInstance;
    if (wasmInitPromise) return wasmInitPromise;

    wasmInitPromise = (async () => {
        try {
            // Dynamic import — doesn't fail at bundle time if package is missing
            const { createEastWasm } = await import("@elaraai/east-c-wasm/browser");
            wasmInstance = await createEastWasm();
            return wasmInstance;
        } catch {
            wasmFailed = true;
            return null;
        }
    })();

    return wasmInitPromise;
}

/** Cache of beast2-encoded IR bytes, keyed by EastIR reference. */
const irBytesCache = new WeakMap<EastIR<any, any>, Uint8Array>();

/**
 * Compile and execute East IR via WASM backend.
 * Returns null if WASM is not available (caller should fall back to JS).
 */
export function compileWithWasm(
    wasm: any,
    ir: EastIR<any, any>,
    platform: PlatformFunction[],
): (() => unknown) | null {
    try {
        // Get or create beast2 bytes for this IR
        let bytes = irBytesCache.get(ir);
        if (!bytes) {
            const { encodeBeast2For } = require("@elaraai/east/internal");
            const { IRType } = require("@elaraai/east/internal");
            bytes = encodeBeast2For(IRType)(ir.ir);
            irBytesCache.set(ir, bytes);
        }

        const compiled = wasm.compileFromBeast2(bytes, platform);
        return compiled;
    } catch {
        return null;
    }
}
```

### Modified: `east-ui-components/src/platform/hooks.tsx`

```typescript
// Add WASM backend support
import { getWasmBackend, compileWithWasm } from "./wasm-backend.js";

export function EastFunction({ ir, storageKey, backend }: EastFunctionProps) {
    // Try WASM backend if requested or available
    const [wasm, setWasm] = useState<any>(null);

    useEffect(() => {
        if (backend !== 'js') {
            getWasmBackend().then(w => setWasm(w));
        }
    }, [backend]);

    const result = useMemo(() => {
        try {
            const platform = [...StateImpl, ...OverlayImpl];

            // Try WASM first
            if (wasm) {
                const compiled = compileWithWasm(wasm, ir, platform);
                if (compiled) {
                    return { compiled, error: null };
                }
            }

            // Fall back to JS
            return { compiled: ir.compile(platform), error: null };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorStack = err instanceof Error ? err.stack : undefined;
            return { compiled: null, error: { message: errorMessage, stack: errorStack } };
        }
    }, [ir, wasm]);

    // ... rest unchanged
}
```

### Props extension

```typescript
export interface EastFunctionProps {
    ir: EastIR<[], any>;
    storageKey?: string;
    /** Execution backend: 'auto' (default) tries WASM then JS, 'js' forces JS only */
    backend?: 'auto' | 'js' | 'wasm';
}
```

## Variant/Struct Compatibility

The `EastChakraComponent` dispatcher in `component.tsx` uses `match()` from
`@elaraai/east` to dispatch on variant tags. This function checks the `.type`
property of the value, which works for both `EastVariant` instances and plain
objects with a `type` field.

Similarly, struct field access uses `value.fieldName` which works for both
`EastStruct` instances (which support `[]` access) and plain objects.

**Potential issue:** If `match()` uses `instanceof EastVariant` checks instead
of duck-typing, the WASM bridge's plain `{ type, value }` objects would fail.
Need to verify `match()` implementation.

## Dependencies

`@elaraai/east-c-wasm` would be an **optional peer dependency** of
`east-ui-components`:

```json
{
  "peerDependencies": {
    "@elaraai/east-c-wasm": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "@elaraai/east-c-wasm": {
      "optional": true
    }
  }
}
```

This way:
- If the package is installed, WASM backend is available
- If not installed, the dynamic import fails gracefully, JS backend is used
- No bundle size impact if WASM is not used

## Browser vs Node

`east-c-wasm` has two entry points:
- `@elaraai/east-c-wasm` — Node.js (loads .wasm from filesystem)
- `@elaraai/east-c-wasm/browser` — Browser (loads .wasm from URL)

east-ui-components runs in the browser, so it uses the `/browser` entry point.
The WASM file needs to be served alongside the app bundle (e.g., copied to
`public/` in Vite, or served from a CDN).

## Verification

1. `east-ui-showcase` with WASM: all pages render correctly
2. `east-ui-showcase` without WASM: falls back to JS, same behavior
3. State platform functions work: state persistence, reactive updates
4. Performance: compare JS vs WASM compile+execute times in showcase
