# Design: WASM Backend for East UI

## Problem

East UI decodes beast2 data values using the TypeScript beast2 decoder
(`decodeBeast2For`). This decoder:
1. Is broken for complex recursive types (trailing bytes errors)
2. Is slower than the C decoder for large values with closures
3. Runs in the browser's JS thread, blocking rendering

## Solution

Replace `decodeBeast2For()` calls with `east-c-wasm`'s `decodeBeast2()` which
uses the C beast2 decoder + direct memory bridge. This is faster (75ms vs 309ms
for the UI benchmark), handles all types correctly, and is already built.

## east-c-wasm API

The `@elaraai/east-c-wasm` package (v0.1.1-beta) exposes a high-level
`EastWasm` interface and platform-specific loaders:

### Entry points

| Export path | Usage | Loader |
|-------------|-------|--------|
| `@elaraai/east-c-wasm` | Node.js | `createEastWasm(options?)` |
| `@elaraai/east-c-wasm/browser` | Browser | `createEastWasmBrowser({ wasmUrl, glueUrl? })` |
| `@elaraai/east-c-wasm/common` | Platform-agnostic core | `createEastWasmFromModule(mod, state?)` |
| `@elaraai/east-c-wasm/east-c.wasm` | Raw WASM binary (~598KB) | — |
| `@elaraai/east-c-wasm/glue` | Emscripten glue JS | — |

### EastWasm interface

```typescript
interface EastWasm {
    /** Compile East IR from Beast2-full encoded bytes. */
    compileFromBeast2(bytes: Uint8Array, platform?: PlatformFunction[]): CompiledFunction;

    /** Compile East IR from JSON bytes. */
    compileFromJson(json: Uint8Array, platform?: PlatformFunction[]): CompiledFunction;

    /** Compile East IR from East text format. */
    compileFromEast(text: string, platform?: PlatformFunction[]): CompiledFunction;

    /** Decode a beast2 data value (any type) — no IR, no compilation.
     *  Pass platform functions if the value contains closures that call them. */
    decodeBeast2(bytes: Uint8Array, platform?: PlatformFunction[]): unknown;

    /** Run garbage collection on the WASM heap. */
    gc(): void;
}

interface CompiledFunction {
    (...args: unknown[]): unknown;
    free(): void;  // Release WASM handle
}
```

### Browser loader

```typescript
import { createEastWasmBrowser } from '@elaraai/east-c-wasm/browser';

const wasm = await createEastWasmBrowser({ wasmUrl: '/path/to/east-c.wasm' });
```

The browser loader requires a URL to the WASM binary. The glue JS URL is
inferred from `wasmUrl` by replacing `.wasm` with `.js`, or can be provided
explicitly via `glueUrl`.

### Value representation (direct memory bridge)

`decodeBeast2()` reads `EastValue*` pointers directly from WASM memory via
per-kind accessor functions (`_east_wasm_value_kind`, `_east_wasm_get_bool`,
`_east_wasm_array_get`, etc.) — no intermediate beast2 re-encoding. Returned
JS values:

| East type | JS representation |
|-----------|-------------------|
| Null | `null` |
| Boolean | `boolean` |
| Integer | `BigInt` |
| Float | `number` |
| String | `string` |
| DateTime | `Date` |
| Blob | `Uint8Array` |
| Array | `Array` |
| Set | `SortedSet` (from `@elaraai/east/internal`) |
| Dict | `SortedMap` (from `@elaraai/east/internal`) |
| Struct | `{ field: value }` plain object |
| Variant | `variant(tag, value)` — branded with `variant_symbol` |
| Ref | unwrapped inner value |
| Vector | `Float64Array` / `BigInt64Array` (copied from WASM heap) |
| Matrix | `{ rows, cols, data: Float64Array }` |
| Function | callable JS wrapper (invokes WASM handle) |

These are compatible with `match()`, `EastChakraComponent`, and all
existing rendering code.

### Platform function bridge

Platform functions (State, Dataset, Overlay) are registered with the WASM
module and called back from C via a packed binary protocol:

```
[count:u32le][len1:u32le][data1][len2:u32le][data2]...
```

Function-valued arguments use a sentinel (`0xFFFFFFFF`) followed by a handle ID
and type bytes. The bridge creates callable JS wrappers around WASM function
handles, enabling closures in decoded data to call back into the C runtime.

## Integration Points

