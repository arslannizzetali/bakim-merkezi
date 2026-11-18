import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { Role, User } from "@prisma/client";
import { env } from "../config/index.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { auditService } from "./audit.service.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload extends JwtPayload {
  sub: string;
  tokenFamily: string;
  jti: string;
  iatMs?: number;
}

type JwtExpiresIn = NonNullable<SignOptions["expiresIn"]>;

/** Failed logins for one account, from any IP, before the account is locked. */
const ACCOUNT_LOCK_MULTIPLIER = 4;
const LOCK_SECONDS = 15 * 60;

// Compared against when the e-mail is unknown, so a missing account costs the
// same bcrypt time as a wrong password and response timing does not reveal it.
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(randomUUID(), 12);
  return dummyHashPromise;
}

/** Redis key holding the time (epoch ms) before which a user's tokens are invalid. */
export function tokensValidAfterKey(userId: string): string {
  return `auth:tokens-valid-after:${userId}`;
}

/**
 * Throws when the token was issued before the user's revocation cutoff (set on
 * password change). `iatMs` is our own millisecond claim; older tokens without
 * it fall back to the standard one-second `iat`.
 */
export async function assertIssuedAfterRevocation(
  userId: string,
  payload: { iat?: number | undefined; iatMs?: unknown }
): Promise<void> {
  const validAfter = Number(await redis.get(tokensValidAfterKey(userId)));
  if (!validAfter) {
    return;
  }
  const issuedAtMs = typeof payload.iatMs === "number" ? payload.iatMs : (payload.iat ?? 0) * 1000;
  if (issuedAtMs < validAfter) {
    throw new UnauthorizedError("TOKEN_REVOKED", "Oturum sonlandırılmış, lütfen tekrar giriş yapın");
  }
}

export interface LoginContext {
  ipAddress: string;
  userAgent?: string | undefined;
}

interface LogoutUser {
  id: string;
  accessTokenJti?: string;
  accessTokenExp?: number;
}

