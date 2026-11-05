import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { EncryptionService } from "../../apps/api/src/services/encryption.service.js";

describe("EncryptionService", () => {
  const service = new EncryptionService();
  const original = Buffer.from("hasta evraki test icerigi");

  it("aynı dosyayı farklı IV ile farklı çıktıya şifreler", () => {
    const first = service.encryptFile(original);
    const second = service.encryptFile(original);

    expect(first.encrypted.equals(second.encrypted)).toBe(false);
    expect(first.iv).not.toBe(second.iv);
  });

  it("şifrele ve çöz işlemi orijinal dosyayı döndürür", () => {
    const encrypted = service.encryptFile(original);
    const decrypted = service.decryptFile(encrypted.encrypted, encrypted.key, encrypted.iv, encrypted.authTag);

    expect(decrypted.equals(original)).toBe(true);
  });

  it("checksum değişmiş dosyayı reddeder", () => {
    const encrypted = service.encryptFile(original);
    const tampered = Buffer.from("degistirilmis");

    expect(() => service.verifyChecksum(tampered, encrypted.checksum)).toThrow("Dosya bütünlüğü doğrulanamadı");
  });

  it("encrypts the same TC number to different ciphertexts with random IVs", () => {
    const first = service.encryptTc("12345678901");
    const second = service.encryptTc("12345678901");

    expect(first).not.toBe(second);
    expect(JSON.parse(first).iv).not.toBe(JSON.parse(second).iv);
    expect(service.decryptTc(first)).toBe("12345678901");
    expect(service.decryptTc(second)).toBe("12345678901");
  });

  it("still decrypts legacy TC values encrypted with a zero IV", () => {
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY ?? "", "hex");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, Buffer.alloc(16, 0));
    const data = Buffer.concat([cipher.update("10000000001", "utf8"), cipher.final()]);
    const legacy = JSON.stringify({ data: data.toString("hex"), authTag: cipher.getAuthTag().toString("hex") });

    expect(service.decryptTc(legacy)).toBe("10000000001");
  });

  it("rejects a tampered TC ciphertext", () => {
    const payload = JSON.parse(service.encryptTc("12345678901"));
    payload.data = payload.data.replace(/^./, (c: string) => (c === "0" ? "1" : "0"));

    expect(() => service.decryptTc(JSON.stringify(payload))).toThrow();
  });
});
