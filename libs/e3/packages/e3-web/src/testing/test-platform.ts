/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The platform package e3-web's runner specs serve their unit workers beside
 * east-node-std's — in Node's in-process workers, and in Chromium's Web
 * Workers — as an app serves its own (`serveUnits({ platforms })`).
 *
 * Its functions show what the specs need to see of a unit from outside it: a
 * greeting, which an app's package answers; a tick, which a unit that loops
 * calls, so a spec in the unit's thread sees whether it still runs; an echo
 * through the port the pool handed the unit's worker, which shows a package
 * reaching back to its host; and an exit, which closes a Web Worker as a
 * worker closes itself.
 *
 * @packageDocumentation
 */

import { East, IntegerType, NullType, StringType } from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import type { UnitConnection } from '../execution/pool.js';
import type { UnitPlatformContext, UnitPlatformPackage } from '../execution/unit-server.js';

/** The name tasks list the package under, as a runner's `{ custom }`
 *  platform. */
export const TEST_PLATFORM = 'e3-web-test';

/** `test_greet(name)`: a greeting from the app's package. */
export const test_greet = East.platform('test_greet', [StringType], StringType);

/** `test_tick()`: counts a call, in the thread the unit runs in. */
export const test_tick = East.platform('test_tick', [], IntegerType);

/** `test_host_echo(text)`: the text, echoed by the host through the port it
 *  handed the unit's worker. */
export const test_host_echo = East.asyncPlatform('test_host_echo', [StringType], StringType);

/** `test_wait()`: waits for the host to say, through the port, that it may go
 *  on. */
export const test_wait = East.asyncPlatform('test_wait', [], NullType);

/** `test_exit()`: closes the unit's Web Worker, as a worker closes itself, and
 *  never returns. */
export const test_exit = East.asyncPlatform('test_exit', [], NullType);

/** How many times `test_tick` has been called in this thread. */
let ticks = 0n;

/**
 * How many times `test_tick` has been called in this thread: a spec running
 * its units in process reads whether a unit still runs.
 *
 * @returns The count
 */
export function testTicks(): bigint {
  return ticks;
}

/**
 * Asks the host through the unit's port, and answers with what it says.
 *
 * @param context - The unit's context, with the port its worker was handed
 * @param ask - What is asked
 * @returns The host's answer
 */
function askHost(context: UnitPlatformContext, ask: string): Promise<string> {
  const port = context.port;
  if (port === null) return Promise.reject(new Error('the unit worker was handed no port'));
  return new Promise<string>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<string>) => {
      channel.port1.close();
      resolve(event.data);
    };
    port.postMessage(ask, [channel.port2]);
  });
}

/**
 * The package: its functions made for each unit, so `test_host_echo` reaches
 * the port the unit's worker was handed.
 */
export const testPlatform: UnitPlatformPackage = (context): PlatformFunction[] => [
  test_greet.implement((name: string) => `hello, ${name}`),
  test_tick.implement(() => {
    ticks += 1n;
    return ticks;
  }),
  test_host_echo.implement((text: string) => askHost(context, `echo:${text}`)),
  test_wait.implement(async () => {
    await askHost(context, 'wait');
    return null;
  }),
  test_exit.implement(() => {
    // A dedicated worker's scope closes it: no event tells its pool.
    (globalThis as unknown as { close(): void }).close();
    return new Promise<null>(() => undefined);
  }),
];

/**
 * The host side of the ports a pool hands its workers, as a spec serves it.
 */
export interface TestHost {
  /** Makes the services a worker is handed: the pool's `connect` */
  readonly connect: () => UnitConnection;
  /** What units have asked, in order: `echo:<text>`, or `wait` */
  readonly asked: readonly string[];
  /** How many of the ports it made the pool has closed, letting their
   *  workers go */
  readonly closed: () => number;
  /** Lets every wait asked go on, and every one asked after */
  release(): void;
  /** Closes every port it made, and every wait still asked */
  close(): void;
}

/**
 * Answers what units ask through the ports a pool hands its workers: an echo
 * at once, and a wait once `release` is called.
 *
 * @returns The host
 */
export function testHost(): TestHost {
  const asked: string[] = [];
  const ports: MessagePort[] = [];
  const waiting: MessagePort[] = [];
  let released = false;
  let closed = 0;
  return {
    asked,
    closed: () => closed,
    connect: () => {
      const channel = new MessageChannel();
      ports.push(channel.port1);
      channel.port1.onmessage = (event: MessageEvent<string>) => {
        const reply = event.ports[0]!;
        asked.push(event.data);
        if (event.data === 'wait' && !released) {
          waiting.push(reply);
          return;
        }
        reply.postMessage(event.data.startsWith('echo:') ? `${event.data.slice(5)}, from the host` : 'go on');
        reply.close();
      };
      let open = true;
      return {
        port: channel.port2,
        close: () => {
          if (!open) return;
          open = false;
          closed++;
          channel.port1.close();
        },
      };
    },
    release: () => {
      released = true;
      for (const reply of waiting.splice(0)) {
        reply.postMessage('go on');
        reply.close();
      }
    },
    close: () => {
      for (const reply of waiting.splice(0)) reply.close();
      for (const port of ports.splice(0)) port.close();
    },
  };
}
