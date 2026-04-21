# Design: Per-Decode Platform Contexts in east-c-wasm

## Problem

The WASM bridge has a **single global platform registry** on both sides:

- C side: `g_platform` (one `PlatformRegistry`, set up at WASM init).
- JS side: `platformFns: Map<string, PlatformRegistration>` (one map per WASM instance).

`ensurePlatformRegistered` skips re-registration when a name is already present:

```ts
for (const reg of buildPlatformRegistrations(platform, ctx)) {
    if (platformFns.has(reg.name)) continue;   // ← bug
    registerPlatform(reg);
}
```

When a JS caller passes a different impl for the same platform fn name in a subsequent `decodeBeast2(bytes, platform)` call, the new impl is silently ignored. The first registration wins, forever (per WASM-instance lifetime).

This breaks **manifest-scoped platform impls** like `Data.bind`, where each UI task supplies a different scoped impl. Switching tasks in the VS Code extension produces:

```
East Render Error
Data.bind: path "inputs.threshold" not declared in manifest
allowed: ['inputs.count']        ← previous task's manifest, stuck in the registry
```

This is **not how other runtimes work**. The TS, native C, and Python runtimes all keep platform impls scoped to a single compile/decode call — never sharing across calls.

## How other runtimes do it

### TypeScript (`libs/east/src/serialization/beast2/index.ts`)

`decodeBeast2For(type, options)` (line 730) captures `platform` / `platformFns` / `asyncPlatformFns` at factory time:

```ts
const platformFns = Object.fromEntries(platform.map(fn => [fn.name, fn.fn]));
```

Each decode call builds a fresh `DecodeContext` carrying these (line 749). The function decoder (line 384) calls:

```ts
compile_internal(ir, typeContext, ctx.platformFns, ctx.asyncPlatformFns, ctx.platform, ...)
```

The compiled JS function **lexically captures** `ctx.platformFns` via closure. When IR_PLATFORM fires at runtime, it does `platformFns[name](args)` — name-keyed lookup in the lexically-captured per-decode map.

Two decodes with two different `platform` arrays produce two closures with two different captured maps. **No global state. No collision.**

The TS impl additionally attaches three symbols to each compiled fn (line 397-402):

```ts
Object.defineProperty(fn, EAST_IR_SYMBOL,        { value: ir });
Object.defineProperty(fn, EAST_CAPTURES_SYMBOL,  { value: captureContext });
Object.defineProperty(fn, EAST_SOURCE_MAP_SYMBOL,{ value: ctx.sourceMap });
```

These symbols carry round-trip metadata (so the encoder can re-emit the IR + captures). Dispatch goes through lexical closure, not symbols.

### Native C runtime

`east_compile(ir, platform, builtins)` stores `fn->platform = platform` on the resulting `EastCompiledFn`. Different compiles → different `fn->platform` pointers. `eval_ir` reads `fn->platform` at IR_PLATFORM eval (`compiler.c:613`).

The platform is **per-fn, captured at compile time** — same property as TS's lexical closure, just realized via a struct field instead of a JS closure.

## Proposed Design

Replicate the TS/C-runtime per-call platform pattern in the WASM bridge, using:

1. **A refcounted C-side `PlatformRegistry` per decode/compile call** — the WASM analog of "lexical capture".
2. **A JS-side `JsPlatformContext` per decode/compile call** — the analog of TS's `DecodeContext`.
3. **A `Symbol` attached to every JS-side wrapper around a wasm fn** — the analog of TS's `EAST_IR_SYMBOL` / `EAST_CAPTURES_SYMBOL`. Carries the platform context.
4. **A JS-side context stack** — what reads top-of-stack at every bridge call to dispatch.
5. **A single C-side thread-local `current_platform` (already exists)** — the C-side equivalent stack.

### Architecture

