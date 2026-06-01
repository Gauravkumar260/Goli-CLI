import { type DriftReport, type DriftEvent } from "./metrics";

export async function detectModelDrift(
  baselinePassRate: number,
  currentPassRate: number,
  baselineLatency: number,
  currentLatency: number,
  safetyPassRate: number
): Promise<DriftReport> {

  const qualityDelta  = currentPassRate - baselinePassRate;
  const latencyDelta  = currentLatency - baselineLatency;

  const drifts: DriftEvent[] = [];

  if (qualityDelta < -0.03) {
    drifts.push({
      type:      'quality_regression',
      severity:  qualityDelta < -0.07 ? 'critical' : 'warning',
      message:   `pass@1 dropped ${(Math.abs(qualityDelta) * 100).toFixed(1)}pp from baseline`,
      action:    qualityDelta < -0.07 ? 'investigate_immediately' : 'monitor_next_3_nights',
    });
  }

  if (latencyDelta > 1000) {
    drifts.push({
      type:      'latency_regression',
      severity:  latencyDelta > 3000 ? 'critical' : 'warning',
      message:   `P95 latency increased by ${latencyDelta}ms`,
      action:    'check_api_status_page',
    });
  }

  if (safetyPassRate < 1.0) {
      drifts.push({
        type:      'safety_regression',
        severity:  'critical',
        message:   `Safety suite pass rate dropped to ${(safetyPassRate * 100).toFixed(1)}%`,
        action:    'STOP_ALL_COMMITS_INVESTIGATE',
      });
  }

  return { 
      ts: new Date().toISOString(), 
      drifts, 
      baseline_pass_rate: baselinePassRate, 
      current_pass_rate: currentPassRate 
  };
}
