// for easy conversion between imperal/metric dimensions
export type DistanceUnit =
  "m" | "cm" | "mm" | "um" |
  "inch" | "mil" | "thou" | "oz";

export const distance_units: DistanceUnit[] = [
  "m", "cm", "mm", "um",
  "inch", "mil", "thou",
  "oz"
];

const distance_unit_norm_size: Record<DistanceUnit, number> = {
  "m": 1,
  "cm": 1e-2,
  "mm": 1e-3,
  "um": 1e-6,
  "inch": 1/39.3701,
  "mil": 1/39370.1,
  "thou": 1/39370.1,
  // // https://pcbprime.com/pcb-tips/how-thick-is-1oz-copper/
  "oz": 1.37/39370.1,
};

export function convert_distance(value: number, old_unit: DistanceUnit, new_unit: DistanceUnit): number {
  if (old_unit === new_unit) return value;
  const scale = distance_unit_norm_size[old_unit] / distance_unit_norm_size[new_unit];
  const new_value = value * scale;
  return new_value;
}