```
JS side                                              C/WASM side
═══════                                              ═══════════

const EAST_PLATFORM_CTX_SYMBOL = Symbol.for('east.wasm.platformContext');
const contextStack: JsPlatformContext[] = [];

decodeBeast2(bytes, platform)                        ┌── PlatformRegistry (refcounted)
   │                                                  │     - functions, generic_functions
   │  ctx = newContext(platform):                     │     - trampolines (per-registry)
   │    { regPtr, impls, handleTable, invokeBufs }    │     - on_free callback
   │  pushContext(ctx)                                 │
   │  mod._east_wasm_decode_value_in_ctx(             │
   │       bytes, ctx.regPtr) ─────────────────────────┼── east_set_thread_context(reg)
   │                                                   │   east_beast2_decode_auto walks bytes
   │                                                   │   each EastCompiledFn captures
   │                                                   │     fn->platform = retain(reg)
   │                                                   │   east_set_thread_context(prev)
   │  result_ptr ◄─────────────────────────────────────┤   returns root EastValue*
   │  readValueFromPtr(result_ptr):                    │
   │     case 15 (FUNCTION):                           │
   │       wrapper = (...args) => { ... }              │
   │       wrapper[EAST_PLATFORM_CTX_SYMBOL] = ctx     │
   │       wrapper[EAST_WASM_HANDLE_SYMBOL] = handleId │
   │  popContext()                                      │
   │  ctx_release (drops our initial ref;              │
   │   any wasm fn keeps it alive via fn->platform)    │
   │                                                    │
JS calls wrapper(arg1, arg2):                          │
   │  contextStack.push(wrapper[EAST_PLATFORM_CTX_SYMBOL])
   │  try {                                             │
   │    mod._east_wasm_invoke_fn_ptr(handle, ...) ─────┼── east_call(fn, args)
   │                                                    │     sets current_platform = fn->platform
   │                                                    │     evaluates IR
   │                                                    │     IR_PLATFORM "data_bind" fires
   │  bridge call ◄─────────────────────────────────────┤     calls js_platform_call(name, ...)
   │  ctx = contextStack[contextStack.length - 1]       │
   │  ctx.impls.get(name)(args)                         │
   │  ──── result ─────────────────────────────────────┼─→ continues IR eval
   │  } finally { contextStack.pop() }                  │
```

### Two stacks, one for each runtime, isomorphic

| Stack | Where | Push at | Pop at | Read at |
|---|---|---|---|---|
| C-side `current_platform` | `compiler.c:1215` thread-local | `east_call` entry | `east_call` exit | IR_PLATFORM eval, value_decode |
| JS-side `contextStack` | `common.ts` module-level | wasm-fn wrapper invocation | wrapper return | `js_platform_call` bridge body |

**Invariant**: at any point during a wasm call, `contextStack` top corresponds to the same context that `current_platform` points to. Both stacks rebuild on every cross-runtime hop. Re-entrancy works naturally.

### Why symbols on wrappers

Three reasons, each independently sufficient:

1. **Idiomatic with the TS reference impl.** TS attaches `EAST_IR_SYMBOL` / `EAST_CAPTURES_SYMBOL` on JS-compiled fns for round-trip; we attach `EAST_PLATFORM_CTX_SYMBOL` / `EAST_WASM_HANDLE_SYMBOL` on JS wrappers around wasm fns for context propagation + round-trip. Same pattern, applied symmetrically.

2. **Identity is the symbol.** No numeric ID space to manage. No `Map<id, ctx>` lookup at every bridge call. The symbol IS the reference. `wrapper[SYMBOL]` is O(1) property access.

3. **Round-trip stays open.** A wrapper can be passed to another wasm fn (as a callback arg). The receiving wasm fn unwraps via `_east_wasm_invoke_fn` using the wasm handle. The `EAST_PLATFORM_CTX_SYMBOL` lets future code recover the context if needed.

### Why a JS-side stack for dispatch (instead of an EM_JS `ctx_id` parameter)

| `(ctx_id, name)` design (rejected) | Symbol + stack (chosen) |
|---|---|
| Add `ctx_id` param to `js_platform_call`, `js_invoke_handle`, `js_release_handle` EM_JS sigs | EM_JS signatures unchanged |
| `Map<ctx_id, ctx>` lookup at every bridge call | `contextStack[contextStack.length - 1]` — O(1) read |
| C-side `PlatformRegistry` carries `ctx_id u32` field | C-side registry needs no extra fields for dispatch |
| New u32 ID space to manage (alloc, free, collision) | No IDs |
| Extra param threaded through every C-side bridge call | Bridge stays opaque |

