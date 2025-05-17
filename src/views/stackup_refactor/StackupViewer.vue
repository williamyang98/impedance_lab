<script setup lang="ts">
import { defineProps, computed } from "vue";
import { type Stackup, type SizeParameter } from "./stackup.ts";
import { create_layout_from_stackup, type TrapezoidShape } from "./layout.ts";
import { Viewer, font_size } from "./viewer.ts";

const props = defineProps<{
  stackup: Stackup,
}>();

const viewer = computed(() => {
  const get_size = (param: SizeParameter): number => {
    return param.placeholder_value;
  };
  const layout = create_layout_from_stackup(props.stackup, get_size);
  const viewer = new Viewer(layout);
  return viewer;
});

function trapezoid_shape_to_points(shape: TrapezoidShape): string {
  const points = [
    [shape.x_left, shape.y_base],
    [shape.x_left_taper, shape.y_taper],
    [shape.x_right_taper, shape.y_taper],
    [shape.x_right, shape.y_base],
  ]
  return points.map(([x,y]) => `${x},${y}`).join(' ');
}

const colours = {
  copper: "#eacc2d",
  dielectric_soldermask: "#00aa00",
  dielectric_prepreg: "#55cc33",
  dielectric_core: "#88ed44",
  selectable: "#aaaaaa",
};

const stroke = {
  outline_colour: "#00000040",
  outline_width: 0.2,
  arm_colour: "#000000",
  arm_width: 0.25,
  arm_dash_array: "2,2",
  line_colour: "#000000",
  line_width: 0.5,
};

const viewport_padding = 0.5;

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
        <template v-for="(trace_mask, trace_index) in layer.mask.traces" :key="trace_index">
          <polygon
            :points="trapezoid_shape_to_points(trace_mask)"
            :fill="colours.dielectric_soldermask" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
          />
        </template>
        <rect
          :x="viewer.stackup.x_min" :y="layer.mask.surface.y_start"
          :width="viewer.stackup.width" :height="layer.mask.surface.height"
          :fill="colours.dielectric_soldermask" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
        ></rect>
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
  <template v-for="(trace, index) in viewer.traces" :key="index">
    <polygon
      :points="trapezoid_shape_to_points(trace.shape)"
      :class="`
        ${trace.is_selectable ? 'trace-selectable' : ''}
        ${trace.on_click ? 'trace-clickable' : '' }
      `"
      :fill="colours.copper"
      :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
      @click="() => trace.on_click?.()"
    />
  </template>
  <template v-for="(conductor, index) in viewer.layout.conductors" :key="index">
    <template v-if="conductor.type == 'plane'">
      <rect
        :x="viewer.stackup.x_min" :y="conductor.shape.y_start"
        :width="viewer.stackup.width" :height="conductor.shape.height"
        :fill="colours.copper" :stroke="stroke.outline_colour" :stroke-width="stroke.outline_width"
      ></rect>
    </template>
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
  stroke-width: 1;
}

.trace-selectable:hover {
  opacity: 1.0;
}

.trace-clickable {
  cursor: pointer;
  user-select: none;
}
</style>
