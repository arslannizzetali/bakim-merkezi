import { describe, expect, it } from "vitest";
import { runHealthChecks } from "../../apps/api/src/utils/health";

describe("runHealthChecks", () => {
  it("reports ok when every dependency is up", async () => {
    const report = await runHealthChecks({ database: async () => 1, redis: async () => "PONG" });
    expect(report.status).toBe("ok");
    expect(report.checks).toEqual({ database: "up", redis: "up" });
  });

  it("reports degraded and marks the failing dependency down", async () => {
    const report = await runHealthChecks({
      database: async () => 1,
      storage: async () => {
        throw new Error("connection refused");
      }
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.storage).toBe("down");
    expect(JSON.stringify(report)).not.toContain("connection refused");
  });

  it("treats a hanging dependency as down after the timeout", async () => {
    const report = await runHealthChecks({ redis: () => new Promise(() => undefined) }, 20);
    expect(report.checks.redis).toBe("down");
  });
});
