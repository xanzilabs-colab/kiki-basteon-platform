import { vi } from "vitest";

export type FakeCall = { table: string; action: string; payload?: unknown; filters: [string, string, unknown][] };
export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };
type Handler = (call: FakeCall) => FakeResult | undefined;

/** Minimal chainable stand-in for the Supabase query builder used by route tests. */
export function fakeSupabase(handler: Handler, rpc: (name: string, args: Record<string, unknown>) => FakeResult = () => ({ data: null, error: null })) {
  const calls: FakeCall[] = [];
  const from = vi.fn((table: string) => {
    const call: FakeCall = { table, action: "select", filters: [] };
    calls.push(call);
    const resolve = () => {
      const result = handler(call) ?? {};
      return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
    };
    const builder: Record<string, unknown> = {};
    for (const action of ["insert", "update", "upsert", "delete"]) {
      builder[action] = vi.fn((payload?: unknown) => { call.action = action; call.payload = payload; return builder; });
    }
    builder.select = vi.fn(() => builder);
    for (const op of ["eq", "neq", "is", "in", "gte", "lte", "lt", "gt", "order", "limit"]) {
      builder[op] = vi.fn((column: string, value: unknown) => { call.filters.push([op, column, value]); return builder; });
    }
    builder.maybeSingle = vi.fn(async () => resolve());
    builder.single = vi.fn(async () => resolve());
    builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  });
  const rpcFn = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const result = rpc(name, args);
    return { data: result.data ?? null, error: result.error ?? null };
  });
  return { client: { from, rpc: rpcFn }, calls, rpc: rpcFn };
}

export function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { origin: "http://localhost", "x-forwarded-host": "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
