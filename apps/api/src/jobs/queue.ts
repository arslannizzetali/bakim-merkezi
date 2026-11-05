import Queue from "bull";
import { env } from "../config/index.js";
import { processDocumentRetention } from "./document-retention.job.js";

export const retentionQueue = new Queue("document-retention", env.REDIS_URL);

export function registerQueues(): void {
  retentionQueue.process(async () => processDocumentRetention());

  retentionQueue.on("completed", (job, result: { deleted: number }) => {
    console.log(`[retention] job ${job.id} completed, ${result.deleted} document(s) deleted`);
  });

  // Failed jobs are kept in Redis (removeOnFail: false) so they can be
  // inspected and retried; this log line is what should trigger an alert.
  retentionQueue.on("failed", (job, error) => {
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(
      `[retention] job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}${final ? ", giving up" : ""}): ${error.message}`
    );
  });

  void retentionQueue.add(
    {},
    {
      repeat: {
        cron: "0 2 * * *",
        tz: "Europe/Istanbul"
      },
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  );
}
