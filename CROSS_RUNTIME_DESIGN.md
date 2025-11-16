# ZeroMQ Cross-Runtime Function Dispatch Design

## Executive Summary

This document provides a detailed implementation guide for cross-runtime East function dispatch using ZeroMQ with DEALER/ROUTER sockets and Beast2 serialization. The architecture enables Python, Julia, and TypeScript runtimes to call functions across language boundaries with ~15-25 μs latency.

---

## 1. Architecture Overview

### 1.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Discovery Layer                   │
│                  (File-based registry or DNS)               │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Python Runtime │  │  Julia Runtime  │  │   TS Runtime    │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │  ROUTER   │  │  │  │  ROUTER   │  │  │  │  ROUTER   │  │
│  │  (Server) │  │  │  │  (Server) │  │  │  │  (Server) │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │  DEALER   │  │  │  │  DEALER   │  │  │  │  DEALER   │  │
│  │  (Client) │  │  │  │  (Client) │  │  │  │  (Client) │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┴────────────────────┘
                    IPC Transport (Unix Socket)
                   ipc:///tmp/east-{runtime}.sock
```

### 1.2 Why DEALER/ROUTER Pattern?

- **Asynchronous**: Non-blocking send/receive operations
- **Multiplexing**: Handle multiple concurrent requests
- **Identity tracking**: ROUTER automatically manages client identity
- **Full control**: Custom message format with Beast2 payload
- **Scalability**: Multiple workers per runtime possible

### 1.3 Transport Choice

```
ipc:///tmp/east-{runtime}-{pid}.sock
```

- Unix domain socket transport (IPC)
- ~13-16 μs latency vs ~50 μs for TCP
- No network stack overhead
- Automatic cleanup on process exit (with unlink)

---

## 2. Type System Layers

Understanding the different type layers is critical for correct implementation. This system involves three distinct layers of types.

### 2.1 Layer 1: East Type System

These are the core East types defined in your type system (`types.ts`, `types.py`, `types.jl`):

```typescript
// Primitive East Types
NeverType                    // Bottom type, no values
NullType                     // Unit type, value: null
BooleanType                  // Values: true, false
IntegerType                  // Values: bigint (arbitrary precision)
FloatType                    // Values: IEEE 754 float64
StringType                   // Values: UTF-8 strings
DateTimeType                 // Values: millisecond timestamps
BlobType                     // Values: Uint8Array (immutable bytes)

// Compound East Types
ArrayType(T)                 // Mutable ordered collection of T
SetType(K)                   // Mutable sorted set of K
DictType(K, V)               // Mutable sorted map K → V
StructType({f1: T1, ...})    // Immutable product type
VariantType({c1: T1, ...})   // Immutable sum type (tagged union)
RefType(T)                   // Mutable reference cell
FunctionType(I[], O, P[])    // Function with inputs, output, platforms
RecursiveType(depth)         // Self-referential type

// Special Compound Type
IRType                       // RecursiveVariant representing East IR
EastTypeValueType            // Variant representing East types themselves
```

**Key constraint**: `ArrayType`, `SetType`, `DictType` require **homogeneous element types**. There is no `AnyType` in East.

### 2.2 Layer 2: East Runtime Values

Each East type has corresponding runtime values in each language:

| East Type | TypeScript | Python | Julia |
|-----------|------------|--------|-------|
| `NullType` | `null` | `None` | `nothing` |
| `BooleanType` | `boolean` | `bool` | `Bool` |
| `IntegerType` | `bigint` | `int` | `Int64` |
| `FloatType` | `number` | `float` | `Float64` |
| `StringType` | `string` | `str` | `String` |
| `BlobType` | `Uint8Array` | `bytes` | `Vector{UInt8}` |
| `ArrayType(T)` | `T[]` | `EastArray` | `Vector{T}` |
| `StructType` | `object` | `EastStruct` | Nominal struct |
| `VariantType` | `{type, value}` | `EastVariant` | `Case{name, T}` |
| `FunctionType` | Variant (IR) | Variant (IR) | Variant (IR) |

### 2.3 Layer 3: Beast2 Serialized Output

Beast2 encoding **always produces raw bytes**:

| Language | Beast2 Output Type | East Type Equivalent |
|----------|-------------------|---------------------|
| TypeScript | `Uint8Array` | `BlobType` |
| Python | `bytes` | `BlobType` |
| Julia | `Vector{UInt8}` | `BlobType` |

**Critical insight**: When Beast2 encodes any East value (regardless of its type), the output is always `BlobType` (raw bytes). The type information is encoded within those bytes according to the Beast2 specification.

### 2.4 Layer 4: Wire Protocol (External to East)

The ZeroMQ message frames contain:

```typescript
// NOT East types - these are transport-layer types
Frame = Buffer | Uint8Array | bytes | Vector{UInt8}
```

**MessagePack** (used for headers): External binary format, not an East type. Encodes JavaScript/Python/Julia objects to bytes.

**Beast2** (used for bodies): East-native binary format. Encodes East values to bytes (`BlobType`).

### 2.5 Type Flow Example

```
Application Layer (East Values):
  arguments = [42n, "hello"]           // [bigint, string]
  input_types = [IntegerType, StringType]

Serialization Layer (Beast2 Encoding):
  arg0_bytes = encodeBeast2For(IntegerType)(42n)     // → Uint8Array
  arg1_bytes = encodeBeast2For(StringType)("hello")  // → Uint8Array
  body_bytes = concat(arg0_bytes, arg1_bytes)        // → Uint8Array

Wire Layer (ZeroMQ Frame):
  Frame 2 = body_bytes                               // raw bytes

Deserialization (Beast2 Decoding):
  [arg0, offset] = decodeBeast2For(IntegerType)(body_bytes, 0)  // → 42n
  [arg1, offset] = decodeBeast2For(StringType)(body_bytes, offset)  // → "hello"
```

The **type information flows separately** from the data - it's either in the function IR (for arguments) or known at compile time.

---

## 3. IR Schema Extensions for Cross-Runtime Dispatch

To enable declarative cross-runtime dispatch, we extend `PlatformIR` and `FunctionIR` with an optional `runtime` field.

### 3.1 Runtime Type Definition

```typescript
// Type-safe runtime specification
type RuntimeId = "node" | "python" | "julia";

// null means inherit from caller context
type RuntimeSpec = RuntimeId | null;
```

### 3.2 Extended PlatformIR Schema

```typescript
// Current schema
type PlatformIR = variant<"Platform", {
  type: EastTypeValue,
  location: LocationValue,
  name: string,
  arguments: IR[]
}>;

// Extended schema (type-safe)
type PlatformIR = variant<"Platform", {
  type: EastTypeValue,
  location: LocationValue,
  name: string,
  arguments: IR[],
  runtime?: RuntimeSpec  // NEW: "node" | "python" | "julia" | null (inherit)
}>;
```

### 3.3 Extended FunctionIR Schema

```typescript
// Current schema
type FunctionIR = variant<"Function", {
  type: EastTypeValue,
  location: LocationValue,
  captures: VariableIR[],
  parameters: VariableIR[],
  body: IR
}>;

