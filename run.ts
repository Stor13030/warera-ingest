import type { TaskType } from "./tasks.js";

export type RunStatus = "running" | "cancelled" | "failed" | "complete";

export class Run {
  id: number | null = null;
  runStart: Date;
  runEnd: Date | null = null;
  status: RunStatus = "running";
  itemsProcessed: number = 0;
  cursorStart: Date | null = null;
  cursorEnd: Date | null = null;

  constructor(
    public task: TaskType
  ) { this.runStart = new Date() }

  fail() {
    if (this.status != "running") throw new Error("Cannot complete a run that is not running");

    this.status = "failed";
    this.runEnd = new Date();
  }

  cancel() {
    if (this.status == "complete") throw new Error("Cannot cancel a completed run");
    if (this.status == "failed") throw new Error("Cannot cancel a failed run");

    this.status = "cancelled";
    this.runEnd = new Date();
  }

  complete() {
    if (this.status != "running") throw new Error("Cannot complete a run that is not running");
    this.status = "complete";
    this.runEnd = new Date();
  }
}
