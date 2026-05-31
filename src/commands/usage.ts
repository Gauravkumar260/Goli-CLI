import { TelemetryMetrics } from "../telemetry/TelemetryMetrics";

export async function usage() {
  const metrics = new TelemetryMetrics();
  const modelUsage = metrics.getUsageByModel();
  
  console.log("\n📈 Model Usage Breakdown");
  console.log("──────────────────────────────────────────────────────────────────────────");
  console.log("Model".padEnd(25), "Turns".padEnd(10), "Input".padEnd(10), "Output".padEnd(10), "Cost");
  console.log("──────────────────────────────────────────────────────────────────────────");
  
  modelUsage.forEach((m: any) => {
    console.log(
      m.model.padEnd(25), 
      m.turns.toString().padEnd(10), 
      (m.input_tokens || 0).toString().padEnd(10),
      (m.output_tokens || 0).toString().padEnd(10),
      `$${(m.cost || 0).toFixed(4)}`
    );
  });
  console.log("──────────────────────────────────────────────────────────────────────────\n");
  
  metrics.close();
}
