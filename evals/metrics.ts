export function calculatePrecisionAtK(expected: string[], retrieved: string[], k: number): number {
    const topK = retrieved.slice(0, k);
    const hits = topK.filter(f => expected.includes(f)).length;
    return hits / Math.min(expected.length, k);
}
