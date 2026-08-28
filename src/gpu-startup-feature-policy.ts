export const GPU_STARTUP_NO_TIER2_PATH = "/gpu-startup-app-frame";

export function suppressTextureFormatsTier2ForGpuStartup(
  pathname = "",
  search = "",
) {
  if (pathname !== GPU_STARTUP_NO_TIER2_PATH) return false;
  const parameters = new URLSearchParams(search);
  return parameters.get("diagnosticBoot") === "1"
    && parameters.get("forceGlazeCommitFallback") === "1";
}
