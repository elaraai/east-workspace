#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cross-language functions (#628): export a manifest, import by name, link
into self-contained IR, and run it — the python twin of
``libs/east/src/functions.spec.ts``."""

from __future__ import annotations

from datetime import UTC

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import East
from east.functions import IMPORT_PLATFORM, FunctionManifestType, function_ir
from east.runtime.compiler import compile_from_value
from east.runtime.errors import EastError
from east.runtime.platform import platform_function
from east.types.construct import none, some
from east.types.types import (
    ArrayType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    StringType,
    StructType,
)
from east.types.values import EastStruct
from east.utils.ordering import equal_for

Row = StructType([("qty", IntegerType), ("price", FloatType)])
log = East.platform("log", [StringType], NullType)

score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)


@East.function([StringType], NullType)
def shout(b, s):
    b.do(log(s.upper_case()))


def _count_imports(ir) -> int:
    from east.functions import _count_imports

    return _count_imports(ir)


class TestExport:
    def test_manifest_carries_ir_type_and_platforms_sorted_by_name(self):
        manifest = East.export_functions(
            "pricing", "1.2.3", {"score": score, "double": double, "shout": shout},
            providers={"log": "east-py-std"})
        assert manifest["package"] == "pricing"
        assert manifest["version"] == "1.2.3"
        assert [f["name"] for f in manifest["functions"]] == ["double", "score", "shout"]
        d, s, sh = list(manifest["functions"])
        assert d["ir"].type == "Function"
        assert s["type"].type == "Function"
        assert list(d["platforms"]) == []
        (dep,) = list(sh["platforms"])
        assert dep["name"] == "log"
        assert dep["async"] is False
        assert dep["provider"] == some("east-py-std")
        assert len(dep["inputs"]) == 1

    def test_manifest_round_trips_through_beast2(self):
        manifest = East.export_functions("pricing", "1.0.0", {"score": score, "shout": shout})
        back = East.decode_function_manifest(East.encode_function_manifest(manifest))
        assert equal_for(FunctionManifestType)(back, manifest)
        assert list(back["functions"])[1]["platforms"][0]["provider"] == none

    def test_a_build_hoisted_constant_is_not_a_capture(self):
        """#669: a build hoists a constant — a stdlib format-token table, an
        empty typed vector — into a ``Let`` above the ``Function`` and lists
        it in the function's captures. Nothing in the source captures
        anything, and the whole ``Block`` is what exports, so the binding
        travels with it. Closed means the IR binds every name it reads."""
        from east.types.types import DateTimeType, VectorType

        parse = East.function([StringType], DateTimeType,
                              lambda b, s: East.DateTime.parse_formatted(s, "YYYY-MM-DD HHmm"))
        manifest = East.export_functions("dates", "1.0.0", {"parse": parse})
        exported = list(manifest["functions"])[0]
        assert exported["ir"].type == "Block"      # the constant Let ships alongside
        assert exported["type"].type == "Function"

        imported = East.import_function("dates", "parse", FunctionType([StringType], DateTimeType))
        user = East.function([StringType], DateTimeType, lambda b, s: imported(s))
        ir, _imports = East.link_imports(user, [manifest])
        from datetime import datetime

        assert compile_from_value(ir, [])("2025-01-15 1430") == datetime(
            2025, 1, 15, 14, 30, tzinfo=UTC)

        # the other two shapes the same hoist produces
        printer = East.function([DateTimeType], StringType,
                                lambda b, d: East.DateTime.print_formatted(d, "YYYY-MM-DD"))
        zeros = East.function([], VectorType(FloatType),
                              lambda b: East.Vector.zeros(FloatType, 0))
        assert len(East.export_functions("p", "1", {"p": printer, "z": zeros})["functions"]) == 2

    def test_hoisted_constants_of_two_packages_do_not_collide(self):
        """#669: a build names its hoisted constants from a per-PROCESS
        counter, so two packages exported from two processes both start at
        ``__n0``. Linked together those Lets land in one scope — east-c binds
        a Block's statements in the enclosing environment, so the second
        would overwrite the first and BOTH functions would read it (silently,
        and only on that runner). Export renames them per package+function."""
        import itertools

        import east.expression.nodes as nodes
        from east.types.types import DateTimeType

        def dated(fmt):
            return East.function([DateTimeType], StringType,
                                 lambda b, d: East.DateTime.print_formatted(d, fmt))

        nodes._fresh_names = itertools.count()          # a fresh "process"
        p = East.export_functions("p", "1", {"f": dated("YYYY-MM-DD")})
        nodes._fresh_names = itertools.count()          # and another
        q = East.export_functions("q", "1", {"f": dated("DD/MM/YYYY")})

        def const_names(manifest):
            ir = list(manifest["functions"])[0]["ir"]
            return [s.value["variable"].value["name"] for s in list(ir.value["statements"])[:-1]]

        assert const_names(p) == ["_export_p_f_0"]
        assert const_names(q) == ["_export_q_f_0"]

        fp = East.import_function("p", "f", FunctionType([DateTimeType], StringType))
        fq = East.import_function("q", "f", FunctionType([DateTimeType], StringType))
        both = East.function([DateTimeType], StringType,
                             lambda b, d: East.String.concat(East.String.concat(fp(d), "|"), fq(d)))
        ir, _imports = East.link_imports(both, [p, q])
        from datetime import datetime

        assert compile_from_value(ir, [])(datetime(2025, 1, 15, tzinfo=UTC)) == \
            "2025-01-15|15/01/2025"

    def test_a_function_reading_a_name_its_ir_does_not_bind_is_still_refused(self):
        """The refusal keys on FREE variables, so a genuine closure — a
        capture nothing in the exported IR binds — is refused by name."""
        from east.ir.builders import ir_builtin, ir_variable
        from east.types.type_of_type import IRType
        from east.types.values import EastArray, EastVariant

        inner = function_ir(double)
        outer = ir_variable(IntegerType, "outer_thing", mutable=False, captured=True)
        fields = {k: inner.value[k] for k in inner.value}
        fields["captures"] = EastArray(IRType, [outer])
        fields["body"] = ir_builtin(IntegerType, "IntegerAdd", [], [fields["body"], outer])
        with pytest.raises(ValueError, match="reads outer_thing, which its own IR does not bind"):
            East.export_functions("p", "1", {"bad": EastVariant("Function", EastStruct(fields))})

    def test_a_bind_result_and_an_unlinked_importer_are_refused(self):
        bound = double.bind if hasattr(double, "bind") else None
        if bound is not None:
            with pytest.raises(TypeError, match="bind"):
                East.export_functions("p", "1", {"bound": bound(3)})
        imported = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))
        user = East.function([IntegerType], IntegerType, lambda b, x: imported(x))
        with pytest.raises(ValueError, match="unresolved import"):
            East.export_functions("p", "1", {"user": user})
        with pytest.raises(TypeError, match="East.function artifact"):
            East.export_functions("p", "1", {"plain": lambda x: x})


class TestImportAndLink:
    manifest = East.export_functions(
        "pricing", "1.0.0", {"score": score, "double": double, "shout": shout},
        providers={"log": "east-py-std"})

    def test_an_import_is_a_callable_expression_carrying_the_platform_node(self):
        imported = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))
        assert imported.ir.type == "Platform"
        assert imported.ir.value["name"] == IMPORT_PLATFORM
        user = East.function([IntegerType], IntegerType, lambda b, x: imported(x) + 1)
        assert _count_imports(function_ir(user)) == 1
        with pytest.raises(EastError, match="east.importFunction"):
            East.compile(user, [])(2)

    def test_linking_embeds_the_exported_ir_and_the_program_runs_on_east_c(self):
        imported = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))
        user = East.function([IntegerType], IntegerType, lambda b, x: imported(x) + 1)
        ir, imports = East.link_imports(user, [self.manifest])
        assert _count_imports(ir) == 0
        assert [(i["package"], i["name"]) for i in imports] == [("pricing", "double")]
        assert compile_from_value(ir, [])(20) == 41

    def test_a_use_inside_a_callback_captures_the_binding(self):
        s = East.import_function("pricing", "score", FunctionType([Row], FloatType))
        d = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))

        @East.function([ArrayType(Row)], FloatType)
        def user(b, rows):
            total = b.const(rows.map(lambda b, r: s(r)).sum())
            n = b.const(d(d(rows.size())))
            return total + n.to_float() + s(East.value(EastStruct({"qty": 1, "price": 0.5}), Row))

        ir, imports = East.link_imports(user, [self.manifest])
        assert [i["name"] for i in imports] == ["score", "double"]
        rows = [EastStruct({"qty": 2, "price": 1.5}), EastStruct({"qty": 3, "price": 2.0})]
        assert compile_from_value(ir, [])(rows) == 3 + 6 + 8 + 0.5

    def test_an_import_with_platform_dependencies_runs_with_the_platform(self):
        sh = East.import_function("pricing", "shout", FunctionType([StringType], NullType))

        @East.function([StringType], NullType)
        def user(b, s):
            b.do(sh(s))

        ir, imports = East.link_imports(user, [self.manifest])
        assert imports[0]["platforms"][0]["name"] == "log"
        assert imports[0]["platforms"][0]["provider"] == some("east-py-std")
        seen: list[str] = []

        @platform_function(inputs=[StringType], output=NullType, name="log")
        def log_impl(s: str) -> None:
            seen.append(s)

        compile_from_value(ir, [log_impl.east_platform_function])("hi")
        assert seen == ["HI"]

    def test_errors_name_the_import(self):
        wrong = East.import_function("pricing", "double", FunctionType([FloatType], FloatType))
        user = East.function([FloatType], FloatType, lambda b, x: wrong(x))
        with pytest.raises(ValueError, match='no function manifest for package "pricing"'):
            East.link_imports(user, [])
        with pytest.raises(ValueError, match="imported as .* but exported as"):
            East.link_imports(user, [self.manifest])
        missing = East.import_function("pricing", "nope", FunctionType([IntegerType], IntegerType))
        user2 = East.function([IntegerType], IntegerType, lambda b, x: missing(x))
        with pytest.raises(ValueError, match='exports no function "nope" — it exports double, score, shout'):
            East.link_imports(user2, [self.manifest])
        with pytest.raises(TypeError, match="needs a FunctionType"):
            East.import_function("pricing", "double", IntegerType)

    def test_a_function_without_imports_links_to_itself(self):
        ir, imports = East.link_imports(double, [self.manifest])
        assert imports == []
        assert ir is function_ir(double)

    def test_an_import_prints_as_east_import_function_and_rebuilds(self):
        from east.codegen import to_python_source

        imported = East.import_function("pricing", "double", FunctionType([IntegerType], IntegerType))
        user = East.function([IntegerType], IntegerType, lambda b, x: imported(x) + 1)
        source = to_python_source(user)
        assert "East.import_function('pricing', 'double', FunctionType([IntegerType], IntegerType))" in source
        namespace: dict = {}
        exec(compile(source, "<printed>", "exec"), namespace)
        assert diff_ir(function_ir(user), namespace["main"]._east_ir) is None

    def test_the_ts_parity_names_are_the_same_functions(self):
        assert East.importFunction is East.import_function
        assert East.exportFunctions is East.export_functions
        assert East.linkImports is East.link_imports
        assert East.platformDependencies is East.platform_dependencies
