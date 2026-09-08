#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Secrets written into source that compiles to replicated IR."""
from east import East, StringType

WAREHOUSE = {
    "host": "warehouse.example.com",
    "user": "reporting",
    "password": "hunter2",  # expect: no-inline-credentials
}
BUCKET = {
    "endpoint": "s3.example.com",
    "secret_access_key": "AKIAIOSFODNN7EXAMPLE",  # expect: no-inline-credentials
}
