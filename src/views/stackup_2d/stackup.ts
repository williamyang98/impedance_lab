import { type DistanceUnit } from "./unit_types.ts";

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
  placeholder_value: number;
}

export interface EtchFactorParameter extends IParameter {
  type: "etch_factor";
  old_value?: number;
  value?: number; // W-W0 = dW0 = 2*T*etch_factor
  taper_suffix?: string;
  placeholder_value: number;
}

export interface EpsilonParameter extends IParameter {
  type: "epsilon";
  old_value?: number;
  value?: number;
}

export type Parameter = SizeParameter | EtchFactorParameter | EpsilonParameter;

export type Orientation = "up" | "down";
export type LayerId = number;
export type TraceId = number;

export type Voltage = "ground" | "positive" | "negative";

export interface TracePosition {
  layer_id: LayerId;
  orientation: Orientation;
}

// conductors
export interface CopperTrace {
  type: "trace";
  id: TraceId;
  width: SizeParameter;
  position: TracePosition;
  voltage: Voltage;
  viewer?: {
    display?: "none" | "solid" | "selectable",
    group_tag?: string,
    is_labeled?: boolean,
    on_click?: () => void;
    z_offset?: number;
  };
}

export interface CopperPlane {
  type: "plane";
  height: SizeParameter;
  position: TracePosition;
  voltage: Voltage;
  layout?: {
    shrink_trace_layer?: boolean;
  };
  viewer?: {
    display?: "none" | "solid" | "selectable",
    is_labeled?: boolean,
    on_click?: () => void;
    z_offset?: number;
  };
  grid?: {
    override_total_divisions?: number;
  };
}

export type Conductor = CopperTrace | CopperPlane;

// horizontal spacing
export type AttachPoint = "left" | "center" | "right";
export interface HorizontalSpacing {
  left_trace: {
    id: TraceId;
    attach: AttachPoint;
  };
  right_trace: {
    id: TraceId;
    attach: AttachPoint;
  };
  width: SizeParameter;
  viewer?: {
    is_display?: boolean;
  }
}

// layers
export interface UnmaskedLayer {
  type: "unmasked",
  id: LayerId;
  trace_height: SizeParameter;
  etch_factor: EtchFactorParameter;
  orientation: Orientation;
}

export interface SoldermaskLayer {
  type: "soldermask",
  id: LayerId;
  trace_height: SizeParameter;
  etch_factor: EtchFactorParameter;
  height: SizeParameter;
  epsilon: EpsilonParameter;
  orientation: Orientation;
}

export interface CoreLayer {
  type: "core",
  id: LayerId;
  height: SizeParameter;
  epsilon: EpsilonParameter;
}

export interface PrepregLayer {
  type: "prepreg",
  id: LayerId;
  height: SizeParameter;
  trace_height: SizeParameter;
  etch_factor: EtchFactorParameter;
  epsilon: EpsilonParameter;
}

export type Layer = UnmaskedLayer | SoldermaskLayer | CoreLayer | PrepregLayer;
export type LayerType = "unmasked" | "soldermask" | "core" | "prepreg";

export interface Stackup {
  spacings: HorizontalSpacing[];
  conductors: Conductor[];
  layers: Layer[];
}
