<script setup lang="ts">
import { defineProps, computed, ref, watch } from "vue";
import { type Stackup, type SizeParameter, type TaperSizeParameter } from "./stackup.ts";
import { create_layout_from_stackup, type TrapezoidShape, type SoldermaskLayerLayout, type Position } from "./layout.ts";
import { Viewer, type ViewerConfig, font_size, voltage_size } from "./viewer.ts";
import { CirclePlusIcon, CircleMinusIcon } from "lucide-vue-next";

const props = defineProps<{
  stackup: Stackup,
  config?: ViewerConfig,
}>();

const viewer = computed(() => {
  const get_size = (param: SizeParameter | TaperSizeParameter): number => {
    return param.placeholder_value;
  };
  const layout = create_layout_from_stackup(props.stackup, get_size);
  const viewer = new Viewer(layout, props.config);
  return viewer;
});

// highlight groups of traces
const trace_group_hovered = ref(new Set<string>());
function on_trace_group_hover(group_tag?: string) {
  if (group_tag === undefined) return
  trace_group_hovered.value.add(group_tag);
}

function on_trace_group_unhover(group_tag?: string) {
  if (group_tag === undefined) return
  trace_group_hovered.value.delete(group_tag);
}

function is_trace_group_hovered(group_tag?: string): boolean {
  if (group_tag === undefined) return false;
  return trace_group_hovered.value.has(group_tag);
}

watch(viewer, () => {
  // reset hover when viewer is updated
  trace_group_hovered.value.clear();
});

// display constants
const colours = {
  copper: "#eacc2d",
  dielectric_soldermask: "#00aa00",
  dielectric_prepreg: "#55cc33",
  dielectric_core: "#88ed44",
  selectable: "#aaaaaa",
};

const stroke = {
  outline_colour: "#00000040",
  outline_width: 0.5,
  arm_colour: "#000000",
  arm_width: 0.5,
  arm_dash_array: "2,2",
  line_colour: "#000000",
  line_width: 0.5,
};

const viewport_padding = 0.5;


// points to svg polygon string
function points_to_string(points: Position[]): string {
  return points.map(({x,y}) => `${x},${y}`).join(' ');
}

function trapezoid_shape_to_points(shape: TrapezoidShape): Position[] {
  const points: Position[] = [
    { x: shape.x_left, y: shape.y_base },
    { x: shape.x_left_taper, y: shape.y_taper },
    { x: shape.x_right_taper, y: shape.y_taper },
    { x: shape.x_right, y: shape.y_base },
  ];
  return points;
}

const soldermask_layer_layout_to_points = (layout: SoldermaskLayerLayout): Position[] => {
  const mask = layout.mask;
  const points: Position[] = [];
  if (mask === undefined) {
    return points;
  }
  const orientation = layout.parent.orientation;

  const y0 = mask.surface.y_start;
  const y1 = y0 + mask.surface.height;
  const y_start = (orientation == "up") ? y1 : y0;
  const y_end = (orientation == "up") ? y0 : y1;

  // base layer
  const x_start = viewer.value.stackup.x_min;
  const x_end = x_start + viewer.value.stackup.width;
  points.push({ x: x_start, y: y_end  });
  points.push({ x: x_start, y: y_start });
  // trace polygons
  const traces = [...mask.traces];
  traces.sort((a,b) => a.x_left-b.x_left)
  for (const trace of traces) {
    const trace_points = trapezoid_shape_to_points(trace);
    for (const point of trace_points) {
      points.push(point);
    }
  }
  // base layer
  points.push({ x: x_end, y: y_start });
  points.push({ x: x_end, y: y_end  });
  return points;
}

const voltage_labels = computed(() => {
  return viewer.value.voltage_labels
    .filter(label => label.voltage !== "ground")
    .map(label => {
      let icon = undefined;
      switch (label.voltage) {
        case "ground": break;
        case "negative": icon = CircleMinusIcon; break;
        case "positive": icon = CirclePlusIcon; break;
      }
      return {
        x: label.x_offset,
        y: label.y_offset,
        icon,
      };
    });
});

</script>

