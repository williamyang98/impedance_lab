import {
  type TraceAlignment, type TraceType, type SpacingType,
} from "./stackup.ts";

export interface TraceLayoutElement {
  width: TraceType;
  annotation?: {
    width?: string;
    taper?: string;
  };
}

export interface SpacingLayoutElement {
  width: SpacingType;
  annotation?: {
    width?: string;
  };
}

export type LayoutElement =
  { type: "trace" } & TraceLayoutElement |
  { type: "spacing" } & SpacingLayoutElement;

export type TraceElement =
  { type: "solid" } |
  { type: "selectable", on_click: () => void } |
  null;

export interface SurfaceLayerElement {
  alignment: TraceAlignment;
  has_soldermask: boolean;
  trace_elements: TraceElement[];
  annotation?: {
    soldermask_height?: string;
    trace_height?: string;
    epsilon?: string;
  };
}

export interface InnerLayerElement {
  trace_elements: Partial<Record<TraceAlignment, TraceElement[]>>;
  annotation?: {
    dielectric_height?: string;
    epsilon?: string;
    trace_heights?: Partial<Record<TraceAlignment, string>>;
  };
}

export type LayerElement =
  { type: "surface" } & SurfaceLayerElement |
  { type: "inner" } & InnerLayerElement |
  { type: "copper" };

export interface ViewerLayout {
  layout_elements: LayoutElement[];
  layer_elements: LayerElement[];
}
