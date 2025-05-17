// types of parameters
export interface Parameter {
  name?: string;
  description?: string;
  value?: number;
  min?: number;
  max?: number;
  error?: string;
}

export interface SizeParameter extends Parameter {
  placeholder_value: number;
}

export interface TaperSizeParameter extends SizeParameter {
  taper_suffix?: string;
}

export type Orientation = "up" | "down";
export type LayerId = number;
export type TraceId = number;

// conductors
export interface CopperTrace {
  id: TraceId;
  width: SizeParameter;
  orientation: Orientation;
  layer_id: LayerId;
}

export interface CopperPlane {
  height: SizeParameter;
  orientation: Orientation;
  layer_id: LayerId;
}

export type Conductor =
  { type: "trace" } & CopperTrace |
  { type: "plane" } & CopperPlane;

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
}

// layers
export interface UnmaskedLayer {
  id: LayerId;
  trace_height: SizeParameter;
  trace_taper: TaperSizeParameter;
  orientation: Orientation;
}

export interface SoldermaskLayer {
  id: LayerId;
  trace_height: SizeParameter;
  trace_taper: TaperSizeParameter;
  soldermask_height: SizeParameter;
  epsilon: Parameter;
  orientation: Orientation;
}

export interface CoreLayer {
  id: LayerId;
  height: SizeParameter;
  epsilon: Parameter;
}

export interface PrepregLayer {
  id: LayerId;
  height: SizeParameter;
  trace_height: SizeParameter;
  trace_taper: TaperSizeParameter;
  epsilon: Parameter;
}

export type Layer =
  { type: "unmasked" } & UnmaskedLayer |
  { type: "soldermask" } & SoldermaskLayer |
  { type: "core" } & CoreLayer |
  { type: "prepreg" } & PrepregLayer;


export interface Stackup {
  spacings: HorizontalSpacing[];
  conductors: Conductor[];
  layers: Layer[];
}
