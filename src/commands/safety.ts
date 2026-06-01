import { TelemetryMetrics } from "../telemetry/TelemetryMetrics";
import { AuditLog } from "../safety/AuditLog";

export async function safetyStatus() {
  const metrics = new TelemetryMetrics();
  const overview = metrics.getOverview();
  const audit = await AuditLog.verify();
  
  console.log("\n🔐 Goli-CLI Safety Dashboard");
  console.log("──────────────────────────────────────────────────────────");
  
  // 1. Action Stats
  console.log("Action Overview:");
  console.log(`- Total Sessions:    ${overview.total_sessions || 0}`);
  
  // 2. Audit Health
  console.log("\nAudit Health:");
  if (audit.valid) {
    console.log(`- Integrity:       \x1b[32m✅ VALID\x1b[0m`);
    console.log(`- Entries:         ${audit.count}`);
  } else {
    console.log(`- Integrity:       \x1b[31m❌ BROKEN\x1b[0m`);
    console.log(`- Error:           ${audit.error}`);
  }

  // 3. Risk Profile
  const usage = metrics.getUsageByModel();
  console.log("\nCost Profile:");
  console.log(`- Total Project Cost: $${(overview.total_cost || 0).toFixed(4)}`);
  
  console.log("──────────────────────────────────────────────────────────\n");
  
  metrics.close();
}
