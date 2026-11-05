export type DependencyStatus = "up" | "down";

export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  checks: Record<string, DependencyStatus>;
}

export type HealthCheck = () => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("health check timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Runs every dependency check in parallel. Error details are deliberately
 * not included in the report because the endpoint is unauthenticated.
 */
export async function runHealthChecks(
  checks: Record<string, HealthCheck>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<HealthReport> {
  const names = Object.keys(checks);
  const results = await Promise.allSettled(names.map((name) => withTimeout(checks[name]!(), timeoutMs)));

  const report: Record<string, DependencyStatus> = {};
  names.forEach((name, index) => {
    report[name] = results[index]!.status === "fulfilled" ? "up" : "down";
  });

  return {
    status: Object.values(report).every((value) => value === "up") ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: report
  };
}
