<script setup lang="ts">
import { __wbindgen_export_0 } from "../../wasm/pkg/fdtd_core_bg.wasm";
import { type TraceAlignment } from "./stackup.ts";
import {
  type LayoutElement, type SurfaceLayerInfo, type InnerLayerInfo, type LayoutInfo,
} from "./viewer_layout.ts";

import { defineProps, computed } from "vue";

const props = defineProps<{
  layout_info: LayoutInfo,
}>();

type RGB = `rgb(${number}, ${number}, ${number})`;
type RGBA = `rgba(${number}, ${number}, ${number}, ${number})`;
type HEX = `#${string}`;
type Colour = RGB | RGBA | HEX;

interface Point {
  x: number;
  y: number;
}

interface RectangularLayer {
  offset: Point;
  width: number;
  height: number;
  colour: Colour;
}

interface SoldermaskLayer {
  polygon: Point[];
  colour: Colour;
}

type Layer =
  { type: "rectangular" } & RectangularLayer |
  { type: "soldermask" } & SoldermaskLayer;

interface SignalTrace {
  polygon: Point[];
  colour: Colour;
  on_click?: () => void;
}

interface LayoutConfig {
  y_axis_widget_width: number;
  font_size: number;
}

interface SizeConfig {
  soldermask_height: number;
  copper_layer_height: number;
  trace_height: number;
  trace_taper: number;
  signal_trace_width: number;
  ground_trace_width: number;
  signal_width_separation: number;
  ground_width_separation: number;
  broadside_height_separation: number;
  padding_width: number;
}

interface ColourConfig {
  copper: Colour;
  dielectric_soldermask: Colour;
  dielectric_core: Colour;
  dielectric_prepreg: Colour;
  black: Colour;
  air: Colour;
  selectable: Colour;
}

interface Config {
  layout: LayoutConfig;
  size: SizeConfig;
  colour: ColourConfig;
}

function get_default_config(): Config {
  return {
    layout: {
      y_axis_widget_width: 23,
      font_size: 9,
    },
    size: {
      soldermask_height: 15,
      copper_layer_height: 10,
      trace_height: 20,
      trace_taper: 15,
      signal_trace_width: 25,
      ground_trace_width: 30,
      signal_width_separation: 20,
      ground_width_separation: 25,
      broadside_height_separation: 40,
      padding_width: 25,
    },
    colour: {
      copper: "#eacc2d",
      dielectric_soldermask: "#00aa00",
      dielectric_prepreg: "#55cc33",
      dielectric_core: "#88ed44",
      black: "#000000",
      air: "#ffffff66",
      selectable: "#aaaaaa",
    },
  };
}

interface Row {
  layer: Layer;
  traces: SignalTrace[];
}

function point_flip(c: Point): Point {
  return { x: c.x, y: -c.y };
}

function point_offset(c: Point, o: Point): Point {
  return { x: c.x+o.x, y: c.y+o.y };
}

function create_trace_points(taper: number, height: number, width: number): Point[] {
  const points = [];
  const c: Point = { x: 0, y: 0 };
  points.push({ ...c });
  c.x += taper;
  c.y = height;
  points.push({ ...c });
  c.x += width;
  points.push({ ...c });
  c.x += taper;
  c.y = 0;
  points.push({ ...c });
  return points;
}

function create_signal_layer_points(config: SizeConfig, layout: LayoutElement[]): [Point[][], number] {
  const ground_trace_points = create_trace_points(
    config.trace_taper,
    config.trace_height,
    config.ground_trace_width,
  );

  const signal_trace_points = create_trace_points(
    config.trace_taper,
    config.trace_height,
    config.signal_trace_width,
  );

  const traces: Point[][] = [];
  const cursor: Point = { x: 0, y: 0 };
  const map_points = (c: Point): Point => {
    c = point_offset(c, cursor);
    return c;
  };

  const push_points = (points: Point[]) => {
    const width = points[points.length-1].x;
    traces.push(points.map(map_points));
    cursor.x += width;
  }

  const total_traces = layout.filter(elem => elem.type == "trace").length;
  const padding_width = config.padding_width*Math.max(1, 5-total_traces);

  cursor.x += padding_width;
  for (const elem of layout) {
    switch (elem.type) {
      case "spacing": {
        switch (elem.width) {
          case "ground": {
            cursor.x += config.ground_width_separation;
            break;
          }
          case "signal": {
            cursor.x += config.signal_width_separation;
            break;
          }
        }
        break;
      }
      case "trace": {
        switch (elem.width) {
          case "ground": {
            push_points(ground_trace_points);
            break;
          }
          case "signal": {
            push_points(signal_trace_points);
            break;
          }
        }
        break;
      };
    }
  }
  cursor.x += padding_width;
  return [traces, cursor.x];
}

