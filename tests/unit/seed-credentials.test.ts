import { describe, expect, it } from "vitest";
import { assertSeedAllowed, resolveSeedPassword } from "../../apps/api/prisma/seed-credentials";

describe("seed credentials", () => {
  it("refuses to seed in production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });

  it("uses the password from the environment when provided", () => {
    expect(resolveSeedPassword("SEED_ADMIN_PASSWORD", { SEED_ADMIN_PASSWORD: "from-env" })).toEqual({
      password: "from-env",
      generated: false
    });
  });

  it("generates a strong unique password when the variable is missing or blank", () => {
    const first = resolveSeedPassword("SEED_ADMIN_PASSWORD", {});
    const second = resolveSeedPassword("SEED_ADMIN_PASSWORD", { SEED_ADMIN_PASSWORD: "  " });
    expect(first.generated).toBe(true);
    expect(first.password.length).toBeGreaterThanOrEqual(24);
    expect(first.password).not.toBe(second.password);
  });
});
