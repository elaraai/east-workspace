/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Named function and one-shot execution client methods.
 *
 * Named functions are package-scoped (`functionList`, `functionCall`, …) or
 * workspace-scoped (`workspaceFunction*` — the package is whatever is
 * deployed in the workspace). One-shot runs caller-supplied IR and is
 * workspace-scoped + role-gated server-side.
 *
 * All call results are inline, bounded values (ExecuteResult) — nothing is
 * persisted server-side by a call.
 */

import type {
  FunctionSignature,
  FunctionCallRequest,
  ExecuteResult,
  OneShotRequest,
} from './types.js';
import {
  FunctionSignatureType,
  FunctionCallRequestType,
  ExecuteResultType,
  OneShotRequestType,
} from './types.js';
import { ArrayType } from '@elaraai/east';
import { get, post, type RequestOptions } from './http.js';

const enc = encodeURIComponent;

function pkgBase(repo: string, pkg: string, version: string, fn?: string): string {
  const base = `/repos/${enc(repo)}/packages/${enc(pkg)}/${enc(version)}/functions`;
  return fn !== undefined ? `${base}/${enc(fn)}` : base;
}

function wsBase(repo: string, ws: string, fn?: string): string {
  const base = `/repos/${enc(repo)}/workspaces/${enc(ws)}/functions`;
  return fn !== undefined ? `${base}/${enc(fn)}` : base;
}

function oneShotBase(repo: string, ws: string): string {
  return `/repos/${enc(repo)}/workspaces/${enc(ws)}/one-shot`;
}

// =============================================================================
// Package-scoped named functions
// =============================================================================

/** List a package's functions with their signatures. */
export async function functionList(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  options: RequestOptions
): Promise<FunctionSignature[]> {
  return get(url, pkgBase(repo, pkg, version), ArrayType(FunctionSignatureType), options);
}

/** Get a single function's signature (for encoding arguments). */
export async function functionDescribe(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  fn: string,
  options: RequestOptions
): Promise<FunctionSignature> {
  return get(url, pkgBase(repo, pkg, version, fn), FunctionSignatureType, options);
}

/** Call a function synchronously, returning its terminal ExecuteResult. */
export async function functionCall(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, pkgBase(repo, pkg, version, fn), req, FunctionCallRequestType, ExecuteResultType, options);
}




// =============================================================================
// Workspace-scoped named functions (package resolved from the deployment)
// =============================================================================

/** List the deployed package's functions. */
export async function workspaceFunctionList(
  url: string,
  repo: string,
  ws: string,
  options: RequestOptions
): Promise<FunctionSignature[]> {
  return get(url, wsBase(repo, ws), ArrayType(FunctionSignatureType), options);
}

/** Describe a function of the deployed package. */
export async function workspaceFunctionDescribe(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  options: RequestOptions
): Promise<FunctionSignature> {
  return get(url, wsBase(repo, ws, fn), FunctionSignatureType, options);
}

/** Call a function of the deployed package synchronously. */
export async function workspaceFunctionCall(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, wsBase(repo, ws, fn), req, FunctionCallRequestType, ExecuteResultType, options);
}




// =============================================================================
// One-shot (anonymous caller-supplied IR; server-side role gate)
// =============================================================================

/** Run an anonymous IR synchronously against a workspace. */
export async function oneShotExecute(
  url: string,
  repo: string,
  ws: string,
  req: OneShotRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, oneShotBase(repo, ws), req, OneShotRequestType, ExecuteResultType, options);
}



