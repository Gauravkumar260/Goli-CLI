export function calculatePrecisionAtK(
	expected: string[],
	retrieved: string[],
	k: number,
): number {
	const topK = retrieved.slice(0, k);
	const hits = topK.filter((f) => expected.includes(f)).length;
	return hits / Math.min(expected.length, k);
}

export function calculatePassAtK(
	passedCount: number,
	totalCount: number,
): number {
	if (totalCount === 0) return 0;
	return passedCount / totalCount;
}

export interface DriftEvent {
	type: "quality_regression" | "latency_regression" | "safety_regression";
	severity: "warning" | "critical";
	message: string;
	action: string;
}

export interface DriftReport {
	ts: string;
	drifts: DriftEvent[];
	baseline_pass_rate: number;
	current_pass_rate: number;
}
