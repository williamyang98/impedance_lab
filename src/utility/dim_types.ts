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
