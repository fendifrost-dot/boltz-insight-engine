import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DbError = { message: string; code?: string } | null;

export type DbResult<T> = {
  data: T;
  error: DbError;
  count: number | null;
};

export interface SquareQuery<T> extends PromiseLike<DbResult<T>> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): SquareQuery<T>;
  insert(values: unknown): SquareQuery<T>;
  upsert(values: unknown, options?: { onConflict?: string }): SquareQuery<T>;
  update(values: unknown): SquareQuery<T>;
  delete(): SquareQuery<T>;
  eq(column: string, value: unknown): SquareQuery<T>;
  in(column: string, values: readonly unknown[]): SquareQuery<T>;
  is(column: string, value: null): SquareQuery<T>;
  order(column: string, options?: { ascending?: boolean }): SquareQuery<T>;
  limit(count: number): SquareQuery<T>;
  range(from: number, to: number): SquareQuery<T>;
  maybeSingle(): Promise<DbResult<T | null>>;
}

export function squareFrom<T = unknown>(table: string): SquareQuery<T> {
  const client = supabaseAdmin as unknown as { from: (name: string) => SquareQuery<T> };
  return client.from(table);
}

export async function unwrapDb<T>(result: PromiseLike<DbResult<T>>): Promise<T> {
  const resolved = await result;
  if (resolved.error) throw dbFailure(resolved.error);
  return resolved.data;
}

export function dbFailure(error: { code?: string }): Error {
  return new Error(`square_storage_${error.code ?? "db_error"}`);
}
