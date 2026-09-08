#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Both wire formats readable where they are declared."""
from east import IntegerType, StringType, StructType

Source = StructType([("org", StringType), ("line", IntegerType)])
Derived = StructType([("org", StringType), ("line", IntegerType)])
