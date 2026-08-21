export const memoryNumberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatMemoryMiB(value: number): string {
  if (value === 0) return "0 MiB";
  if (value > 0 && value < 0.05) return "<0.1 MiB";
  return `${memoryNumberFormatter.format(value)} MiB`;
}
