import {
  PROJECT_STORAGE_QUOTA_RESERVE_BYTES,
  type ProjectSaveRequestV1,
  type ProjectStorageCapacity,
  type ProjectStorageManagerLike,
  type ProjectStorageQuotaEstimate,
} from "./project-storage-schema.ts";
import {
  assertNonNegativeInteger,
  validateProjectSaveRequest,
} from "./project-storage-codec.ts";

export function estimateProjectSaveBytes(request: ProjectSaveRequestV1): number {
  validateProjectSaveRequest(request);
  return request.chunks.reduce((total, chunk) => total + chunk.storedBytes, 0)
    + (request.thumbnail?.size ?? 0);
}

export function checkProjectStorageCapacity(
  requiredBytes: number,
  estimate: Pick<ProjectStorageQuotaEstimate, "availableBytes" | "quotaBytes">,
): ProjectStorageCapacity {
  assertNonNegativeInteger(requiredBytes, "requiredBytes");
  const reserveBytes = estimate.quotaBytes === null
    ? null
    : Math.max(
      PROJECT_STORAGE_QUOTA_RESERVE_BYTES,
      Math.floor(estimate.quotaBytes * 0.05),
    );
  const fits = estimate.availableBytes === null || reserveBytes === null
    ? null
    : requiredBytes + reserveBytes <= estimate.availableBytes;
  return {
    requiredBytes,
    availableBytes: estimate.availableBytes,
    reserveBytes,
    fits,
  };
}

export function globalStorageManager(): ProjectStorageManagerLike | null {
  return typeof navigator !== "undefined" && navigator.storage
    ? navigator.storage
    : null;
}

export async function estimateProjectStorageQuota(
  manager: ProjectStorageManagerLike | null = globalStorageManager(),
): Promise<ProjectStorageQuotaEstimate> {
  if (!manager) {
    return {
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      persisted: null,
    };
  }
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;
  try {
    const estimate = await manager.estimate?.();
    usageBytes = typeof estimate?.usage === "number" && Number.isFinite(estimate.usage)
      ? Math.max(0, estimate.usage)
      : null;
    quotaBytes = typeof estimate?.quota === "number" && Number.isFinite(estimate.quota)
      ? Math.max(0, estimate.quota)
      : null;
  } catch {
    // Quota telemetry is advisory. A failed estimate must not disable saving.
  }
  try {
    persisted = manager.persisted ? await manager.persisted() : null;
  } catch {
    persisted = null;
  }
  return {
    usageBytes,
    quotaBytes,
    availableBytes: usageBytes !== null && quotaBytes !== null
      ? Math.max(0, quotaBytes - usageBytes)
      : null,
    persisted,
  };
}

export async function requestPersistentProjectStorage(
  manager: ProjectStorageManagerLike | null = globalStorageManager(),
): Promise<boolean | null> {
  if (!manager?.persist) return null;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}