The stack design exploits a property the `(ctx_id, name)` design didn't: **the JS side already controls every entry into the wasm runtime via wrapper functions**. Whichever wrapper is on top of the call stack is the one whose context applies. We just make that stack explicit on the JS side.

### Key data structures

#### C side

```c
// libs/east-c/include/east/platform.h
struct PlatformRegistry {
    HashMap *functions;
    HashMap *generic_functions;
    PlatformPreCallHook pre_call;
    int ref_count;                                // atomic, initial 1
    PlatformTrampoline *trampolines[256];         // moved from g_trampolines
    PlatformTrampoline *current_trampoline;       // moved from g_current_trampoline
    void (*on_free)(struct PlatformRegistry *self);  // hook before free
};

void platform_registry_retain(PlatformRegistry *reg);
void platform_registry_release(PlatformRegistry *reg);   // calls on_free + free at refcount 0
```

#### JS side

```ts
// libs/east-c-wasm/src/common.ts
export const EAST_PLATFORM_CTX_SYMBOL = Symbol.for('east.wasm.platformContext');
export const EAST_WASM_HANDLE_SYMBOL  = Symbol.for('east.wasm.handle');

export interface JsPlatformContext {
    regPtr: number;                              // C-side PlatformRegistry*
    impls: Map<string, PlatformRegistration>;
    handleTable: JsHandleTable;                  // per-context JS callback handles
    invokeBufs: {
        resultBufPtr: number; errorBufPtr: number;
        resultLenPtr: number; errorLenPtr: number;
    };
}

const contextStack: JsPlatformContext[] = [];                  // single-threaded WASM
const contextByRegPtr = new Map<number, JsPlatformContext>();  // for the C→JS release callback
```

### EM_JS signatures stay unchanged

The bridge dispatches by reading `contextStack[contextStack.length - 1]`. EM_JS imports keep their current signatures:

```c
EM_JS(int, js_platform_call,  (const char *name, ..., uint8_t *out, size_t *out_len), { ... });
EM_JS(int, js_invoke_handle,  (uint32_t hid, ..., uint8_t *out, size_t *out_len), { ... });
EM_JS(void, js_release_handle, (uint32_t hid), { ... });
```

**One new EM_JS import** — the C→JS release callback:

```c
EM_JS(void, js_release_context, (uintptr_t reg_ptr), {
    if (Module.js_release_context) Module.js_release_context(reg_ptr);
});
```

Fired by `platform_registry_free` when refcount reaches 0.

### New WASM exports

```c
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_context_new(void);
EMSCRIPTEN_KEEPALIVE void      east_wasm_context_release(uintptr_t reg_ptr);
EMSCRIPTEN_KEEPALIVE void      east_wasm_context_register(
                                   uintptr_t reg_ptr,
                                   const char *name,
                                   int is_generic, int is_async);

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_decode_value_in_ctx(
                                   const uint8_t *data, size_t len,
                                   uintptr_t reg_ptr,
                                   char *err_buf, size_t *err_len);

EMSCRIPTEN_KEEPALIVE uint32_t  east_wasm_compile_in_ctx(
                                   const uint8_t *ir_bytes, size_t ir_len,
                                   uintptr_t reg_ptr);
```

### Wrapper sites that push/pop context

The JS side has exactly three wrapper-construction sites. All three must be updated:

| Site | File:Line | Change |
|---|---|---|
| `wrapHandle` (callable returned by `compileFromBeast2`) | `common.ts:528` | Capture `ctx`, attach symbols, push/pop around invoke |
| `readValueFromPtr` case 15 (wasm fn returned to JS as callable) | `common.ts:494` | Same |
| `createFnHandleWrapper` (incoming wasm-fn args to JS callbacks) | `common.ts:791` | Same |

All three currently produce a wrapper closure. The change is uniform: capture `ctx` from `currentContext()` (or pass it in), attach `EAST_PLATFORM_CTX_SYMBOL`, push/pop around the wasm call.

### Lifetime

Two ref-holders:

1. **C-side `PlatformRegistry.ref_count`** — atomic int.
   - Initial refcount = 1, set when `_east_wasm_context_new()` returns.
   - Each `EastCompiledFn.platform = retain(reg)` adds 1.
   - `east_compiled_fn_free` releases.
   - When refcount → 0: `platform_registry_free` runs C cleanup, then fires `on_free(reg)` which calls `js_release_context(reg_ptr)`.

