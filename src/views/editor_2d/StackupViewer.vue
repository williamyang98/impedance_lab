<script setup lang="ts">
import { type TraceAlignment } from "./stackup.ts";
import {
  type LayoutElement, type SurfaceLayerInfo, type InnerLayerInfo,
  type LayoutInfo, type TraceInfo,
  type TraceElement, type SpacingElement,
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
  // NOTE: this will always be 4 points
  polygon: Point[];
  colour: Colour;
  on_click?: () => void;
}

interface LayoutConfig {
  y_axis_widget_width: number;
  font_size: number;
  epsilon_annotation: {
    x_offset: number;
  };
  width_annotation: {
    overhang: number;
    text_offset: number;
  };
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
      width_annotation: {
        overhang: 5,
        text_offset: 6,
      },
      epsilon_annotation: {
        x_offset: 5,
      },
      font_size: 9,
    },
    size: {
      soldermask_height: 17,
      copper_layer_height: 10,
      trace_height: 20,
      trace_taper: 15,
      signal_trace_width: 25,
      ground_trace_width: 30,
      signal_width_separation: 20,
      ground_width_separation: 25,
      broadside_height_separation: 45,
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

function create_trace_polygons(config: SizeConfig, layout: LayoutElement[]): [Point[][], number] {
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
          case "broadside": {
            cursor.x += config.signal_width_separation;
            break;
          };
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

function create_soldermask_points(
  height: number, width: number,
  y_offset: number, layer_height: number,
  alignment: TraceAlignment,
  traces: SignalTrace[],
): Point[] {
  const all_points: Point[] = [];

  const deposit_above = (c: Point): Point => {
    c = point_offset(c, { x: 0, y: -height });
    return c;
  };

  const deposit_below = (c: Point): Point => {
    c = point_offset(c, { x: 0, y: height });
    return c;
  };

  const deposit_point = (alignment == "bottom") ? deposit_above : deposit_below;

  const extend_points = (points: Point[]) => {
    for (const point of points.map(deposit_point)) {
      all_points.push(point);
    }
  }

  const y_base = (alignment == "bottom") ? y_offset+layer_height : y_offset;
  const y_deposit = (alignment == "bottom") ? y_base-height : y_base+height;

  all_points.push({ x: 0, y: y_base });
  all_points.push({ x: 0, y: y_deposit });
  for (const trace of traces) {
    extend_points(trace.polygon);
  }
  all_points.push({ x: width, y: y_deposit });
  all_points.push({ x: width, y: y_base });

  return all_points;
}

interface HeightAnnotation {
  y_offset: number;
  overhang_top: number;
  overhang_bottom: number;
  height: number;
  text: string;
}

interface WidthAnnotation {
  left_arm_overhang: {
    top: number;
    bottom: number;
  };
  right_arm_overhang: {
    top: number;
    bottom: number;
  };
  offset: Point;
  width: number;
  y_offset_text: number;
  text: string;
}

interface EpsilonAnnotation {
  y_offset: number;
  text: string;
}

class Stackup {
  elements: LayoutElement[];
  viewport_offset: Point = { x: 0, y: 0 };
  viewport_size: Point = { x: 0, y: 0 };
  rows: Row[] = [];
  config: Config = get_default_config();
  trace_polygons_template: Point[][];
  signal_trace_table: Partial<Record<number, SignalTrace>> = {}; // use to lookup created trace for each trace_index
  stackup_width: number;
  height_annotations: HeightAnnotation[] = [];
  width_annotations: WidthAnnotation[] = [];
  epsilon_annotations: EpsilonAnnotation[] = [];

  constructor(info: LayoutInfo) {
    const [trace_polygons, stackup_width] = create_trace_polygons(this.config.size, info.elements);
    this.elements = info.elements;
    this.trace_polygons_template = trace_polygons;
    this.viewport_size.x = stackup_width;
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

    this._create_broadside_layer_separation();
    this._expand_viewport_to_fit_annotations();
  }

  _create_broadside_layer_separation() {
    let trace_index = 0;
    for (const elem of this.elements) {
      if (elem.type == "trace") {
        trace_index++;
        continue;
      }
      if (elem.type != "spacing") continue;
      if (elem.width != "broadside") continue;
      const text = elem.annotation?.width;
      if (text === undefined) continue;

      const left_trace = this.signal_trace_table[trace_index-1];
      const right_trace = this.signal_trace_table[trace_index];
      if (left_trace === undefined || right_trace === undefined) continue;


      const y_mid_left = (left_trace.polygon[0].y+left_trace.polygon[1].y)/2;
      const y_mid_right = (right_trace.polygon[0].y+right_trace.polygon[1].y)/2;
      const x_mid_left = (left_trace.polygon[1].x+left_trace.polygon[2].x)/2;
      const x_mid_right = (right_trace.polygon[1].x+right_trace.polygon[2].x)/2;
      const y_offset = (y_mid_left+y_mid_right)/2;
      const width = x_mid_right-x_mid_left;
      const offset: Point = { x: x_mid_left, y: y_offset };

      const y_left_overhang = y_offset-y_mid_left;
      const y_right_overhang = y_offset-y_mid_right;
      const y_base_overhang = this.config.layout.width_annotation.overhang;
      // prevent overhang arm from overlapping existing width annotation on trace
      const y_overhang_shrink =
        this.config.layout.width_annotation.text_offset +
        2*this.config.layout.width_annotation.overhang +
        this.config.size.trace_height/2;

      const annotation: WidthAnnotation = {
        left_arm_overhang: {
          top: Math.max(y_base_overhang, y_left_overhang-y_overhang_shrink),
          bottom: Math.max(y_base_overhang, -y_left_overhang-y_overhang_shrink),
        },
        right_arm_overhang: {
          top: Math.max(y_base_overhang, y_right_overhang-y_overhang_shrink),
          bottom: Math.max(y_base_overhang, -y_right_overhang-y_overhang_shrink),
        },
        offset,
        width,
        y_offset_text: this.config.layout.width_annotation.text_offset,
        text,
      };
      this.width_annotations.push(annotation);
    }
  }

  _expand_viewport_to_fit_annotations() {
    const x_padding = this.config.layout.y_axis_widget_width;
    this.viewport_offset.x = -x_padding-1;
    this.viewport_size.x += x_padding;

    let y_min = 0;
    let y_max = this.viewport_size.y;
    const font_height = this.config.layout.font_size;
    for (const annotation of this.width_annotations) {
      const y = annotation.offset.y + annotation.y_offset_text;
      // NOTE: we multiple by this asymmetric ratio because the text vertical alignment
      //       isn't actually perfectly centre to the bounding box of the text
      y_min = Math.min(y_min, y-font_height*0.45);
      y_max = Math.max(y_max, y+font_height*0.55);
    }
    const viewport_height = y_max-y_min;
    this.viewport_offset.y = y_min;
    this.viewport_size.y = viewport_height;
  }

  get_trace_colour(type: "solid" | "selectable"): Colour {
    switch (type) {
      case "solid": return this.config.colour.copper;
      case "selectable": return this.config.colour.selectable;
    }
  }

  _create_inline_width_annotation(offset: Point, width: number, text: string, drag_up: boolean): WidthAnnotation {
    const drag_overhang = this.config.layout.width_annotation.overhang;
    const drag_distance = this.config.layout.width_annotation.overhang;
    const text_offset = this.config.layout.width_annotation.text_offset;

    const label: WidthAnnotation = {
      offset: { ...offset },
      width,
      y_offset_text: 0,
      left_arm_overhang: { top: 0, bottom: 0 },
      right_arm_overhang: { top: 0, bottom: 0 },
      text,
    };

    if (drag_up) {
      label.offset.y -= drag_distance;
      label.left_arm_overhang.bottom = drag_distance;
      label.right_arm_overhang.bottom = drag_distance;
      label.left_arm_overhang.top = drag_overhang;
      label.right_arm_overhang.top = drag_overhang;
      label.y_offset_text = -text_offset;
    } else {
      label.offset.y += drag_distance;
      label.left_arm_overhang.top = drag_distance;
      label.right_arm_overhang.top = drag_distance;
      label.left_arm_overhang.bottom = drag_overhang;
      label.right_arm_overhang.bottom = drag_overhang;
      label.y_offset_text = text_offset;
    }

    return label;
  }

  _create_layer_trace(
    polygon: Point[], trace_info: TraceInfo, trace_element: TraceElement, alignment: TraceAlignment,
  ): SignalTrace | null {
    if (trace_info == null) return null;


    const trace: SignalTrace = {
      polygon,
      colour: this.get_trace_colour(trace_info.type),
      on_click: trace_info.type == "selectable" ? trace_info.on_click : undefined,
    };

    // only annotate solid traces
    const text = trace_element.annotation;
    if (trace_info.type == "solid" && text) {
      if (text.width) {
        const offset = polygon[0];
        const width = polygon[3].x-polygon[0].x;
        const drag_up = alignment == "top";
        const annotation = this._create_inline_width_annotation(offset, width, text.width, drag_up);
        this.width_annotations.push(annotation);
      }
      if (text.taper) {
        const offset = polygon[1];
        const width = polygon[2].x-polygon[1].x;
        const drag_up = alignment == "bottom";
        const annotation = this._create_inline_width_annotation(offset, width, text.taper, drag_up);
        this.width_annotations.push(annotation);
      }
    }

    return trace;
  }

  _create_inline_layer_separation(
    left_polygon: Point[], right_polygon: Point[],
    spacing_element: SpacingElement, alignment: TraceAlignment,
  ) {
    const text = spacing_element.annotation;
    if (text === undefined) return;
    if (text.width) {
      const offset = left_polygon[3];
      const width = right_polygon[0].x - left_polygon[3].x;
      const drag_up = alignment == "top";
      const annotation = this._create_inline_width_annotation(offset, width, text.width, drag_up);
      this.width_annotations.push(annotation);
    }
  }

  _create_layer_traces(
    y_offset: number, layer_height: number, alignment: TraceAlignment,
    traces_info: TraceInfo[],
  ): SignalTrace[] {
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
    const to_layer = get_to_layer(alignment);
    const trace_polygons = this.trace_polygons_template.map(polygon => polygon.map(to_layer));

    const traces: SignalTrace[] = [];
    if (this.trace_polygons_template.length != traces_info.length) {
      console.warn(`Got mismatching number of traces between template (${this.trace_polygons_template.length}) and layer trace info (${traces_info.length}) at alignment '${alignment}'`);
    }
    const total_traces = Math.min(this.trace_polygons_template.length, traces_info.length);

    let trace_index = 0;
    for (const element of this.elements) {
      switch (element.type) {
        case "trace": {
          const trace_info: TraceInfo = traces_info[trace_index];
          const trace_polygon = trace_polygons[trace_index];
          const trace = this._create_layer_trace(trace_polygon, trace_info, element, alignment);
          if (trace !== null) {
            traces.push(trace);
            if (trace_info?.type == "solid") {
              this.signal_trace_table[trace_index] = trace;
            }
          }
          trace_index++;
          break;
        }
        case "spacing": {
          if (element.width != "broadside") {
            if (trace_index > 0 && trace_index < total_traces) {
              const is_left_trace = traces_info[trace_index-1]?.type == "solid";
              const is_right_trace = traces_info[trace_index]?.type == "solid";
              const left_polygon = trace_polygons[trace_index-1];
              const right_polygon = trace_polygons[trace_index];
              if (is_left_trace && is_right_trace) {
                this._create_inline_layer_separation(left_polygon, right_polygon, element, alignment);
              }
            }
          }
          break;
        }
      }
      if (trace_index == total_traces) {
        break;
      }
    }
    return traces;
  }

  create_surface_layer(info: SurfaceLayerInfo) {
    const layer_height = this.config.size.trace_height + this.config.size.soldermask_height;
    const y_offset = this.viewport_size.y;

    const traces = this._create_layer_traces(y_offset, layer_height, info.alignment, info.traces);

    const soldermask_points = create_soldermask_points(
      this.config.size.soldermask_height, this.stackup_width,
      y_offset, layer_height, info.alignment,
      traces,
    );

    const layer: Layer = info.has_soldermask ? {
      type: "soldermask",
      polygon: soldermask_points,
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
    if (traces.length > 0) {
      annotation_overhang = traces[0].polygon[1].x;
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
    if (text?.epsilon) {
      if (info.alignment == "top") {
        this.epsilon_annotations.push({
          y_offset: y_offset+this.config.size.soldermask_height/2,
          text: text.epsilon,
        });
      } else {
        this.epsilon_annotations.push({
          y_offset: y_offset+layer_height-this.config.size.soldermask_height/2,
          text: text.epsilon,
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

    const alignment_traces: Partial<Record<TraceAlignment, SignalTrace[]>> = {};
    for (const alignment of trace_alignments) {
      const traces_info = info.traces[alignment];
      if (traces_info === undefined) continue;
      const traces = this._create_layer_traces(y_offset, layer_height, alignment, traces_info);
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
    if (text?.epsilon) {
      this.epsilon_annotations.push({
        y_offset: y_offset + layer_height/2,
        text: text.epsilon,
      });
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
  :viewBox="`
    ${stackup.viewport_offset.x} ${stackup.viewport_offset.y}
    ${stackup.viewport_size.x} ${stackup.viewport_size.y}
  `"
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
        <text x="1" :y="label.height/2" :font-size="layout.font_size">
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
  <!-- Width annotations -->
  <template v-for="(label, index) in stackup.width_annotations" :key="index">
    <g :transform="`translate(${label.offset.x}, ${label.offset.y})`">
      <g :transform="`translate(0,0)`">
        <line
          x1="0" x2="0"
          :y1="label.left_arm_overhang.bottom"
          :y2="-label.left_arm_overhang.top"
          stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
        <line
          :x1="label.width" :x2="label.width"
          :y1="label.right_arm_overhang.bottom"
          :y2="-label.right_arm_overhang.top"
          stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
        <text
          :x="label.width/2" :y="label.y_offset_text"
          :font-size="layout.font_size"
          text-anchor="middle"
        >
          {{ label.text }}
        </text>
        <g>
          <line
            x1="0" :x2="label.width"
            y1="0" y2="0"
            stroke="#000000" stroke-width="0.5"></line>
          <g :transform="`translate(${2},0)`">
            <polygon points="-2,0 2,2 2,-2" fill="#000000"></polygon>
          </g>
          <g :transform="`translate(${label.width-2},0) scale(1,-1)`">
            <polygon points="2,0 -2,2 -2,-2" fill="#000000"></polygon>
          </g>
        </g>
      </g>
    </g>
  </template>
  <!-- Epsilon annotations -->
  <g :transform="`translate(${layout.epsilon_annotation.x_offset},0)`">
    <template v-for="(label, index) in stackup.epsilon_annotations" :key="index">
      <text x="0" :y="label.y_offset" :font-size="layout.font_size">{{ label.text }}</text>
    </template>
  </g>
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
