// In-memory Supabase stand-in used by the user-data and comments tests. It
// implements just the query builder shapes those layers use, including failure
// injection, multi-column ordering, `in`, `range` and exact counts.

type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export class FakeSupabaseClient {
  tables: Tables;
  /** table -> error message (undefined message = default "<table> unavailable") */
  failures = new Map<string, string | undefined>();
  writes = 0;

  auth = {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };

  constructor(seed: Tables = {}) {
    this.tables = seed;
  }

  failOn(table: string, message?: string) {
    this.failures.set(table, message);
  }

  heal(table: string) {
    this.failures.delete(table);
  }

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private filters: ((row: Row) => boolean)[] = [];
  private orderBys: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private offsetCount = 0;
  private wantsCount = false;
  private headOnly = false;
  private operation: { kind: "select" | "insert" | "upsert" | "update" | "delete"; payload?: any } = {
    kind: "select",
  };

  constructor(private client: FakeSupabaseClient, private table: string) {}

  select(_columns?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    // `insert(...).select().single()` keeps the write, only the return shape changes.
    if (this.operation.kind === "select") this.operation = { kind: "select", payload: _columns };
    this.wantsCount = options?.count === "exact" || options?.count === "planned" || options?.count === "estimated";
    this.headOnly = options?.head === true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.operation = { kind: "insert", payload: rows };
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.operation = { kind: "upsert", payload: { rows, onConflict: options?.onConflict } };
    return this;
  }

  update(patch: Row) {
    this.operation = { kind: "update", payload: patch };
    return this;
  }

  delete() {
    this.operation = { kind: "delete" };
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }

  in(column: string, values: unknown[]) {
    const allowed = new Set((values ?? []).map((value) => String(value)));
    this.filters.push((row) => allowed.has(String(row[column])));
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBys.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.offsetCount = from;
    this.limitCount = Math.max(0, to - from + 1);
    return this;
  }

  private matching(): Row[] {
    return this.client.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)));
  }

  private run(): { data: any; error: any; count?: number | null } {
    if (this.client.failures.has(this.table)) {
      const message = this.client.failures.get(this.table);
      return { data: null, error: new Error(message ?? `${this.table} unavailable`), count: null };
    }

    const { kind, payload } = this.operation;
    const rows = this.client.rows(this.table);

    if (kind === "insert" || kind === "upsert") {
      const incoming: Row[] = Array.isArray(payload.rows ?? payload) ? payload.rows ?? payload : [payload.rows ?? payload];
      const conflictColumns: string[] =
        payload?.onConflict?.split(",").map((item: string) => item.trim()) ??
        Object.keys(incoming[0] ?? {}).slice(0, 1);

      const written: Row[] = [];
      for (const row of incoming) {
        // Real tables generate the id/timestamp when they are not supplied.
        const prepared: Row = {
          ...(row.id == null ? { id: `fake-${rows.length + written.length + 1}` } : {}),
          ...(row.created_at == null ? { created_at: new Date().toISOString() } : {}),
          ...row,
        };
        // `upsert` merges on its conflict target; a plain `insert` always appends.
        const existingIndex =
          kind === "upsert"
            ? rows.findIndex((existing) =>
                conflictColumns.every((column) => String(existing[column]) === String(prepared[column])),
              )
            : -1;
        if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...prepared };
        else rows.push({ ...prepared });
        written.push({ ...prepared });
      }

      this.client.writes += written.length;
      return { data: written, error: null };
    }

    if (kind === "update") {
      const targets = this.matching();
      for (const target of targets) Object.assign(target, payload);
      this.client.writes += targets.length;
      return { data: targets, error: null };
    }

    if (kind === "delete") {
      const targets = this.matching();
      const kept = rows.filter((row) => !targets.includes(row));
      this.client.tables[this.table] = kept;
      this.client.writes += targets.length;
      return { data: targets, error: null };
    }

    let result = this.matching();
    for (const { column, ascending } of [...this.orderBys].reverse()) {
      result = [...result].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        const compared = left > right ? 1 : -1;
        return ascending ? compared : -compared;
      });
    }
    if (this.offsetCount) result = result.slice(this.offsetCount);
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);

    const count = this.wantsCount ? this.matching().length : null;
    const data = this.headOnly ? null : result.map((row) => ({ ...row }));
    return { data, error: null, count };
  }

  async maybeSingle() {
    const { data, error } = this.run();
    return { data: Array.isArray(data) ? data[0] ?? null : data, error };
  }

  async single() {
    return this.maybeSingle();
  }

  then<TResult1 = { data: any; error: any; count?: number | null }, TResult2 = never>(
    onFulfilled?: ((value: { data: any; error: any; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}