2. **JS-side `contextByRegPtr` Map** — holds the per-context buffers + handle table.
   - Inserted by `newContext`.
   - Removed (and buffers `_free`d) by `jsReleaseContext` callback wired to `Module.js_release_context`.

#### `decodeBeast2(bytes, platform)` flow

1. `newContext(platform)` → C registry refcount = 1, JS context inserted, all platform fns registered with the C-side registry via `_east_wasm_context_register`.
2. `pushContext(ctx)` so the bridge can dispatch during decode (some impls may fire during decode, e.g. `Data.bind` reads).
3. `mod._east_wasm_decode_value_in_ctx(...)` returns root EastValue ptr. During decode, every EastCompiledFn captures `fn->platform = retain(reg)` (refcount goes up).
4. `readValueFromPtr` walks the result. Case 15 attaches `EAST_PLATFORM_CTX_SYMBOL = ctx` and `EAST_WASM_HANDLE_SYMBOL = handleId` to every wasm-fn wrapper.
5. `popContext()` and `_east_wasm_context_release(ctx.regPtr)` — drop our initial refcount = 1.
6. If any wasm fn captured the registry (via `fn->platform`), the C-side retains keep it alive. JS context entry stays. Wrappers are returned, callable.

#### When user drops references

7. React unmounts the UI tree → wrappers GC'd.
8. Wasm value handles get released (via `_east_wasm_value_release` or `fn.free()`).
9. Each `EastCompiledFn` destructor runs → releases `fn->platform`.
10. Last release → registry refcount → 0 → `platform_registry_free` → `on_free` → `js_release_context(regPtr)` → JS-side cleanup (`_free` buffers, delete from map).

#### Re-entrancy

When the bridge fires a JS impl that calls back into wasm (via another wrapper):
- Inner wrapper pushes its own context.
- Bridge for the inner call reads top-of-stack → inner ctx.
- On return, pop restores outer ctx.
- C-side `current_platform` thread-local does the same dance via `east_call`'s save/restore.
- Both stacks pop in lockstep. No leaks, no cross-talk.

### Three concrete refinements from auditing existing code

#### 1. `g_trampolines` table moves into `PlatformRegistry`

`wasm_api.c:111` has a global hash bucket table mapping `(name, type_params) → PlatformTrampoline`. Trampolines are set by `wasm_platform_pre_call` (line 617), which is registered as the `PlatformRegistry::pre_call` hook. With multiple registries coexisting, each fires its OWN pre_call hook, but they'd all write to the same global bucket table — pollution.

**Fix**: trampoline tables become per-registry (`reg->trampolines[256]`). `wasm_platform_pre_call` reads `current_platform()->trampolines`.

#### 2. `_handleResolver.invokeBufs` becomes per-context

`common.ts:206` has `_handleResolver` as a module-level singleton holding `invokeBufs` (result + error WASM ptrs). `createFnHandleWrapper` (line 791) uses these buffers when JS-side wrappers invoke wasm fns. With re-entrancy, two wrapper invocations could write to the same buffer.

**Fix**: per-context buffers, allocated in `newContext`, freed in `jsReleaseContext`. `createFnHandleWrapper` reads from the wrapper's captured context.

#### 3. Defensive thread-context save/restore

`east_wasm_decode_value` currently calls `east_set_thread_context(g_platform, g_builtins)` once but never restores. WASM is single-threaded so this is benign today, but per-context APIs must save+restore so nested operations don't capture a stale registry.

**Fix**: `_in_ctx` variants save → set → work → restore.

### What goes away

- `g_platform` global on C side — removed.
- `platformFns: Map<string, PlatformRegistration>` JS-side global — replaced by per-context `ctx.impls`.
- `_handleResolver` JS-side singleton — replaced by per-context `ctx.invokeBufs`.
- `ensurePlatformRegistered` "register-once-skip-if-exists" check — gone.
- `g_trampolines[256]` global table on C side — moved into `PlatformRegistry`.

### What stays the same

