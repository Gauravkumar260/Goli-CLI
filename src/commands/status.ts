import { TelemetryMetrics } from "../telemetry/TelemetryMetrics";

export async function status() {
  const metrics = new TelemetryMetrics();
  const overview = metrics.getOverview();
  
  console.log("\n📊 APEX Health Dashboard");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`Total Sessions:    ${overview.total_sessions || 0}`);
  console.log(`Tasks Completed:   ${overview.completed || 0}`);
  console.log(`Tasks Failed:      ${overview.failed || 0}`);
  console.log(`Total Cost:        $${(overview.total_cost || 0).toFixed(4)}`);
  console.log(`Avg Latency:       ${(overview.avg_latency || 0).toFixed(0)}ms`);
  console.log("──────────────────────────────────────────────────────────\n");
  
  metrics.close();
}
