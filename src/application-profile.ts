import type { LayerFormat } from "./engine-types";

export const RGBA8_APPLICATION_LAB_PATH = "/rgba8-app-lab" as const;
export const RGBA8_APPLICATION_LAB_DATABASE =
  "webgpu-brush-rgba8-app-lab-v1" as const;

export type ApplicationProfileId = "production" | "rgba8-document-lab";

export interface ApplicationProfile {
  readonly id: ApplicationProfileId;
  readonly documentLayerFormat: LayerFormat;
  readonly projectDatabaseName: string | null;
  readonly unsupportedControlIds: readonly string[];
}

const PRODUCTION_APPLICATION_PROFILE: ApplicationProfile = Object.freeze({
  id: "production",
  documentLayerFormat: "rgba16float",
  projectDatabaseName: null,
  unsupportedControlIds: Object.freeze([]),
});

const RGBA8_DOCUMENT_LAB_PROFILE: ApplicationProfile = Object.freeze({
  id: "rgba8-document-lab",
  documentLayerFormat: "rgba8unorm",
  projectDatabaseName: RGBA8_APPLICATION_LAB_DATABASE,
  // These destructive filters currently require an authoritative RGBA16F
  // destination. Keep the comparison honest instead of exposing controls that
  // would fail after the 8-bit document has already opened.
  unsupportedControlIds: Object.freeze([
    "mobileLiquifyOpen",
    "mobileGaussianBlurOpen",
    "mobileMotionBlurOpen",
    "mobileSpatialBlurOpen",
    "mobileNoiseOpen",
    "editorFiltersMenu",
  ]),
});

/**
 * Selects immutable application capabilities from an exact route. Query
 * parameters never change pixel precision, and every other path retains the
 * production RGBA16F profile.
 */
export function resolveApplicationProfile(pathname: string): ApplicationProfile {
  return pathname === RGBA8_APPLICATION_LAB_PATH
    ? RGBA8_DOCUMENT_LAB_PROFILE
    : PRODUCTION_APPLICATION_PROFILE;
}