- `EastCompiledFn` invoke hook (added in prior PR for JS-callback bridge).
- `JsHandleTable` data structure (now lives per-context instead of singleton).
- `writeValueToPtr` / `readValueFromPtr` walking logic.
- Beast2 wire format. **Zero changes.**
- Public `decodeBeast2(bytes, platform)` / `compileFromBeast2(bytes, platform)` signatures.
- All 38 existing tests.

## Cleanup pass — code that becomes redundant

The previous bidirectional handle bridge fix added a lot of singleton/global plumbing to work around the absence of per-context contexts. With per-context in place, much of that code is dead or simplifiable. **Implementation must include this cleanup as part of the same PR** — leaving dead code around invites future bugs.

### Removed outright

| Code | Where | Reason |
|---|---|---|
| Module-level `_handleResolver` singleton + `setHandleResolver` export | `common.ts:197-213`; called from `index.ts` and `browser.ts` | Per-context `invokeBufs` replaces it |
| Module-level `platformFns: Map<string, PlatformRegistration>` | `createEastWasmFromModule` in `common.ts` | Per-context `ctx.impls` replaces it |
| `genericCache: Map<string, PlatformFn>` (sibling to `platformFns`) | Same | Per-context (lives inside `ctx.impls` registrations) |
| `ensurePlatformRegistered` "register-once-skip-if-exists" check | `common.ts:396-402` | Each `decodeBeast2` allocates a fresh ctx; no skip needed |
| `getRegisteredPlatformImplementations` JS function | `east-ui-components/src/platform/registry.ts` | Dead — no global registry to read |
| Module-load `registerPlatformImplementation(StateImpl)` side-effect | `state-runtime.ts:122` | Each decode passes platform; no module-load registration needed |
| Module-load `registerPlatformImplementation(ReactiveDatasetPlatform)` side-effect | `dataset-runtime.ts` (added during this session) | Same — irrelevant when per-decode |
| `"sideEffects": ["./dist/.../state-runtime.js", ...]` package.json gymnastics | `east-ui-components/package.json`, `e3-ui-components/package.json` | Restore `"sideEffects": false` — the tree-shaking fight is over |
| C-side `g_platform` global registry | `wasm_api.c:24` | Per-context registries from `east_wasm_context_new` |
| C-side `g_trampolines[256]` + `g_current_trampoline` globals | `wasm_api.c:111-112` | Moved into `PlatformRegistry` struct |
| C-side `wasm_platform_pre_call` reading globals | `wasm_api.c:617` | Reads `current_platform()->trampolines` |
| Diagnostic logs added during the bug hunt: `[wasm.bridge.call]`, `[wasm.registerPlatform]`, `[registry.read]`, `[registry.register]`, `[Data.bind/scoped] manifest paths`, `[Data.bind/scoped.call] requested path` | `common.ts`, `registry.ts`, `dataset-runtime.ts` | Served their purpose. Drop or move behind a `DEBUG` flag. |

### Simplified

| Code | Before | After |
|---|---|---|
| `callJsPlatformFn` return type | `Uint8Array \| null \| { kind: 'ptr', ptr: number }` | `{ ptr: number } \| null` (always ptr — `writeValueToPtr` handles all types uniformly) |
| Bridge protocol return codes | `rc=0` (bytes) / `rc=1` (error) / `rc=2` (ptr) | `rc=0` (success+ptr) / `rc=1` (error). Drop the bytes path entirely. |
| `outputContainsFunction` discriminator | Recursive walker to choose bytes vs ptr | **Dead.** Remove. |
| `PlatformResult` union type | Tagged union | Remove. |
| `writeResultToWasm` helper (bytes-buffer fill) | Used for `rc=0` bytes path | **Dead.** Remove. |
| `g_platform_result_buf` + `g_platform_result_len` heap allocations | C-side bytes-result buffers | **Dead** if bytes path goes. Or kept only for error messages (smaller buffer). |
| `dataset-runtime.ts` `createDatasetTracker` (now a no-op stub from prior PR) | No-op shim left in for back-compat | Delete; update the one caller in `dataset-hooks.tsx` |

### Consolidated — three near-identical wrapper sites become one

Today (after the fix) there are **three** sites producing JS wrappers around wasm-side function values, with near-identical bodies (encode args, call wasm via handle, decode result):

