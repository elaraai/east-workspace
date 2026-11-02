# Cross-language functions

`east-py export-functions` and `East.import_function`. Part of the `east-py` skill.

## Cross-language functions: `east-py export-functions` and `East.import_function`

A python `East.function` is *called* from a TypeScript e3 task — and a
TypeScript one from python — as pure IR: no python at run time, no platform
bridge. The functions travel as a **function manifest** (each function's IR,
declared type and platform dependencies with the package providing each);
the importer names the function and declares its type; linking checks the
type exactly and embeds the IR. Declare them on the package's root module:

```python
# packages/pricing/src/pricing/__init__.py — the package's root module
from east import East
from east.types.types import FloatType, StructType, IntegerType

Row = StructType([("qty", IntegerType), ("price", FloatType)])
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
east_functions = {"score": score}          # name -> East.function artifact. CLOSED values: the
                                           # exported IR must BIND every name it reads. A captured
                                           # lookup table or a stdlib format string is a literal in
                                           # the body and closes over nothing; a .bind result (no IR
                                           # of its own) and an unresolved import are refused, and a
                                           # genuinely free variable is refused BY NAME
```

```typescript
// the e3 task, in TypeScript (see the e3 skill) — the reference is all there is to write:
// e3.export finds `pricing` in the uv workspace, exports it (east-py export-functions, in the
// project's .venv) and links; the providers come from the task's runner
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));
await e3.export(pkg, "out.zip");
```

e3 exports each workspace package in one `east-py export-functions --batch`
process, however many tasks import from it, and keeps the manifests, so a
redeploy whose python has not changed runs no export (the **e3** skill). A
function's manifest entry is its own: the same bytes whatever else the process
built first and whatever directory it ran in, so a task embedding it keeps its
hash until the function, or a line it was written at, changes.

For a package built elsewhere (published, another repo), or to link
in-process, write the manifest where the package lives and pass it:

```bash
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std
#   -p names the platform package implementing each platform call the functions make;
#   a call no package provides fails the export (the manifest records the provider)
#   → e3.export(pkg, "out.zip", { functions: ["./pricing.functions.beast2"] })
```

The other direction, in python:

```python
manifest = East.decode_function_manifest(Path("maths.functions.beast2").read_bytes())  # east-node export-functions wrote it
double = East.import_function("maths", "double", FunctionType([IntegerType], IntegerType))
user = East.function([IntegerType], IntegerType, lambda b, x: double(x) + 1)   # callable in a body
ir, imports = East.link_imports(user, [manifest])       # exact type check; the IR embedded as a Let
compile_from_value(ir, [])(20)                          # 41 — pure IR, runs on any runner
```

Unlinked, the reference is a `Platform` node named `east.importFunction`, and
compiling it raises naming that platform. `East.export_functions(pkg, version,
{…}, providers)` and `East.encode_function_manifest` are the API behind the CLI,
and `East.platform_dependencies(fn)` lists the platform functions an artifact
calls, in first-use order (unresolved imports skipped). Each also answers to its
TypeScript camelCase name (`East.exportFunctions`, `East.linkImports`, …). The
contract and the runner rules: `docs/conventions/EAST_CODEGEN.md`.
