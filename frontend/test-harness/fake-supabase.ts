// In-memory Supabase stand-in used by the Prompt 9 tests. It implements just the
// query builder shapes the user-data layer uses, including failure injection.

type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export class FakeSupabaseClient {
  tables: Tables;
  failures = new Set<string>();
  writes = 0;

  auth = {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };

  constructor(seed: Tables = {}) {
    this.tables = seed;
  }

  failOn(table: string) {
    this.failures.add(table);
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

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: ((row: Row) => boolean)[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private operation: { kind: "select" | "insert" | "upsert" | "update" | "delete"; payload?: any } = {
    kind: "select",
  };

  constructor(private client: FakeSupabaseClient, private table: string) {}

  select(_columns?: string) {
    this.operation = { kind: "select" };
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

  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private matching(): Row[] {
    return this.client.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)));
  }

  private run(): { data: any; error: any } {
    if (this.client.failures.has(this.table)) {
      return { data: null, error: new Error(`${this.table} unavailable`) };
    }

    const { kind, payload } = this.operation;
    const rows = this.client.rows(this.table);

    if (kind === "insert" || kind === "upsert") {
      const incoming: Row[] = Array.isArray(payload.rows ?? payload) ? payload.rows ?? payload : [payload.rows ?? payload];
      const conflictColumns: string[] =
        payload?.onConflict?.split(",").map((item: string) => item.trim()) ??
        Object.keys(incoming[0] ?? {}).slice(0, 1);

      for (const row of incoming) {
        const existingIndex = rows.findIndex((existing) =>
          conflictColumns.every((column) => String(existing[column]) === String(row[column])),
        );
        if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...row };
        else rows.push({ ...row });
      }

      this.client.writes += incoming.length;
      return { data: incoming, error: null };
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
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        const compared = left > right ? 1 : -1;
        return ascending ? compared : -compared;
      });
    }
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);

    return { data: result.map((row) => ({ ...row })), error: null };
  }

  async maybeSingle() {
    const { data, error } = this.run();
    return { data: Array.isArray(data) ? data[0] ?? null : data, error };
  }

  async single() {
    return this.maybeSingle();
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onFulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}
