#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A wire format you can only read by running it."""
from east import IntegerType, StringType, StructType

Source = StructType([("org", StringType), ("line", IntegerType)])
Derived = StructType([(f["name"], f["type"]) for f in Source.value])  # expect: no-derived-struct-fields
