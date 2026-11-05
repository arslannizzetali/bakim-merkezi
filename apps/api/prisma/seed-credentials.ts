import { randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

/**
 * Refuses to run development seeding against a production environment.
 * Production tenants are bootstrapped with `seed-tenant.ts` instead.
 */
export function assertSeedAllowed(env: Env = process.env): void {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed with NODE_ENV=production. Use prisma/seed-tenant.ts for production tenants.");
  }
}

/** Generates a strong random password that satisfies common complexity rules. */
export function generatePassword(): string {
  return `${randomBytes(18).toString("base64url")}-Aa1!`;
}

export interface ResolvedPassword {
  password: string;
  generated: boolean;
}

/**
 * Reads a seed password from the given environment variable, or generates a
 * random one when the variable is missing or empty.
 */
export function resolveSeedPassword(variable: string, env: Env = process.env): ResolvedPassword {
  const value = env[variable]?.trim();
  if (value) {
    return { password: value, generated: false };
  }
  return { password: generatePassword(), generated: true };
}
