#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The value from the environment at runtime, a local container whose password
is not a secret, a table of header NAMES, a template, and a script's main."""
import os

from east import East, StringType


def warehouse():
    return {
        "host": "warehouse.example.com",
        "user": "reporting",
        "password": os.environ["WAREHOUSE_PASSWORD"],
    }


LOCAL_FIXTURE = {
    "host": "localhost",
    "password": "devpassword",
}
HEADERS = {"api_key": "X-Api-Key", "token": "Authorization"}
TEMPLATE = {"token": "${GITHUB_TOKEN}"}

if __name__ == "__main__":
    print({"password": "a-script-argument-nobody-deploys"})