export class AuthService {
  async login(
    email: string,
    password: string,
    context: LoginContext
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    await this.assertNotBanned(email, context.ipAddress);

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        mustChangePassword: true
      }
    });

    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !passwordMatches) {
      await this.recordFailedLogin(email, context);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "E-posta veya şifre hatalı");
    }

    if (!user.isActive) {
      await auditService.write({
        userId: user.id,
        action: "USER_LOGIN_FAILED",
        resourceType: "User",
        resourceId: user.id,
        metadata: { reason: "INACTIVE_ACCOUNT" },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      });
      throw new ForbiddenError("USER_INACTIVE", "Hesabınız devre dışı. Yöneticinizle iletişime geçin.");
    }

    await redis.del(this.failedKey(email, context.ipAddress), this.accountFailedKey(email));
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: context.ipAddress
      }
    });

    const tokens = await this.generateTokenPair(user);
    await auditService.write({
      userId: user.id,
      action: "USER_LOGIN",
      resourceType: "User",
      resourceId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return {
      user: toPublicUser(user),
      tokens
    };
  }

  async refresh(refreshToken: string, context: LoginContext): Promise<TokenPair> {
    const payload = this.verifyRefreshToken(refreshToken);
    await assertIssuedAfterRevocation(payload.sub, payload);
    const familyRevoked = await redis.get(this.revokedFamilyKey(payload.tokenFamily));
    if (familyRevoked) {
      throw new UnauthorizedError("TOKEN_REUSE_DETECTED", "Tüm oturumlar sonlandırıldı");
    }

    // GETDEL is atomic: two concurrent requests with the same refresh token
    // cannot both succeed, so the second one is treated as reuse.
    const activeToken = await redis.getdel(this.refreshTokenKey(payload.jti));
    if (!activeToken) {
      await redis.set(this.revokedFamilyKey(payload.tokenFamily), "1", "EX", this.refreshTtlSeconds());
      await auditService.write({
        userId: payload.sub,
        action: "TOKEN_REUSE_DETECTED",
        resourceType: "User",
        resourceId: payload.sub,
        metadata: { tokenFamily: payload.tokenFamily },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      });
      throw new UnauthorizedError("TOKEN_REUSE_DETECTED", "Tüm oturumlar sonlandırıldı");
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true }
    });

    if (!user) {
      throw new UnauthorizedError("USER_INACTIVE", "Kullanıcı aktif değil");
    }

    return this.generateTokenPair(user, payload.tokenFamily);
  }

  /**
   * Replaces the user's password, clears the forced-change flag and revokes
   * every token issued before now (other devices must log in again).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: LoginContext
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, passwordHash: true }
    });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("INVALID_CURRENT_PASSWORD", "Mevcut şifre hatalı");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, mustChangePassword: true }
    });

    await redis.set(tokensValidAfterKey(user.id), String(Date.now()), "EX", this.refreshTtlSeconds());

    await auditService.write({
      userId: user.id,
      action: "USER_PASSWORD_CHANGED",
      resourceType: "User",
      resourceId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { user: toPublicUser(updated), tokens: await this.generateTokenPair(updated) };
  }

  async logout(user: LogoutUser | undefined, refreshToken: string | undefined, context: LoginContext): Promise<void> {
    if (user?.accessTokenJti && user.accessTokenExp) {
      const ttl = Math.max(1, user.accessTokenExp - Math.floor(Date.now() / 1000));
      await redis.set(`blacklist:access:${user.accessTokenJti}`, "1", "EX", ttl);
    }

    if (refreshToken) {
      try {
        const payload = this.verifyRefreshToken(refreshToken);
        await redis.del(this.refreshTokenKey(payload.jti));
      } catch {
        // Logout must be idempotent.
      }
    }

    if (user) {
      await auditService.write({
        userId: user.id,
        action: "USER_LOGOUT",
        resourceType: "User",
        resourceId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      });
    }
  }

  private async generateTokenPair(
    user: Pick<User, "id" | "email" | "firstName" | "lastName" | "role">,
    tokenFamily: string = randomUUID()
  ): Promise<TokenPair> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const iatMs = Date.now();
    const refreshPayload: RefreshPayload = {
      sub: user.id,
      tokenFamily,
      jti: refreshJti,
      iatMs
    };

    const signOptions: SignOptions = {
      expiresIn: env.JWT_EXPIRES_IN as JwtExpiresIn,
      issuer: "bakimevi-api",
      audience: "bakimevi-web",
      algorithm: "HS256"
    };

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: accessJti,
        iatMs
      },
      env.JWT_SECRET,
      signOptions
    );

    const refreshToken = jwt.sign(refreshPayload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as JwtExpiresIn,
      issuer: "bakimevi-api",
      audience: "bakimevi-web",
      algorithm: "HS256"
    });

    await redis.set(
      this.refreshTokenKey(refreshJti),
      JSON.stringify({ userId: user.id, tokenFamily }),
      "EX",
      this.refreshTtlSeconds()
    );

    return { accessToken, refreshToken };
  }

  private verifyRefreshToken(token: string): RefreshPayload {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: "bakimevi-api",
      audience: "bakimevi-web",
      algorithms: ["HS256"]
    }) as RefreshPayload;

    if (!payload.sub || !payload.jti || !payload.tokenFamily) {
      throw new UnauthorizedError("INVALID_REFRESH_TOKEN", "Oturum yenileme bilgisi geçersiz");
    }

    return payload;
  }

  private async assertNotBanned(email: string, ipAddress: string): Promise<void> {
    const [ipBanned, accountBanned] = await Promise.all([
      redis.get(this.banKey(email, ipAddress)),
      redis.get(this.accountBanKey(email))
    ]);
    if (ipBanned || accountBanned) {
      throw new ForbiddenError("TOO_MANY_ATTEMPTS", "Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.");
    }
  }

  private async recordFailedLogin(email: string, context: LoginContext): Promise<void> {
    const key = this.failedKey(email, context.ipAddress);
    const attempts = await redis.incr(key);
    await redis.expire(key, LOCK_SECONDS);
    if (attempts >= env.AUTH_RATE_LIMIT_MAX) {
      await redis.set(this.banKey(email, context.ipAddress), "1", "EX", LOCK_SECONDS);
    }

    // Per-account counter across all IPs, so rotating IPs does not allow
    // unlimited guesses against one account.
    const accountKey = this.accountFailedKey(email);
    const accountAttempts = await redis.incr(accountKey);
    await redis.expire(accountKey, LOCK_SECONDS);
    if (accountAttempts >= env.AUTH_RATE_LIMIT_MAX * ACCOUNT_LOCK_MULTIPLIER) {
      await redis.set(this.accountBanKey(email), "1", "EX", LOCK_SECONDS);
    }

    await auditService.write({
      action: "USER_LOGIN_FAILED",
      resourceType: "User",
      resourceId: email,
      metadata: { attempts },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });
  }

  private failedKey(email: string, ipAddress: string): string {
    return `auth:failed:${ipAddress}:${email.toLowerCase()}`;
  }

  private banKey(email: string, ipAddress: string): string {
    return `auth:ban:${ipAddress}:${email.toLowerCase()}`;
  }

  private accountFailedKey(email: string): string {
    return `auth:failed-account:${email.toLowerCase()}`;
  }

  private accountBanKey(email: string): string {
    return `auth:ban-account:${email.toLowerCase()}`;
  }

  private refreshTokenKey(jti: string): string {
    return `refresh:${jti}`;
  }

  private revokedFamilyKey(tokenFamily: string): string {
    return `refresh-family-revoked:${tokenFamily}`;
  }

  private refreshTtlSeconds(): number {
    const value = env.JWT_REFRESH_EXPIRES_IN;
    if (value.endsWith("h")) {
      return Number(value.slice(0, -1)) * 60 * 60;
    }
    if (value.endsWith("m")) {
      return Number(value.slice(0, -1)) * 60;
    }
    return 8 * 60 * 60;
  }
}

interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mustChangePassword: boolean;
}

function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  };
}

export const authService = new AuthService();
