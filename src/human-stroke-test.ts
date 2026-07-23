export type HumanStrokeTestThicknessMode = "standard" | "taper-0-0-speed100";

export interface HumanStrokeTestThicknessSettings {
  startThickness: number;
  endThickness: number;
  speedThickness: number;
}

export function humanStrokeTestThicknessSettings(
  mode: HumanStrokeTestThicknessMode,
): HumanStrokeTestThicknessSettings {
  if (mode === "taper-0-0-speed100") {
    return {
      startThickness: 0,
      endThickness: 0,
      speedThickness: 100,
    };
  }

  return {
    startThickness: 1,
    endThickness: 1,
    speedThickness: 0,
  };
}

export function humanStrokeTestThicknessLabel(
  mode: HumanStrokeTestThicknessMode,
): string {
  return mode === "taper-0-0-speed100"
    ? "Coda 0/0/+100"
    : "Spessore 100/100/0";
}
