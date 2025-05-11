import { type TraceAlignment } from "./stackup.ts";

export interface TraceElement {
  width: "ground" | "signal";
  annotation?: {
    width?: string;
    taper?: string;
  };
}

export interface SpacingElement {
  width: "ground" | "signal" | "broadside";
  annotation?: {
    width?: string;
  };
}

export type LayoutElement =
  { type: "spacing" } & SpacingElement |
  { type: "trace" } & TraceElement;

export type TraceInfo =
  { type: "solid" } |
  { type: "selectable", on_click: () => void } |
  null;

export interface SurfaceLayerInfo {
  alignment: TraceAlignment;
  has_soldermask: boolean;
  traces: TraceInfo[];
  annotation?: {
    soldermask_height?: string;
    trace_height?: string;
    epsilon?: string;
  };
}

export interface InnerLayerInfo {
  traces: Partial<Record<TraceAlignment, TraceInfo[]>>;
  annotation?: {
    dielectric_height?: string;
    epsilon?: string;
    trace_heights?: Partial<Record<TraceAlignment, string>>;
  };
}

export type LayerInfo =
  { type: "surface" } & SurfaceLayerInfo |
  { type: "inner" } & InnerLayerInfo |
  { type: "copper" };

export interface LayoutInfo {
  elements: LayoutElement[];
  layers: LayerInfo[];
}
