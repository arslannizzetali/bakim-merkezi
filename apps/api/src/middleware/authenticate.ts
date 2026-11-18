import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { env } from "../config/index.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { assertIssuedAfterRevocation } from "../services/auth.service.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

/** Routes a user who must change their password can still call. */
const PASSWORD_CHANGE_ALLOWED = new Set(["/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/change-password"]);

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  jti: string;
  iatMs?: number;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedError("UNAUTHORIZED", "Giriş yapmalısınız");
    }

    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: "bakimevi-api",
      audience: "bakimevi-web",
      algorithms: ["HS256"]
    }) as AccessTokenPayload;

    if (!payload.sub || !payload.jti || typeof payload.exp !== "number") {
      throw new UnauthorizedError("INVALID_TOKEN", "Oturum geçersiz");
    }

    const blacklisted = await redis.get(`blacklist:access:${payload.jti}`);
    if (blacklisted) {
      throw new UnauthorizedError("TOKEN_REVOKED", "Oturum sonlandırılmış");
    }

    await assertIssuedAfterRevocation(payload.sub, payload);

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, mustChangePassword: true }
    });

    if (!user) {
      throw new UnauthorizedError("USER_INACTIVE", "Kullanıcı aktif değil");
    }

    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${req.baseUrl}${req.path}`)) {
      throw new ForbiddenError("PASSWORD_CHANGE_REQUIRED", "Devam etmeden önce şifrenizi değiştirmelisiniz");
    }

    req.user = {
      ...user,
      accessTokenJti: payload.jti,
      accessTokenExp: payload.exp
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      next(error);
      return;
    }
    next(new UnauthorizedError("INVALID_TOKEN", "Oturum geçersiz"));
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}