```
wrapHandle              common.ts:528    — callable returned by compileFromBeast2
readValueFromPtr case 15 common.ts:494    — fn value returned to JS during decode
createFnHandleWrapper    common.ts:791    — incoming wasm-fn arg passed to JS callback
```

Collapse into a single helper:

```ts
function makeWasmFnWrapper(
    ctx: JsPlatformContext,
    handleId: number,
    fnType: EastTypeValue,
): (...args: unknown[]) => unknown {
    const inputEncoders = (fnType as Function).value.inputs.map(t => encodeBeast2For(t));
    const wrapper = (...args: unknown[]) => {
        pushContext(ctx);
        try {
            const packed = encodeArgsList(args.map((a, i) => inputEncoders[i]!(a)));
            const argsPtr = writeBytesToWasm(ctx.mod, packed);
            const resultPtr = ctx.mod._east_wasm_invoke_fn_ptr(
                handleId, argsPtr, packed.length,
                ctx.invokeBufs.errorBufPtr, ctx.invokeBufs.errorLenPtr,
            );
            ctx.mod._free(argsPtr);
            if (resultPtr === 0) throw new Error(readError(ctx));
            const result = readValueFromPtr(ctx, resultPtr);
            ctx.mod._east_wasm_value_release(resultPtr);
            return result;
        } finally { popContext(); }
    };
    Object.defineProperty(wrapper, EAST_PLATFORM_CTX_SYMBOL, { value: ctx, enumerable: false });
    Object.defineProperty(wrapper, EAST_WASM_HANDLE_SYMBOL,  { value: handleId, enumerable: false });
    return wrapper;
}
```

All three sites reduce to a single call. **~150 lines of near-duplicate code → ~50 lines.**

### Consolidated — `callJsPlatformFn` and `js_invoke_handle` bridges merge

Today they have separate code paths but identical structure (decode args, call JS impl, build result via `writeValueToPtr`). Single `dispatchJsImpl(ctx, name?, handleId?, argsBytes)` helper:

```ts
function dispatchJsImpl(
    ctx: JsPlatformContext,
    impl: (...a: unknown[]) => unknown,
    inputTypes: EastTypeValue[],
    outputType: EastTypeValue,
    argsBytes: Uint8Array,
    outPtrSlot: number,
): number {
    const args = decodeArgs(argsBytes, inputTypes, ctx);
    let result: unknown;
    try { result = impl(...args); }
    catch (e) { writeErr(ctx, e); return 1; }
    if (outputType.type === 'Null' || result == null) return 0;
    const ptr = writeValueToPtr(ctx, result, outputType);
    ctx.mod.HEAPU32[outPtrSlot >> 2] = ptr;
    return 0;
}
```

`createPlatformBridge` and `createJsInvokeHandleBridge` shrink to thin name-resolvers / handle-resolvers around this helper.

### Net code delta after cleanup

| | Lines |
|---|---|
| Removed (singletons, skip-checks, dead branches, side-effect workarounds, diagnostic logs) | ~280 |
| Consolidated (3 wrapper sites → 1; 2 bridge fns → 1) | ~150 → ~80 (saves ~70) |
| Added (per-context plumbing per the design) | ~880 |
| Added (16 new tests) | ~300 |
| **Net code add** | **~530 + ~300 tests** |

Cleanup pays for ~30% of the new code. The codebase ends up smaller in the singleton/global surface, with a clearer ownership model.

### Cleanup acceptance criteria

After implementation, these greps must return zero hits:

```bash
# In libs/east-c-wasm/src/
grep -rn "_handleResolver"                              # singleton dead
grep -rn "ensurePlatformRegistered"                     # gone
grep -rn "writeResultToWasm"                            # dead
grep -rn "PlatformBridgeContext"                        # replaced by JsPlatformContext
grep -rn "outputContainsFunction"                       # dead
grep -rn "PlatformResult"                               # dead

# In libs/east-c/packages/east-c-wasm/src/wasm_api.c
grep -rn "g_platform[^_]"                               # global C registry gone
grep -rn "g_trampolines"                                # moved into PlatformRegistry
grep -rn "g_current_trampoline"                         # moved

# In libs/east-ui/packages/east-ui-components/
grep -rn "getRegisteredPlatformImplementations"         # dead
grep -rn "registerPlatformImplementation(StateImpl)"    # module-load side-effect gone

# In libs/east-ui/packages/{east-ui-components,e3-ui-components}/package.json
grep -rn '"sideEffects"' --include="*.json"             # restored to false
```

