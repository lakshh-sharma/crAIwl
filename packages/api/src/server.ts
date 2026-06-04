/**
 * Tiny framework-free HTTP server for the scope-confirmation flow.
 *
 * One real endpoint:
 *   POST /scope/confirm   { entryUrl, goal, userFields?, scope?, auth? }
 *                          → { config, estimate, usage, model }
 *
 * Plus a health probe at GET /healthz. No router, no framework — the
 * surface is small enough that a switch on method+path is honest.
 *
 * Auth profiles in the request body are looked up against the SecretsProvider
 * the caller supplied when constructing the server. That keeps secret
 * material on the server side and out of API responses.
 */

import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { confirmScope, ScopeConfirmError, type ScopeConfirmRequest } from './scope.js';
import type { LLMProvider, SecretsProvider } from '@craiwl/core';
import type { Fetcher } from '@craiwl/fetcher';

export type CreateServerOptions = {
  fetcher: Fetcher;
  llm: LLMProvider;
  /** Required when callers pass `auth` in their request body. */
  secrets?: SecretsProvider;
  /** Body size cap in bytes (default 1 MB) — prevents trivial DoS. */
  maxBodyBytes?: number;
  /** Override clock for deterministic tests. */
  now?: () => Date;
};

const DEFAULT_MAX_BODY = 1_048_576; // 1 MB

export type CraiwlServer = {
  server: Server;
  /** The port the server is listening on after `listen()`. */
  port(): number;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
};

export function createServer(opts: CreateServerOptions): CraiwlServer {
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const server = createNodeServer(async (req, res) => {
    try {
      await route(req, res, opts, maxBody);
    } catch (err) {
      sendJson(res, 500, { error: 'internal-error', message: (err as Error).message });
    }
  });

  return {
    server,
    port: () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return 0;
      return (addr as AddressInfo).port;
    },
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise<number>((resolve) => {
        server.listen(port, host, () => {
          const addr = server.address() as AddressInfo;
          resolve(addr.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CreateServerOptions,
  maxBody: number,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  if (method === 'GET' && url === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url === '/scope/confirm') {
    let body: ScopeConfirmRequest;
    try {
      body = (await readJson(req, maxBody)) as ScopeConfirmRequest;
    } catch (err) {
      sendJson(res, 400, { error: 'bad-request', message: (err as Error).message });
      return;
    }
    try {
      const result = await confirmScope(body, {
        fetcher: opts.fetcher,
        llm: opts.llm,
        ...(opts.secrets ? { secrets: opts.secrets } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof ScopeConfirmError) {
        sendJson(res, err.status, { error: 'scope-confirm-failed', message: err.message });
        return;
      }
      sendJson(res, 500, { error: 'compile-failed', message: (err as Error).message });
    }
    return;
  }

  sendJson(res, 404, { error: 'not-found', method, url });
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      received += chunk.length;
      if (received > maxBytes) {
        // Stop accumulating but let the request drain so the caller can
        // still send the 400 response without the client seeing a socket
        // reset. We surface the error from the 'end' handler instead.
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflowed) {
        reject(new Error(`request body exceeded ${maxBytes} bytes`));
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        reject(new Error('empty request body'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`invalid JSON: ${(err as Error).message}`));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
