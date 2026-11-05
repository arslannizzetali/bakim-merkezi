import cookieParser from "cookie-parser";
import express from "express";
import { env } from "./config/index.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { minioClient } from "./config/storage.js";
import { runHealthChecks } from "./utils/health.js";
import { routes } from "./routes/index.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security-headers.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(securityMiddleware);
  app.use(apiLimiter);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Liveness: the process is up. Does not touch dependencies.
  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Readiness: PostgreSQL, Redis and MinIO are all reachable.
  app.get("/health", async (_req, res) => {
    const report = await runHealthChecks({
      database: () => prisma.$queryRaw`SELECT 1`,
      redis: () => redis.ping(),
      storage: () => minioClient.bucketExists(env.MINIO_BUCKET)
    });
    res.status(report.status === "ok" ? 200 : 503).json(report);
  });

  app.use("/api/v1", routes);
  app.use(errorHandler);

  return app;
}
