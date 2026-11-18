import cors from "cors";
import helmet from "helmet";
import { allowedOrigins } from "../config/index.js";

export const securityMiddleware = [
  helmet({
    // The API only serves JSON and file downloads, so it needs no scripts,
    // styles or frames at all.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  }),
  cors({
    origin: (origin, callback) => {
      const allowed = allowedOrigins();
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS: ${origin} izin verilmedi`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    credentials: true,
    maxAge: 600
  })
];
