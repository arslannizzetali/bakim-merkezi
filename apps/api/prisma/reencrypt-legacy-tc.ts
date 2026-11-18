// Re-encrypts TC numbers stored in the legacy format (AES-256-GCM with a fixed
// all-zero IV) into the current format with a random IV. Reusing a GCM nonce
// under the same key weakens confidentiality, so run this once on every
// installation that was set up before the random-IV change.
//
// Usage (from apps/api, with the tenant's .env loaded):
//   pnpm exec tsx prisma/reencrypt-legacy-tc.ts          # dry run, only counts
//   pnpm exec tsx prisma/reencrypt-legacy-tc.ts --apply  # rewrites rows
//
// Take a database backup first. Rows are updated one by one; the script is
// idempotent and can be re-run safely.
import { prisma } from "../src/config/database.js";
import { auditService } from "../src/services/audit.service.js";
import { encryptionService } from "../src/services/encryption.service.js";

const apply = process.argv.includes("--apply");
const BATCH_SIZE = 200;

async function main(): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let legacy = 0;
  let failed = 0;
  let reencrypted = 0;

  for (;;) {
    const patients = await prisma.patient.findMany({
      where: { tcNumberEncrypted: { not: null } },
      select: { id: true, tcNumberEncrypted: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    if (patients.length === 0) {
      break;
    }

    for (const patient of patients) {
      scanned += 1;
      const value = patient.tcNumberEncrypted;
      if (!value) {
        continue;
      }
      try {
        if (!encryptionService.isLegacyTc(value)) {
          continue;
        }
        legacy += 1;
        if (apply) {
          const plain = encryptionService.decryptTc(value);
          await prisma.patient.update({
            where: { id: patient.id },
            data: { tcNumberEncrypted: encryptionService.encryptTc(plain) }
          });
          reencrypted += 1;
        }
      } catch {
        // Never print the value itself; only the row id.
        failed += 1;
        console.error(`Çözülemeyen kayıt: patient ${patient.id}`);
      }
    }
    cursor = patients[patients.length - 1]?.id;
  }

  if (apply && reencrypted > 0) {
    await auditService.write({
      action: "TC_REENCRYPTED",
      resourceType: "Patient",
      resourceId: "bulk",
      metadata: { reencrypted, failed }
    });
  }

  console.log(
    `${scanned} kayıt tarandı, ${legacy} eski formatta kayıt bulundu` +
      (apply ? `, ${reencrypted} yeniden şifrelendi.` : ". Değiştirmek için --apply ile çalıştırın.")
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Bilinmeyen hata");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
