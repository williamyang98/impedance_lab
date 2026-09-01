export type Axis2D = "x" | "y";
export type Axis3D = "x" | "y" | "z";

export const AXES_3D: Axis3D[] = ["x", "y", "z"];
export const AXES_2D: Axis2D[] = ["x", "y"];

export interface Vec2<T> {
  x: T;
  y: T;
}

export interface Vec3<T> {
  x: T;
  y: T;
  z: T;
}

export interface Bound<T> {
  min: T;
  max: T;
}

export type CrossSection3D = "xy" | "xz" | "yz";
export const CROSS_SECTIONS_3D: CrossSection3D[] = ["xy", "xz", "yz"];

export function get_cross_section_axes(cross_section: CrossSection3D): [Axis3D, Axis3D] {
  switch (cross_section) {
    case "xy": return ["x", "y"];
    case "xz": return ["x", "z"];
    case "yz": return ["y", "z"];
  }
}

export function map_axes_to_vec3<T>(func: (axis: Axis3D) => T): Vec3<T> {
  const vec: Partial<Vec3<T>> = {};
  for (const axis of AXES_3D) {
    vec[axis] = func(axis);
  }
  return vec as Vec3<T>;
}

export function map_axes_to_vec2<T>(func: (axis: Axis2D) => T): Vec2<T> {
  const vec: Partial<Vec2<T>> = {};
  for (const axis of AXES_2D) {
    vec[axis] = func(axis);
  }
  return vec as Vec2<T>;
}
