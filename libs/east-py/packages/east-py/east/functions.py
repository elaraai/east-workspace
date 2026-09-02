#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cross-language East functions (#628): export, import, link.

A function authored in one host language is exported as pure IR — its
``Function`` node, the declared ``FunctionType`` and the platform functions
it calls — in a **function manifest** (``FunctionManifestType``, one beast2
value per package). Code in the other language refers to it with
``East.import_function(package, name, type)``: a typed, callable function
expression whose IR is a ``Platform`` node named :data:`IMPORT_PLATFORM`
carrying the package and function names — no new IR node kind, and loud if
it ever reaches a compiler unresolved. :func:`link_imports` resolves every
such node against the manifests: the declared type must equal the exported
type exactly, and the exported IR is embedded as a ``Let``-bound constant at
the top of the importing function's body (nested uses capture it), so the
linked program is self-contained IR that runs on any runner. The TypeScript
twin is ``libs/east/src/functions.ts`` (``East.exportFunctions``,
``East.importFunction``, ``East.linkImports``).
"""

from __future__ import annotations

import re
from typing import Any

from east.ir.builders import ir_block, ir_let, ir_platform, ir_value, ir_variable
from east.types.construct import none, some
from east.types.type_of_type import EastTypeType, IRType
from east.types.types import (
    ArrayType,
    BooleanType,
    EastType,
    NullType,
    OptionType,
    StringType,
    StructType,
)
from east.types.values import EastArray, EastStruct, EastVariant
from east.types.values.guards import is_east_array, is_east_struct, is_east_variant

__all__ = [
    "IMPORT_PLATFORM",
    "PlatformDependencyType",
    "FunctionExportType",
    "FunctionManifestType",
    "function_ir",
    "platform_dependencies",
    "export_functions",
    "encode_function_manifest",
    "decode_function_manifest",
    "import_function",
    "link_imports",
]

#: The platform name an unresolved ``East.import_function`` carries in IR.
IMPORT_PLATFORM = "east.importFunction"

#: One platform function an exported function calls: its name and signature
#: as the IR emits them, and — when the exporter could tell — the platform
#: package that implements it (``provider``). Fields are declared
#: alphabetically in both languages so the wire layout cannot depend on
#: declaration order.
PlatformDependencyType = StructType([
    ("async", BooleanType),
    ("inputs", ArrayType(EastTypeType)),
    ("name", StringType),
    ("optional", BooleanType),
    ("output", EastTypeType),
    ("provider", OptionType(StringType)),
    ("type_parameters", ArrayType(EastTypeType)),
])

#: One exported function: its IR, declared type, and platform dependencies.
FunctionExportType = StructType([
    ("ir", IRType),
    ("name", StringType),
    ("platforms", ArrayType(PlatformDependencyType)),
    ("type", EastTypeType),
])

#: A package's exported functions — what ``east-py export-functions`` /
#: ``East.export_functions`` write.
FunctionManifestType = StructType([
    ("functions", ArrayType(FunctionExportType)),
    ("package", StringType),
    ("version", StringType),
])


# ── the IR behind a function ─────────────────────────────────────────────────


def function_ir(fn_or_ir: Any) -> Any:
    """The IR value behind an ``East.function`` artifact, an expression, or an
    IR value — what every function-level API here takes.

    Raises:
        TypeError: For anything else — including a ``.bind`` result, which
            holds by-reference state and carries no IR of its own.
    """
    if is_east_variant(fn_or_ir):
        return fn_or_ir
    ir = getattr(fn_or_ir, "_east_ir", None)
    if ir is not None:
        return ir
    ir = getattr(fn_or_ir, "ir", None)
    if ir is not None and is_east_variant(ir):
        return ir
    raise TypeError(
        "expected an East.function artifact, a function expression, or an IR value"
        + (" — a .bind result holds by-reference state and cannot cross as a value"
           if callable(fn_or_ir) else ""))


def _root_function(ir: Any, what: str) -> Any:
    """The Function / AsyncFunction node: the root, or the last statement of
    the ``Block[Let…, Function]`` a build with hoisted constants emits."""
    root = ir
    if root.type == "Block":
        statements = list(root.value["statements"])
        root = statements[-1]
    if root.type not in ("Function", "AsyncFunction"):
        raise ValueError(f"{what}: expected a function's IR, got a {ir.type} node")
    return root


# ── walking and rebuilding IR ────────────────────────────────────────────────


def _walk(node: Any, visit: Any) -> None:
    """Depth-first over an IR value: ``visit(node)`` for every IR node."""
    if is_east_variant(node):
        visit(node)
        payload = node.value
        if is_east_struct(payload):
            for name, child in payload.items():
                if name in ("type", "loc_id", "type_parameters"):
                    continue
                _walk(child, visit)
        return
    if is_east_struct(node):
        for _name, child in node.items():
            _walk(child, visit)
        return
    if is_east_array(node) or isinstance(node, (list, tuple)):
        for child in node:
            _walk(child, visit)


def _rebuild(node: Any, replace: Any) -> Any:
    """``node`` with every IR node ``n`` for which ``replace(n)`` is not
    ``None`` swapped for that value, children first for the rest."""
    if is_east_variant(node):
        hit = replace(node)
        if hit is not None:
            return hit
        payload = node.value
        if not is_east_struct(payload):
            return node
        fields = {}
        for name, child in payload.items():
            if name in ("type", "loc_id", "type_parameters"):
                fields[name] = child
            else:
                fields[name] = _rebuild(child, replace)
        return EastVariant(node.type, EastStruct(fields))
    if is_east_struct(node):
        return EastStruct({name: _rebuild(child, replace) for name, child in node.items()})
    if is_east_array(node):
        return EastArray(node.element_type, [_rebuild(child, replace) for child in node])
    return node


# ── platform dependencies ────────────────────────────────────────────────────


def platform_dependencies(fn_or_ir: Any, providers: dict[str, str] | None = None) -> EastArray:
    """The platform functions an IR calls, in first-use order — the name,
    signature and asyncness each ``Platform`` node carries. Unresolved imports
    (:data:`IMPORT_PLATFORM`) are not dependencies and are skipped.

    Args:
        fn_or_ir: An ``East.function`` artifact, expression, or IR value.
        providers: Platform name → the package that implements it, when known.

    Returns:
        An ``EastArray`` of ``PlatformDependencyType`` values.
    """
    ir = function_ir(fn_or_ir)
    providers = providers or {}
    seen: dict[str, Any] = {}

    def visit(node: Any) -> None:
        if node.type != "Platform":
            return
        p = node.value
        name = p["name"]
        if name == IMPORT_PLATFORM or name in seen:
            return
        seen[name] = EastStruct({
            "async": bool(p["async"]),
            "inputs": EastArray(EastTypeType, [a.value["type"] for a in p["arguments"]]),
            "name": name,
            "optional": bool(p["optional"]),
            "output": p["type"],
            "provider": some(providers[name]) if name in providers else none,
            "type_parameters": EastArray(EastTypeType, list(p["type_parameters"])),
        })

    _walk(ir, visit)
    return EastArray(PlatformDependencyType, list(seen.values()))


# ── export ───────────────────────────────────────────────────────────────────


def export_functions(package: str, version: str, functions: dict[str, Any],
                     providers: dict[str, str] | None = None) -> EastStruct:
    """Build a package's function manifest from its named functions.

    Every function exports as a closed value: a function with captures (a
    closure over an enclosing body) is rejected, as is a ``.bind`` result (no
    IR of its own) and a function that itself holds an unresolved import —
    link before exporting; exports do not chain. The exported IR carries no
    location ids (a manifest has no source map).

    Args:
        package: The exporting package's name (what importers name).
        version: Its version.
        functions: Name → ``East.function`` artifact (or IR value).
        providers: Platform name → the package that implements it, recorded
            per dependency.

    Returns:
        The manifest value (``FunctionManifestType``); write it with
        :func:`encode_function_manifest`.

    Example::

        double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)
        manifest = East.export_functions("maths", "1.0.0", {"double": double})
        Path("maths.functions.beast2").write_bytes(East.encode_function_manifest(manifest))
    """
    if not package:
        raise ValueError("export_functions: the package name is empty")
    exports: list[EastStruct] = []
    for name in sorted(functions):
        try:
            ir = function_ir(functions[name])
        except TypeError as e:
            raise TypeError(f"export_functions: {name}: {e}") from None
        root = _root_function(ir, f"export_functions: {name}")
        captures = [v.value["name"] for v in root.value["captures"]]
        if captures:
            raise ValueError(
                f"export_functions: {name} captures {', '.join(captures)} — an exported function "
                "is a closed value; only functions with no captures export")
        imports = _count_imports(ir)
        if imports:
            raise ValueError(
                f"export_functions: {name} holds {imports} unresolved import(s) — link it "
                "(link_imports) before exporting; exports do not chain")
        exports.append(EastStruct({
            "ir": _strip_locations(ir),
            "name": name,
            "platforms": platform_dependencies(ir, providers),
            "type": root.value["type"],
        }))
    return EastStruct({
        "functions": EastArray(FunctionExportType, exports),
        "package": package,
        "version": version,
    })


def _strip_locations(node: Any) -> Any:
    """The IR with every ``loc_id`` zeroed: a manifest carries no source map,
    so the exporter's location ids would only collide with the importer's —
    an embedded function reports no location instead."""
    if is_east_variant(node):
        payload = node.value
        if not is_east_struct(payload):
            return node
        fields = {}
        for name, child in payload.items():
            if name == "loc_id":
                fields[name] = 0
            elif name in ("type", "type_parameters"):
                fields[name] = child
            else:
                fields[name] = _strip_locations(child)
        return EastVariant(node.type, EastStruct(fields))
    if is_east_struct(node):
        return EastStruct({name: _strip_locations(child) for name, child in node.items()})
    if is_east_array(node):
        return EastArray(node.element_type, [_strip_locations(child) for child in node])
    return node


def _count_imports(ir: Any) -> int:
    count = 0

    def visit(node: Any) -> None:
        nonlocal count
        if node.type == "Platform" and node.value["name"] == IMPORT_PLATFORM:
            count += 1

    _walk(ir, visit)
    return count


def encode_function_manifest(manifest: Any) -> bytes:
    """Encode a function manifest as beast2 — the file ``east-py
    export-functions`` / ``east-node export-functions`` write and ``e3
    export`` / :func:`link_imports` read, in either language."""
    from east.serialization.beast2 import encode_beast2_v5_for

    return encode_beast2_v5_for(FunctionManifestType)(manifest)


def decode_function_manifest(data: bytes) -> EastStruct:
    """Decode a function manifest written by either language."""
    from east.serialization.beast2 import decode_beast2_with_header_for

    return decode_beast2_with_header_for(FunctionManifestType)(data)


# ── import ───────────────────────────────────────────────────────────────────


def import_function(package: str, name: str, typ: EastType) -> Any:
    """Refer to a function exported by another package (in either language)
    as a typed, callable function expression.

    Unresolved, the reference is a ``Platform`` node named
    :data:`IMPORT_PLATFORM` whose arguments are the package and function
    names: compiling it without linking fails naming that platform.
    :func:`link_imports` replaces it with the exported IR, checked for exact
    type equality with ``typ``.

    Args:
        package: The exporting package's name (its manifest's ``package``).
        name: The function's name in that package.
        typ: The declared ``FunctionType`` / ``AsyncFunctionType``.

    Returns:
        A function expression of ``typ`` — call it inside a body.

    Example::

        score = East.import_function("pricing", "score", FunctionType([Row], FloatType))
        total = East.function([ArrayType(Row)], FloatType,
                              lambda b, rows: rows.map(lambda b, r: score(r)).sum())
    """
    from east.expression.expr.base import Expression

    if getattr(typ, "type", None) not in ("Function", "AsyncFunction"):
        kind = getattr(typ, "type", type(typ).__name__)
        raise TypeError(f"import_function: {package}.{name} needs a FunctionType or AsyncFunctionType, got {kind}")
    if not package or not name:
        raise TypeError("import_function: the package and function names are required")
    node = ir_platform(typ, IMPORT_PLATFORM,
                       [ir_value(StringType, package), ir_value(StringType, name)])
    return Expression(node, typ)


def _import_target(node: Any) -> tuple[str, str]:
    args = list(node.value["arguments"])
    if len(args) != 2 or any(a.type != "Value" for a in args):
        raise ValueError(f"{IMPORT_PLATFORM}: the package and function names must be string literals")
    return str(args[0].value["value"].value), str(args[1].value["value"].value)


# ── link ─────────────────────────────────────────────────────────────────────


def link_imports(fn_or_ir: Any, manifests: list) -> tuple[Any, list[dict[str, Any]]]:
    """Resolve every ``East.import_function`` reference in a function's IR
    against the given manifests and embed the exported IR.

    For each distinct (package, function): the manifest for the package must
    be present, the function must be in it, and the reference's declared
    type must equal the exported type exactly — each failure is an error
    naming the import (and, for a type mismatch, both types). The exported IR
    becomes a ``Let``-bound constant at the top of the importing function's
    body; a use inside a nested function captures it, so the nested
    functions' ``captures`` are extended. The result is self-contained IR
    with no import left.

    Args:
        fn_or_ir: An ``East.function`` artifact, expression, or IR value.
        manifests: The exporting packages' manifests (decoded values).

    Returns:
        ``(ir, imports)`` — the linked IR and, per import resolved in
        first-use order, ``{"package", "name", "type", "platforms"}``.
    """
    from east.types.types import is_type_equal

    ir = function_ir(fn_or_ir)
    by_package = {m["package"]: m for m in manifests}

    # Which imports the IR holds, and whether any use sits inside a nested
    # function (the binding is then captured).
    targets: dict[tuple[str, str], dict[str, Any]] = {}

    def scan(node: Any, depth: int) -> None:
        if is_east_variant(node):
            if node.type == "Platform" and node.value["name"] == IMPORT_PLATFORM:
                key = _import_target(node)
                typ = node.value["type"]
                hit = targets.get(key)
                if hit is None:
                    targets[key] = {"type": typ, "nested": depth > 0}
                else:
                    if not is_type_equal(hit["type"], typ):
                        raise ValueError(
                            f"link_imports: {key[0]}.{key[1]} is imported at two types — "
                            f"{hit['type']} and {typ}")
                    hit["nested"] = hit["nested"] or depth > 0
                return
            nested = node.type in ("Function", "AsyncFunction")
            payload = node.value
            if is_east_struct(payload):
                for name, child in payload.items():
                    if name not in ("type", "loc_id", "type_parameters"):
                        scan(child, depth + 1 if nested else depth)
            return
        if is_east_struct(node):
            for _name, child in node.items():
                scan(child, depth)
        elif is_east_array(node) or isinstance(node, (list, tuple)):
            for child in node:
                scan(child, depth)

    root = _root_function(ir, "link_imports")
    scan(root.value["body"], 0)
    if not targets:
        return ir, []

    # Resolve each against its manifest: present, named, and typed exactly.
    bindings: dict[tuple[str, str], dict[str, Any]] = {}
    imports: list[dict[str, Any]] = []
    for index, (key, target) in enumerate(targets.items()):
        package, name = key
        manifest = by_package.get(package)
        if manifest is None:
            raise ValueError(
                f'link_imports: no function manifest for package "{package}" (imported {package}.{name}) — '
                "export it (east-py export-functions / East.export_functions) and pass the manifest to the linker")
        exported = next((f for f in manifest["functions"] if f["name"] == name), None)
        if exported is None:
            names = ", ".join(f["name"] for f in manifest["functions"]) or "(none)"
            raise ValueError(f'link_imports: package "{package}" exports no function "{name}" — it exports {names}')
        if not is_type_equal(target["type"], exported["type"]):
            raise ValueError(
                f"link_imports: {package}.{name} is imported as {target['type']} "
                f"but exported as {exported['type']}")
        variable = ir_variable(
            target["type"], f"_import{index}_{_identifier(package)}_{_identifier(name)}",
            mutable=False, captured=target["nested"])
        bindings[key] = {"variable": variable, "export": exported}
        imports.append({"package": package, "name": name, "type": target["type"],
                        "platforms": list(exported["platforms"])})
    by_variable = {b["variable"].value["name"]: b["variable"] for b in bindings.values()}

    # Rewrite: references in place, captures on every enclosing nested function.
    def rebuild(node: Any, capture_stack: list[set[str]]) -> Any:
        def replace(n: Any) -> Any:
            if n.type == "Platform" and n.value["name"] == IMPORT_PLATFORM:
                binding = bindings[_import_target(n)]
                var_name = binding["variable"].value["name"]
                for captured in capture_stack:
                    captured.add(var_name)
                fields = dict(binding["variable"].value.items())
                fields["loc_id"] = n.value["loc_id"]
                return EastVariant("Variable", EastStruct(fields))
            if n.type in ("Function", "AsyncFunction"):
                mine: set[str] = set()
                body = rebuild(n.value["body"], [*capture_stack, mine])
                fields = dict(n.value.items())
                fields["body"] = body
                fields["captures"] = EastArray(
                    IRType, [*n.value["captures"], *(by_variable[v] for v in sorted(mine))])
                return EastVariant(n.type, EastStruct(fields))
            return None

        return _rebuild(node, replace)

    body = rebuild(root.value["body"], [])
    lets = [ir_let(NullType, b["variable"], b["export"]["ir"]) for b in bindings.values()]
    statements = [*lets, *(list(body.value["statements"]) if body.type == "Block" else [body])]
    linked_body = ir_block(statements[-1].value["type"], statements, loc_id=body.value["loc_id"])
    fields = dict(root.value.items())
    fields["body"] = linked_body
    linked_root: EastVariant = EastVariant(root.type, EastStruct(fields))
    if ir.type == "Block":
        outer = list(ir.value["statements"])
        return ir_block(ir.value["type"], [*outer[:-1], linked_root], loc_id=ir.value["loc_id"]), imports
    return linked_root, imports


def _identifier(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]+", "_", name)
