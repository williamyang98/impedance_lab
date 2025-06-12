// types of parameters
export interface Parameter {
  name?: string;
  description?: string;
  old_value?: number;
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

export function validate_parameter(param: Parameter) {
  if (param.value === undefined) {
    param.error = "Field is required";
    throw Error(`Missing field value for ${param.name}`);
  }
  if (typeof(param.value) !== 'number') {
    param.error = "Field is requried";
    throw Error(`Non number field value for ${param.name}`);
  }
  if (Number.isNaN(param.value)) {
    param.error = "Field is requried";
    throw Error(`NaN field value for ${param.name}`);
  }
  if (param.min !== undefined && param.value < param.min) {
    param.error = `Value must be greater than ${param.min}`;
    throw Error(`Violated minimum value for ${param.name}`);
  }
  if (param.max !== undefined && param.value > param.max) {
    param.error = `Value must be less than ${param.max}`;
    throw Error(`Violated maximum value for ${param.name}`);
  }
  param.error = undefined;
}

export type Orientation = "up" | "down";
export type LayerId = number;
export type TraceId = number;

export type Voltage = "ground" | "positive" | "negative";

// conductors
export interface CopperTrace {
  id: TraceId;
  width: SizeParameter;
  orientation: Orientation;
  layer_id: LayerId;
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
  height: SizeParameter;
  orientation: Orientation;
  layer_id: LayerId;
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
  viewer?: {
    is_display?: boolean;
  }
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
  height: SizeParameter;
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