function create_soldermask_points(height: number, width: number, traces: Point[][]): Point[] {
  const all_points: Point[] = [];

  const map_trace_points = (c: Point): Point => {
    c = point_offset(c, { x: 0, y: height });
    return c;
  };

  const extend_points = (points: Point[]) => {
    for (const point of points.map(map_trace_points)) {
      all_points.push(point);
    }
  }

  all_points.push({ x: 0, y: 0 });
  all_points.push({ x: 0, y: height });
  for (const points of traces) {
    extend_points(points);
  }
  all_points.push({ x: width, y: height });
  all_points.push({ x: width, y: 0 });

  return all_points;
}

interface HeightAnnotation {
  y_offset: number;
  overhang_top: number;
  overhang_bottom: number;
  height: number;
  text: string;
}

class Stackup {
  viewport_size: Point = { x: 0, y: 0 };
  rows: Row[] = [];
  config: Config = get_default_config();
  points_traces_template: Point[][];
  stackup_width: number;
  height_annotations: HeightAnnotation[] = [];

  constructor(info: LayoutInfo) {
    const [traces_points, stackup_width] = create_signal_layer_points(this.config.size, info.elements);
    this.points_traces_template = traces_points;
    this.viewport_size.x = stackup_width + this.config.layout.y_axis_widget_width;
    this.stackup_width = stackup_width;

    for (const layer_info of info.layers) {
      switch (layer_info.type) {
        case "surface": {
          this.create_surface_layer(layer_info);
          break;
        }
        case "inner": {
          this.create_inner_layer(layer_info);
          break;
        }
        case "copper": {
          this.create_copper_layer();
          break;
        }
      }
    }
  }

  get_trace_colour(type: "solid" | "selectable"): Colour {
    switch (type) {
      case "solid": return this.config.colour.copper;
      case "selectable": return this.config.colour.selectable;
    }
  }

  create_surface_layer(info: SurfaceLayerInfo) {
    const layer_height = this.config.size.trace_height + this.config.size.soldermask_height;
    const y_offset = this.viewport_size.y;

    const to_top_layer = (point: Point): Point => {
      point = point_offset(point, { x: 0, y: y_offset });
      return point;
    };

    const to_bottom_layer = (point: Point): Point => {
      point = point_flip(point);
      point = point_offset(point, { x: 0, y: y_offset + layer_height });
      return point;
    };

    const to_layer = (info.alignment == "bottom") ? to_bottom_layer : to_top_layer;

    const trace_points: Point[][] = [];
    const traces: SignalTrace[] = [];
    if (this.points_traces_template.length != info.traces.length) {
      console.warn(`Got mismatching number of traces between template (${this.points_traces_template.length}) and layer trace info (${info.traces.length})`);
    }
    const total_traces = Math.min(this.points_traces_template.length, info.traces.length);
    for (let i = 0; i < total_traces; i++) {
      const trace_info = info.traces[i];
      if (trace_info == null) continue;
      const points = this.points_traces_template[i];

      const trace: SignalTrace = {
        polygon: points.map(to_layer),
        colour: this.get_trace_colour(trace_info.type),
        on_click: trace_info.type == "selectable" ? trace_info.on_click : undefined,
      };

      trace_points.push(points);
      traces.push(trace);
    }

    const soldermask_points = create_soldermask_points(
      this.config.size.soldermask_height,
      this.stackup_width,
      trace_points,
    )

    const layer: Layer = info.has_soldermask ? {
      type: "soldermask",
      polygon: soldermask_points.map(to_layer),
      colour: this.config.colour.dielectric_soldermask,
    } : {
      type: "rectangular",
      offset: { x: 0, y: y_offset },
      width: this.stackup_width,
      height: layer_height,
      colour: this.config.colour.air,
    };

    this.rows.push({ layer, traces });

    // annotation
    const text = info.annotation;
    let annotation_overhang = 0;
    if (trace_points.length > 0) {
      annotation_overhang = trace_points[0][1].x;
    }

    if (info.alignment == "top") {
      if (text?.trace_height) {
        this.height_annotations.push({
          y_offset,
          height: this.config.size.trace_height,
          overhang_top: 0,
          overhang_bottom: annotation_overhang,
          text: text.trace_height,
        });
      }
      if (text?.soldermask_height && info.has_soldermask) {
        this.height_annotations.push({
          y_offset: y_offset+this.config.size.trace_height,
          height: this.config.size.soldermask_height,
          overhang_top: 0,
          overhang_bottom: annotation_overhang,
          text: text.soldermask_height,
        });
      }
    } else {
      if (text?.trace_height) {
        this.height_annotations.push({
          y_offset: y_offset+this.config.size.soldermask_height,
          height: this.config.size.trace_height,
          overhang_top: annotation_overhang,
          overhang_bottom: 0,
          text: text.trace_height,
        });
      }
      if (text?.soldermask_height && info.has_soldermask) {
        this.height_annotations.push({
          y_offset: y_offset,
          height: this.config.size.soldermask_height,
          overhang_top: annotation_overhang,
          overhang_bottom: 0,
          text: text.soldermask_height,
        });
      }
    }

    this.viewport_size.y += layer_height;
  }

