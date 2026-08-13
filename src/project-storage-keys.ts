export function projectManifestKey(
  projectId: string,
  generationId: string,
): string {
  return `${projectId}|${generationId}`;
}

export function projectChunkKey(
  projectId: string,
  generationId: string,
  layerId: number,
  chunkIndex: number,
): string {
  return `${projectManifestKey(projectId, generationId)}|${layerId}|${chunkIndex}`;
}
