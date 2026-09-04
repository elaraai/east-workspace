#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The variable name in the IR, the value from the environment — and a local
container, whose password is not a secret."""
from east import East, StringType

WAREHOUSE = {
    "host": "warehouse.example.com",
    "user": "reporting",
    "password": East.Env.get("WAREHOUSE_PASSWORD"),
}
LOCAL_FIXTURE = {
    "host": "localhost",
    "password": "devpassword",
}
