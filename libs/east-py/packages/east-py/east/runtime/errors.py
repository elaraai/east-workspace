#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East runtime error types.

Separated from compiler.py to avoid circular imports when builtins
need to raise EastError.
"""

from east.types.values import EastArray


class EastError(Exception):
    """Exception for East errors that preserves IR source locations.

    This exception carries the original IR location information from where
    the error was raised, enabling accurate stack traces that reference
    the original East source code rather than Python runtime locations.

    The location is an EastArray of location structs (matching TypeScript).
    """

    def __init__(self, message: str, location: EastArray):
        self.message = message
        self.location = location  # EastArray of {filename, line, column} structs
        super().__init__(message)

    def __str__(self) -> str:
        """Format error with location and stack trace."""
        if len(self.location) == 0:
            return self.message

        loc = self.location[0]
        header = f"{loc['filename']}:{loc['line']}:{loc['column']}: {self.message}"

        if len(self.location) <= 1:
            return header

        # Build stack trace (skip first since it's in the header)
        lines = [header, "Stack trace:"]
        for frame in self.location[1:]:
            lines.append(f"  at {frame['filename']}:{frame['line']}:{frame['column']}")

        return "\n".join(lines)


def _wrap_exception_with_location(exc: Exception, location: EastArray) -> EastError:
    """Wrap or augment an exception with IR source location.

    If the exception is already an EastError, extends the location stack.
    Otherwise, creates a new EastError with the exception message and location.
    """
    if isinstance(exc, EastError):
        exc.location.extend(location)
        return exc
    return EastError(str(exc), location)


__all__ = ["EastError", "_wrap_exception_with_location"]