<template>
<svg
  version="1.1" xmlns="http://www.w3.org/2000/svg"
  :viewBox="`
    ${viewer.viewport.x_min-viewport_padding} ${viewer.viewport.y_min-viewport_padding}
    ${viewer.viewport.width+viewport_padding*2} ${viewer.viewport.height+viewport_padding*2}
  `"
  preserveAspectRatio="xMidYMid meet"
  class="w-full"
>
  <!--Layers-->
  <template v-for="(layer, index) in viewer.layout.layers" :key="index">
    <template v-if="layer.type == 'soldermask'">
      <template v-if="layer.mask">
        <polygon
          :points="points_to_string(soldermask_layer_layout_to_points(layer))"
          :fill="colours.dielectric_soldermask" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
        />
      </template>
    </template>
    <template v-if="layer.type == 'core'">
      <rect
        :x="viewer.stackup.x_min" :y="layer.bounding_box.y_start"
        :width="viewer.stackup.width" :height="layer.bounding_box.height"
        :fill="colours.dielectric_core" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
      ></rect>
    </template>
    <template v-if="layer.type == 'prepreg'">
      <rect
        :x="viewer.stackup.x_min" :y="layer.bounding_box.y_start"
        :width="viewer.stackup.width" :height="layer.bounding_box.height"
        :fill="colours.dielectric_prepreg" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
      ></rect>
    </template>
  </template>
  <!--Conductors-->
  <template v-for="(conductor, index) in viewer.conductors" :key="index">
    <template v-if="conductor.type === 'trace'">
      <polygon
        :class="`
          ${conductor.is_selectable ? 'trace-selectable' : ''}
          ${conductor.on_click ? 'trace-clickable' : '' }
          ${is_trace_group_hovered(conductor.group_tag) ? 'trace-selectable-group-hover' : '' }
        `"
        :points="points_to_string(trapezoid_shape_to_points(conductor.shape))"
        :fill="colours.copper" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
        @click="() => conductor.on_click?.()"
        @mouseenter="() => on_trace_group_hover(conductor.group_tag)"
        @mouseleave="() => on_trace_group_unhover(conductor.group_tag)"
        :group_tag="conductor.group_tag"
      />
    </template>
    <template v-else-if="conductor.type === 'plane'">
      <rect
        :class="`
          ${conductor.is_selectable ? 'trace-selectable' : ''}
          ${conductor.on_click ? 'trace-clickable' : '' }
        `"
        :x="viewer.stackup.x_min" :y="conductor.shape.y_start"
        :width="viewer.stackup.width" :height="conductor.shape.height"
        :fill="colours.copper" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
        @click="() => conductor.on_click?.()"
      ></rect>
    </template>
  </template>
  <!-- Voltage labels -->
  <template v-for="(label, index) in voltage_labels" :key="index">
    <g
      v-if="label.icon !== undefined"
      :transform="`translate(${label.x},${label.y}) scale(${voltage_size})`"
    >
      <component :is="label.icon" x="-0.5" y="-0.5" width="1" height="1" stroke="black"/>
    </g>
  </template>
  <!-- Height labels -->
  <template v-for="(label, index) in viewer.height_labels" :key="index">
    <g :transform="`translate(${viewer.height_label_config.x_min},${label.y_offset})`">
      <line
        x1="0" :x2="viewer.height_label_config.width+label.overhang_top"
        y1="0" y2="0"
        :stroke="stroke.arm_colour" :stroke-width="stroke.arm_width" :stroke-dasharray="stroke.arm_dash_array"/>
      <line
        x1="0" :x2="viewer.height_label_config.width+label.overhang_bottom"
        :y1="label.height" :y2="label.height"
        :stroke="stroke.arm_colour" :stroke-width="stroke.arm_width" :stroke-dasharray="stroke.arm_dash_array"/>
      <text
        x="1" :y="label.height/2"
        :font-size="font_size"
        font-weight="500"
        alignment-baseline="central"
      >
        {{ label.text }}
      </text>
      <g :transform="`translate(${viewer.height_label_config.width-5},0)`">
        <line x1="0" x2="0" :y1="2" :y2="label.height-2" stroke="#000000" stroke-width="0.5"></line>
        <g :transform="`translate(0,${2})`">
          <polygon points="-2,2 0,-2 2,2" fill="#000000"></polygon>
        </g>
        <g :transform="`translate(0,${label.height-2}) scale(1,-1)`">
          <polygon points="-2,2 0,-2 2,2" fill="#000000"></polygon>
        </g>
      </g>
    </g>
  </template>
  <!-- Width labels -->
  <template v-for="(label, index) in viewer.width_labels" :key="index">
    <g :transform="`translate(${label.offset.x}, ${label.offset.y})`">
      <line
        x1="0" x2="0"
        :y1="label.left_arm_overhang.bottom"
        :y2="-label.left_arm_overhang.top"
        :stroke="stroke.arm_colour" :stroke-width="stroke.arm_width" :stroke-dasharray="stroke.arm_dash_array"/>
      <line
        :x1="label.width" :x2="label.width"
        :y1="label.right_arm_overhang.bottom"
        :y2="-label.right_arm_overhang.top"
        :stroke="stroke.arm_colour" :stroke-width="stroke.arm_width" :stroke-dasharray="stroke.arm_dash_array"/>
      <text
        :x="label.width/2" :y="label.y_offset_text"
        :font-size="font_size"
        text-anchor="middle"
        font-weight="500"
        alignment-baseline="central"
      >
        {{ label.text }}
      </text>
      <g>
        <template v-if="label.mask_out_width">
          <line
            x1="0" :x2="label.width/2-label.mask_out_width/2"
            y1="0" y2="0"
            :stroke="stroke.line_colour" :stroke-width="stroke.line_width"></line>
          <line
            :x1="label.width/2+label.mask_out_width/2" :x2="label.width"
            y1="0" y2="0"
            :stroke="stroke.line_colour" :stroke-width="stroke.line_width"></line>
        </template>
        <template v-else>
          <line
            x1="0" :x2="label.width"
            y1="0" y2="0"
            :stroke="stroke.line_colour" :stroke-width="stroke.line_width"></line>
        </template>
        <g :transform="`translate(${2},0)`">
          <polygon points="-2,0 2,2 2,-2" fill="#000000"></polygon>
        </g>
        <g :transform="`translate(${label.width-2},0) scale(1,-1)`">
          <polygon points="2,0 -2,2 -2,-2" fill="#000000"></polygon>
        </g>
      </g>
    </g>
  </template>
  <!-- Epsilon labels -->
  <template v-for="(label, index) in viewer.epsilon_labels" :key="index">
    <text
      :x="viewer.epsilon_label_x_offset" :y="label.y_offset"
      :font-size="font_size"
      font-weight="500"
      alignment-baseline="central"
    >
      {{ label.text }}
    </text>
  </template>
</svg>
</template>

<style scoped>
.trace-selectable {
  opacity: 0.4;
}

.trace-selectable-group-hover {
  opacity: 1.0;
}

.trace-selectable:hover {
  opacity: 1.0;
}

.trace-clickable {
  cursor: pointer;
  user-select: none;
}
</style>