  create_inner_layer(info: InnerLayerInfo) {
    // NOTE: we redeclare this so we control which order will build the stackup
    const trace_alignments: TraceAlignment[] = ["top", "bottom"];
    const total_alignments = trace_alignments
      .map(alignment => info.traces[alignment])
      .filter(traces => traces !== undefined)
      .length;
    const layer_height =
      this.config.size.trace_height*total_alignments +
      this.config.size.broadside_height_separation*Math.max(1, total_alignments-1);
    const y_offset = this.viewport_size.y;

    const to_top_layer = (point: Point): Point => {
      point = point_offset(point, { x: 0, y: y_offset });
      return point;
    };
    const to_bottom_layer = (point: Point): Point => {
      point = point_flip(point);
      point = point_offset(point, { x: 0, y: y_offset + layer_height });
      return point;
    };
    const get_to_layer = (alignment: TraceAlignment) => {
      switch (alignment) {
      case "top": return to_top_layer;
      case "bottom": return to_bottom_layer;
      }
    }

    const alignment_traces: Partial<Record<TraceAlignment, SignalTrace[]>> = {};
    for (const alignment of trace_alignments) {
      const traces_info = info.traces[alignment];
      if (traces_info === undefined) continue;
      const traces: SignalTrace[] = [];
      if (this.points_traces_template.length != traces_info.length) {
        console.warn(`Got mismatching number of traces between template (${this.points_traces_template.length}) and layer trace info (${traces_info.length}) at alignment '${alignment}'`);
      }
      const total_traces = Math.min(this.points_traces_template.length, traces_info.length);
      const to_layer = get_to_layer(alignment);

      for (let i = 0; i < total_traces; i++) {
        const trace_info = traces_info[i];
        if (trace_info == null) continue;
        const points = this.points_traces_template[i];

        const trace: SignalTrace = {
          polygon: points.map(to_layer),
          colour: this.get_trace_colour(trace_info.type),
          on_click: trace_info.type == "selectable" ? trace_info.on_click : undefined,
        };
        traces.push(trace);
      }
      alignment_traces[alignment] = traces;
    }

    // annotations
    const text = info.annotation;
    let height_annotation_offset = y_offset;
    for (let i = 0; i < trace_alignments.length; i++) {
      const alignment = trace_alignments[i];
      const traces = alignment_traces[alignment];
      if (traces !== undefined) {
        const annotation_overhang = (traces.length > 0) ? traces[0].polygon[1].x : 0;
        const height = this.config.size.trace_height;
        const label = text?.trace_heights?.[alignment];
        if (label) {
          const overhang_top = (i > 0) ? annotation_overhang : 0;
          const overhang_bottom = (i < trace_alignments.length-1) ? annotation_overhang : 0;
          this.height_annotations.push({
            y_offset: height_annotation_offset,
            height,
            overhang_top,
            overhang_bottom,
            text: label,
          });
        }
        height_annotation_offset += height;
      }
      if (i < trace_alignments.length-1) {
        const height = this.config.size.broadside_height_separation;
        if (text?.dielectric_height) {
          // trace height annotation will handle overhang for us
          this.height_annotations.push({
            y_offset: height_annotation_offset,
            height,
            overhang_top: 0,
            overhang_bottom: 0,
            text: text.dielectric_height,
          });
        }
        height_annotation_offset += height;
      }
    }

    const layer: Layer = {
      type: "rectangular",
      offset: { x: 0, y: y_offset },
      width: this.stackup_width,
      height: layer_height,
      colour: (total_alignments == 0) ? this.config.colour.dielectric_core : this.config.colour.dielectric_prepreg,
    };

    const traces = [];
    for (const alignment of trace_alignments) {
      const sub_traces = alignment_traces[alignment];
      if (sub_traces === undefined) continue;
      for (const trace of sub_traces) {
        traces.push(trace);
      }
    }

    this.rows.push({ layer, traces });
    this.viewport_size.y += layer_height;
  }