## Files modified

| File | Changes |
|---|---|
| `libs/east-c/include/east/platform.h` | `PlatformRegistry` gains `ref_count`, `trampolines[256]`, `current_trampoline`, `on_free`. Add `platform_registry_retain` / `platform_registry_release`. |
| `libs/east-c/src/platform.c` | Implement retain/release. `platform_registry_free` becomes inner. |
| `libs/east-c/src/compiler.c` | `fn->platform` retain/release wherever set. `east_compiled_fn_free` releases. New `east_get_thread_context` for save/restore. |
| `libs/east-c/src/serialization/beast2/value_decode.c` | Retain `fn->platform` from `east_current_platform()` (line 325). |
| `libs/east-c-wasm/src/wasm_api.c` | Remove `g_platform`. Add `east_wasm_context_*` exports. Add `*_in_ctx` decode/compile variants. `wasm_platform_pre_call` and `platform_bridge_fn` read trampolines from `current_platform()`. New `js_release_context` EM_JS import. `wasm_registry_on_free` fires it. |
| `libs/east-c-wasm/src/common.ts` | Define `EAST_PLATFORM_CTX_SYMBOL`, `EAST_WASM_HANDLE_SYMBOL`, `JsPlatformContext`, `contextStack`, `contextByRegPtr`, `currentContext`. `newContext`/`jsReleaseContext` lifecycle. Bridges (`createPlatformBridge`, `createJsInvokeHandleBridge`, `createJsReleaseHandleBridge`) read top-of-stack — no `ctx_id` param. Three wrapper sites (`wrapHandle`, `readValueFromPtr` case 15, `createFnHandleWrapper`) attach symbols and push/pop context. `decodeBeast2`/`compileFromBeast2` allocate context per call. |
| `libs/east-c-wasm/src/index.ts`, `browser.ts` | Wire `js_release_context` into `moduleOpts`. Drop the prebuilt singleton handle table (now per-context). |
| `libs/east-ui/packages/east-ui-components/src/platform/dataset-runtime.ts` | **No code change.** Manifest-scoped impls Just Work because each task's decode now gets its own context. |

## Tests

### Top-priority regression (the user's bug)

Goes from RED → GREEN.

```ts
test('switching tasks with different manifest-scoped impls works in any order', async () => {
    const wasm = await createEastWasm();

    const myBind = East.genericPlatform('myBind', ['T'], [StringType],
        StructType({ read: FunctionType([], 'T') }));

    const makeImpl = (allowed: string[]) => [
        myBind.implement((_t) => (key: unknown) => {
            const k = key as string;
            if (!allowed.includes(k)) throw new Error(`path "${k}" not declared`);
            return { read: () => 42n };
        }),
    ];

    const irFor = (k: string) => compileBeast2(East.function([], IntegerType, $ => {
        const b = $.let(myBind([IntegerType], k));
        return b.read();
    }));

    const fnA = wasm.compileFromBeast2(irFor('alpha'), makeImpl(['alpha']));
    assert.equal(fnA(), 42n);

    const fnB = wasm.compileFromBeast2(irFor('beta'), makeImpl(['beta']));
    assert.equal(fnB(), 42n);

    // Now invoke A again — must hit ITS impl, not B's
    assert.equal(fnA(), 42n);

    fnA.free();
    fnB.free();
});
```

### Full new test block — `describe('per-decode platform contexts')`

