import { TrajectoryAnalyzer } from "../telemetry/TrajectoryAnalyzer";
import { AuditLog } from "../safety/AuditLog";
import * as fs from "fs/promises";
import * as path from "path";

export async function evalStatus() {
  const analyzer = new TrajectoryAnalyzer();
  const metrics = analyzer.getMetrics();
  const audit = await AuditLog.verify();
  
  console.log("\n📈 Goli-CLI Evaluation Dashboard");
  console.log("──────────────────────────────────────────────────────────");

  // 1. Performance
  console.log("Trajectory Performance:");
  console.log(`- Success Rate:      \x1b[36m${(metrics.successRate * 100).toFixed(1)}%\x1b[0m`);
  console.log(`- Efficiency:        ${metrics.avgTurnsToSuccess.toFixed(1)} turns/success`);
  console.log(`- Avg Latency:       ${(metrics.avgLatencyMs / 1000).toFixed(2)}s / turn`);
  
  // 2. Safety
  console.log("\nSafety Integrity:");
  const integrityColor = audit.valid ? "\x1b[32m" : "\x1b[31m";
  console.log(`- Audit Log:         ${integrityColor}${audit.valid ? "VALID" : "BROKEN"}\x1b[0m`);
  console.log(`- Safety Trigger:    ${(metrics.safetyFiringRate * 100).toFixed(1)}% of turns gated`);
  
  // 3. Economics
  console.log("\nBudget & Economics:");
  console.log(`- Total Sessions:    ${metrics.totalSessions}`);
  console.log(`- Avg Session Cost:  $${metrics.avgCostPerSession.toFixed(4)}`);
  
  // 4. Retrieval (v2 integration)
  const projectRoot = process.cwd();
  const evalLogPath = path.join(projectRoot, "evals", "latest-eval.json");
  try {
      const latestEval = JSON.parse(await fs.readFile(evalLogPath, "utf-8"));
      console.log(`\nLatest Retrieval:   ${(latestEval.avgPrecision * 100).toFixed(1)}% (P@5)`);
  } catch {
      console.log(`\nLatest Retrieval:   N/A (Run 'bun evals/run-retrieval.ts')`);
  }

  console.log("──────────────────────────────────────────────────────────\n");
  
  analyzer.close();
}
