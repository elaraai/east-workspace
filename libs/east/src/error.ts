/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { Location } from "./location.js";

/**
 * Internal error for invariant violations in the East compiler/runtime.
 * These indicate bugs in East itself, not user errors.
 */
export class InternalError extends Error {
  constructor(message: string) {
    super(`Internal East error: ${message}`);
    this.name = "InternalError";
  }
}

export class EastError extends Error {
  public location: Location[];
  public eastMessage: string;

  constructor(message: string, options: { cause?: any, location?: Location[] } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.eastMessage = message;
    this.location = options.location ?? [];
  }

  override toString(): string {
    // Format matches east-c / east-py: message on one line, innermost-first
    // `  at <file>:<line>:<col>` frames below. Caller typically prefixes the
    // whole thing with `Error: ` when printing to stderr.
    const lines = [this.eastMessage];
    for (const frame of this.location) {
      lines.push(`  at ${frame.filename}:${frame.line}:${frame.column}`);
    }
    return lines.join("\n");
  }

  get formattedMessage(): string {
    return this.toString();
  }
}