There are **3 places** that decode beast2 data values in east-ui:

### 1. `useDatasetPreview` hook (e3-ui-components)

**File:** `packages/e3-ui-components/src/hooks/useDatasetPreview.ts:160`

**Current:**
```typescript
const decoder = decodeBeast2For(status.type, {
    platform: platformImplementations,
    skipTypeCheck: true,
});
const value = decoder(raw);
```

**Proposed:**
```typescript
const value = wasm.decodeBeast2(raw, platformImplementations);
```

The `status.type` parameter is no longer needed — beast2 v2 includes the type
table, making the format self-describing. The `skipTypeCheck` option is
irrelevant since the C decoder validates types structurally during decode.

### 2. State platform — `state_read` (east-ui-components)

**File:** `packages/east-ui-components/src/platform/state-runtime.ts:171`

**Current:**
```typescript
const decode = decodeBeast2For(type)
const ret = getStore().read(key as string);
return decode(ret);
```

**Proposed:**
```typescript
const ret = getStore().read(key as string);
return wasm.decodeBeast2(ret);
```

State values are beast2-encoded blobs stored in the UIStore. The type is
known but `decodeBeast2` doesn't need it — the beast2 header contains the type.

### 3. ReactiveDataset platform — `reactive_dataset_get` (east-ui-components)

**File:** `packages/east-ui-components/src/platform/dataset-runtime.ts:250`

**Current:**
```typescript
const decode = decodeBeast2For(type);
return decode(cached);
```

**Proposed:**
```typescript
return wasm.decodeBeast2(cached);
```

Same pattern — cached beast2 bytes decoded on read.

## WASM Lifecycle

### Singleton initialization

```typescript
// New file: packages/east-ui-components/src/platform/wasm.ts

import type { EastWasm } from '@elaraai/east-c-wasm';

let instance: EastWasm | null = null;
let initPromise: Promise<EastWasm | null> | null = null;
let failed = false;

export async function getWasm(): Promise<EastWasm | null> {
    if (failed) return null;
    if (instance) return instance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const { createEastWasmBrowser } = await import('@elaraai/east-c-wasm/browser');
            instance = await createEastWasmBrowser({
                wasmUrl: getWasmUrl(),
            });
            return instance;
        } catch {
            failed = true;
            return null;
        }
    })();

    return initPromise;
}

export function getWasmSync(): EastWasm | null {
    return instance;
}

function getWasmUrl(): string {
    // Extension webview: served as extension asset via webviewUri
    // Standalone app: served from public/ or CDN
    return (window as any).__EAST_WASM_URL__ ?? './east-c.wasm';
}
```

### Hook for React components

```typescript
// In hooks.tsx or a new useWasm.ts

export function useWasm(): EastWasm | null {
    const [wasm, setWasm] = useState<EastWasm | null>(null);
    useEffect(() => {
        getWasm().then(w => setWasm(w));
    }, []);
    return wasm;
}
```

### Decode helper with fallback

```typescript
export function decodeBeast2Value(
    wasm: EastWasm | null,
    bytes: Uint8Array,
    type: EastTypeValue,
    options?: { platform?: PlatformFunction[] },
): unknown {
    if (wasm) {
        return wasm.decodeBeast2(bytes, options?.platform);
    }
    // Fallback to TS decoder
    return decodeBeast2For(type, options)(bytes);
}
```

## Dependency

`@elaraai/east-c-wasm` is an **optional peer dependency** of both
`east-ui-components` and `e3-ui-components`:

```json
{
  "peerDependencies": {
    "@elaraai/east-c-wasm": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@elaraai/east-c-wasm": {
      "optional": true
    }
  }
}
```

If not installed, the dynamic import fails, `getWasm()` returns null,
and `decodeBeast2Value` falls back to the TS decoder. No functional change.

## east-ui-extension Integration

The VS Code extension webview (`packages/east-ui-extension/`) bundles all
code into a single IIFE file via Vite. WASM integration requires:

### 1. WASM binary as extension asset

The WASM binary (~598KB) and Emscripten glue JS must be served as webview-
accessible files alongside the bundled `index.js`.

**Approach:** Copy the WASM binary and glue JS into `dist/webview/` at build
time, then serve via `webview.asWebviewUri()`:

```typescript
// src/webview/html.ts — add WASM URL as a webview global
window.__EAST_WASM_URL__ = ${JSON.stringify(`${webviewUri}/east-c.wasm`)};
```

