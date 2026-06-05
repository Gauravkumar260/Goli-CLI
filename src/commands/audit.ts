import { AuditLog } from "../safety/AuditLog.js";

export async function verifyAudit(): Promise<void> {
	console.log("\n🛡️ Goli-CLI Audit Log Verification");
	console.log("──────────────────────────────────────────────────────────");

	const auditLog = new AuditLog();
	const result = auditLog.verify();

	if (result.valid) {
		console.log("✅ Success: Audit trail is intact and valid.");
		console.log(`Total verified entries: ${result.count}`);
	} else {
		console.error(`❌ FAILURE: Audit trail is BROKEN at entry #${result.brokenAt}`);
		console.error(`Total entries scanned: ${result.count}`);
		process.exit(1);
	}
}
