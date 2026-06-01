import { AuditLog } from "../safety/AuditLog";

export async function verifyAudit() {
  console.log("\n🛡️ Goli-CLI Audit Log Verification");
  console.log("──────────────────────────────────────────────────────────");
  
  const result = await AuditLog.verify();
  
  if (result.valid) {
    console.log(`✅ Success: Audit trail is intact and valid.`);
    console.log(`Total verified entries: ${result.count}`);
  } else {
    console.error(`❌ FAILURE: ${result.error}`);
    console.log(`Verified up to entry: ${result.count}`);
    process.exit(1);
  }
  console.log("──────────────────────────────────────────────────────────\n");
}
