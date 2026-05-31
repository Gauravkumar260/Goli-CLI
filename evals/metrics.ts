export function calculatePrecisionAtK(expectedFiles: string[], retrievedFiles: string[], k: number): number {
  const topK = retrievedFiles.slice(0, k);
  const hits = expectedFiles.filter(file => 
    topK.some(retrieved => retrieved.replace(/\\/g, '/') === file.replace(/\\/g, '/'))
  );
  return hits.length / expectedFiles.length;
}

export function calculateRecallAtK(expectedFiles: string[], retrievedFiles: string[], k: number): number {
  return calculatePrecisionAtK(expectedFiles, retrievedFiles, k); // For retrieval on files, these are often similar
}
