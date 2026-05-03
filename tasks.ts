import { parseCursorDate } from "./util.js";
import type { Database } from "./queries.js";
import type { APIClient } from "@wareraprojects/api";
import type { Run } from "./run.js";

export abstract class BaseTask {
  constructor(protected taskType: TaskType) { }
  abstract execute(run: Run): AsyncGenerator<{ count: number }>;
}

export class GetBestRegionsTask extends BaseTask {
  constructor(
    private readonly client: any,
    private readonly db: Database
  ) { super("best_regions") }

  async *execute(run: Run): AsyncGenerator<{ count: number }> {
    const cfg = await this.client.gameConfig.getGameConfig();
    const itemCodes = Object.values(cfg.items as Record<string, { code: string; productionPoints: number }>)
      .filter(item => item.productionPoints > 0)
      .map(item => item.code);

    for (const itemCode of itemCodes) {
      const result = await this.client.company.getRecommendedRegionIdsByItemCode({ itemCode });

      const values = Object.values(result as Record<string, any>).map((rec, index) => ({
        itemCode,
        rank: index + 1,
        recordedAt: run.runStart!,
        data: rec,
      }));

      await this.db.upsertBestRegions(values, this.taskType);
      yield { count: values.length };
    }
  }
}

// Shared logic: cursor tracking + upsert
interface Resumable {
  loadResumePoint(db: Database): Promise<void>;
}

function isResumable(task: BaseTask): task is BaseTask & Resumable {
  return "loadResumePoint" in task;
}

abstract class GetPaginatedTask extends BaseTask implements Resumable {
  protected resumeFrom: Date | undefined;

  constructor(
    taskType: TaskType,
    protected readonly db: Database,
  ) { super(taskType); }

  async loadResumePoint(db: Database): Promise<void> {
    const lastRunCursor = await db.getLastRun(this.taskType);
    this.resumeFrom = lastRunCursor ?? undefined;
  }

  protected abstract getPages(): AsyncIterable<{ cursor: string; items: { _id: string }[] }>;

  async *execute(run: Run): AsyncGenerator<{ count: number }> {
    for await (const page of this.getPages()) {
      const cursorDate = parseCursorDate(page.cursor);
      if (cursorDate) {
        if (!run.cursorStart) run.cursorStart = cursorDate;
        run.cursorEnd = cursorDate;
      }
      await this.db.upsertItems(
        page.items.map(i => ({ id: i._id, data: i })),
        this.taskType
      );
      yield { count: page.items.length };
    }
  }
}

export class GetTransactionsTask extends GetPaginatedTask {
  constructor(private client: APIClient, db: Database) {
    super("transactions", db);
  }

  protected getPages() {
    return this.client.transaction.getPaginatedTransactions({
      limit: 100,
      autoPaginate: true,
      ...(this.resumeFrom && { cursorEnd: this.resumeFrom }),
    });
  }
}

export class GetSanctionsTask extends GetPaginatedTask {
  constructor(private client: APIClient, db: Database) {
    super("sanctions", db);
  }

  protected getPages() {
    this.client.company.getRecommendedRegionIdsByItemCode
    return (this.client as any).sanction.getPaginated({
      limit: 100,
      autoPaginate: true,
      ...(this.resumeFrom && { cursorEnd: this.resumeFrom }),
    });
  }
}

export class GetActionTask extends GetPaginatedTask {
  constructor(private client: APIClient, db: Database) {
    super("actions", db);
  }

  protected getPages() {
    return (this.client as any).actionLog.getPaginated({
      limit: 100,
      autoPaginate: true,
      ...(this.resumeFrom && { cursorEnd: this.resumeFrom }),
    });
  }
}

export const TaskRegistry = {
  transactions: GetTransactionsTask,
  sanctions: GetSanctionsTask,
  actions: GetActionTask,
  best_regions: GetBestRegionsTask,
} as const

export type TaskType = keyof typeof TaskRegistry

export class TaskFactory {
  constructor(private client: APIClient, private db: Database) { }

  async createTask(type: TaskType): Promise<BaseTask> {
    const TaskClass = TaskRegistry[type];
    const task = new TaskClass(this.client, this.db);
    if (isResumable(task)) await task.loadResumePoint(this.db);
    return task;
  }
}