| # | Test | Validates |
|---|---|---|
| 1 | Two compiles with distinct platform impls coexist (the user's bug) | Reproducer above |
| 2 | Same platform fn name, two different impls — each compile dispatches to its own | Context isolation via stack |
| 3 | Decoded fn outlives the decode call — registry stays alive via refcount | `fn->platform` retain |
| 4 | Releasing all decoded fns frees the C registry → `js_release_context` fires | Lifetime + JS cleanup |
| 5 | Decoded value containing nested fns (struct of fns) — all share one ctx | Multiple fns / single decode |
| 6 | Reactive-style: outer fn returns a fn that calls `data_bind` correctly | Real-world shape |
| 7 | JS callback handle table is per-context — handle id 1 in ctx A ≠ handle id 1 in ctx B | Per-context handle tables |
| 8 | Releasing ctx A while ctx B is still alive — B keeps working | Independent lifetimes |
| 9 | Wrapper has both `EAST_PLATFORM_CTX_SYMBOL` and `EAST_WASM_HANDLE_SYMBOL` attached | Symbol presence (round-trip readiness) |
| 10 | 1000 sequential `decodeBeast2 + free` cycles — no leak (handle table empty, contexts == 0) | Stress + leak |
| 11 | Interleaved invocations across two contexts — no cross-talk | Trampoline + stack isolation |
| 12 | Decode with empty platform array → still works (degenerate context) | Edge case |
| 13 | Decode with no `platform` arg → uses default empty context (back-compat path) | Back-compat |
| 14 | Nested wasm→js→wasm call from a JS callback inside ctx A returns to ctx A's registry | Re-entrancy + stack pop |
| 15 | Fn captured in a struct that's then captured by another fn — single retain chain works | Refcount chain |
| 16 | Attempt to invoke fn after its ctx was freed → clear error, no crash | Defensive (use-after-free) |

### Existing tests

All 38 tests in `east-c-wasm.spec.ts` continue to pass unchanged. The per-context model is back-compat: each `compileFromBeast2(bytes, platform)` call internally allocates a context, so existing tests keep working without modification.

### End-to-end test — VS Code extension

Manual verification, no automated harness. Two sequences:

1. **Sequence A**: open `data_bind_integer`, drive input, verify count updates. Switch to `data_bind_float`, drive slider, verify threshold updates. Switch back to `data_bind_integer`, drive again, verify still works. **No "path not declared in manifest" errors at any point.**

2. **Sequence B**: open `data_bind_string_reset`, click reset, verify writeback. Switch to `data_bind_slider_writeback`, drag, verify. Switch back. Verify.

Console logs to inspect (existing diagnostic logs in `dataset-runtime.ts`):
- `[Data.bind/scoped] manifest paths: [...]` — fires once per task switch.
- `[Data.bind/scoped.call] requested path: X allowed: [...]` — `requested` always in `allowed`. Different tasks see different `allowed` sets.

## Out of scope

- **Async JS callbacks** (`AsyncFunctionType`). Existing platform fns are sync-only too. Throws a clear error if installed; deferred to a separate workstream.
- **Round-trip of WASM-decoded fns** (re-encoding a wasm-decoded fn back via beast2). The `EAST_WASM_HANDLE_SYMBOL` plus a future `_east_wasm_get_fn_ir` export would enable this; current scope doesn't need it.
- **Sharing `TypePtrCache` across contexts.** Types are immutable; potential perf optimization. Defer.
- **Removing legacy global-context APIs** (`east_wasm_decode_value`, `east_wasm_compile`). Keep as thin wrappers that allocate a context per call internally.

## Verification

```bash
cd libs/east-c && make build && make test       # native — refcount + retain/release
cd libs/east-c && make wasm                      # wasm rebuild
cd packages/east-c-wasm && npm run build && npm run test:unit
                                                 # 38 → 54 tests, all green

cd ../../../east-ui/packages/east-ui-components && npm run build
cd ../e3-ui-components && npm run build
cd ../east-ui-extension && npm run build && npm run package

# Install vsix; switch between data_bind_float / data_bind_integer / data_bind_string_reset
# in any order. No "path not declared in manifest" errors. All tasks render and writeback.
```

## Effort

- east-c core (refcount + retain/release, trampolines into registry, save/restore thread context): ~120 lines
- east-c-wasm C exports + new `_in_ctx` variants + `wasm_registry_on_free`: ~280 lines
- common.ts JS context model + symbols + push/pop wrappers + per-context bridges: ~350 lines
- Tests (16 new, leaving 38 existing): ~300 lines
- Cascade rebuild: rebuild WASM, east-c-wasm, east-ui-components, e3-ui-components, east-ui-extension webview, repackage vsix.

Estimated **2 focused days**.
