<script lang="ts" setup>
import { defineProps, computed } from "vue";
import {
  type Visualiser, type Viewport,
  type Text,
  type HorizontalAlign, type VerticalAlign,
  type PolygonPoint, type IconLabel,
} from "./visualiser.ts";

const props = defineProps<{
  visualiser: Visualiser,
}>();

const viewport = computed(() => props.visualiser._viewport);
const entities = computed(() => props.visualiser.entities);

const font_glyph_width = 0.75;
const font_glyph_height = 0.8;

function get_text_width(text: Text): number {
  return text.data.length * text.size*font_glyph_width;
}

function get_text_height(text: Text): number {
  return text.size*font_glyph_height;
}

function get_alignment_baseline(align: VerticalAlign) {
  switch (align) {
    case "top": return "text-after-edge";
    case "middle": return "central";
    case "bottom": return "text-before-edge";
  }
}

function get_text_anchor(align: HorizontalAlign) {
  switch (align) {
    case "left": return "start";
    case "center": return "middle";
    case "right": return "end";
  }
}

function get_polygon_points_string(points: PolygonPoint[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ');
}

type ArrowDirection = "left" | "right" | "up" | "down";
function get_arrow_string(x: number, y: number, size: number, direction: ArrowDirection): string {
  switch (direction) {
    case "left": return `${x},${y} ${x+size},${y+size/2} ${x+size},${y-size/2}`;
    case "right": return `${x},${y} ${x-size},${y+size/2} ${x-size},${y-size/2}`;
    case "up": return `${x},${y} ${x+size/2},${y-size} ${x-size/2},${y-size}`;
    case "down": return `${x},${y} ${x+size/2},${y+size} ${x-size/2},${y+size}`;
  }
}

function get_icon_transform(label: IconLabel): string {
  const { width, height } = label.icon;
  return `translate(${label.x},${label.y}) scale(${width},${height})`;
}

function get_view_box(viewport: Viewport): string {
  const width = viewport.x_right-viewport.x_left;
  const height = viewport.y_bottom-viewport.y_top;
  return [
    viewport.x_left, viewport.y_top,
    width, height
  ].join(' ');
}

</script>

<template>
<svg
  version="1.1" xmlns="http://www.w3.org/2000/svg"
  :viewBox="get_view_box(viewport)"
  preserveAspectRatio="xMidYMid meet"
  class="w-full h-full select-text"
>
<template v-for="(e, index) of entities" :key="index">
<!--Shapes-->
<template v-if="e.type === 'rectangle_shape'">
  <rect
    :class="{'cursor-pointer': e.on_click !== undefined}"
    :x="e.x_left" :y="e.y_top"
    :width="e.x_right-e.x_left" :height="e.y_bottom-e.y_top"
    :fill="e.fill_colour" :stroke="e.stroke_colour" :stroke-width="e.stroke_width"
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  />
</template>
<template v-if="e.type === 'circle_shape'">
  <circle
    :class="{'cursor-pointer': e.on_click !== undefined}"
    :cx="e.x" :cy="e.y"
    :r="e.radius"
    :fill="e.fill_colour" :stroke="e.stroke_colour" :stroke-width="e.stroke_width"
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  />
</template>
<template v-if="e.type === 'ellipse_shape'">
  <ellipse
    :class="{'cursor-pointer': e.on_click !== undefined}"
    :cx="e.x" :cy="e.y"
    :rx="e.radius_x" :ry="e.radius_y"
    :fill="e.fill_colour" :stroke="e.stroke_colour" :stroke-width="e.stroke_width"
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  />
</template>
<template v-if="e.type === 'polygon_shape'">
  <polygon
    :class="{'cursor-pointer': e.on_click !== undefined}"
    :points="get_polygon_points_string(e.points)"
    :fill="e.fill_colour" :stroke="e.stroke_colour" :stroke-width="e.stroke_width"
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  />
</template>
<!--Dimension lines-->
<template v-if="e.type === 'horizontal_dimension_line'">
  <g
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  >
    <!--Distance line-->
    <template v-if="e.y_text !== undefined">
      <line
        :x1="e.x_left+e.arrow_size" :x2="e.x_right-e.arrow_size" :y1="e.y_line" :y2="e.y_line"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
    </template>
    <template v-else>
      <line
        :x1="e.x_left+e.arrow_size" :x2="(e.x_left+e.x_right)/2-get_text_width(e.text)/2" :y1="e.y_line" :y2="e.y_line"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
      <line
        :x2="e.x_right-e.arrow_size" :x1="(e.x_left+e.x_right)/2+get_text_width(e.text)/2" :y1="e.y_line" :y2="e.y_line"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
    </template>
    <!--Arrows-->
    <polygon
      :points="get_arrow_string(e.x_left, e.y_line, e.arrow_size, 'left')"
      :fill="e.colour"
    />
    <polygon
      :points="get_arrow_string(e.x_right, e.y_line, e.arrow_size, 'right')"
      :fill="e.colour"
    />
    <!--Extension lines-->
    <line v-if="e.left_extension_line"
      :x1="e.x_left" :x2="e.x_left"
      :y1="e.left_extension_line.y_top" :y2="e.left_extension_line.y_bottom"
      :stroke="e.colour"
      :stroke-width="e.left_extension_line?.line_width ?? e.line_width"
      :stroke-dasharray="e.left_extension_line?.line_style?.join(',')"
    />
    <line v-if="e.right_extension_line"
      :x1="e.x_right" :x2="e.x_right"
      :y1="e.right_extension_line.y_top" :y2="e.right_extension_line.y_bottom"
      :stroke="e.colour"
      :stroke-width="e.right_extension_line?.line_width ?? e.line_width"
      :stroke-dasharray="e.right_extension_line?.line_style?.join(',')"
    />
    <!--Text-->
    <text
      :x="(e.x_left+e.x_right)/2" :y="e.y_text ?? e.y_line"
      :font-size="e.text.size" :font-weight="e.text.weight" :fill="e.text.colour"
      :alignment-baseline="get_alignment_baseline(e.text_vertical_align)"
      :text-anchor="get_text_anchor(e.text_horizontal_align)"
    >
      {{ e.text.data }}
    </text>
  </g>
</template>
<template v-if="e.type === 'vertical_dimension_line'">
  <g
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  >
    <!--Distance line-->
    <template v-if="e.x_text !== undefined">
      <line
        :x1="e.x_line" :x2="e.x_line" :y1="e.y_top" :y2="e.y_bottom"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
    </template>
    <template v-else>
      <line
        :x1="e.x_line" :x2="e.x_line" :y2="(e.y_top+e.y_bottom)/2-get_text_height(e.text)" :y1="e.y_top"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
      <line
        :x1="e.x_line" :x2="e.x_line" :y1="(e.y_top+e.y_bottom)/2+get_text_height(e.text)" :y2="e.y_bottom"
        :stroke="e.colour" :stroke-width="e.line_width"
      />
    </template>
    <!--Arrows-->
    <polygon
      :points="get_arrow_string(e.x_line, e.y_top, e.arrow_size, 'down')"
      :fill="e.colour"
    />
    <polygon
      :points="get_arrow_string(e.x_line, e.y_bottom, e.arrow_size, 'up')"
      :fill="e.colour"
    />
    <!--Extension lines-->
    <line v-if="e.top_extension_line"
      :x1="e.top_extension_line.x_left" :x2="e.top_extension_line.x_right"
      :y1="e.y_top" :y2="e.y_top"
      :stroke="e.colour"
      :stroke-width="e.top_extension_line?.line_width ?? e.line_width"
      :stroke-dasharray="e.top_extension_line?.line_style?.join(',')"
    />
    <line v-if="e.bottom_extension_line"
      :x1="e.bottom_extension_line.x_left" :x2="e.bottom_extension_line.x_right"
      :y1="e.y_bottom" :y2="e.y_bottom"
      :stroke="e.colour"
      :stroke-width="e.bottom_extension_line?.line_width ?? e.line_width"
      :stroke-dasharray="e.bottom_extension_line?.line_style?.join(',')"
    />
    <!--Text-->
    <text
      :x="e.x_text ?? e.x_line" :y="(e.y_top+e.y_bottom)/2"
      :font-size="e.text.size" :font-weight="e.text.weight" :fill="e.text.colour"
      :alignment-baseline="get_alignment_baseline(e.text_vertical_align)"
      :text-anchor="get_text_anchor(e.text_horizontal_align)"
    >
      {{ e.text.data }}
    </text>
  </g>
</template>
<!--Label-->
<template v-if="e.type === 'text_label'">
  <text
    :x="e.x" :y="e.y"
    :font-size="e.text.size" :font-weight="e.text.weight" :fill="e.text.colour"
    :alignment-baseline="get_alignment_baseline(e.vertical_align)"
    :text-anchor="get_text_anchor(e.horizontal_align)"
    @click="e.on_click?.()"
    @mouseenter="e.on_hover?.(true)"
    @mouseleave="e.on_hover?.(false)"
  >
    {{ e.text.data }}
  </text>
</template>
<template v-if="e.type === 'icon_label'">
  <g :transform="get_icon_transform(e)">
    <component
      :is="e.icon.component"
      x="-0.5" y="-0.5"
      width="1" height="1"
      :stroke="e.icon.colour"
      @click="e.on_click?.()"
      @mouseenter="e.on_hover?.(true)"
      @mouseleave="e.on_hover?.(false)"
    />
  </g>
</template>
</template>
</svg>
</template>
