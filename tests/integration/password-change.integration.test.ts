/**
 * Forced password change on first login, token revocation after a change,
 * and atomic refresh-token rotation.
 * Requires a seeded test database, Redis and MinIO (RUN_INTEGRATION=true).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { prisma } from "../../apps/api/src/config/database.js";

const ADMIN = { email: "admin@demo.example", password: process.env.SEED_ADMIN_PASSWORD ?? "" };

const runIntegration = process.env.RUN_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

interface LoginBody {
  data: { accessToken: string; user: { mustChangePassword: boolean } };
}

describeIntegration("password change", () => {
  let baseUrl = "";
  let server: Server;
  let adminToken = "";
  const email = `pw-${randomUUID().slice(0, 8)}@demo.example`;
  const temporaryPassword = "Temp-Password-1";
  const newPassword = "Yeni-Sifre-2026x";

  beforeAll(async () => {
    // Uses its own user, so it does not reset shared lockout state that the
    // permission-matrix suite may be using in parallel.
    const { ensureRedisConnected } = await import("../../apps/api/src/config/redis.js");
    await ensureRedisConnected();

    const { createApp } = await import("../../apps/api/src/app.js");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adminToken = (await login(ADMIN.email, ADMIN.password)).body.data.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function login(loginEmail: string, password: string): Promise<{ body: LoginBody; cookie: string }> {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password })
    });
    expect(response.status).toBe(200);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return { body: (await response.json()) as LoginBody, cookie };
  }

  function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  function refresh(cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });
  }

  it("forces a user created by an admin to change the password before doing anything else", async () => {
    const created = await call("POST", "/users", adminToken, {
      email,
      password: temporaryPassword,
      firstName: "Deneme",
      lastName: "Kullanici",
      role: "EMPLOYEE"
    });
    expect(created.status).toBe(201);

    const first = await login(email, temporaryPassword);
    expect(first.body.data.user.mustChangePassword).toBe(true);
    const token = first.body.data.accessToken;

    const blocked = await call("GET", "/patients", token);
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call("GET", "/auth/me", token)).status).toBe(200);

    const weak = await call("POST", "/auth/change-password", token, {
      currentPassword: temporaryPassword,
      newPassword: "short"
    });
    expect(weak.status).toBe(422);

    const changed = await call("POST", "/auth/change-password", token, {
      currentPassword: temporaryPassword,
      newPassword
    });
    expect(changed.status).toBe(200);
    const changedBody = (await changed.json()) as LoginBody;
    expect(changedBody.data.user.mustChangePassword).toBe(false);

    // Tokens issued before the change are revoked; the new one works.
    expect((await call("GET", "/auth/me", token)).status).toBe(401);
    expect((await refresh(first.cookie)).status).toBe(401);
    expect((await call("GET", "/patients", changedBody.data.accessToken)).status).toBe(200);
  });

  it("rejects a wrong current password", async () => {
    const { body } = await login(email, newPassword);
    const response = await call("POST", "/auth/change-password", body.data.accessToken, {
      currentPassword: "not-the-password",
      newPassword: "Another-Password-9"
    });
    expect(response.status).toBe(401);
  });

  it("lets only one of two concurrent refreshes with the same token succeed", async () => {
    const { cookie } = await login(email, newPassword);
    const statuses = (await Promise.all([refresh(cookie), refresh(cookie)])).map((response) => response.status);
    expect(statuses.sort()).toEqual([200, 401]);
  });
});
