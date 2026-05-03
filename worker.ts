import { Run } from "./run.js";
import type { TaskFactory, TaskType } from "./tasks.js";
import type { Database } from "./queries.js";

export class RunPersistence {
  private lastSavedCount = 0;
  private cursorStartSaved = false;

  constructor(
    private readonly run: Run,
    private readonly db: Database
  ) { }

  async maybeSave(): Promise<void> {
    const shouldSaveCursorStart = !this.cursorStartSaved && this.run.cursorStart !== null;
    const shouldSaveProgress = this.run.itemsProcessed - this.lastSavedCount >= 1000;

    if (shouldSaveCursorStart || shouldSaveProgress) {
      await this.db.saveRun(this.run);
      if (shouldSaveCursorStart) this.cursorStartSaved = true;
      this.lastSavedCount = this.run.itemsProcessed;
    }
  }

  async flush(): Promise<void> {
    await this.db.saveRun(this.run);
  }
}

export class Worker {
  private activeRun: Run | null = null;

  constructor(private db: Database, private factory: TaskFactory) { }

  async run(taskType: TaskType): Promise<void> {
    const run = new Run(taskType)
    run.id = await this.db.insertRun(run);
    this.activeRun = run;
    await this.execute(run);
    this.activeRun = null;
  }

  async cancelActive(): Promise<void> {
    if (!this.activeRun) return;
    this.activeRun.cancel();
    await this.db.saveRun(this.activeRun);
  }

  private async execute(run: Run): Promise<void> {
    const task = await this.factory.createTask(run.task);
    const persistence = new RunPersistence(run, this.db);

    try {
      for await (const { count } of task.execute(run)) {
        run.itemsProcessed += count;
        await persistence.maybeSave();
      }
      run.complete();
    } catch (err) {
      run.fail();
      throw err;
    } finally {
      await persistence.flush();
      console.log(`Done. ${run.itemsProcessed} items written.`);
    }
  }
}
