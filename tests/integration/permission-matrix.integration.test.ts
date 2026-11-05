/**
 * One test per row of the README permission matrix, plus brute-force lockout.
 * Requires a seeded test database, Redis and MinIO (RUN_INTEGRATION=true).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../apps/api/src/config/database.js";

const ADMIN = { email: "admin@bakimevi.com", password: process.env.SEED_ADMIN_PASSWORD ?? "" };
const EMPLOYEE = { email: "ahmet@bakimevi.com", password: process.env.SEED_EMPLOYEE_PASSWORD ?? "" };

const runIntegration = process.env.RUN_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("permission matrix", () => {
  let baseUrl = "";
  let server: Server;
  let adminToken = "";
  let employeeToken = "";
  let employeeId = "";

  beforeAll(async () => {
    const { ensureRedisConnected, redis } = await import("../../apps/api/src/config/redis.js");
    await ensureRedisConnected();
    // Start from a clean rate-limit / lockout state.
    const keys = await redis.keys("auth:*");
    if (keys.length > 0) await redis.del(...keys);

    const { createApp } = await import("../../apps/api/src/app.js");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    adminToken = await login(ADMIN.email, ADMIN.password);
    employeeToken = await login(EMPLOYEE.email, EMPLOYEE.password);
    employeeId = (await prisma.user.findUniqueOrThrow({ where: { email: EMPLOYEE.email } })).id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function login(email: string, password: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
  }

  function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  async function documentOf(priority: "RED" | "YELLOW" | "GREEN", uploadedBy: "employee" | "other") {
    return prisma.document.findFirstOrThrow({
      where: {
        priority,
        isDeleted: false,
        uploadedById: uploadedBy === "employee" ? employeeId : { not: employeeId }
      },
      select: { id: true }
    });
  }

  describe("create, delete, list employees", () => {
    it("admin: allowed", async () => {
      expect((await call("GET", "/users", adminToken)).status).toBe(200);
    });
    it("employee: denied", async () => {
      expect((await call("GET", "/users", employeeToken)).status).toBe(403);
      expect((await call("POST", "/users", employeeToken, { email: "x@example.com" })).status).toBe(403);
      expect((await call("DELETE", `/users/${employeeId}`, employeeToken)).status).toBe(403);
    });
  });

  describe("view all audit logs", () => {
    it("admin: allowed", async () => {
      expect((await call("GET", "/admin/audit-logs", adminToken)).status).toBe(200);
    });
    it("employee: denied", async () => {
      expect((await call("GET", "/admin/audit-logs", employeeToken)).status).toBe(403);
    });
  });

  describe("view all patient updates", () => {
    it("admin: allowed", async () => {
      expect((await call("GET", "/admin/recent-updates", adminToken)).status).toBe(200);
    });
    it("employee: denied", async () => {
      expect((await call("GET", "/admin/recent-updates", employeeToken)).status).toBe(403);
    });
  });

  describe("create and view patients", () => {
    it("both roles: allowed", async () => {
      expect((await call("GET", "/patients", adminToken)).status).toBe(200);
      expect((await call("GET", "/patients", employeeToken)).status).toBe(200);
    });
  });

  describe("delete patients", () => {
    it("employee: denied", async () => {
      const patient = await prisma.patient.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
      expect((await call("DELETE", `/patients/${patient.id}`, employeeToken)).status).toBe(403);
      const stillThere = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(stillThere.deletedAt).toBeNull();
    });
  });

  describe("download documents", () => {
    it("employee can download own document", async () => {
      const own = await documentOf("GREEN", "employee").catch(() => documentOf("YELLOW", "employee"));
      expect((await call("GET", `/documents/${own.id}/download`, employeeToken)).status).toBe(200);
    });
    it("employee cannot download another employee's document", async () => {
      const other = await documentOf("GREEN", "other").catch(() => documentOf("YELLOW", "other"));
      expect((await call("GET", `/documents/${other.id}/download`, employeeToken)).status).toBe(403);
    });
    it("admin can download any employee's document", async () => {
      const other = await documentOf("GREEN", "employee").catch(() => documentOf("YELLOW", "employee"));
      expect((await call("GET", `/documents/${other.id}/download`, adminToken)).status).toBe(200);
    });
  });

  describe("delete RED documents", () => {
    it("denied for every role", async () => {
      const red = await prisma.document.findFirstOrThrow({
        where: { priority: "RED", isDeleted: false },
        select: { id: true }
      });
      expect((await call("DELETE", `/documents/${red.id}`, adminToken)).status).toBe(403);
      expect((await call("DELETE", `/documents/${red.id}`, employeeToken)).status).toBe(403);
      expect((await prisma.document.findUniqueOrThrow({ where: { id: red.id } })).isDeleted).toBe(false);
    });
  });

  describe("delete YELLOW/GREEN documents", () => {
    it("employee: denied", async () => {
      const doc = await documentOf("YELLOW", "employee").catch(() => documentOf("GREEN", "employee"));
      expect((await call("DELETE", `/documents/${doc.id}`, employeeToken)).status).toBe(403);
    });
    it("admin: allowed", async () => {
      const doc = await documentOf("GREEN", "other").catch(() => documentOf("YELLOW", "other"));
      const response = await call("DELETE", `/documents/${doc.id}`, adminToken);
      expect([200, 204]).toContain(response.status);
    });
  });

  describe("retention policy settings", () => {
    it("admin: allowed", async () => {
      expect((await call("GET", "/admin/retention-policies", adminToken)).status).toBe(200);
    });
    it("employee: denied", async () => {
      expect((await call("GET", "/admin/retention-policies", employeeToken)).status).toBe(403);
    });
  });

  describe("brute-force protection", () => {
    it("locks the account/IP pair after repeated failed logins", async () => {
      const max = Number(process.env.AUTH_RATE_LIMIT_MAX ?? "5");
      const statuses: number[] = [];
      for (let attempt = 0; attempt < max + 1; attempt += 1) {
        const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "mehmet@bakimevi.com", password: "wrong-password" })
        });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, max - 1).every((status) => status === 401)).toBe(true);
      expect(statuses.at(-1)).toBeGreaterThanOrEqual(403);

      // Even the correct password is rejected while locked.
      const locked = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "mehmet@bakimevi.com", password: EMPLOYEE.password })
      });
      expect(locked.status).not.toBe(200);
    });
  });
});
