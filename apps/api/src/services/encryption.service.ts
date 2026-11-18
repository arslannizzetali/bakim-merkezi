import crypto from "node:crypto";
import { env } from "../config/index.js";
import { BadRequestError } from "../utils/errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
/** 96-bit IV, the recommended size for GCM. */
const GCM_IV_LENGTH = 12;
const MASTER_KEY = Buffer.from(env.MASTER_ENCRYPTION_KEY, "hex");

interface WrappedKey {
  key: string;
  iv: string;
  authTag: string;
}

interface TcCipherText {
  /** 2 = random IV. Absent on legacy values encrypted with a zero IV. */
  v?: number;
  iv?: string;
  data: string;
  authTag: string;
}

export interface EncryptedFile {
  encrypted: Buffer;
  key: string;
  iv: string;
  authTag: string;
  checksum: string;
}

export class EncryptionService {
  encryptFile(buffer: Buffer): EncryptedFile {
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const fileKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, fileKey, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      key: this.wrapFileKey(fileKey),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      checksum
    };
  }

  decryptFile(encrypted: Buffer, encryptionKey: string, iv: string, authTag: string): Buffer {
    const fileKey = this.unwrapFileKey(encryptionKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, fileKey, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  verifyChecksum(buffer: Buffer, expectedChecksum: string): void {
    const actual = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actual !== expectedChecksum) {
      throw new BadRequestError("CHECKSUM_MISMATCH", "Dosya bütünlüğü doğrulanamadı");
    }
  }

  /**
   * Encrypts a national ID (TC) number with AES-256-GCM and a fresh random IV.
   * The output is non-deterministic, so it cannot be used for equality search.
   */
  encryptTc(tc: string): string {
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(tc, "utf8"), cipher.final()]);
    const payload: TcCipherText = {
      v: 2,
      iv: iv.toString("hex"),
      data: encrypted.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex")
    };
    return JSON.stringify(payload);
  }

  /**
   * Decrypts both the current format (random IV) and the legacy format,
   * which used a fixed all-zero IV and must only ever be read, never written.
   */
  decryptTc(encrypted: string): string {
    const payload = this.parseTcCipherText(encrypted);
    const iv = payload.iv ? Buffer.from(payload.iv, "hex") : Buffer.alloc(IV_LENGTH, 0);
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, "hex")), decipher.final()]).toString("utf8");
  }

  /** True for values written by the old zero-IV format, which must be re-encrypted. */
  isLegacyTc(encrypted: string): boolean {
    return !this.parseTcCipherText(encrypted).iv;
  }

  packDocumentKey(encryptionKey: string, iv: string, authTag: string): string {
    return JSON.stringify({
      wrappedKey: JSON.parse(encryptionKey) as WrappedKey,
      fileIv: iv,
      fileAuthTag: authTag
    });
  }

  unpackDocumentKey(packed: string): { encryptionKey: string; iv: string; authTag: string } {
    const parsed = JSON.parse(packed) as { wrappedKey?: WrappedKey; fileIv?: string; fileAuthTag?: string };
    if (!parsed.wrappedKey || !parsed.fileIv || !parsed.fileAuthTag) {
      return {
        encryptionKey: packed,
        iv: "",
        authTag: ""
      };
    }

    return {
      encryptionKey: JSON.stringify(parsed.wrappedKey),
      iv: parsed.fileIv,
      authTag: parsed.fileAuthTag
    };
  }

  private wrapFileKey(fileKey: Buffer): string {
    const keyIv = crypto.randomBytes(IV_LENGTH);
    const keyCipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, keyIv);
    const encryptedKey = Buffer.concat([keyCipher.update(fileKey), keyCipher.final()]);
    const wrapped: WrappedKey = {
      key: encryptedKey.toString("hex"),
      iv: keyIv.toString("hex"),
      authTag: keyCipher.getAuthTag().toString("hex")
    };
    return JSON.stringify(wrapped);
  }

  private unwrapFileKey(encryptionKey: string): Buffer {
    const keyData = JSON.parse(encryptionKey) as WrappedKey;
    const keyDecipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, Buffer.from(keyData.iv, "hex"));
    keyDecipher.setAuthTag(Buffer.from(keyData.authTag, "hex"));
    return Buffer.concat([keyDecipher.update(Buffer.from(keyData.key, "hex")), keyDecipher.final()]);
  }

  private parseTcCipherText(encrypted: string): TcCipherText {
    const parsed = JSON.parse(encrypted) as Partial<TcCipherText>;
    if (!parsed.data || !parsed.authTag) {
      throw new BadRequestError("INVALID_ENCRYPTED_VALUE", "Şifreli veri geçersiz");
    }
    return {
      ...(parsed.iv ? { iv: parsed.iv } : {}),
      data: parsed.data,
      authTag: parsed.authTag
    };
  }
}

export const encryptionService = new EncryptionService();
