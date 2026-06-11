#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""HTTP fetch platform functions for East.

Provides HTTP request operations for East programs running in Python.
The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported here for building inputs with ``coerce_to`` and validating
outputs.
"""

import urllib.error
import urllib.request
from typing import TypedDict, cast

from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    BlobType,
    BooleanType,
    DictType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastBlob, EastDict, EastStruct, EastVariant


class HttpMethodVariant(TypedDict):
    """HTTP method variant structure."""

    type: str  # "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"
    value: None


class OptionStringVariant(TypedDict):
    """Option variant structure for optional string."""

    type: str  # "some" or "none"
    value: str | None


class FetchRequestConfig(TypedDict):
    """HTTP request configuration structure."""

    url: str
    method: EastVariant[HttpMethodVariant]
    headers: EastDict
    body: EastVariant[OptionStringVariant]


class FetchResponse(TypedDict):
    """HTTP response structure."""

    status: int
    statusText: str
    headers: EastDict
    body: str
    ok: bool


# ============================================================================
# Type Definitions for Fetch
# ============================================================================

FetchMethodType = VariantType(
    [
        ("GET", NullType),
        ("POST", NullType),
        ("PUT", NullType),
        ("DELETE", NullType),
        ("PATCH", NullType),
        ("HEAD", NullType),
        ("OPTIONS", NullType),
    ]
)
"""HTTP method selector.

Cases: ``GET``, ``POST``, ``PUT``, ``DELETE``, ``PATCH``, ``HEAD``,
``OPTIONS``.
"""

FetchRequestConfigType = StructType(
    [
        ("url", StringType),
        ("method", FetchMethodType),
        ("headers", DictType(StringType, StringType)),
        ("body", OptionType(StringType)),
    ]
)
"""HTTP request configuration for ``fetch_request``.

Fields: ``url`` (``String``), ``method`` (``FetchMethodType``),
``headers`` (``Dict<String, String>``), ``body``
(``Option<String>`` - request body; ``none`` for bodyless methods).
"""

FetchResponseType = StructType(
    [
        ("status", IntegerType),
        ("statusText", StringType),
        ("headers", DictType(StringType, StringType)),
        ("body", StringType),
        ("ok", BooleanType),
    ]
)
"""HTTP response returned by ``fetch_request``.

