#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""FTP platform functions for East.

Provides FTP file transfer operations for East programs.  The ``*_impl``
functions are plain Python callables taking and returning East values - import
them directly from a project's own ``@platform_function`` to reuse the
implementations without an IR round-trip.
"""

import contextlib
import importlib.util
import uuid
from typing import Any

from east.runtime.platform import platform_function, platform_functions

_HAS_FTP_SUPPORT = importlib.util.find_spec("aioftp") is not None


def _check_ftp_support() -> None:
    """Raise if the ftp extra (aioftp) isn't installed."""
    if not _HAS_FTP_SUPPORT:
        raise NotImplementedError(
            "FTP support requires the 'ftp' extra. "
            "Add east-py-io[ftp] to your pyproject.toml dependencies."
        )
from east.types.types import BlobType, NullType, StringType
from east.types.values import EastArray, EastBlob, EastStruct

from .types import ConnectionHandleType, FileEntryType, FileListType, FtpConfigType

# Connection storage
_clients: dict[str, Any] = {}


@platform_function(
    name="ftp_connect", inputs=[FtpConfigType], output=ConnectionHandleType
)
async def ftp_connect_impl(config: EastStruct) -> str:
    """Open a connection to an FTP server and return a session handle.

    Args:
        config: ``FtpConfigType`` (``EastStruct``) with fields:

            - ``host`` (``String``): server hostname or IP.
            - ``port`` (``Integer``): server port (typically 21).
            - ``user`` (``String``): login username.
            - ``password`` (``String``): login password.
            - ``secure`` (``Boolean``): request TLS/AUTH TLS upgrade.

    Returns:
        ``ConnectionHandleType`` (``String``) - opaque UUID identifying the
        live session; pass to all subsequent ``ftp_*`` calls.

    Raises:
        NotImplementedError: the ``ftp`` extra (aioftp) is not installed.
        Exception: connection or login failure.
    """
    _check_ftp_support()
    import aioftp

    try:
        host = config["host"]
        port = int(config["port"])
        user = config["user"]
        password = config["password"]

        client = aioftp.Client()
        await client.connect(host, port)
        await client.login(user, password)

        handle = str(uuid.uuid4())
        _clients[handle] = client

        return handle
    except Exception as e:
        raise Exception(f"FTP connection failed: {e}") from e


@platform_function(
    name="ftp_put",
    inputs=[ConnectionHandleType, StringType, BlobType],
    output=NullType,
)
async def ftp_put_impl(handle: str, remote_path: str, data: EastBlob) -> None:
    """Upload a file to an FTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`ftp_connect_impl`.
        remote_path: ``String`` - destination path on the server.
        data: ``Blob`` (``EastBlob``) - binary content to upload.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or upload failure.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        async with client.upload_stream(remote_path) as stream:
            await stream.write(bytes(data))
    except Exception as e:
        raise Exception(f"FTP put failed: {e}") from e


@platform_function(
    name="ftp_get", inputs=[ConnectionHandleType, StringType], output=BlobType
)
async def ftp_get_impl(handle: str, remote_path: str) -> EastBlob:
    """Download a file from an FTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`ftp_connect_impl`.
        remote_path: ``String`` - source path on the server.

    Returns:
        ``Blob`` (``EastBlob``) - raw file content.

    Raises:
        Exception: invalid handle, or download failure.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        data = b""
        async with client.download_stream(remote_path) as stream:
            async for block in stream.iter_by_block():
                data += block

        return EastBlob(data)
    except Exception as e:
        raise Exception(f"FTP get failed: {e}") from e


@platform_function(
    name="ftp_list", inputs=[ConnectionHandleType, StringType], output=FileListType
)
async def ftp_list_impl(handle: str, remote_path: str) -> EastArray:
    """List entries in a directory on an FTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`ftp_connect_impl`.
        remote_path: ``String`` - directory path to list.

    Returns:
        ``Array<FileEntryType>`` (``EastArray``) - one ``FileEntryType``
        struct per entry: ``name`` (``String``), ``path`` (``String``),
        ``size`` (``Integer``), ``isDirectory`` (``Boolean``),
        ``modifiedTime`` (``String``).

    Raises:
        Exception: invalid handle, or listing failure.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        entries: EastArray = EastArray(FileEntryType, [])
        async for path, info in client.list(remote_path):
            entries.push_last(
                EastStruct(
                    {
                        "name": path.name,
                        "path": str(path),
                        "size": int(info.get("size", 0)),
                        "isDirectory": info.get("type") == "dir",
                        "modifiedTime": info.get("modify", ""),
                    }
                )
            )

        return entries
    except Exception as e:
        raise Exception(f"FTP list failed: {e}") from e


@platform_function(
    name="ftp_delete", inputs=[ConnectionHandleType, StringType], output=NullType
)
async def ftp_delete_impl(handle: str, remote_path: str) -> None:
    """Delete a file on an FTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`ftp_connect_impl`.
        remote_path: ``String`` - path of the file to delete.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or deletion failure.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        await client.remove(remote_path)
    except Exception as e:
        raise Exception(f"FTP delete failed: {e}") from e


@platform_function(name="ftp_close", inputs=[ConnectionHandleType], output=NullType)
def ftp_close_impl(handle: str) -> None:
    """Close a single FTP session (hard close, no QUIT command).

    Matches the TypeScript ``ftp_close`` which is synchronous - the
    underlying stream is closed directly without sending QUIT.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`ftp_connect_impl`.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or close failure.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        if hasattr(client, "stream") and client.stream:
            client.stream.close()
        del _clients[handle]
    except Exception as e:
        raise Exception(f"FTP close failed: {e}") from e


@platform_function(name="ftp_close_all", inputs=[], output=NullType)
async def ftp_close_all_impl() -> None:
    """Close all open FTP sessions with a graceful QUIT.

    Returns:
        ``Null`` on success.  Errors on individual sessions are suppressed.
    """
    for client in _clients.values():
        with contextlib.suppress(Exception):
            await client.quit()
    _clients.clear()


# Collected from the @platform_function decorations above.
ftp_impl = platform_functions(__name__)

__all__ = [
    "ftp_impl",
    "ftp_connect_impl",
    "ftp_put_impl",
    "ftp_get_impl",
    "ftp_list_impl",
    "ftp_delete_impl",
    "ftp_close_impl",
    "ftp_close_all_impl",
]
