#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The typed expression classes — one per East type kind, one file each,
mirroring ``libs/east/src/expr/*.ts``:

==========================  ==================  ================================
python                      TypeScript          file
==========================  ==================  ================================
``Expression``              ``Expr``            ``base.py`` / ``expr.ts``
``NullExpression``          ``NullExpr``        ``null.py``
``NeverExpression``         ``NeverExpr``       ``never.py``
``BooleanExpression``       ``BooleanExpr``     ``boolean.py``
``IntegerExpression``       ``IntegerExpr``     ``integer.py``
``FloatExpression``         ``FloatExpr``       ``float.py``
``StringExpression``        ``StringExpr``      ``string.py``
``DateTimeExpression``      ``DateTimeExpr``    ``datetime.py``
``BlobExpression``          ``BlobExpr``        ``blob.py``
``RefExpression``           ``RefExpr``         ``ref.py``
``ArrayExpression``         ``ArrayExpr``       ``array.py``
``SetExpression``           ``SetExpr``         ``set.py``
``DictExpression``          ``DictExpr``        ``dict.py``
``StructExpression``        ``StructExpr``      ``struct.py``
``VariantExpression``       ``VariantExpr``     ``variant.py``
``RecursiveExpression``     ``RecursiveExpr``   ``recursive.py``
``FunctionExpression``      ``FunctionExpr``    ``function.py``
``AsyncFunctionExpression`` ``AsyncFunctionExpr`` ``asyncfunction.py``
``VectorExpression``        ``VectorExpr``      ``vector.py``
``MatrixExpression``        ``MatrixExpr``      ``matrix.py``
==========================  ==================  ================================

``Expression(ir, east_type)`` returns the class for the type's kind; the
TypeScript names are available as aliases (``ArrayExpr`` is
``ArrayExpression``) so a program ported name for name reads the same.
"""

from east.expression.expr.array import ArrayExpression
from east.expression.expr.asyncfunction import AsyncFunctionExpression
from east.expression.expr.base import Expression
from east.expression.expr.blob import BlobExpression
from east.expression.expr.boolean import BooleanExpression
from east.expression.expr.datetime import DateTimeExpression
from east.expression.expr.dict import DictExpression
from east.expression.expr.float import FloatExpression
from east.expression.expr.function import FunctionExpression
from east.expression.expr.integer import IntegerExpression
from east.expression.expr.matrix import MatrixExpression
from east.expression.expr.never import NeverExpression
from east.expression.expr.null import NullExpression
from east.expression.expr.recursive import RecursiveExpression
from east.expression.expr.ref import RefExpression
from east.expression.expr.set import SetExpression
from east.expression.expr.string import StringExpression
from east.expression.expr.struct import StructExpression
from east.expression.expr.variant import VariantExpression
from east.expression.expr.vector import VectorExpression

# The TypeScript class names, for programs ported name for name.
Expr = Expression
NullExpr = NullExpression
NeverExpr = NeverExpression
BooleanExpr = BooleanExpression
IntegerExpr = IntegerExpression
FloatExpr = FloatExpression
StringExpr = StringExpression
DateTimeExpr = DateTimeExpression
BlobExpr = BlobExpression
RefExpr = RefExpression
ArrayExpr = ArrayExpression
SetExpr = SetExpression
DictExpr = DictExpression
StructExpr = StructExpression
VariantExpr = VariantExpression
RecursiveExpr = RecursiveExpression
FunctionExpr = FunctionExpression
AsyncFunctionExpr = AsyncFunctionExpression
VectorExpr = VectorExpression
MatrixExpr = MatrixExpression

__all__ = [
    "Expression",
    "NullExpression",
    "NeverExpression",
    "BooleanExpression",
    "IntegerExpression",
    "FloatExpression",
    "StringExpression",
    "DateTimeExpression",
    "BlobExpression",
    "RefExpression",
    "ArrayExpression",
    "SetExpression",
    "DictExpression",
    "StructExpression",
    "VariantExpression",
    "RecursiveExpression",
    "FunctionExpression",
    "AsyncFunctionExpression",
    "VectorExpression",
    "MatrixExpression",
    "Expr",
    "NullExpr",
    "NeverExpr",
    "BooleanExpr",
    "IntegerExpr",
    "FloatExpr",
    "StringExpr",
    "DateTimeExpr",
    "BlobExpr",
    "RefExpr",
    "ArrayExpr",
    "SetExpr",
    "DictExpr",
    "StructExpr",
    "VariantExpr",
    "RecursiveExpr",
    "FunctionExpr",
    "AsyncFunctionExpr",
    "VectorExpr",
    "MatrixExpr",
]
