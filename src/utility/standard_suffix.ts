export interface StandardSuffix {
  scale: number;
  suffix: string;
}

export function get_standard_suffix(value: number, threshold?: number): StandardSuffix {
  // suffix doesn't care about sign
  value = Math.abs(value);
  if (threshold !== undefined && value <= threshold) {
    return { scale: 1, suffix: "" };
  }
  if (value >= 1e15) return { scale: 1e15, suffix: "P" };
  if (value >= 1e12) return { scale: 1e12, suffix: "T" };
  if (value >= 1e9) return { scale: 1e9, suffix: "G" };
  if (value >= 1e6) return { scale: 1e6, suffix: "M" };
  if (value >= 1e3) return { scale: 1e3, suffix: "k" };
  if (value >= 1e0) return { scale: 1e0, suffix: "" };
  if (value >= 1e-3) return { scale: 1e-3, suffix: "m" };
  if (value >= 1e-6) return { scale: 1e-6, suffix: "µ" };
  if (value >= 1e-9) return { scale: 1e-9, suffix: "n" };
  if (value >= 1e-12) return { scale: 1e-12, suffix: "f" };
  return { scale: 1, suffix: "" };
}

export function with_standard_suffix(value: number, unit?: string, precision?: number, threshold?: number): string {
  precision = precision ?? 3;
  const result = get_standard_suffix(value, threshold);
  return `${(value/result.scale).toPrecision(precision)} ${result.suffix}${unit ?? ''}`;
}
