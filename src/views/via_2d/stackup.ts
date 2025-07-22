import { type DistanceUnit } from "../../utility/unit_types";

// types of parameters
export interface IParameter {
  name?: string;
  description?: string;
  min?: number;
  max?: number;
  error?: string;
  impedance_correlation?: "positive" | "negative";
}

export interface SizeParameter extends IParameter {
  type: "size";
  old_value?: number;
  old_unit?: DistanceUnit;
  value?: number;
  unit: DistanceUnit;
}

export interface EpsilonParameter extends IParameter {
  type: "epsilon";
  old_value?: number;
  value?: number;
}

export interface EtchFactorParameter extends IParameter {
  type: "etch_factor";
  old_value?: number;
  value?: number; // W-W0 = dW0 = 2*T*etch_factor
  taper_suffix?: string;
  placeholder_value: number;
}

export type Parameter = SizeParameter | EpsilonParameter | EtchFactorParameter;

export interface ViaBarrel {
  diameter: SizeParameter;
  copper_thickness: SizeParameter;
  epsilon: EpsilonParameter;
}

export interface ReferencePlane {
  Dpad?: SizeParameter,
  Dantipad?: SizeParameter,
}

export type LayerId = number;

export interface SurfaceLayer {
  readonly type: "surface";
  id: LayerId;
  soldermask?: {
    height: SizeParameter;
    epsilon: EpsilonParameter;
  };
  plane: {
    copper_thickness: SizeParameter;
  } & ReferencePlane;
}

export interface InnerLayer {
  readonly type: "inner";
  id: LayerId;
  height: SizeParameter;
  epsilon: EpsilonParameter;
  planes: {
    copper_thickness: SizeParameter;
    top: ReferencePlane;
    bottom: ReferencePlane;
  };
}

export type Layer = SurfaceLayer | InnerLayer;
export type LayerType = "surface" | "inner";

export interface Stackup {
  layers: Layer[];
  barrel: ViaBarrel;
}

export const Rules = {
  plane_has_copper(plane: ReferencePlane): boolean {
    return plane.Dantipad !== undefined || plane.Dpad !== undefined;
  },
}

export type Orientation = "top" | "bottom";
export interface Position {
  layer_id: LayerId;
  orientation: Orientation;
}