// Extended schema (type-safe)
type FunctionIR = variant<"Function", {
  type: EastTypeValue,
  location: LocationValue,
  captures: VariableIR[],
  parameters: VariableIR[],
  body: IR,
  runtime?: RuntimeSpec  // NEW: "node" | "python" | "julia" | null (inherit)
}>;
```

### 3.4 Runtime Inheritance Semantics

```
If runtime field is:
  - null or absent  → Inherit from calling context (parent's runtime)
  - "node"          → Must execute in Node.js/TypeScript runtime
  - "python"        → Must execute in Python runtime
  - "julia"         → Must execute in Julia runtime
```

**Note**: Using `"node"` instead of `"typescript"` since it's the actual runtime environment (Node.js), not the language. This is more accurate and consistent with how the runtime is identified.

**Key principle**: The runtime is declared at **definition time**, not **call time**. When the compiler encounters a call to a function/platform with a different runtime than the current context, it automatically inserts IPC dispatch code.

### 3.5 API Extensions

**TypeScript (East)**:
```typescript
// Type-safe runtime options
type PlatformOptions = {
  runtime?: "node" | "python" | "julia";  // Type-safe union
};

type FunctionOptions = {
  runtime?: "node" | "python" | "julia";  // Type-safe union
};

// Platform with runtime
const numpy_sum = East.platform(
  "numpy_sum",
  [ArrayType(FloatType)],
  FloatType,
  { runtime: "python" }  // NEW: type-safe runtime option
);

// Function with runtime
const juliaFn = East.function(
  [IntegerType],
  IntegerType,
  { runtime: "julia" },  // NEW: type-safe runtime option
  ($, x) => $.return(x.add(East.int(1)))
);

// Compile-time error if invalid runtime:
// East.platform(..., { runtime: "invalid" });  // ❌ Type error
```

**Python (east-py)**:
```python
# Platform with runtime
platform_def = {
    "name": "julia_ccall",
    "inputs": [...],
    "output": ...,
    "type": "sync",
    "runtime": "julia"  # NEW field
}

# Function IR with runtime
fn_ir = ir_function(
    type=...,
    location=...,
    captures=[],
    parameters=[...],
    body=...,
    runtime="python"  # NEW field
)
```

**Julia (East.jl)**:
```julia
# Function IR with runtime
fn_ir = ir_function(
    FunctionType(...),
    location,
    [],  # captures
    [param],  # parameters
    body,
    "julia"  # runtime - NEW field
)
```

### 3.6 Backward Compatibility

- The `runtime` field is **optional** (defaults to `null` = inherit)
- Existing IR without the field continues to work
- Existing functions execute in their current runtime
- No breaking changes to existing code

---

## 4. Message Protocol

### 4.1 ZeroMQ Message Frame Structure

ZeroMQ messages are multi-part. Our protocol uses this structure:

```
DEALER → ROUTER (Request):
┌─────────────────┐
│ Frame 0: Empty  │  (delimiter for DEALER)
├─────────────────┤
│ Frame 1: Header │  (msgpack: request metadata, NOT an East type)
├─────────────────┤
│ Frame 2: Body   │  (beast2-encoded bytes, East BlobType equivalent)
└─────────────────┘

ROUTER → DEALER (Response):
┌─────────────────┐
│ Frame 0: Identity│  (auto-added by ROUTER)
├─────────────────┤
│ Frame 1: Empty  │  (delimiter)
├─────────────────┤
│ Frame 2: Header │  (msgpack: response metadata, NOT an East type)
├─────────────────┤
│ Frame 3: Body   │  (beast2-encoded bytes, East BlobType equivalent)
└─────────────────┘
```

**Important**: Headers use MessagePack (external format), not Beast2. Bodies use Beast2 (East-native format).

### 4.2 Header Format (MessagePack)

MessagePack for headers (small, fast to parse):

```typescript
interface RequestHeader {
  version: 1;                    // Protocol version
  request_id: string;            // UUID for correlation
  message_type: "CALL";          // Message type
  function_hash: string;         // SHA256 of IR (hex, 64 chars)
  has_ir: boolean;               // Whether body includes IR
  timeout_ms: number;            // Request timeout
  trace_id?: string;             // Distributed tracing
  parent_span?: string;          // Parent span ID
  depth: number;                 // Call nesting depth (prevent infinite recursion)
}

interface ResponseHeader {
  version: 1;
  request_id: string;            // Correlation ID
  message_type: "RESULT" | "ERROR" | "NOT_FOUND";
  execution_time_us: number;     // Server-side execution time
}

interface ErrorHeader extends ResponseHeader {
  message_type: "ERROR";
  error_type: "east_error" | "timeout" | "serialization" | "internal";
}
```

**Note**: These TypeScript interfaces describe MessagePack-serialized objects, not East types. MessagePack is external to the East type system.

### 4.3 Body Format (Beast2-Encoded Bytes)

The body frame is **raw bytes** (`Uint8Array`/`bytes`/`Vector{UInt8}`) containing Beast2-encoded East values. The layout depends on the message type.

**Request Body Layout** (not an East Struct - just concatenated bytes):

```typescript
// TypeScript/JavaScript representation of the byte layout
type RequestBody = Uint8Array;  // Equivalent to East BlobType

// When has_ir = true (first call or cache miss):
// Layout: [IR_bytes][Arg0_bytes][Arg1_bytes]...[ArgN_bytes]
//
// Where:
//   IR_bytes    = Beast2.encode(ir, IRType)              // East FunctionIR value
//   Arg0_bytes  = Beast2.encode(arg0, input_types[0])   // First argument
//   Arg1_bytes  = Beast2.encode(arg1, input_types[1])   // Second argument
//   ...
//   ArgN_bytes  = Beast2.encode(argN, input_types[N])   // Nth argument

// When has_ir = false (function already cached):
// Layout: [Arg0_bytes][Arg1_bytes]...[ArgN_bytes]
//
// The receiver knows the types from the cached FunctionIR
```

**Why not use an East Struct?**
- Arguments are **heterogeneous** (each has a different type)
- East `ArrayType` requires homogeneous element type (no `Array<Any>`)
- Sequential encoding is more efficient (no wrapper overhead)
- Type information is carried separately in the FunctionIR

**Response Body Layout**:

```typescript
// Success (message_type = "RESULT"):
// Layout: [Result_bytes]
//
// Where:
//   Result_bytes = Beast2.encode(result, output_type)
//
// The output_type is known from the FunctionIR

// Error (message_type = "ERROR"):
// Layout: MessagePack-encoded error object (NOT Beast2)
//
// {
//   message: string,
//   locations: Array<{filename: string, line: number, column: number}>
// }
//
// Note: We use MessagePack here for simplicity since error bodies
// are not performance-critical and have variable structure.
// Alternatively, could define an East ErrorType and use Beast2.
```

**Type Safety Guarantee**: The receiver can decode the body correctly because:
1. The `function_hash` identifies the function
2. The function's IR contains `input_types` and `output_type`
3. Beast2 encoding is deterministic for a given type

### 4.4 Function Hash Computation

Stable hash for function identity:

```python
def compute_function_hash(ir: dict) -> str:
    """
    Compute SHA256 hash of function IR.

    Args:
        ir: East value conforming to IRType (FunctionIR variant case)

    Returns:
        Hex string of SHA256 hash (64 characters)

    Note: Location info is INCLUDED in hash because it refers to the
    original source location where the function was defined, not the
    runtime loading it.
    """
    # Encode to Beast2 (deterministic across all runtimes)
    encoder = encode_beast2_for(IRType)
    beast2_bytes: bytes = encoder(ir)

    # SHA256 hash
    return hashlib.sha256(beast2_bytes).hexdigest()
```

### 4.5 Cross-Runtime Hash Consistency

**Critical**: The function hash is identical across all runtimes for the same IR.

```typescript
// TypeScript loads IR (originally defined in Python)
const hash = computeFunctionHash(ir);  // "a1b2c3d4..."

// Python loads same IR
hash = compute_function_hash(ir)       // "a1b2c3d4..." (identical!)

// Julia loads same IR
hash = compute_function_hash(ir)       # "a1b2c3d4..." (identical!)
```

**Why this works**:

1. **IR is immutable**: The IR structure (including source locations) is fixed when the function is defined
2. **Location refers to original source**: If function was written in `mycode.py:42`, that's in the IR forever
3. **Beast2 encoding is deterministic**: Same IR bytes = same hash across all runtimes
4. **Same function = same hash**: If two runtimes load the same IR, they compute the same hash

**Key insight**: The IR is a **portable artifact**. It carries its own identity (including where it was originally written). Loading it in Python, Julia, or TypeScript doesn't change the IR - it just executes it.

This means:
- A function defined once can be registered in any runtime
- Other runtimes can call it by hash without needing to know where it came from
- The hash acts as a universal function identifier across the cluster

---

## 5. Service Discovery

### 5.1 File-Based Registry

Simple, no external dependencies:

```
/tmp/east-registry/
├── python-12345.json
├── julia-12346.json
└── typescript-12347.json
```

**Registry Entry**:
```json
{
  "runtime": "python",
  "pid": 12345,
  "endpoint": "ipc:///tmp/east-python-12345.sock",
  "started_at": "2025-01-15T10:30:00Z",
  "functions": {
    "a1b2c3d4...": {
      "name": "process_data",
      "signature": {
        "inputs": [{"type": "Array", "value": {"type": "Integer"}}],
        "output": {"type": "Float"}
      },
      "runtime": "python"
    }
  },
  "platforms": {
    "numpy_sum": { "runtime": "python" },
    "numpy_matmul": { "runtime": "python" },
    "log": { "runtime": null }
  },
  "heartbeat": "2025-01-15T10:35:00Z"
}
```

**Note**: The `runtime` field in functions indicates where this function **must** execute. Platform functions with `runtime: null` are available in the current runtime (no dispatch needed).
```

### 5.2 Registry Operations

```python
class ServiceRegistry:
    REGISTRY_DIR = "/tmp/east-registry"

    def register(self, runtime: str, pid: int, endpoint: str, functions: dict):
        """Register this runtime in the registry."""
        os.makedirs(self.REGISTRY_DIR, exist_ok=True)
        path = f"{self.REGISTRY_DIR}/{runtime}-{pid}.json"

        entry = {
            "runtime": runtime,
            "pid": pid,
            "endpoint": endpoint,
            "started_at": datetime.utcnow().isoformat(),
            "functions": functions,
            "heartbeat": datetime.utcnow().isoformat()
        }

        with open(path, 'w') as f:
            json.dump(entry, f)

    def discover(self, runtime: str) -> List[RegistryEntry]:
        """Find all instances of a runtime."""
        entries = []
        pattern = f"{self.REGISTRY_DIR}/{runtime}-*.json"

        for path in glob.glob(pattern):
            with open(path) as f:
                entry = json.load(f)

            # Check if process is alive
            if self._is_alive(entry["pid"]):
                entries.append(entry)
            else:
                os.unlink(path)  # Cleanup stale entry

        return entries

    def find_function(self, function_hash: str) -> Optional[str]:
        """Find endpoint that has this function."""
        for path in glob.glob(f"{self.REGISTRY_DIR}/*.json"):
            with open(path) as f:
                entry = json.load(f)

            if function_hash in entry["functions"]:
                if self._is_alive(entry["pid"]):
                    return entry["endpoint"]

        return None

    def heartbeat(self):
        """Update heartbeat timestamp."""
        # Update own registry file
        pass

    def _is_alive(self, pid: int) -> bool:
        """Check if process is running."""
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
```

---

## 6. Python Runtime Implementation

### 6.1 Dependencies

```toml
# pyproject.toml
[project.dependencies]
pyzmq = ">=25.0"
msgpack = ">=1.0"
# existing east-py dependencies
```

### 6.2 ZeroMQ Server (ROUTER)

```python
# east/runtime/zeromq_server.py
import asyncio
import zmq
import zmq.asyncio
import msgpack
from typing import Dict, Callable, Any, List
from dataclasses import dataclass
import uuid
import time
import os
import hashlib

from east.serialization.beast2 import (
    encode_beast2_for,  # Returns: (type) -> (value) -> bytes
    decode_beast2_for,  # Returns: (type) -> (bytes) -> value
)
from east.types.types import IRType, EastType  # IRType is the East type for all IR nodes
from east.types.error import EastError
from east.runtime.compiler import compile_async
from east.ir.analyze import analyze_ir


@dataclass
class CompiledFunction:
    """
    Cached compiled function with type metadata.

    ir: East variant value (dict with type="Function", value={...})
        This is the FunctionIR case of IRType
    compiled: Python async callable
    input_types: List of East type values (EastType dicts)
    output_type: East type value (EastType dict)
    """
    ir: dict  # East value conforming to IRType (FunctionIR variant case)
    compiled: Callable[..., Any]
    input_types: List[EastType]  # List of East type values
    output_type: EastType  # East type value


class EastZeroMQServer:
    """ZeroMQ ROUTER server for handling cross-runtime function calls."""

    def __init__(self, runtime_name: str = "python", platform: list = None):
        self.runtime_name = runtime_name
        self.platform = platform or []
        self.pid = os.getpid()

        # Function cache: hash -> CompiledFunction
        self.function_cache: Dict[str, CompiledFunction] = {}

        # ZeroMQ context (asyncio-compatible)
        self.ctx = zmq.asyncio.Context()
        self.socket = None

        # Endpoint
        self.endpoint = f"ipc:///tmp/east-{runtime_name}-{self.pid}.sock"

        # Service registry
        self.registry = ServiceRegistry()

        # Stats
        self.requests_handled = 0
        self.total_execution_time_us = 0

    async def start(self):
        """Start the ZeroMQ server."""
        # Create ROUTER socket
        self.socket = self.ctx.socket(zmq.ROUTER)
        self.socket.setsockopt(zmq.ROUTER_MANDATORY, 1)  # Error on unroutable
        self.socket.setsockopt(zmq.LINGER, 0)  # Don't wait on close

        # Bind to IPC endpoint
        self.socket.bind(self.endpoint)
        print(f"East {self.runtime_name} server listening on {self.endpoint}")

        # Register with service discovery
        self.registry.register(
            self.runtime_name,
            self.pid,
            self.endpoint,
            self._get_function_signatures()
        )

        # Start heartbeat task
        asyncio.create_task(self._heartbeat_loop())

        # Main message loop
        await self._message_loop()

    async def _message_loop(self):
        """Main loop to handle incoming requests."""
        while True:
            try:
                # Receive multi-part message
                # [identity, empty, header, body]
                frames = await self.socket.recv_multipart()

                # Process in background task (non-blocking)
                asyncio.create_task(self._handle_request(frames))

            except zmq.ZMQError as e:
                print(f"ZeroMQ error: {e}")
            except Exception as e:
                print(f"Server error: {e}")

    async def _handle_request(self, frames: list):
        """Handle a single request."""
        start_time = time.perf_counter_ns()

        # Parse frames
        identity = frames[0]
        # frames[1] is empty delimiter
        header_bytes = frames[2]
        body_bytes = frames[3] if len(frames) > 3 else b""

        # Decode header (msgpack)
        header = msgpack.unpackb(header_bytes)
        request_id = header["request_id"]

        try:
            # Check depth limit (prevent infinite recursion)
            if header.get("depth", 0) > 10:
                raise Exception("Maximum call depth exceeded")

            # Get or compile function
            function_hash = header["function_hash"]

            if function_hash not in self.function_cache:
                if not header.get("has_ir", False):
                    # Function not cached and IR not provided
                    await self._send_not_found(identity, request_id)
                    return

                # Decode IR and arguments from body
                body = self._decode_request_body_with_ir(body_bytes)

                # Compile and cache function
                compiled_fn = await self._compile_function(body["ir"])
                self.function_cache[function_hash] = compiled_fn

                args = body["arguments"]
            else:
                # Function cached, decode arguments only
                compiled_fn = self.function_cache[function_hash]
                args = self._decode_arguments(body_bytes, compiled_fn.input_types)

            # Execute function
            result = await compiled_fn.compiled(*args)

            # Calculate execution time
            execution_time_us = (time.perf_counter_ns() - start_time) // 1000
            self.requests_handled += 1
            self.total_execution_time_us += execution_time_us

            # Send success response
            await self._send_result(identity, request_id, result,
                                   compiled_fn.output_type, execution_time_us)

        except Exception as e:
            # Send error response
            execution_time_us = (time.perf_counter_ns() - start_time) // 1000
            await self._send_error(identity, request_id, e, execution_time_us)

    def _decode_request_body_with_ir(self, body_bytes: bytes) -> dict:
        """Decode request body containing IR and arguments."""
        # Body schema: Struct<{ir: IRType, arguments: Array<Any>}>
        # For now, decode as two separate beast2 values
        # First: read IR
        ir, offset = decode_beast2_for(IRType)(body_bytes, 0)

        # Second: read arguments (need to know types from IR)
        fn_type = ir["value"]["type"]["value"]  # FunctionIR.type
        input_types = fn_type["inputs"]

        args = []
        for input_type in input_types:
            arg, offset = decode_beast2_for(input_type)(body_bytes, offset)
            args.append(arg)

        return {"ir": ir, "arguments": args}

    def _decode_arguments(self, body_bytes: bytes, input_types: list) -> list:
        """Decode arguments when function is cached."""
        args = []
        offset = 0
        for input_type in input_types:
            arg, offset = decode_beast2_for(input_type)(body_bytes, offset)
            args.append(arg)
        return args

    async def _compile_function(self, ir) -> CompiledFunction:
        """Compile function IR to executable Python function."""
        # Analyze IR
        analyzed_ir, is_async_map = analyze_ir(ir, self.platform)

        # Compile (always async for cross-runtime calls)
        compiled = compile_async(analyzed_ir, self.platform)

        # Extract type info
        fn_type = ir["value"]["type"]["value"]
        input_types = fn_type["inputs"]
        output_type = fn_type["output"]

        return CompiledFunction(
            ir=ir,
            compiled=compiled,
            input_types=input_types,
            output_type=output_type
        )

    async def _send_result(self, identity: bytes, request_id: str,
                          result: Any, output_type: EastType, exec_time_us: int):
        """Send successful result back to client."""
        # Header
        response_header = {
            "version": 1,
            "request_id": request_id,
            "message_type": "RESULT",
            "execution_time_us": exec_time_us
        }
        header_bytes = msgpack.packb(response_header)

        # Body (Beast2-encoded result)
        body_bytes = encode_beast2_for(output_type)(result)

        # Send: [identity, empty, header, body]
        await self.socket.send_multipart([
            identity,
            b"",
            header_bytes,
            body_bytes
        ])

    async def _send_error(self, identity: bytes, request_id: str,
                         error: Exception, exec_time_us: int):
        """Send error response back to client."""
        # Determine error type
        if isinstance(error, EastError):
            error_type = "east_error"
            message = error.message
            locations = error.location
        else:
            error_type = "internal"
            message = str(error)
            locations = []

        # Header
        response_header = {
            "version": 1,
            "request_id": request_id,
            "message_type": "ERROR",
            "error_type": error_type,
            "execution_time_us": exec_time_us
        }
        header_bytes = msgpack.packb(response_header)

        # Body (Beast2-encoded error info)
        error_body = {
            "message": message,
            "locations": locations
        }
        # Encode as struct
        body_bytes = self._encode_error_body(error_body)

        await self.socket.send_multipart([
            identity,
            b"",
            header_bytes,
            body_bytes
        ])

    async def _send_not_found(self, identity: bytes, request_id: str):
        """Send not found response (function not cached, IR not provided)."""
        response_header = {
            "version": 1,
            "request_id": request_id,
            "message_type": "NOT_FOUND",
            "execution_time_us": 0
        }
        header_bytes = msgpack.packb(response_header)

        await self.socket.send_multipart([
            identity,
            b"",
            header_bytes,
            b""
        ])

    async def _heartbeat_loop(self):
        """Periodically update registry heartbeat."""
        while True:
            await asyncio.sleep(30)
            self.registry.heartbeat()

    def _get_function_signatures(self) -> dict:
        """Get signatures of all cached functions for registry."""
        return {
            hash: {
                "signature": {
                    "inputs": fn.input_types,
                    "output": fn.output_type
                }
            }
            for hash, fn in self.function_cache.items()
        }

    def register_function(self, name: str, ir):
        """Pre-register a function for remote calling."""
        hash = compute_function_hash(ir)
        compiled_fn = asyncio.run(self._compile_function(ir))
        self.function_cache[hash] = compiled_fn

        # Update registry
        self.registry.register(
            self.runtime_name,
            self.pid,
            self.endpoint,
            self._get_function_signatures()
        )

        return hash

    async def stop(self):
        """Gracefully stop the server."""
        if self.socket:
            self.socket.close()
        self.ctx.term()

        # Unregister from registry
        registry_path = f"{ServiceRegistry.REGISTRY_DIR}/{self.runtime_name}-{self.pid}.json"
        if os.path.exists(registry_path):
            os.unlink(registry_path)

        # Cleanup IPC socket file
        socket_path = self.endpoint.replace("ipc://", "")
        if os.path.exists(socket_path):
            os.unlink(socket_path)
```

### 6.3 ZeroMQ Client (DEALER)

```python
# east/runtime/zeromq_client.py
import asyncio
import zmq
import zmq.asyncio
import msgpack
import uuid
from typing import Dict, Any, Optional
from dataclasses import dataclass
import time


@dataclass
class PendingRequest:
    future: asyncio.Future
    sent_at: float
    timeout_ms: int


class EastZeroMQClient:
    """ZeroMQ DEALER client for calling functions in other runtimes."""

    def __init__(self):
        self.ctx = zmq.asyncio.Context()

        # Connection pool: endpoint -> socket
        self.connections: Dict[str, zmq.asyncio.Socket] = {}

        # Pending requests: request_id -> PendingRequest
        self.pending: Dict[str, PendingRequest] = {}

        # Service registry
        self.registry = ServiceRegistry()

        # Function IR cache: hash -> IR
        self.ir_cache: Dict[str, Any] = {}

        # Response handler task
        self._response_handlers: Dict[str, asyncio.Task] = {}

    async def get_connection(self, endpoint: str) -> zmq.asyncio.Socket:
        """Get or create connection to endpoint."""
        if endpoint not in self.connections:
            socket = self.ctx.socket(zmq.DEALER)
            socket.setsockopt(zmq.LINGER, 0)
            socket.setsockopt_string(zmq.IDENTITY, str(uuid.uuid4()))
            socket.connect(endpoint)

            self.connections[endpoint] = socket

            # Start response handler for this connection
            task = asyncio.create_task(self._response_handler(endpoint, socket))
            self._response_handlers[endpoint] = task

        return self.connections[endpoint]

    async def _response_handler(self, endpoint: str, socket: zmq.asyncio.Socket):
        """Handle responses from a server."""
        while True:
            try:
                # Receive: [empty, header, body]
                frames = await socket.recv_multipart()

                # frames[0] is empty delimiter
                header_bytes = frames[1]
                body_bytes = frames[2] if len(frames) > 2 else b""

                # Decode header
                header = msgpack.unpackb(header_bytes)
                request_id = header["request_id"]

                # Find pending request
                if request_id in self.pending:
                    pending = self.pending.pop(request_id)
                    pending.future.set_result((header, body_bytes))
                else:
                    print(f"Warning: Response for unknown request {request_id}")

            except zmq.ZMQError as e:
                print(f"ZeroMQ client error: {e}")
                break
            except Exception as e:
                print(f"Client response handler error: {e}")

    async def call_function(
        self,
        target_runtime: str,
        function_hash: str,
        arguments: list,
        input_types: list,
        output_type: Any,
        ir: Optional[Any] = None,
        timeout_ms: int = 5000,
        depth: int = 0
    ) -> Any:
        """
        Call a function in another runtime.

        Args:
            target_runtime: "python", "julia", or "typescript"
            function_hash: SHA256 hash of function IR
            arguments: List of argument values
            input_types: List of East types for arguments
            output_type: East type for return value
            ir: Optional function IR (sent on first call)
            timeout_ms: Request timeout in milliseconds
            depth: Current call nesting depth

        Returns:
            Function result (decoded from Beast2)

        Raises:
            EastError: If function execution fails
            TimeoutError: If request times out
        """
        # Find endpoint for target runtime
        endpoint = self._find_endpoint(target_runtime, function_hash)
        if not endpoint:
            raise Exception(f"No {target_runtime} runtime found with function {function_hash[:16]}...")

        # Get connection
        socket = await self.get_connection(endpoint)

        # Create request
        request_id = str(uuid.uuid4())

        # Determine if we need to send IR
        has_ir = ir is not None and function_hash not in self.ir_cache
        if has_ir:
            self.ir_cache[function_hash] = ir

        # Build header
        header = {
            "version": 1,
            "request_id": request_id,
            "message_type": "CALL",
            "function_hash": function_hash,
            "has_ir": has_ir,
            "timeout_ms": timeout_ms,
            "depth": depth
        }
        header_bytes = msgpack.packb(header)

        # Build body
        if has_ir:
            body_bytes = self._encode_request_body_with_ir(ir, arguments, input_types)
        else:
            body_bytes = self._encode_arguments(arguments, input_types)

        # Send request: [empty, header, body]
        await socket.send_multipart([b"", header_bytes, body_bytes])

        # Create pending request with future
        future = asyncio.get_event_loop().create_future()
        pending = PendingRequest(
            future=future,
            sent_at=time.time(),
            timeout_ms=timeout_ms
        )
        self.pending[request_id] = pending

        # Wait for response with timeout
        try:
            response_header, response_body = await asyncio.wait_for(
                future,
                timeout=timeout_ms / 1000
            )
        except asyncio.TimeoutError:
            self.pending.pop(request_id, None)
            raise TimeoutError(f"Cross-runtime call timed out after {timeout_ms}ms")

        # Handle response
        message_type = response_header["message_type"]

        if message_type == "RESULT":
            # Decode result
            result, _ = decode_beast2_for(output_type)(response_body, 0)
            return result

        elif message_type == "ERROR":
            # Decode error
            error_info = self._decode_error_body(response_body)
            raise EastError(error_info["message"], error_info["locations"])

        elif message_type == "NOT_FOUND":
            # Function not cached on server, retry with IR
            if ir is not None:
                # Retry with IR included
                return await self.call_function(
                    target_runtime, function_hash, arguments,
                    input_types, output_type, ir, timeout_ms, depth
                )
            else:
                raise Exception(f"Function {function_hash[:16]}... not found and IR not available")

        else:
            raise Exception(f"Unknown response type: {message_type}")

    def _find_endpoint(self, target_runtime: str, function_hash: str) -> Optional[str]:
        """Find endpoint that can handle this function."""
        # First, try to find by function hash
        endpoint = self.registry.find_function(function_hash)
        if endpoint:
            return endpoint

        # Otherwise, find any instance of target runtime
        entries = self.registry.discover(target_runtime)
        if entries:
            return entries[0]["endpoint"]

        return None

    def _encode_request_body_with_ir(self, ir, arguments: list, input_types: list) -> bytes:
        """Encode request body with IR and arguments."""
        buffer = bytearray()

        # Encode IR
        ir_bytes = encode_beast2_for(IRType)(ir)
        buffer.extend(ir_bytes)

        # Encode arguments
        for arg, arg_type in zip(arguments, input_types):
            arg_bytes = encode_beast2_for(arg_type)(arg)
            buffer.extend(arg_bytes)

        return bytes(buffer)

    def _encode_arguments(self, arguments: list, input_types: list) -> bytes:
        """Encode arguments only."""
        buffer = bytearray()
        for arg, arg_type in zip(arguments, input_types):
            arg_bytes = encode_beast2_for(arg_type)(arg)
            buffer.extend(arg_bytes)
        return bytes(buffer)

    def _decode_error_body(self, body_bytes: bytes) -> dict:
        """Decode error body."""
        # For now, simple msgpack (could be beast2 struct)
        return msgpack.unpackb(body_bytes)

    async def close(self):
        """Close all connections."""
        for task in self._response_handlers.values():
            task.cancel()

        for socket in self.connections.values():
            socket.close()

        self.ctx.term()
```

### 6.4 Compile-Time Dispatch Integration

The dispatch logic is integrated into the **compiler**, not as platform functions. When the compiler encounters a Call IR node where the target function has a different `runtime` field, it automatically generates remote dispatch code.

```python
# east/runtime/compiler_dispatch.py
from east.runtime.zeromq_client import EastZeroMQClient
from east.serialization.beast2 import encode_beast2_for
from east.types.types import IRType
from typing import Any, Callable
import hashlib


# Global ZeroMQ client instance
_zeromq_client: Optional[EastZeroMQClient] = None


def get_zeromq_client() -> EastZeroMQClient:
    """Get or create global ZeroMQ client for cross-runtime calls."""
    global _zeromq_client
    if _zeromq_client is None:
        _zeromq_client = EastZeroMQClient()
    return _zeromq_client


def compile_call_with_dispatch(
    call_ir: dict,
    current_runtime: str,
    compile_expr: Callable  # Recursive compiler function
) -> Callable:
    """
    Compile a Call IR node, inserting dispatch logic if target runtime differs.

    This is called by the main compiler when it encounters a Call node.
    """
    function_ir = call_ir["value"]["function"]
    arguments_ir = call_ir["value"]["arguments"]

    # Determine target runtime
    target_runtime = get_target_runtime(function_ir, current_runtime)

    if target_runtime == current_runtime:
        # Local call - no dispatch needed
        return compile_local_call(function_ir, arguments_ir, compile_expr)
    else:
        # Remote call - generate dispatch code
        return compile_remote_call(function_ir, arguments_ir, target_runtime, compile_expr)


def get_target_runtime(ir_node: dict, current_runtime: str) -> str:
    """
    Extract target runtime from IR node.

    If runtime field is null/absent, inherit from current_runtime.
    """
    if ir_node["type"] == "Function":
        return ir_node["value"].get("runtime") or current_runtime
    elif ir_node["type"] == "Platform":
        return ir_node["value"].get("runtime") or current_runtime
    else:
        return current_runtime


def compile_local_call(
    function_ir: dict,
    arguments_ir: list,
    compile_expr: Callable
) -> Callable:
    """Compile a local function call (no IPC)."""
    # Standard local call compilation
    compiled_fn = compile_expr(function_ir)
    compiled_args = [compile_expr(arg) for arg in arguments_ir]

    async def local_call(env: dict) -> Any:
        fn = await compiled_fn(env)
        args = [await arg(env) for arg in compiled_args]
        return await fn(*args)

    return local_call


def compile_remote_call(
    function_ir: dict,
    arguments_ir: list,
    target_runtime: str,
    compile_expr: Callable
) -> Callable:
    """
    Compile a remote function call (cross-runtime dispatch via ZeroMQ).

    This generates code that:
    1. Evaluates arguments locally
    2. Serializes them with Beast2
    3. Sends request to target runtime
    4. Deserializes and returns result
    """
    # Pre-compute function hash (compile-time)
    function_hash = compute_function_hash(function_ir)

    # Extract type information from function IR
    fn_type = function_ir["value"]["type"]["value"]
    input_types = fn_type["inputs"]
    output_type = fn_type["output"]

    # Compile argument expressions
    compiled_args = [compile_expr(arg) for arg in arguments_ir]

    async def remote_call(env: dict) -> Any:
        # Evaluate arguments in current runtime
        args = [await arg(env) for arg in compiled_args]

        # Dispatch to remote runtime via ZeroMQ
        client = get_zeromq_client()
        result = await client.call_function(
            target_runtime=target_runtime,
            function_hash=function_hash,
            arguments=args,
            input_types=input_types,
            output_type=output_type,
            ir=function_ir,  # Send IR (will be cached by receiver)
            timeout_ms=5000,
            depth=env.get("__call_depth__", 0) + 1
        )
        return result

    return remote_call


def compute_function_hash(ir: dict) -> str:
    """Compute deterministic hash of function IR."""
    encoder = encode_beast2_for(IRType)
    beast2_bytes = encoder(ir)
    return hashlib.sha256(beast2_bytes).hexdigest()
```

**Integration with main compiler** (`east/runtime/compiler.py`):

```python
def _compile_ir(ir: dict, current_runtime: str = "python") -> Callable:
    """Main IR compiler with dispatch support."""

    if ir["type"] == "Call":
        # Use dispatch-aware compilation
        return compile_call_with_dispatch(
            ir,
            current_runtime,
            lambda node: _compile_ir(node, current_runtime)
        )

    elif ir["type"] == "Function":
        # When entering a function, check if it has a different runtime
        fn_runtime = ir["value"].get("runtime") or current_runtime
        # Compile body with function's runtime context
        body_compiler = lambda node: _compile_ir(node, fn_runtime)
        # ... rest of function compilation

    # ... other IR node types
```

**Key insight**: No explicit `call_runtime()` platform function needed. The dispatch logic is automatically inserted by the compiler based on the `runtime` field in the IR.
```

---

## 7. Julia Runtime Implementation

### 7.1 Dependencies

```julia
# Project.toml
[deps]
ZMQ = "c2297ded-f4af-51ae-bb23-16f4e9d52545"
MsgPack = "99f44e22-a591-53d1-9472-aa23ef4bd671"
# existing East.jl dependencies
```

### 7.2 ZeroMQ Server

```julia
# src/zeromq_server.jl
module ZeroMQServer

using ZMQ
using MsgPack
using ..East: compile, IRType, EastError
using ..Beast2: encode_beast2, decode_beast2

export EastServer, start_server, register_function

mutable struct CompiledFunction
    ir::Any
    compiled::Function
    input_types::Vector{Any}
    output_type::Any
end

mutable struct EastServer
    runtime_name::String
    pid::Int
    endpoint::String
    context::ZMQ.Context
    socket::ZMQ.Socket
    function_cache::Dict{String, CompiledFunction}
    platform::Vector{Any}
    running::Bool
end

function EastServer(runtime_name::String="julia"; platform=Any[])
    pid = getpid()
    endpoint = "ipc:///tmp/east-$(runtime_name)-$(pid).sock"
    ctx = ZMQ.Context()

    EastServer(
        runtime_name,
        pid,
        endpoint,
        ctx,
        ZMQ.Socket(ctx, ROUTER),
        Dict{String, CompiledFunction}(),
        platform,
        false
    )
end

function start_server(server::EastServer)
    # Configure socket
    ZMQ.set_router_mandatory(server.socket, true)
    ZMQ.set_linger(server.socket, 0)

    # Bind to IPC endpoint
    ZMQ.bind(server.socket, server.endpoint)
    println("East $(server.runtime_name) server listening on $(server.endpoint)")

    # Register with service discovery
    register_with_discovery(server)

    server.running = true

    # Main message loop
    while server.running
        try
            # Receive multi-part message
            # [identity, empty, header, body]
            frames = ZMQ.recv_multipart(server.socket)

            # Handle request
            handle_request(server, frames)

        catch e
            if isa(e, InterruptException)
                break
            end
            @error "Server error" exception=e
        end
    end
end

function handle_request(server::EastServer, frames::Vector{ZMQ.Message})
    start_time = time_ns()

    # Parse frames
    identity = frames[1]
    # frames[2] is empty delimiter
    header_bytes = Vector{UInt8}(frames[3])
    body_bytes = length(frames) > 3 ? Vector{UInt8}(frames[4]) : UInt8[]

    # Decode header (msgpack)
    header = MsgPack.unpack(header_bytes)
    request_id = header["request_id"]

    try
        # Check depth limit
        depth = get(header, "depth", 0)
        if depth > 10
            throw(EastError("Maximum call depth exceeded", []))
        end

        # Get or compile function
        function_hash = header["function_hash"]

        if !haskey(server.function_cache, function_hash)
            if !get(header, "has_ir", false)
                # Function not cached and IR not provided
                send_not_found(server, identity, request_id)
                return
            end

            # Decode IR and arguments
            ir, offset = decode_beast2(IRType, body_bytes, 1)

            # Compile and cache
            compiled_fn = compile_function(server, ir)
            server.function_cache[function_hash] = compiled_fn

            # Decode arguments
            args = decode_arguments(body_bytes, offset, compiled_fn.input_types)
        else
            # Function cached
            compiled_fn = server.function_cache[function_hash]
            args = decode_arguments(body_bytes, 1, compiled_fn.input_types)
        end

        # Execute function
        result = Base.invokelatest(compiled_fn.compiled, args...)

        # Calculate execution time
        execution_time_us = div(time_ns() - start_time, 1000)

        # Send success response
        send_result(server, identity, request_id, result,
                   compiled_fn.output_type, execution_time_us)

    catch e
        execution_time_us = div(time_ns() - start_time, 1000)
        send_error(server, identity, request_id, e, execution_time_us)
    end
end

function compile_function(server::EastServer, ir)::CompiledFunction
    # Compile IR to Julia function
    compiled = eval(compile(ir))

    # Extract type info
    fn_type = ir[:value][:type][:value]
    input_types = fn_type[:inputs]
    output_type = fn_type[:output]

    CompiledFunction(ir, compiled, input_types, output_type)
end

function decode_arguments(body_bytes::Vector{UInt8}, offset::Int,
                         input_types::Vector)::Vector{Any}
    args = Any[]
    for input_type in input_types
        arg, offset = decode_beast2(input_type, body_bytes, offset)
        push!(args, arg)
    end
    args
end

function send_result(server::EastServer, identity, request_id::String,
                    result, output_type, exec_time_us::Int)
    # Header
    response_header = Dict(
        "version" => 1,
        "request_id" => request_id,
        "message_type" => "RESULT",
        "execution_time_us" => exec_time_us
    )
    header_bytes = MsgPack.pack(response_header)

    # Body (Beast2-encoded result)
    body_bytes = encode_beast2(output_type, result)

    # Send: [identity, empty, header, body]
    ZMQ.send_multipart(server.socket, [
        identity,
        ZMQ.Message(""),
        ZMQ.Message(header_bytes),
        ZMQ.Message(body_bytes)
    ])
end

function send_error(server::EastServer, identity, request_id::String,
                   error::Exception, exec_time_us::Int)
    # Determine error type and info
    if isa(error, EastError)
        error_type = "east_error"
        message = error.message
        locations = error.location
    else
        error_type = "internal"
        message = string(error)
        locations = []
    end

    # Header
    response_header = Dict(
        "version" => 1,
        "request_id" => request_id,
        "message_type" => "ERROR",
        "error_type" => error_type,
        "execution_time_us" => exec_time_us
    )
    header_bytes = MsgPack.pack(response_header)

    # Body (error info as msgpack for simplicity)
    error_body = Dict("message" => message, "locations" => locations)
    body_bytes = MsgPack.pack(error_body)

    ZMQ.send_multipart(server.socket, [
        identity,
        ZMQ.Message(""),
        ZMQ.Message(header_bytes),
        ZMQ.Message(body_bytes)
    ])
end

function send_not_found(server::EastServer, identity, request_id::String)
    response_header = Dict(
        "version" => 1,
        "request_id" => request_id,
        "message_type" => "NOT_FOUND",
        "execution_time_us" => 0
    )
    header_bytes = MsgPack.pack(response_header)

    ZMQ.send_multipart(server.socket, [
        identity,
        ZMQ.Message(""),
        ZMQ.Message(header_bytes)
    ])
end

function register_function(server::EastServer, name::String, ir)::String
    hash = compute_function_hash(ir)
    compiled_fn = compile_function(server, ir)
    server.function_cache[hash] = compiled_fn

    # Update registry
    register_with_discovery(server)

    hash
end

function stop_server(server::EastServer)
    server.running = false
    ZMQ.close(server.socket)
    ZMQ.close(server.context)

    # Cleanup
    socket_path = replace(server.endpoint, "ipc://" => "")
    isfile(socket_path) && rm(socket_path)
end

# Service discovery helpers
function register_with_discovery(server::EastServer)
    # Write JSON registry file
    registry_dir = "/tmp/east-registry"
    mkpath(registry_dir)

    entry = Dict(
        "runtime" => server.runtime_name,
        "pid" => server.pid,
        "endpoint" => server.endpoint,
        "functions" => Dict(
            hash => Dict("signature" => Dict(
                "inputs" => fn.input_types,
                "output" => fn.output_type
            ))
            for (hash, fn) in server.function_cache
        )
    )

    path = joinpath(registry_dir, "$(server.runtime_name)-$(server.pid).json")
    open(path, "w") do f
        # Use JSON serialization
        write(f, JSON.json(entry))
    end
end

end # module
```

### 7.3 ZeroMQ Client

```julia
# src/zeromq_client.jl
module ZeroMQClient

using ZMQ
using MsgPack
using UUIDs
using ..East: EastError
using ..Beast2: encode_beast2, decode_beast2

export call_runtime, close_client

# Global state
const connections = Dict{String, ZMQ.Socket}()
const pending_requests = Dict{String, Channel}()
const context = Ref{Union{Nothing, ZMQ.Context}}(nothing)

function get_context()
    if context[] === nothing
        context[] = ZMQ.Context()
    end
    context[]
end

function get_connection(endpoint::String)::ZMQ.Socket
    if !haskey(connections, endpoint)
        socket = ZMQ.Socket(get_context(), DEALER)
        ZMQ.set_linger(socket, 0)
        ZMQ.set_identity(socket, string(uuid4()))
        ZMQ.connect(socket, endpoint)
        connections[endpoint] = socket

        # Start response handler
        @async response_handler(endpoint, socket)
    end
    connections[endpoint]
end

function response_handler(endpoint::String, socket::ZMQ.Socket)
    while true
        try
            # Receive: [empty, header, body]
            frames = ZMQ.recv_multipart(socket)

            header_bytes = Vector{UInt8}(frames[2])
            body_bytes = length(frames) > 2 ? Vector{UInt8}(frames[3]) : UInt8[]

            header = MsgPack.unpack(header_bytes)
            request_id = header["request_id"]

            if haskey(pending_requests, request_id)
                ch = pop!(pending_requests, request_id)
                put!(ch, (header, body_bytes))
            end

        catch e
            @error "Client response handler error" exception=e
            break
        end
    end
end

function call_runtime(
    target_runtime::String,
    function_hash::String,
    arguments::Vector,
    input_types::Vector,
    output_type;
    ir=nothing,
    timeout_ms::Int=5000,
    depth::Int=0
)
    # Find endpoint
    endpoint = find_endpoint(target_runtime, function_hash)
    if endpoint === nothing
        error("No $target_runtime runtime found")
    end

    # Get connection
    socket = get_connection(endpoint)

    # Create request
    request_id = string(uuid4())
    has_ir = ir !== nothing

    # Build header
    header = Dict(
        "version" => 1,
        "request_id" => request_id,
        "message_type" => "CALL",
        "function_hash" => function_hash,
        "has_ir" => has_ir,
        "timeout_ms" => timeout_ms,
        "depth" => depth
    )
    header_bytes = MsgPack.pack(header)

    # Build body
    body_bytes = if has_ir
        encode_request_body_with_ir(ir, arguments, input_types)
    else
        encode_arguments(arguments, input_types)
    end

    # Send request: [empty, header, body]
    ZMQ.send_multipart(socket, [
        ZMQ.Message(""),
        ZMQ.Message(header_bytes),
        ZMQ.Message(body_bytes)
    ])

    # Create channel for response
    ch = Channel{Tuple}(1)
    pending_requests[request_id] = ch

    # Wait for response with timeout
    response = timedwait(timeout_ms / 1000) do
        take!(ch)
    end

    if response === :timed_out
        delete!(pending_requests, request_id)
        error("Cross-runtime call timed out after $(timeout_ms)ms")
    end

    response_header, response_body = response

    # Handle response
    message_type = response_header["message_type"]

    if message_type == "RESULT"
        result, _ = decode_beast2(output_type, response_body, 1)
        return result
    elseif message_type == "ERROR"
        error_info = MsgPack.unpack(response_body)
        throw(EastError(error_info["message"], error_info["locations"]))
    elseif message_type == "NOT_FOUND"
        if ir !== nothing
            # Retry with IR
            return call_runtime(target_runtime, function_hash, arguments,
                               input_types, output_type; ir=ir,
                               timeout_ms=timeout_ms, depth=depth)
        else
            error("Function $function_hash not found and IR not available")
        end
    else
        error("Unknown response type: $message_type")
    end
end

function encode_request_body_with_ir(ir, arguments::Vector, input_types::Vector)::Vector{UInt8}
    buffer = UInt8[]

    # Encode IR
    ir_bytes = encode_beast2(IRType, ir)
    append!(buffer, ir_bytes)

    # Encode arguments
    for (arg, arg_type) in zip(arguments, input_types)
        arg_bytes = encode_beast2(arg_type, arg)
        append!(buffer, arg_bytes)
    end

    buffer
end

function encode_arguments(arguments::Vector, input_types::Vector)::Vector{UInt8}
    buffer = UInt8[]
    for (arg, arg_type) in zip(arguments, input_types)
        arg_bytes = encode_beast2(arg_type, arg)
        append!(buffer, arg_bytes)
    end
    buffer
end

function find_endpoint(target_runtime::String, function_hash::String)::Union{String, Nothing}
    registry_dir = "/tmp/east-registry"
    if !isdir(registry_dir)
        return nothing
    end

    # Look for runtime instances
    for file in readdir(registry_dir)
        if startswith(file, target_runtime) && endswith(file, ".json")
            path = joinpath(registry_dir, file)
            entry = JSON.parsefile(path)

            # Check if process is alive
            try
                # Send signal 0 to check if alive
                ccall(:kill, Cint, (Cint, Cint), entry["pid"], 0)
                return entry["endpoint"]
            catch
                # Process dead, remove stale entry
                rm(path)
            end
        end
    end

    nothing
end

function close_client()
    for socket in values(connections)
        ZMQ.close(socket)
    end
    empty!(connections)

    if context[] !== nothing
        ZMQ.close(context[])
        context[] = nothing
    end
end

end # module
```

### 7.4 Platform Function Integration

```julia
# src/platform_zeromq.jl

using .ZeroMQClient: call_runtime

"""
Create platform function for calling Python runtime.
"""
function platform_call_python(
    function_hash::String,
    arguments::Vector,
    input_types::Vector,
    output_type;
    ir=nothing,
    timeout_ms::Int=5000,
    depth::Int=0
)
    call_runtime("python", function_hash, arguments, input_types, output_type;
                ir=ir, timeout_ms=timeout_ms, depth=depth+1)
end

"""
Create platform function for calling TypeScript runtime.
"""
function platform_call_typescript(
    function_hash::String,
    arguments::Vector,
    input_types::Vector,
    output_type;
    ir=nothing,
    timeout_ms::Int=5000,
    depth::Int=0
)
    call_runtime("typescript", function_hash, arguments, input_types, output_type;
                ir=ir, timeout_ms=timeout_ms, depth=depth+1)
end
```

---

## 8. TypeScript Runtime Implementation

### 8.1 Dependencies

```json
{
  "dependencies": {
    "zeromq": "^6.0.0",
    "@msgpack/msgpack": "^3.0.0"
  }
}
```

### 8.2 ZeroMQ Server

```typescript
// src/runtime/zeromq_server.ts
import * as zmq from "zeromq";
import { encode, decode } from "@msgpack/msgpack";
import { v4 as uuidv4 } from "uuid";
import {
  encodeBeast2ValueFor,
  decodeBeast2ValueFor,
  IRType
} from "../serialization/beast2";
import { compile_internal } from "../compile";
import { analyze_ir } from "../analyze";
import { EastError } from "../error";
import { PlatformFunction } from "../platform";

interface CompiledFunction {
  ir: any;
  compiled: (...args: any[]) => any;
  inputTypes: any[];
  outputType: any;
}

interface RequestHeader {
  version: number;
  request_id: string;
  message_type: "CALL";
  function_hash: string;
  has_ir: boolean;
  timeout_ms: number;
  depth: number;
}

export class EastZeroMQServer {
  private runtimeName: string;
  private pid: number;
  private endpoint: string;
  private socket: zmq.Router;
  private functionCache: Map<string, CompiledFunction>;
  private platform: PlatformFunction[];
  private running: boolean;

  constructor(runtimeName: string = "typescript", platform: PlatformFunction[] = []) {
    this.runtimeName = runtimeName;
    this.pid = process.pid;
    this.endpoint = `ipc:///tmp/east-${runtimeName}-${this.pid}.sock`;
    this.socket = new zmq.Router();
    this.functionCache = new Map();
    this.platform = platform;
    this.running = false;
  }

  async start(): Promise<void> {
    // Configure socket
    this.socket.routerMandatory = true;
    this.socket.linger = 0;

    // Bind to IPC endpoint
    await this.socket.bind(this.endpoint);
    console.log(`East ${this.runtimeName} server listening on ${this.endpoint}`);

    // Register with service discovery
    this.registerWithDiscovery();

    this.running = true;

    // Main message loop
    for await (const frames of this.socket) {
      if (!this.running) break;

      // Handle request asynchronously
      this.handleRequest(frames).catch(err => {
        console.error("Request handler error:", err);
      });
    }
  }

  private async handleRequest(frames: Buffer[]): Promise<void> {
    const startTime = process.hrtime.bigint();

    // Parse frames: [identity, empty, header, body]
    const identity = frames[0];
    // frames[1] is empty delimiter
    const headerBytes = frames[2];
    const bodyBytes = frames[3] || Buffer.alloc(0);

    // Decode header (msgpack)
    const header = decode(headerBytes) as RequestHeader;
    const requestId = header.request_id;

    try {
      // Check depth limit
      if (header.depth > 10) {
        throw new Error("Maximum call depth exceeded");
      }

      // Get or compile function
      const functionHash = header.function_hash;

      let compiledFn: CompiledFunction;
      let args: any[];

      if (!this.functionCache.has(functionHash)) {
        if (!header.has_ir) {
          // Function not cached and IR not provided
          await this.sendNotFound(identity, requestId);
          return;
        }

        // Decode IR and arguments
        const { ir, arguments: decodedArgs } = this.decodeRequestBodyWithIR(bodyBytes);

        // Compile and cache
        compiledFn = this.compileFunction(ir);
        this.functionCache.set(functionHash, compiledFn);
        args = decodedArgs;
      } else {
        // Function cached
        compiledFn = this.functionCache.get(functionHash)!;
        args = this.decodeArguments(bodyBytes, compiledFn.inputTypes);
      }

      // Execute function
      const result = await compiledFn.compiled(...args);

      // Calculate execution time
      const executionTimeUs = Number((process.hrtime.bigint() - startTime) / 1000n);

      // Send success response
      await this.sendResult(identity, requestId, result, compiledFn.outputType, executionTimeUs);

    } catch (error) {
      const executionTimeUs = Number((process.hrtime.bigint() - startTime) / 1000n);
      await this.sendError(identity, requestId, error as Error, executionTimeUs);
    }
  }

  private decodeRequestBodyWithIR(bodyBytes: Buffer): { ir: any; arguments: any[] } {
    // Decode IR
    const irDecoder = decodeBeast2ValueFor(IRType);
    const [ir, offset] = irDecoder(bodyBytes, 0);

    // Get input types from IR
    const fnType = ir.value.type.value;
    const inputTypes = fnType.inputs;

    // Decode arguments
    const args: any[] = [];
    let currentOffset = offset;
    for (const inputType of inputTypes) {
      const decoder = decodeBeast2ValueFor(inputType);
      const [arg, newOffset] = decoder(bodyBytes, currentOffset);
      args.push(arg);
      currentOffset = newOffset;
    }

    return { ir, arguments: args };
  }

  private decodeArguments(bodyBytes: Buffer, inputTypes: any[]): any[] {
    const args: any[] = [];
    let offset = 0;
    for (const inputType of inputTypes) {
      const decoder = decodeBeast2ValueFor(inputType);
      const [arg, newOffset] = decoder(bodyBytes, offset);
      args.push(arg);
      offset = newOffset;
    }
    return args;
  }

  private compileFunction(ir: any): CompiledFunction {
    // Analyze IR
    const analyzedIR = analyze_ir(ir);

    // Build platform map
    const platformFns: Record<string, (...args: any[]) => any> = {};
    const asyncPlatformFns = new Set<string>();
    for (const pf of this.platform) {
      platformFns[pf.name] = pf.fn;
      if (pf.type === "async") {
        asyncPlatformFns.add(pf.name);
      }
    }

    // Compile
    const compiled = compile_internal(analyzedIR, {}, platformFns, asyncPlatformFns);

    // Extract type info
    const fnType = ir.value.type.value;
    const inputTypes = fnType.inputs;
    const outputType = fnType.output;

    return {
      ir,
      compiled: (...args: any[]) => compiled(Object.fromEntries(
        ir.value.parameters.map((p: any, i: number) => [p.value.name, args[i]])
      )),
      inputTypes,
      outputType
    };
  }

  private async sendResult(
    identity: Buffer,
    requestId: string,
    result: any,
    outputType: any,
    execTimeUs: number
  ): Promise<void> {
    // Header
    const responseHeader = {
      version: 1,
      request_id: requestId,
      message_type: "RESULT",
      execution_time_us: execTimeUs
    };
    const headerBytes = Buffer.from(encode(responseHeader));

    // Body (Beast2-encoded result)
    const encoder = encodeBeast2ValueFor(outputType);
    const bodyBytes = Buffer.from(encoder(result));

    // Send: [identity, empty, header, body]
    await this.socket.send([identity, Buffer.alloc(0), headerBytes, bodyBytes]);
  }

  private async sendError(
    identity: Buffer,
    requestId: string,
    error: Error,
    execTimeUs: number
  ): Promise<void> {
    // Determine error type
    const isEastError = error instanceof EastError;
    const errorType = isEastError ? "east_error" : "internal";
    const message = error.message;
    const locations = isEastError ? (error as any).location : [];

    // Header
    const responseHeader = {
      version: 1,
      request_id: requestId,
      message_type: "ERROR",
      error_type: errorType,
      execution_time_us: execTimeUs
    };
    const headerBytes = Buffer.from(encode(responseHeader));

    // Body
    const errorBody = { message, locations };
    const bodyBytes = Buffer.from(encode(errorBody));

    await this.socket.send([identity, Buffer.alloc(0), headerBytes, bodyBytes]);
  }

  private async sendNotFound(identity: Buffer, requestId: string): Promise<void> {
    const responseHeader = {
      version: 1,
      request_id: requestId,
      message_type: "NOT_FOUND",
      execution_time_us: 0
    };
    const headerBytes = Buffer.from(encode(responseHeader));

    await this.socket.send([identity, Buffer.alloc(0), headerBytes]);
  }

  registerFunction(name: string, ir: any): string {
    const hash = computeFunctionHash(ir);
    const compiledFn = this.compileFunction(ir);
    this.functionCache.set(hash, compiledFn);
    this.registerWithDiscovery();
    return hash;
  }

  private registerWithDiscovery(): void {
    // Write JSON registry file
    const registryDir = "/tmp/east-registry";
    const fs = require("fs");

    if (!fs.existsSync(registryDir)) {
      fs.mkdirSync(registryDir, { recursive: true });
    }

    const entry = {
      runtime: this.runtimeName,
      pid: this.pid,
      endpoint: this.endpoint,
      functions: Object.fromEntries(
        Array.from(this.functionCache.entries()).map(([hash, fn]) => [
          hash,
          {
            signature: {
              inputs: fn.inputTypes,
              output: fn.outputType
            }
          }
        ])
      )
    };

    const path = `${registryDir}/${this.runtimeName}-${this.pid}.json`;
    fs.writeFileSync(path, JSON.stringify(entry));
  }

  async stop(): Promise<void> {
    this.running = false;
    this.socket.close();

    // Cleanup
    const fs = require("fs");
    const socketPath = this.endpoint.replace("ipc://", "");
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const registryPath = `/tmp/east-registry/${this.runtimeName}-${this.pid}.json`;
    if (fs.existsSync(registryPath)) {
      fs.unlinkSync(registryPath);
    }
  }
}

function computeFunctionHash(ir: any): string {
  const crypto = require("crypto");
  const encoder = encodeBeast2ValueFor(IRType);
  const beast2Bytes = encoder(ir);
  return crypto.createHash("sha256").update(beast2Bytes).digest("hex");
}
```

### 8.3 ZeroMQ Client (TypeScript)

```typescript
// src/runtime/zeromq_client.ts
import * as zmq from "zeromq";
import { encode, decode } from "@msgpack/msgpack";
import { v4 as uuidv4 } from "uuid";
import {
  encodeBeast2ValueFor,
  decodeBeast2ValueFor,
  IRType
} from "../serialization/beast2";
import { EastError } from "../error";

interface PendingRequest {
  resolve: (value: [any, Buffer]) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
}

export class EastZeroMQClient {
  private connections: Map<string, zmq.Dealer>;
  private pending: Map<string, PendingRequest>;
  private irCache: Map<string, any>;

  constructor() {
    this.connections = new Map();
    this.pending = new Map();
    this.irCache = new Map();
  }

  private async getConnection(endpoint: string): Promise<zmq.Dealer> {
    if (!this.connections.has(endpoint)) {
      const socket = new zmq.Dealer();
      socket.linger = 0;
      socket.routingId = Buffer.from(uuidv4());
      socket.connect(endpoint);

      this.connections.set(endpoint, socket);

      // Start response handler
      this.startResponseHandler(endpoint, socket);
    }

    return this.connections.get(endpoint)!;
  }

  private async startResponseHandler(endpoint: string, socket: zmq.Dealer): Promise<void> {
    for await (const frames of socket) {
      // frames: [empty, header, body]
      const headerBytes = frames[1] as Buffer;
      const bodyBytes = (frames[2] as Buffer) || Buffer.alloc(0);

      const header = decode(headerBytes) as any;
      const requestId = header.request_id;

      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.resolve([header, bodyBytes]);
      }
    }
  }

  async callFunction(
    targetRuntime: string,
    functionHash: string,
    args: any[],
    inputTypes: any[],
    outputType: any,
    ir?: any,
    timeoutMs: number = 5000,
    depth: number = 0
  ): Promise<any> {
    // Find endpoint
    const endpoint = this.findEndpoint(targetRuntime, functionHash);
    if (!endpoint) {
      throw new Error(`No ${targetRuntime} runtime found`);
    }

    // Get connection
    const socket = await this.getConnection(endpoint);

    // Create request
    const requestId = uuidv4();
    const hasIR = ir !== undefined && !this.irCache.has(functionHash);
    if (hasIR) {
      this.irCache.set(functionHash, ir);
    }

    // Build header
    const header = {
      version: 1,
      request_id: requestId,
      message_type: "CALL",
      function_hash: functionHash,
      has_ir: hasIR,
      timeout_ms: timeoutMs,
      depth
    };
    const headerBytes = Buffer.from(encode(header));

    // Build body
    const bodyBytes = hasIR
      ? this.encodeRequestBodyWithIR(ir, args, inputTypes)
      : this.encodeArguments(args, inputTypes);

    // Send request: [empty, header, body]
    await socket.send([Buffer.alloc(0), headerBytes, bodyBytes]);

    // Wait for response
    const [responseHeader, responseBody] = await new Promise<[any, Buffer]>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`Cross-runtime call timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        this.pending.set(requestId, { resolve, reject, timeout });
      }
    );

    // Handle response
    const messageType = responseHeader.message_type;

    if (messageType === "RESULT") {
      const decoder = decodeBeast2ValueFor(outputType);
      const [result] = decoder(responseBody, 0);
      return result;
    } else if (messageType === "ERROR") {
      const errorInfo = decode(responseBody) as any;
      throw new EastError(errorInfo.message, errorInfo.locations);
    } else if (messageType === "NOT_FOUND") {
      if (ir !== undefined) {
        // Retry with IR
        return this.callFunction(targetRuntime, functionHash, args,
                                 inputTypes, outputType, ir, timeoutMs, depth);
      } else {
        throw new Error(`Function ${functionHash.slice(0, 16)}... not found`);
      }
    } else {
      throw new Error(`Unknown response type: ${messageType}`);
    }
  }

  private encodeRequestBodyWithIR(ir: any, args: any[], inputTypes: any[]): Buffer {
    const chunks: Buffer[] = [];

    // Encode IR
    const irEncoder = encodeBeast2ValueFor(IRType);
    chunks.push(Buffer.from(irEncoder(ir)));

    // Encode arguments
    for (let i = 0; i < args.length; i++) {
      const encoder = encodeBeast2ValueFor(inputTypes[i]);
      chunks.push(Buffer.from(encoder(args[i])));
    }

    return Buffer.concat(chunks);
  }

  private encodeArguments(args: any[], inputTypes: any[]): Buffer {
    const chunks: Buffer[] = [];
    for (let i = 0; i < args.length; i++) {
      const encoder = encodeBeast2ValueFor(inputTypes[i]);
      chunks.push(Buffer.from(encoder(args[i])));
    }
    return Buffer.concat(chunks);
  }

  private findEndpoint(targetRuntime: string, functionHash: string): string | null {
    const fs = require("fs");
    const path = require("path");
    const registryDir = "/tmp/east-registry";

    if (!fs.existsSync(registryDir)) {
      return null;
    }

    const files = fs.readdirSync(registryDir);
    for (const file of files) {
      if (file.startsWith(targetRuntime) && file.endsWith(".json")) {
        const filePath = path.join(registryDir, file);
        const entry = JSON.parse(fs.readFileSync(filePath, "utf-8"));

        // Check if process is alive (simplified check)
        try {
          process.kill(entry.pid, 0);
          return entry.endpoint;
        } catch {
          // Process dead, remove stale entry
          fs.unlinkSync(filePath);
        }
      }
    }

    return null;
  }

  close(): void {
    for (const socket of this.connections.values()) {
      socket.close();
    }
    this.connections.clear();
  }
}
```

---

## 9. Complete Usage Example

### 9.1 Python Server Setup

```python
# example_python_server.py
import asyncio
from east.runtime.zeromq_server import EastZeroMQServer
from east.runtime.platform import PlatformFunction
from east.types.types import IntegerType, FloatType, ArrayType

# Define platform functions WITH RUNTIME METADATA
platform = [
    {
        "name": "numpy_sum",
        "inputs": [ArrayType(FloatType)],
        "output": FloatType,
        "type": "sync",
        "runtime": "python",  # This platform only exists in Python
        "fn": lambda arr: sum(arr)
    },
    {
        "name": "log",
        "inputs": [StringType],
        "output": NullType,
        "type": "sync",
        "runtime": None,  # Available in current runtime (no dispatch)
        "fn": print
    }
]

async def main():
    # Create server
    server = EastZeroMQServer("python", platform)

    # Pre-register a function with runtime metadata
    # This function is defined to run in Python
    sum_ir = {
        "type": "Function",
        "value": {
            "type": FunctionType([ArrayType(FloatType)], FloatType),
            "location": {"filename": "example.py", "line": 10, "column": 0},
            "captures": [],
            "parameters": [...],
            "body": {...},
            "runtime": "python"  # NEW: This function runs in Python
        }
    }
    hash = server.register_function("numpy_sum_array", sum_ir)
    print(f"Registered numpy_sum_array with hash: {hash[:16]}...")

    # Start server
    await server.start()

if __name__ == "__main__":
    asyncio.run(main())
```

### 9.2 Declarative Cross-Runtime Function Definition

```typescript
// example_cross_runtime.ts

// Define platform functions with their target runtimes
const numpy_preprocess = East.platform(
  "numpy_preprocess",
  [ArrayType(FloatType)],
  ArrayType(FloatType),
  { runtime: "python" }  // Only available in Python
);

const julia_optimize = East.platform(
  "julia_optimize",
  [ArrayType(FloatType)],
  FloatType,
  { runtime: "julia" }  // Only available in Julia
);

// Define a pipeline function
// By default, inherits runtime from caller (no explicit runtime)
const pipeline = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, rawData) => {
    // Step 1: Preprocess in Python
    // Compiler sees numpy_preprocess.runtime = "python"
    // If current runtime != python, dispatch inserted automatically
    const processed = $(numpy_preprocess(rawData));

    // Step 2: Compute in Julia
    // Compiler sees julia_optimize.runtime = "julia"
    // If current runtime != julia, dispatch inserted automatically
    const result = $(julia_optimize(processed));

    $.return(result);
  }
);

// When compiled in any runtime, the compiler automatically inserts
// IPC dispatch points based on the runtime fields
```

### 9.3 Nested Cross-Runtime Call (Declarative)

```typescript
// Define a Julia-specific function
const juliaCompute = East.function(
  [ArrayType(FloatType)],
  FloatType,
  { runtime: "julia" },  // This function MUST run in Julia
  ($, data) => {
    // Use Julia-specific platform function
    const optimized = $(julia_simd_sum(data));
    $.return(optimized);
  }
);

// Define a Python-specific function
const pythonPreprocess = East.function(
  [ArrayType(FloatType)],
  ArrayType(FloatType),
  { runtime: "python" },  // This function MUST run in Python
  ($, data) => {
    const normalized = $(numpy_normalize(data));
    $.return(normalized);
  }
);

// Define pipeline that orchestrates both (no explicit runtime = inherit)
const fullPipeline = East.function(
  [ArrayType(FloatType)],
  FloatType,
  ($, rawData) => {
    // These calls are AUTOMATICALLY dispatched based on runtime fields
    const preprocessed = $(pythonPreprocess(rawData));  // → Python
    const result = $(juliaCompute(preprocessed));       // → Julia
    $.return(result);
  }
);

// Compile in TypeScript runtime
const compiled = compile(fullPipeline.toIR(), platform);

// When executed:
// 1. fullPipeline runs in TypeScript (inherits caller's runtime)
// 2. pythonPreprocess(rawData) → IPC to Python runtime
// 3. juliaCompute(preprocessed) → IPC to Julia runtime
// 4. Result returns to TypeScript
compiled([1.0, 2.0, 3.0]);
```

### 9.4 Runtime Inheritance Example

```typescript
// Function with no explicit runtime (inherits)
const helper = East.function(
  [IntegerType],
  IntegerType,
  ($, x) => $.return(x.add(East.int(1)))
);

// Function that runs in Julia
const juliaMain = East.function(
  [IntegerType],
  IntegerType,
  { runtime: "julia" },
  ($, x) => {
    // helper() inherits julia runtime - NO dispatch
    const y = $(helper(x));
    $.return(y);
  }
);

// Function that runs in Python
const pythonMain = East.function(
  [IntegerType],
  IntegerType,
  { runtime: "python" },
  ($, x) => {
    // helper() inherits python runtime - NO dispatch
    const y = $(helper(x));
    $.return(y);
  }
);

// Same helper function, but runtime is determined by caller context
```

---

## 10. Performance Considerations

### 10.1 Expected Latencies

| Operation | Time (μs) |
|-----------|-----------|
| MessagePack encode header | 0.5-1 |
| MessagePack decode header | 0.5-1 |
| Beast2 encode small payload | 1-5 |
| Beast2 decode small payload | 1-5 |
| ZeroMQ IPC send/receive | 13-16 |
| **Total round-trip (small)** | **~20-30** |
| Beast2 encode large payload (1MB) | 50-200 |
| **Total round-trip (1MB)** | **~150-400** |

### 10.2 Optimization Strategies

1. **Function caching**: Send IR only once, use hash for subsequent calls
2. **Connection pooling**: Reuse DEALER sockets across calls
3. **Batching**: Combine multiple requests in single send (custom protocol extension)
4. **Pre-warming**: Compile hot functions at startup
5. **Async pipelining**: Send multiple requests without waiting

### 10.3 Monitoring

```python
# Add to server for metrics
class EastZeroMQServer:
    def get_stats(self) -> dict:
        return {
            "requests_handled": self.requests_handled,
            "avg_execution_time_us": (
                self.total_execution_time_us / self.requests_handled
                if self.requests_handled > 0 else 0
            ),
            "cached_functions": len(self.function_cache),
            "uptime_seconds": time.time() - self.start_time
        }
```

---

## 11. Error Handling Matrix

| Error Type | Client Action | Example |
|------------|---------------|---------|
| `east_error` | Propagate with stack trace | Division by zero, index out of bounds |
| `timeout` | Retry with backoff or fail | Network issue, slow computation |
| `serialization` | Log and fail (bug) | Type mismatch in Beast2 |
| `not_found` | Retry with IR, then fail | Function not cached |
| `internal` | Log and fail (bug) | Server crash |
| `connection_error` | Retry or find alternative | Server down |

---

## 12. Security Considerations

1. **Socket permissions**: Unix domain socket with 0600 permissions
2. **Registry isolation**: Per-user registry directory
3. **Depth limiting**: Prevent infinite recursion (max depth = 10)
4. **Timeout enforcement**: Prevent hung calls
5. **IR validation**: analyze_ir validates before compilation
6. **No arbitrary code**: Only execute pre-defined functions

---

## 13. Implementation Checklist

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] MessagePack header encoding/decoding
- [ ] Beast2 body encoding/decoding (already exists)
- [ ] ZeroMQ ROUTER server skeleton (Python)
- [ ] ZeroMQ DEALER client skeleton (Python)
- [ ] Basic request/response cycle
- [ ] Unit tests

### Phase 2: Function Management (Week 3)
- [ ] Function hash computation
- [ ] IR caching on server
- [ ] Lazy IR transfer protocol
- [ ] NOT_FOUND handling with retry
- [ ] Service registry (file-based)

### Phase 3: Multi-Runtime (Week 4-5)
- [ ] Julia server implementation
- [ ] Julia client implementation
- [ ] TypeScript server implementation
- [ ] TypeScript client implementation
- [ ] Cross-runtime integration tests

### Phase 4: Platform Integration (Week 6)
- [ ] Python platform functions (call_julia, call_typescript)
- [ ] Julia platform functions (platform_call_python, platform_call_typescript)
- [ ] TypeScript platform functions (callPython, callJulia)
- [ ] Depth tracking and limits
- [ ] Error propagation tests

### Phase 5: Production Hardening (Week 7-8)
- [ ] Connection pooling
- [ ] Timeout handling
- [ ] Heartbeat and cleanup
- [ ] Monitoring and metrics
- [ ] Performance benchmarking
- [ ] Documentation

---

## 14. Future Enhancements

1. **Shared memory path**: Hybrid approach for large payloads
2. **Load balancing**: Multiple instances per runtime with round-robin
3. **Service mesh**: Automatic discovery via mDNS or Consul
4. **Tracing**: OpenTelemetry integration for distributed tracing
5. **Rate limiting**: Prevent one runtime from overwhelming another
6. **Hot reloading**: Update functions without restart

---

## 15. Conclusion

This ZeroMQ-based architecture provides a production-ready solution for cross-runtime East function dispatch with:

- **~20-30 μs latency** for small payloads (acceptable for most use cases)
- **Simple implementation** leveraging existing Beast2 serialization
- **Mature library support** in Python (pyzmq), Julia (ZMQ.jl), TypeScript (zeromq.js)
- **Built-in patterns** (DEALER/ROUTER) for async multiplexed communication
- **Automatic connection management** and message framing

The design balances development speed with performance, providing a solid foundation that can be optimized further (shared memory, io_uring) if benchmarks reveal bottlenecks.
