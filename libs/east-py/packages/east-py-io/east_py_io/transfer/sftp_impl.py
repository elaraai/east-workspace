#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SFTP platform functions for East.

Provides SFTP file transfer operations for East programs.  The ``*_impl``
functions are plain Python callables taking and returning East values - import
them directly from a project's own ``@platform_function`` to reuse the
implementations without an IR round-trip.
"""

import importlib.util
import uuid
from typing import Any

from east.runtime.platform import platform_function, platform_functions

_HAS_SFTP_SUPPORT = importlib.util.find_spec("asyncssh") is not None


def _check_sftp_support() -> None:
    """Raise if the sftp extra (asyncssh) isn't installed."""
    if not _HAS_SFTP_SUPPORT:
        raise NotImplementedError(
            "SFTP support requires the 'sftp' extra. "
            "Add east-py-io[sftp] to your pyproject.toml dependencies."
        )
from east.types.types import BlobType, NullType, StringType
from east.types.values import EastArray, EastBlob, EastStruct

from .types import ConnectionHandleType, FileEntryType, FileListType, SftpConfigType

# Connection storage
_connections: dict[str, tuple[Any, Any]] = {}


@platform_function(
    name="sftp_connect",
    inputs=[SftpConfigType],
    output=ConnectionHandleType,
)
async def sftp_connect(config: EastStruct) -> str:
    """Open a connection to an SFTP server and return a session handle.

    Connects with a private key when ``privateKey`` is present; falls back
    to password authentication otherwise.  Host key checking is disabled
    (``known_hosts=None``).

    Args:
        config: ``SftpConfigType`` (``EastStruct``) with fields:

            - ``host`` (``String``): server hostname or IP.
            - ``port`` (``Integer``): server port (typically 22).
            - ``username`` (``String``): login username.
            - ``password`` (``Option<String>``): password; used when
              ``privateKey`` is absent.
            - ``privateKey`` (``Option<String>``): PEM-encoded private key;
              preferred over password when both are present.

    Returns:
        ``ConnectionHandleType`` (``String``) - opaque UUID identifying the
        live session; pass to all subsequent ``sftp_*`` calls.

    Raises:
        NotImplementedError: the ``sftp`` extra (asyncssh) is not installed.
        Exception: connection or authentication failure.
    """
    _check_sftp_support()
    import asyncssh

    try:
        host = config["host"]
        port = int(config["port"])
        username = config["username"]

        password_opt = config["password"]
        password = password_opt.value if password_opt.type == "some" else None

        private_key_opt = config["privateKey"]
        private_key = private_key_opt.value if private_key_opt.type == "some" else None

        if private_key:
            conn = await asyncssh.connect(
                host,
                port=port,
                username=username,
                client_keys=[private_key],
                known_hosts=None,
            )
        else:
            conn = await asyncssh.connect(
                host,
                port=port,
                username=username,
                password=password,
                known_hosts=None,
            )

        sftp = await conn.start_sftp_client()

        handle = str(uuid.uuid4())
        _connections[handle] = (conn, sftp)

        return handle
    except Exception as e:
        raise Exception(f"SFTP connection failed: {e}") from e


@platform_function(
    name="sftp_put",
    inputs=[ConnectionHandleType, StringType, BlobType],
    output=NullType,
)
async def sftp_put(handle: str, remote_path: str, data: EastBlob) -> None:
    """Upload a file to an SFTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`sftp_connect`.
        remote_path: ``String`` - destination path on the server.
        data: ``Blob`` (``EastBlob``) - binary content to upload.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or upload failure.
    """
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        async with sftp.open(remote_path, "wb") as f:
            await f.write(bytes(data))
    except Exception as e:
        raise Exception(f"SFTP put failed: {e}") from e


@platform_function(
    name="sftp_get",
    inputs=[ConnectionHandleType, StringType],
    output=BlobType,
)
async def sftp_get(handle: str, remote_path: str) -> EastBlob:
    """Download a file from an SFTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`sftp_connect`.
        remote_path: ``String`` - source path on the server.

    Returns:
        ``Blob`` (``EastBlob``) - raw file content.

    Raises:
        Exception: invalid handle, or download failure.
    """
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        async with sftp.open(remote_path, "rb") as f:
            data = await f.read()
            return EastBlob(data if isinstance(data, bytes) else data.encode())
    except Exception as e:
        raise Exception(f"SFTP get failed: {e}") from e


@platform_function(
    name="sftp_list",
    inputs=[ConnectionHandleType, StringType],
    output=FileListType,
)
async def sftp_list(handle: str, remote_path: str) -> EastArray:
    """List entries in a directory on an SFTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`sftp_connect`.
        remote_path: ``String`` - directory path to list.

    Returns:
        ``Array<FileEntryType>`` (``EastArray``) - one ``FileEntryType``
        struct per entry: ``name`` (``String``), ``path`` (``String``),
        ``size`` (``Integer``), ``isDirectory`` (``Boolean``),
        ``modifiedTime`` (``String`` - mtime as a numeric string, or empty).

    Raises:
        Exception: invalid handle, or listing failure.
    """
    import asyncssh

    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        entries: EastArray = EastArray(FileEntryType, [])
        async for entry in sftp.scandir(remote_path):
            entries.push_last(
                EastStruct(
                    {
                        "name": entry.filename,
                        "path": f"{remote_path}/{entry.filename}",
                        "size": entry.attrs.size or 0,
                        "isDirectory": entry.attrs.type == asyncssh.FILEXFER_TYPE_DIRECTORY,
                        "modifiedTime": str(entry.attrs.mtime or ""),
                    }
                )
            )

        return entries
    except Exception as e:
        raise Exception(f"SFTP list failed: {e}") from e


@platform_function(
    name="sftp_delete",
    inputs=[ConnectionHandleType, StringType],
    output=NullType,
)
async def sftp_delete(handle: str, remote_path: str) -> None:
    """Delete a file on an SFTP server.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`sftp_connect`.
        remote_path: ``String`` - path of the file to delete.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or deletion failure.
    """
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]
        await sftp.remove(remote_path)
    except Exception as e:
        raise Exception(f"SFTP delete failed: {e}") from e


@platform_function(
    name="sftp_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def sftp_close(handle: str) -> None:
    """Close a single SFTP session gracefully.

    Exits the SFTP subsystem then closes the underlying SSH connection.

    Args:
        handle: ``ConnectionHandleType`` (``String``) - session handle from
            :func:`sftp_connect`.

    Returns:
        ``Null`` on success.

    Raises:
        Exception: invalid handle, or close failure.
    """
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        conn, sftp = _connections[handle]
        sftp.exit()
        conn.close()
        del _connections[handle]
    except Exception as e:
        raise Exception(f"SFTP close failed: {e}") from e


@platform_function(
    name="sftp_close_all",
    inputs=[],
    output=NullType,
)
async def sftp_close_all() -> None:
    """Close all open SFTP sessions.

    Exits each SFTP subsystem and closes its SSH connection.  Errors on
    individual sessions are suppressed.

    Returns:
        ``Null`` on success.
    """
    for conn, sftp in _connections.values():
        try:
            sftp.exit()
            conn.close()
        except Exception:
            pass
    _connections.clear()


# Collected from the @platform_function decorations above.
sftp_impl = platform_functions(__name__)

__all__ = [
    "sftp_impl",
    "sftp_connect",
    "sftp_put",
    "sftp_get",
    "sftp_list",
    "sftp_delete",
    "sftp_close",
    "sftp_close_all",
]
