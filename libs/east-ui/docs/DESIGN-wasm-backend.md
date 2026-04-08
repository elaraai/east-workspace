# Design: WASM Backend for East UI

## Problem

East UI decodes beast2 data values using the TypeScript beast2 decoder
(`decodeBeast2For`). This decoder:
1. Is broken for complex recursive types (trailing bytes errors)
2. Is slower than the C decoder for large values with closures
3. Runs in the browser's JS thread, blocking rendering

## Solution

Replace `decodeBeast2For()` calls with `east-c-wasm`'s `decodeValue()` which
uses the C beast2 decoder + direct memory bridge. This is faster (75ms vs 309ms
for the UI benchmark), handles all types correctly, and is already built.

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
const value = wasm.decodeValue(raw);
```

The `status.type` parameter is no longer needed — `decodeValue` is self-describing
(beast2 v2 includes the type table). The `platform` parameter was for function
closures in the decoded data — with the C decoder, closures are compiled
internally and returned as opaque function handles (not yet callable from JS,
but the data values around them decode correctly).

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
return wasm.decodeValue(ret);
```

State values are beast2-encoded blobs stored in the UIStore. The type is
known but `decodeValue` doesn't need it — the beast2 header contains the type.

### 3. ReactiveDataset platform — `reactive_dataset_get` (east-ui-components)

**File:** `packages/east-ui-components/src/platform/dataset-runtime.ts:250`

**Current:**
```typescript
const decode = decodeBeast2For(type);
return decode(cached);
```

**Proposed:**
```typescript
return wasm.decodeValue(cached);
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
            const { createEastWasm } = await import('@elaraai/east-c-wasm/browser');
            instance = await createEastWasm();
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
export function decodeValue(
    wasm: EastWasm | null,
    bytes: Uint8Array,
    type: EastTypeValue,
    options?: { platform?: PlatformFunction[] },
): unknown {
    if (wasm) {
        return wasm.decodeValue(bytes);
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
    "@elaraai/east-c-wasm": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "@elaraai/east-c-wasm": {
      "optional": true
    }
  }
}
```

If not installed, the dynamic import fails, `getWasm()` returns null,
and `decodeValue` falls back to the TS decoder. No functional change.

## Browser Deployment

The WASM binary (`east-c.wasm`, ~597KB) needs to be served alongside
the app bundle. Options:
- Copy to `public/` in Vite/webpack
- Serve from CDN
- `@elaraai/east-c-wasm/browser` handles loading from a URL

## Value Representation

The WASM `decodeValue` returns JS values via the direct memory bridge:
- **Variants**: `variant(tag, value)` — branded with `variant_symbol`
- **Structs**: plain `{ field: value }` objects
- **Arrays**: JS `Array`
- **Sets**: `SortedSet` (from `@elaraai/east/internal`)
- **Dicts**: `SortedMap` (from `@elaraai/east/internal`)
- **Scalars**: `BigInt`, `number`, `string`, `boolean`, `null`

These are compatible with `match()`, `EastChakraComponent`, and all
existing rendering code.

## Encode Path

State writes and dataset writes use `encodeBeast2For(type)(value)` to
encode JS values to beast2 bytes. This stays as-is — the TS encoder
works correctly. Only the decode path changes.

## File Changes

| File | Change |
|------|--------|
| `east-ui-components/src/platform/wasm.ts` | **New** — singleton WASM init + decode helper |
| `east-ui-components/src/platform/state-runtime.ts` | Use `decodeValue` with WASM fallback |
| `east-ui-components/src/platform/dataset-runtime.ts` | Use `decodeValue` with WASM fallback |
| `east-ui-components/src/platform/hooks.tsx` | Add `useWasm` hook, pass to components |
| `east-ui-components/package.json` | Add optional peer dep on `@elaraai/east-c-wasm` |
| `e3-ui-components/src/hooks/useDatasetPreview.ts` | Use `decodeValue` with WASM fallback |
| `e3-ui-components/package.json` | Add optional peer dep on `@elaraai/east-c-wasm` |

## What Does NOT Change

- Showcase (`EastFunction` component) — continues using JS compiler
- State encode (`state_write`) — continues using TS beast2 encoder
- Dataset encode (`reactive_dataset_set`) — continues using TS beast2 encoder
- Component rendering — unchanged, values are compatible
