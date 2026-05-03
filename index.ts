import { createAPIClient } from "@wareraprojects/api";
import { Database } from './queries.js';
import { TaskFactory } from "./tasks.js";
import { createServer } from "node:http";
import { TaskRegistry } from "./tasks.js";
import { Scheduler } from "./scheduler.js";

import type { PgOptions } from "./queries.js";
import type { TaskType } from "./tasks.js";

const pgConfig: PgOptions = {
  host: process.env.DB_HOST ?? 'localhost',
  database: process.env.DB_NAME ?? 'postgres',
  username: process.env.DB_USER ?? 'postgres',
  ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
  port: 5432,
};

// Main
async function main() {
  const apiKey = process.env.WARERA_API_KEY;
  if (!apiKey) {
    console.error("WARERA_API_KEY is not set. Please supply an API key.");
    process.exit(1);
  }

  const db = new Database(pgConfig);

  const client = createAPIClient({ apiKey });
  const factory = new TaskFactory(client, db);
  const scheduler = new Scheduler(db, factory)

  process.on('SIGINT', async () => {
    await scheduler.cancelAll();
    await db.end();
    process.exit(0);
  });

  const server = createServer((req, res) => {
    const task = req.url?.slice(1) as TaskType;
    if (!TaskRegistry[task]) {
      res.writeHead(400).end("Unknown task");
      return;
    }
    scheduler.enqueue(task);
    res.writeHead(202).end("Queued");
  });

  server.listen(3000, () => {
    console.log("Listening at http://localhost:3000");
  });
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
