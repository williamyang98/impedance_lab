<script setup lang="ts">
import { defineProps, computed } from "vue";
import {
  Builder, type Layer, type LayerType, type TraceAlignment,
} from "./stackup.ts";

type RGB = `rgb(${number}, ${number}, ${number})`;
type RGBA = `rgba(${number}, ${number}, ${number}, ${number})`;
type HEX = `#${string}`;
type Colour = RGB | RGBA | HEX;

const colours: Record<string, Colour> = {
  copper: "#d9aa1c",
  soldermask: "#00aa00",
  dielectric: "#00ff00",
  black: "#000000",
  air: "#ffffffff",
  selectable: "#777777",
};

function layer_type_to_colour(type: LayerType): Colour {
  switch (type) {
  case "air": return colours.air;
  case "soldermask": return colours.soldermask;
  case "copper": return colours.copper;
  case "dielectric": return colours.dielectric;
  }
}

const props = defineProps<{
  builder: Builder,
  layer: Layer,
  index: number,
}>();

interface SvgPoint {
  x: number;
  y: number;
}

interface SvgTrace {
  points: SvgPoint[];
  colour: Colour;
  on_click?: () => void;
}

function get_trace_alignments(): TraceAlignment[] {
  const layer = props.layer;
  if (layer.type == "dielectric") {
    return ["top", "bottom"];
  }
  const is_layer_top = props.index == 0;
  const is_layer_bottom = props.index == props.builder.layers.length-1;
  if (layer.type == "copper" && !(is_layer_top || is_layer_bottom)) {
    return ["top", "bottom"];
  }
  return is_layer_top ? ["bottom"] : ["top"];
}

interface Layout {
  viewport_width: number;
  viewport_height: number;
  traces: SvgTrace[];
}

function svg_points_to_string(points: SvgPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

const layout = computed<Layout>(() => {
  const viewport_width_padding = 5;
  const copper_plane_height = 15;
  const trace_separation = 5;
  const trace_taper = 5;
  const trace_width = 20;
  const trace_height = 10;
  const soldermask_height = 5;
  const vertical_separation = 5;

  const trace_alignments = get_trace_alignments();
  const signal = props.builder.signal;

  function get_viewport_height(): number {
    const type = props.layer.type;
    if (type == "copper" ) {
      return copper_plane_height;
    }
    if (trace_alignments.length >= 2) {
      const N = trace_alignments.length;
      return trace_height*N + vertical_separation*(N-1);
    }
    if (type == "soldermask" || type == "air") {
      return trace_height+soldermask_height;
    }
    return trace_height;
  }
  const viewport_height = get_viewport_height();

  function get_max_total_traces_horizontal(): number {
    switch (signal.type) {
      case "single": return signal.has_coplanar_ground ? 3 : 1;
      case "coplanar_pair": return signal.has_coplanar_ground ? 4 : 2;
      case "broadside_pair": return 2;
    }
  }

  function get_total_traces_horizontal(): number {
    if (props.layer.type == "copper") {
      return 0;
    }
    return get_max_total_traces_horizontal();
  }

  const total_traces_horizontal = get_total_traces_horizontal();
  const max_traces_horizontal = get_max_total_traces_horizontal();

  function get_viewport_width(): number {
    const trace_combined_width = trace_separation*2+trace_taper*2+trace_width;
    return viewport_width_padding*2 + trace_combined_width*max_traces_horizontal;
  }
  const viewport_width = get_viewport_width();

  function create_traces(): SvgTrace[] {
    const traces: SvgTrace[] = [];
    if (props.layer.type == "copper") {
      return traces;
    }


    const cursor = {
      x: 0,
    };

    function create_trace_points(alignment: TraceAlignment): SvgPoint[] {
      const points: SvgPoint[] = [];
      cursor.x += trace_separation;
      if (alignment == "top") {
        points.push({ x: cursor.x, y: 0 });
        cursor.x += trace_taper;
        points.push({ x: cursor.x, y: trace_height });
        cursor.x += trace_width;
        points.push({ x: cursor.x, y: trace_height });
        cursor.x += trace_taper;
        points.push({ x: cursor.x, y: 0 });
      } else {
        points.push({ x: cursor.x, y: viewport_height });
        cursor.x += trace_taper;
        points.push({ x: cursor.x, y: viewport_height-trace_height });
        cursor.x += trace_width;
        points.push({ x: cursor.x, y: viewport_height-trace_height });
        cursor.x += trace_taper;
        points.push({ x: cursor.x, y: viewport_height });
      }
      cursor.x += trace_separation;
      return points;
    }

    for (const alignment of trace_alignments) {
      cursor.x = viewport_width_padding;
      // broadside signal needs separate handling for left and right pair
      if (signal.type == "broadside_pair") {
        for (let i = 0; i < total_traces_horizontal; i++) {
          const points = create_trace_points(alignment);
          const is_left = i < (total_traces_horizontal/2);
          const has_signal = props.builder.is_broadside_signal_in_layer(props.index, alignment, is_left);
          if (!has_signal && !props.builder.is_valid_signal_alignment(props.index, alignment)) {
            continue;
          }
          const colour = has_signal ? colours.copper : colours.selectable;
          const on_click = has_signal ? undefined : () => {
            props.builder.move_broadside_signal(props.index, alignment, is_left);
          };
          traces.push({ points, on_click, colour });
        }
      } else {
        const has_signal = props.builder.is_signal_in_layer(props.index, alignment);
        if (!has_signal && !props.builder.is_valid_signal_alignment(props.index, alignment)) {
          continue;
        }
        const colour = has_signal ? colours.copper : colours.selectable;
        const on_click = has_signal ? undefined : () => {
          props.builder.move_single_layer_signal(props.index, alignment);
        };
        for (let i = 0; i < total_traces_horizontal; i++) {
          const points = create_trace_points(alignment);
          traces.push({ points, on_click, colour });
        }
      }
    }

    return traces;
  }

  const traces = create_traces();

  return {
    viewport_height,
    viewport_width,
    traces,
  }
});


</script>

<template>
<svg
  class="w-fit min-w-[8rem] min-h-[1.75rem]"
  version="1.1" xmlns="http://www.w3.org/2000/svg"
  :viewBox="`0 0 ${layout.viewport_width} ${layout.viewport_height}`"
  preserveAspectRatio="xMidYMid meet"
>
  <rect
    x="0" :width="layout.viewport_width"
    y="0" :height="layout.viewport_height" :fill="layer_type_to_colour(layer.type)"
    :stroke="colours.black" stroke-width="0.5"></rect>

  <template v-for="(trace, index) in layout.traces" :key="index">
    <polygon
      :class="`${(trace.on_click !== undefined) ? 'trace-select' : 'trace' }`"
      @click="() => trace.on_click?.()"
      :points="svg_points_to_string(trace.points)"
      :fill="trace.colour" :stroke="colours.black" stroke-width="0.5"
    />
  </template>
</svg>
</template>

<style scoped>
polygon.trace-select {
  opacity: 0.2;
}

polygon.trace-select:hover {
  opacity: 1.0;
  cursor: pointer;
}
</style>
