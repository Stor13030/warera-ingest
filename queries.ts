import postgres from 'postgres';
import type { JSONValue } from 'postgres';
import type { TaskType } from './tasks.js';
import type { Run } from './run.js';

const taskTables: Record<TaskType, string> = {
  transactions: "transactions_raw",
  sanctions: "sanctions_raw",
  actions: "actions_raw",
  usernames: "usernames",
  best_regions: "best_regions_raw"
};

export type PgOptions = {
  host: string,
  database: string,
  username: string,
  password?: string,
  port: number
};

export class Database {
  private readonly sql: postgres.Sql;
  private savedStates = new WeakMap<Run, Partial<Run>>();

  constructor(config: PgOptions) {
    this.sql = postgres(config);
  }

  async end() { await this.sql.end(); }

  async getLastRun(task: TaskType): Promise<Date | null> {
    const [lastRun] = await this.sql<{ cursor_start: Date }[]>`
    SELECT cursor_start FROM run_history
    WHERE status = 'complete'
      AND cursor_start IS NOT NULL
      AND task = ${task}
    ORDER BY run_end DESC
    LIMIT 1
  `;
    return lastRun?.cursor_start ?? null;
  }

  async getUnknownUsers(): Promise<string[]> {
    const users = await this.sql<{ id: string }[]>`
      SELECT id FROM usernames
      WHERE username IS NULL
    `;
    return users.map((u: { id: string }) => u.id);
  }

  async insertRun(
    run: Run,
  ): Promise<number> {
    const [row] = await this.sql<{ id: number }[]>`
      INSERT INTO run_history (task, run_start, status, items_processed)
      VALUES (${run.task}, ${run.runStart}, ${run.status}, ${run.itemsProcessed})
      RETURNING id
    `;
    if (!row) throw new Error("Insert returned no row");
    return row.id;
  }

  async insertItems(
    values: {
      id: string;
      data: any,
    }[],
    task: TaskType
  ): Promise<void> {
    if (values.length === 0) return;
    const table = taskTables[task];
    const rows = values.map(v => ({ id: v.id, data: this.sql.json(v.data as unknown as JSONValue) }));

    await this.sql`
      INSERT INTO ${this.sql(table)} ${this.sql(rows, 'id', 'data')}
      ON CONFLICT(id) DO NOTHING
    `;
  }

  async upsertUsernames(
    values: {
      id: string,
      username: string | null,
    }[]
  ): Promise<void> {
    if (values.length === 0) return;
    const rows = [...new Map(values.map(v => [v.id, v])).values()];

    await this.sql`
    INSERT INTO usernames ${this.sql(rows, 'id', 'username')}
    ON CONFLICT(id) DO UPDATE SET username = EXCLUDED.username
  `;
  }

  async insertBestRegions(
    values: {
      itemCode: string,
      rank: number,
      recordedAt: Date,
      data: any
    }[],
    task: TaskType
  ): Promise<void> {
    if (values.length === 0) return;
    const table = taskTables[task];
    const rows = values.map(v => ({
      item_code: v.itemCode,
      rank: v.rank,
      recorded_at: v.recordedAt,
      data: this.sql.json(v.data as unknown as JSONValue)
    }));

    await this.sql`
      INSERT INTO ${this.sql(table)} ${this.sql(rows, 'item_code', 'rank', 'recorded_at', 'data')}
      ON CONFLICT(item_code, rank, recorded_at) DO NOTHING
    `;
  }

  async saveRun(run: Run): Promise<void> {
    if (!run.id) return;
    const saved = this.savedStates.get(run) ?? {};
    const update = this.diffRun(run, saved);
    if (Object.keys(update).length === 0) return;
    await this.sql`UPDATE run_history SET ${this.sql(update)} WHERE id = ${run.id}`;
    this.savedStates.set(run, { ...run });
  }

  private diffRun(current: Run, saved: Partial<Run>): Record<string, unknown> {
    const update: Record<string, unknown> = {};
    if (current.runStart !== (saved.runStart ?? null)) update.run_start = current.runStart;
    if (current.runEnd !== (saved.runEnd ?? null)) update.run_end = current.runEnd;
    if (current.status !== saved.status) update.status = current.status;
    if (current.itemsProcessed !== (saved.itemsProcessed ?? 0)) update.items_processed = current.itemsProcessed;
    if (current.cursorStart !== (saved.cursorStart ?? null)) update.cursor_start = current.cursorStart;
    if (current.cursorEnd !== (saved.cursorEnd ?? null)) update.cursor_end = current.cursorEnd;
    return update;
  }
}