  create_copper_layer() {
    const layer_height = this.config.size.copper_layer_height;
    const y_offset = this.viewport_size.y;
    const layer: Layer = {
      type: "rectangular",
      offset: { x: 0, y: y_offset },
      width: this.stackup_width,
      height: layer_height,
      colour: this.config.colour.copper,
    };
    this.rows.push({ layer, traces: [] });
    this.viewport_size.y += layer_height;
  }
}

function points_to_string(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

const stackup = computed(() => new Stackup(props.layout_info));
const layout = computed(() => stackup.value.config.layout);
</script>

<template>
<svg
  version="1.1" xmlns="http://www.w3.org/2000/svg"
  :viewBox="`${-layout.y_axis_widget_width-1} -1 ${stackup.viewport_size.x+1} ${stackup.viewport_size.y+2}`"
  preserveAspectRatio="xMidYMid meet"
>
  <!-- Stackup -->
  <template v-for="(row, i) in stackup.rows" :key="i">
    <g>
      <!-- Layer background -->
      <template v-if="row.layer.type == 'rectangular'">
        <rect
          class="dielectric"
          :x="row.layer.offset.x" :width="row.layer.width"
          :y="row.layer.offset.y" :height="row.layer.height"
          :fill="row.layer.colour"
          ></rect>
      </template>
      <template v-else-if="row.layer.type = 'soldermask'">
        <polygon
          class="dielectric"
          :points="points_to_string(row.layer.polygon)"
          :fill="row.layer.colour"
        />
      </template>
      <!-- Traces -->
      <template v-for="(trace, j) in row.traces" :key="[i,j]">
        <polygon
          :class="`${trace.on_click !== undefined ? 'signal-selectable' : 'signal-solid'}`"
          @click="() => trace.on_click?.()"
          :points="points_to_string(trace.polygon)"
          :fill="trace.colour"
        />
      </template>
    </g>
  </template>
  <!-- Height annotations -->
  <template v-for="(label, index) in stackup.height_annotations" :key="index">
    <g :transform="`translate(${-layout.y_axis_widget_width},0)`">
      <g :transform="`translate(0,${label.y_offset})`">
        <line
          x1="0" :x2="layout.y_axis_widget_width+label.overhang_top"
          y1="0" y2="0"
          stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
        <line
          x1="0" :x2="layout.y_axis_widget_width+label.overhang_bottom"
          :y1="label.height" :y2="label.height"
          stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
        <text x="1" :y="label.height/2-1" :font-size="layout.font_size">
          {{ label.text }}
        </text>
        <g :transform="`translate(${layout.y_axis_widget_width-5},0)`">
          <line x1="0" x2="0" :y1="2" :y2="label.height-2" stroke="#000000" stroke-width="0.5"></line>
          <g :transform="`translate(0,${2})`">
            <polygon points="-2,2 0,-2 2,2" fill="#000000"></polygon>
          </g>
          <g :transform="`translate(0,${label.height-2}) scale(1,-1)`">
            <polygon points="-2,2 0,-2 2,2" fill="#000000"></polygon>
          </g>
        </g>
      </g>
    </g>
  </template>
</svg>
</template>

<style scoped>
svg {
  width: 100%;
  display: block;
}

text {
  font-weight: 500;
  alignment-baseline: central;
}

.dielectric {
  stroke: #00000066;
  stroke-width: 0.25;
}

.signal-solid {
  stroke: #00000066;
  stroke-width: 0.25;
}

.signal-selectable {
  opacity: 0.2;
  stroke: #000000;
  stroke-width: 0.5;
}

.signal-selectable:hover {
  opacity: 1.0;
  cursor: pointer;
}
</style>