Fields: ``status`` (``Integer`` - HTTP status code), ``statusText``
(``String`` - reason phrase), ``headers`` (``Dict<String, String>`` -
lowercase-normalised response headers), ``body`` (``String`` - UTF-8
decoded response body), ``ok`` (``Boolean`` - ``True`` when
200 <= status < 300).
"""


@platform_function(name="fetch_get", inputs=[StringType], output=StringType)
async def fetch_get_impl(url: str) -> str:
    """Perform an HTTP GET request and return the response body.

    Args:
        url: ``String`` (``str``) - URL to fetch.

    Returns:
        ``String`` (``str``) - UTF-8 decoded response body.

    Raises:
        Exception: If the request fails or the HTTP status is not 2xx.
    """
    import asyncio

    loop = asyncio.get_event_loop()

    def _fetch() -> str:
        response = urllib.request.urlopen(url)
        if response.status < 200 or response.status >= 300:
            raise Exception(f"HTTP {response.status}: {response.msg}")
        return response.read().decode("utf-8")

    return await loop.run_in_executor(None, _fetch)


@platform_function(name="fetch_get_bytes", inputs=[StringType], output=BlobType)
async def fetch_get_bytes_impl(url: str) -> EastBlob:
    """Perform an HTTP GET request and return the response body as raw bytes.

    Args:
        url: ``String`` (``str``) - URL to fetch.

    Returns:
        ``Blob`` (``EastBlob``) - raw response body bytes.

    Raises:
        Exception: If the request fails or the HTTP status is not 2xx.
    """
    import asyncio

    loop = asyncio.get_event_loop()

    def _fetch() -> EastBlob:
        response = urllib.request.urlopen(url)
        if response.status < 200 or response.status >= 300:
            raise Exception(f"HTTP {response.status}: {response.msg}")
        return EastBlob(response.read())

    return await loop.run_in_executor(None, _fetch)


@platform_function(name="fetch_post", inputs=[StringType, StringType], output=StringType)
async def fetch_post_impl(url: str, body: str) -> str:
    """Perform an HTTP POST request with a plain-text body.

    Sends ``body`` encoded as UTF-8 with ``Content-Type: text/plain``.

    Args:
        url: ``String`` (``str``) - URL to POST to.
        body: ``String`` (``str``) - request body.

    Returns:
        ``String`` (``str``) - UTF-8 decoded response body.

    Raises:
        Exception: If the request fails or the HTTP status is not 2xx.
    """
    import asyncio

    loop = asyncio.get_event_loop()

    def _fetch() -> str:
        req = urllib.request.Request(
            url, data=body.encode("utf-8"), headers={"Content-Type": "text/plain"}, method="POST"
        )
        response = urllib.request.urlopen(req)
        if response.status < 200 or response.status >= 300:
            raise Exception(f"HTTP {response.status}: {response.msg}")
        return response.read().decode("utf-8")

    return await loop.run_in_executor(None, _fetch)


@platform_function(name="fetch_request", inputs=[FetchRequestConfigType], output=FetchResponseType)
async def fetch_request_impl(config: EastStruct[FetchRequestConfig]) -> EastStruct[FetchResponse]:
    """Perform an HTTP request with full control over method, headers, and body.

    Non-2xx responses are captured rather than raised: check ``ok`` or ``status``
    on the returned struct. Network-level errors (DNS failure, connection refused,
    timeout) are raised as exceptions.

    Args:
        config: ``FetchRequestConfigType`` (``EastStruct``) with fields:

            - ``url`` (``String``): request URL.
            - ``method`` (``FetchMethodType``): HTTP verb (``GET``, ``POST``,
              ``PUT``, ``DELETE``, ``PATCH``, ``HEAD``, ``OPTIONS``).
            - ``headers`` (``Dict<String, String>``): additional request headers.
            - ``body`` (``Option<String>``): request body encoded as UTF-8;
              use ``none`` for bodyless methods.

    Returns:
        ``FetchResponseType`` (``EastStruct``): ``status`` (``Integer``),
        ``statusText`` (``String``), ``headers`` (``Dict<String, String>``
        with lowercase keys), ``body`` (``String``), ``ok`` (``Boolean``).

    Raises:
        Exception: On network-level failure (DNS, connection, timeout).
    """
    import asyncio

    loop = asyncio.get_event_loop()

    def _fetch() -> EastStruct[FetchResponse]:
        # Cast to TypedDict for type inference (workaround until EastStruct.__getitem__ is typed)
        cfg = cast(FetchRequestConfig, config)

        # Extract config fields
        url = cfg["url"]
        method_variant = cast(HttpMethodVariant, cfg["method"])
        headers_dict = cfg["headers"]
        body_option = cast(OptionStringVariant, cfg["body"])

        # Convert method variant to string
        method = method_variant["type"]

        # Convert headers dict to Python dict
        headers = dict(headers_dict.items())

        # Get body if present
        data = None
        if body_option["type"] == "some":
            body_str = body_option["value"]
            if body_str is not None:
                data = body_str.encode("utf-8")

        # Create request
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        # Execute request
        try:
            response = urllib.request.urlopen(req)
            status = response.status
            status_text = response.msg
            body = response.read().decode("utf-8")
            response_headers = dict(response.headers)
        except urllib.error.HTTPError as e:
            status = e.code
            status_text = e.msg
            body = e.read().decode("utf-8") if e.fp else ""
            response_headers = dict(e.headers)

        # Convert response headers to EastDict (lowercase keys for consistency)
        east_headers: EastDict = EastDict(
            StringType, StringType, {k.lower(): v for k, v in response_headers.items()}
        )

        # Create response struct (plain dict wrapped in EastStruct)
        return EastStruct(
            {
                "status": status,
                "statusText": status_text,
                "headers": east_headers,
                "body": body,
                "ok": (200 <= status < 300),
            }
        )

    return await loop.run_in_executor(None, _fetch)


# Collected from the @platform_function decorations above.
fetch_impl = platform_functions(__name__)


__all__ = [
    "fetch_impl",
    "fetch_get_impl",
    "fetch_get_bytes_impl",
    "fetch_post_impl",
    "fetch_request_impl",
    "FetchMethodType",
    "FetchRequestConfigType",
    "FetchResponseType",
]
