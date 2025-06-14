// types of parameters
export interface Parameter {
  name?: string;
  description?: string;
  old_value?: number;
  value?: number;
  min?: number;
  max?: number;
  error?: string;
  impedance_correlation?: "positive" | "negative";
}

export interface SizeParameter extends Parameter {
  type: "size";
  placeholder_value: number;
}

export interface TaperSizeParameter extends Parameter {
  type: "taper";
  placeholder_value: number;
  taper_suffix?: string;
}

export interface EpsilonParameter extends Parameter {
  type: "epsilon";
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
  trace_taper: TaperSizeParameter;
  orientation: Orientation;
}

export interface SoldermaskLayer {
  type: "soldermask",
  id: LayerId;
  trace_height: SizeParameter;
  trace_taper: TaperSizeParameter;
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
  trace_taper: TaperSizeParameter;
  epsilon: EpsilonParameter;
}

export type Layer = UnmaskedLayer | SoldermaskLayer | CoreLayer | PrepregLayer;

export interface Stackup {
  spacings: HorizontalSpacing[];
  conductors: Conductor[];
  layers: Layer[];
}
