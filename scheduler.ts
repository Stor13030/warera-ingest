import type { Database } from "./queries.js";
import type { TaskFactory, TaskType } from "./tasks.js";
import { Worker } from "./worker.js";

export class Scheduler {
  private queue: TaskType[] = [];
  private activeWorkers = new Map<Worker, TaskType>();
  private readonly maxWorkers: number;

  constructor(private db: Database, private factory: TaskFactory, maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
  }

  enqueue(task: TaskType) {
    const alreadyPending = this.queue.includes(task);
    const alreadyRunning = [...this.activeWorkers.values()].includes(task);
    if (alreadyPending || alreadyRunning) return;
    this.queue.push(task);
    this.drain();
  }

  async cancelAll() {
    this.queue = [];
    await Promise.all(
      [...this.activeWorkers.keys()].map(w => w.cancelActive())
    );
  }

  private drain() {
    while (this.activeWorkers.size < this.maxWorkers && this.queue.length > 0) {
      const task = this.queue.shift()!;
      const worker = new Worker(this.db, this.factory);
      this.activeWorkers.set(worker, task);
      worker.run(task)
        .catch(err => {
          console.error(`Task ${task} failed:`, err);
        })
        .finally(() => {
          this.activeWorkers.delete(worker);
          this.drain();
        });
    }
  }
}
