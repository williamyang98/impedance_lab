export interface StandardSuffix {
  scale: number;
  suffix: string;
}

export function get_standard_suffix(value: number): StandardSuffix {
  if (value >= 1e9) return { scale: 1e9, suffix: "G" };
  if (value >= 1e6) return { scale: 1e6, suffix: "M" };
  if (value >= 1e3) return { scale: 1e3, suffix: "k" };
  if (value >= 1e0) return { scale: 1e0, suffix: "" };
  if (value >= 1e-3) return { scale: 1e-3, suffix: "m" };
  if (value >= 1e-6) return { scale: 1e-6, suffix: "µ" };
  if (value >= 1e-9) return { scale: 1e-9, suffix: "n" };
  return { scale: 1e-12, suffix: "f" };
}

export function with_standard_suffix(value: number, unit?: string, precision?: number): string {
  precision = precision ?? 3;
  const result = get_standard_suffix(value);
  return `${(value/result.scale).toPrecision(precision)} ${result.suffix}${unit ?? ''}`;
}
