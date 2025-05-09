import { type TraceAlignment } from "./stackup.ts";

export type LayoutElement =
  { type: "spacing", separation: "ground" | "signal" } |
  { type: "trace", trace: "ground" | "signal" };

export type TraceInfo =
  { type: "solid" } |
  { type: "selectable", on_click: () => void } |
  null;

export interface SurfaceLayerInfo {
  alignment: TraceAlignment;
  has_soldermask: boolean;
  traces: TraceInfo[];
}

export interface InnerLayerInfo {
  traces: Record<TraceAlignment, TraceInfo[]>;
}

export type LayerInfo =
  { type: "surface" } & SurfaceLayerInfo |
  { type: "inner" } & InnerLayerInfo |
  { type: "copper" };

export interface LayoutInfo {
  elements: LayoutElement[];
  layers: LayerInfo[];
}