### 2. Vite config changes

```typescript
// webview/vite.config.ts — additions:
{
    build: {
        rollupOptions: {
            // Exclude WASM-related imports from the bundle — loaded at runtime
            external: (id: string) =>
                id.startsWith('node:') ||
                id === '@elaraai/east-c-wasm/browser' ||
                id.endsWith('.wasm'),
        },
    },
}
```

The `@elaraai/east-c-wasm/browser` dynamic import uses Vite's `@vite-ignore`
comment (already present in the browser loader's `import()` call), so Vite
won't try to bundle the glue script.

### 3. Build step: copy WASM assets

```makefile
# Makefile or package.json script
build:webview:
    cd webview && pnpm run build
    cp node_modules/@elaraai/east-c-wasm/dist/wasm/east-c.wasm dist/webview/
    cp node_modules/@elaraai/east-c-wasm/dist/wasm/east-c.js dist/webview/
```

### 4. CSP already allows WASM

The extension's Content Security Policy already includes `'wasm-unsafe-eval'`:

```html
<meta http-equiv="Content-Security-Policy"
    content="... script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ...">
```

No CSP changes needed.

### 5. Webview dependency

Add `@elaraai/east-c-wasm` to the webview's `package.json`:

```json
// webview/package.json
{
  "dependencies": {
    "@elaraai/east-c-wasm": "workspace:*"
  }
}
```

And to the extension's `devDependencies` (needed for the WASM asset copy):

```json
// package.json (extension root)
{
  "devDependencies": {
    "@elaraai/east-c-wasm": "workspace:*"
  }
}
```

### 6. Extension summary

| Concern | Status |
|---------|--------|
| CSP (`wasm-unsafe-eval`) | Already present |
| WASM binary serving | Copy to `dist/webview/`, serve via `asWebviewUri()` |
| Glue JS serving | Copy alongside WASM binary |
| URL injection | `window.__EAST_WASM_URL__` global in webview HTML |
| Vite bundling | Exclude browser loader from IIFE bundle |
| Fallback | Dynamic import failure → TS decoder (unchanged behavior) |

## Browser Deployment (Standalone)

For standalone Vite/webpack apps (not the VS Code extension), the WASM binary
(`east-c.wasm`, ~598KB) and glue JS (`east-c.js`) need to be served alongside
the app bundle:

- Copy both files to `public/` in Vite
- Or serve from CDN
- Set `window.__EAST_WASM_URL__` or pass URL directly to `createEastWasmBrowser`

## Encode Path

State writes and dataset writes use `encodeBeast2For(type)(value)` to
encode JS values to beast2 bytes. This stays as-is — the TS encoder
works correctly. Only the decode path changes.

## File Changes

| File | Change |
|------|--------|
| `east-ui-components/src/platform/wasm.ts` | **New** — singleton WASM init + decode helper |
| `east-ui-components/src/platform/state-runtime.ts` | Use `decodeBeast2Value` with WASM fallback |
| `east-ui-components/src/platform/dataset-runtime.ts` | Use `decodeBeast2Value` with WASM fallback |
| `east-ui-components/src/platform/hooks.tsx` | Add `useWasm` hook, pass to components |
| `east-ui-components/package.json` | Add optional peer dep on `@elaraai/east-c-wasm` |
| `e3-ui-components/src/hooks/useDatasetPreview.ts` | Use `decodeBeast2Value` with WASM fallback |
| `e3-ui-components/package.json` | Add optional peer dep on `@elaraai/east-c-wasm` |
| `east-ui-extension/src/webview/html.ts` | Add `__EAST_WASM_URL__` global |
| `east-ui-extension/webview/vite.config.ts` | Exclude WASM browser loader from bundle |
| `east-ui-extension/webview/package.json` | Add `@elaraai/east-c-wasm` dependency |
| `east-ui-extension/package.json` | Add `@elaraai/east-c-wasm` devDependency |
| `east-ui-extension/Makefile` or build script | Copy WASM + glue to `dist/webview/` |

## What Does NOT Change

- Showcase (`EastFunction` component) — continues using JS compiler
- State encode (`state_write`) — continues using TS beast2 encoder
- Dataset encode (`reactive_dataset_set`) — continues using TS beast2 encoder
- Component rendering — unchanged, values are compatible
