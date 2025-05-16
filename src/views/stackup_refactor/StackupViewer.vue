<script setup lang="ts">
import { defineProps, computed } from "vue";
import {
  type Stackup, type Orientation, type LayerId,
type TraceId,
} from "./stackup.ts";
import {
  create_layout_from_stackup, type TrapezoidShape, type StackupLayout,
} from "./layout.ts";

const props = defineProps<{
  stackup: Stackup,
}>();
const stackup = computed(() => props.stackup);

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
  colour: "#00000040",
  width: 0.2,
};

const font_size = 9;
const min_arm_overhang = 5;
const drag_text_offset = font_size*0.6;
const center_overhang_margin = min_arm_overhang*2 + drag_text_offset;

interface Position {
  x: number;
  y: number;
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
  offset: Position;
  width: number;
  y_offset_text: number;
  text: string;
}

interface EpsilonAnnotation {
  y_offset: number;
  text: string;
}

class Viewer {
  layout: StackupLayout;
  viewport: {
    width: number;
    height: number;
    x_min: number;
    y_min: number;
  };
  stackup: {
    x_min: number;
    y_min: number;
    width: number;
    height: number;
  };
  height_annotations: HeightAnnotation[] = [];
  width_annotations: WidthAnnotation[] = [];
  epsilon_annotations: EpsilonAnnotation[] = [];
  epsilon_annotation_x_offset: number;
  height_annotation: {
    x_min: number;
    width: number;
  };

  constructor(layout: StackupLayout) {

    const stackup_x_padding = 25;
    const stackup_x_min = layout.x_min-stackup_x_padding;
    const stackup_x_max = layout.x_max+stackup_x_padding;
    const stackup_width = stackup_x_max-stackup_x_min;
    const stackup_height = layout.total_height;
    const stackup_y_min = layout.y_min;

    const height_annotation_width = 23;
    const epsilon_annotation_x_offset = 5;

    const viewport_width = stackup_width+height_annotation_width;
    const viewport_height = layout.total_height;
    const viewport_x_min = stackup_x_min-height_annotation_width;
    const viewport_y_min = layout.y_min;

    this.epsilon_annotation_x_offset = epsilon_annotation_x_offset;
    this.height_annotation = {
      x_min: stackup_x_min-height_annotation_width,
      width: height_annotation_width,
    };
    this.layout = layout;
    this.viewport = {
      width: viewport_width,
      height: viewport_height,
      x_min: viewport_x_min,
      y_min: viewport_y_min,
    };
    this.stackup = {
      x_min: stackup_x_min,
      y_min: stackup_y_min,
      width: stackup_width,
      height: stackup_height,
    };

    this.create_height_annotations();
    this.create_trace_width_annotations();
    this.create_spacing_annotations();
  }

  create_height_annotations() {
    const layer_trace_x_min_table: Partial<Record<LayerId, Partial<Record<Orientation, number>>>> = {};
    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const trace = trace_layout.parent;
      const x_min = trace_layout.shape.x_left_taper;
      let orientations = layer_trace_x_min_table[trace.layer_id];
      if (orientations === undefined) {
        orientations = {};
        layer_trace_x_min_table[trace.layer_id] = orientations;
      }
      const old_x_min = orientations[trace.orientation];
      if (old_x_min === undefined || old_x_min > x_min) {
        orientations[trace.orientation] = x_min;
      }
    }
    const get_layer_x_min = (layer_id: LayerId, orientation: Orientation): number => {
      const x_min = layer_trace_x_min_table[layer_id]?.[orientation];
      if (x_min === undefined) return this.stackup.x_min;
      return x_min;
    };
    const get_layer_annotation_overhang = (layer_id: LayerId, orientation: Orientation): number => {
      const x_min = get_layer_x_min(layer_id, orientation);
      return x_min-this.stackup.x_min;
    };

    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "unmasked": {
          const layer = layer_layout.parent;
          const text = layer.trace_height.name;
          const height = layer_layout.bounding_box.height;
          const is_copper_plane = layer_layout.is_copper_plane;
          if (height > 0 && !is_copper_plane && text) {
            const overhang = get_layer_annotation_overhang(layer.id, layer.orientation);
            this.height_annotations.push({
              y_offset: layer_layout.bounding_box.y_start,
              height: layer_layout.bounding_box.height,
              overhang_top: layer.orientation == "up" ? 0 : overhang,
              overhang_bottom: layer.orientation == "up" ? overhang: 0,
              text,
            })
          }
          break;
        }
        case "soldermask": {
          const layer = layer_layout.parent;
          if (layer_layout.mask) {
            const soldermask_height = layer_layout.mask.surface.height;
            // label both trace height and soldermask height
            if (layer_layout.mask.traces.length > 0) {
              const trace = layer_layout.mask.traces[0];
              const trace_height = Math.abs(trace.y_base-trace.y_taper);
              const overhang = get_layer_annotation_overhang(layer.id, layer.orientation);
              if (layer.orientation == "down") {
                const y_start = layer_layout.bounding_box.y_start;
                if (layer.soldermask_height.name) {
                  this.height_annotations.push({
                    y_offset: y_start,
                    height: soldermask_height,
                    overhang_top: overhang,
                    overhang_bottom: overhang,
                    text: layer.soldermask_height.name,
                  });
                }
                if (layer.trace_height.name) {
                  this.height_annotations.push({
                    y_offset: y_start+soldermask_height,
                    height: trace_height,
                    overhang_top: overhang,
                    overhang_bottom: 0,
                    text: layer.trace_height.name,
                  });
                }
              } else {
                const y_start = layer_layout.bounding_box.y_start;
                if (layer.trace_height.name) {
                  this.height_annotations.push({
                    y_offset: y_start,
                    height: trace_height,
                    overhang_top: overhang,
                    overhang_bottom: 0,
                    text: layer.trace_height.name,
                  });
                }
                if (layer.soldermask_height.name) {
                  this.height_annotations.push({
                    y_offset: y_start+trace_height,
                    height: soldermask_height,
                    overhang_top: overhang,
                    overhang_bottom: overhang,
                    text: layer.soldermask_height.name,
                  });
                }
              }
            // label just the soldermask height
            } else {
              if (layer.soldermask_height.name) {
                this.height_annotations.push({
                  y_offset: layer_layout.mask.surface.y_start,
                  height: soldermask_height,
                  overhang_top: 0,
                  overhang_bottom: 0,
                  text: layer.soldermask_height.name,
                });
              }
            }
          }
          break;
        }
        case "core": {
          const layer = layer_layout.parent;
          const text = layer.height.name;
          const height = layer_layout.bounding_box.height;
          if (height > 0 && text) {
            this.height_annotations.push({
              y_offset: layer_layout.bounding_box.y_start,
              height: layer_layout.bounding_box.height,
              overhang_top: 0,
              overhang_bottom: 0,
              text,
            })
          }
          break;
        }
        case "prepreg": {
          const layer = layer_layout.parent;
          if (!layer_layout.top.is_copper_plane && layer.trace_height.name) {
            const overhang = get_layer_annotation_overhang(layer.id, "up");
            this.height_annotations.push({
              y_offset: layer_layout.top.shape.y_start,
              height: layer_layout.top.shape.height,
              overhang_top: 0,
              overhang_bottom: overhang,
              text: layer.trace_height.name,
            })
          }
          if (layer.height.name) {
            this.height_annotations.push({
              y_offset: layer_layout.middle_shape.y_start,
              height: layer_layout.middle_shape.height,
              overhang_top: 0,
              overhang_bottom: 0,
              text: layer.height.name,
            })
          }
          if (!layer_layout.bottom.is_copper_plane && layer.trace_height.name) {
            const overhang = get_layer_annotation_overhang(layer.id, "down");
            this.height_annotations.push({
              y_offset: layer_layout.bottom.shape.y_start,
              height: layer_layout.bottom.shape.height,
              overhang_top: overhang,
              overhang_bottom: 0,
              text: layer.trace_height.name,
            })
          }
          break;
        }
      }
    }
  }

  create_inline_width_annotation(offset: Position, width: number, text: string, drag_up: boolean): WidthAnnotation {
    const annotation: WidthAnnotation = {
      offset: { ...offset },
      width,
      y_offset_text: 0,
      left_arm_overhang: { top: 0, bottom: 0 },
      right_arm_overhang: { top: 0, bottom: 0 },
      text,
    };
    if (drag_up) {
      annotation.offset.y -= min_arm_overhang;
      annotation.left_arm_overhang.bottom = min_arm_overhang;
      annotation.right_arm_overhang.bottom = min_arm_overhang;
      annotation.left_arm_overhang.top = min_arm_overhang;
      annotation.right_arm_overhang.top = min_arm_overhang;
      annotation.y_offset_text = -drag_text_offset;
    } else {
      annotation.offset.y += min_arm_overhang;
      annotation.left_arm_overhang.top = min_arm_overhang;
      annotation.right_arm_overhang.top = min_arm_overhang;
      annotation.left_arm_overhang.bottom = min_arm_overhang;
      annotation.right_arm_overhang.bottom = min_arm_overhang;
      annotation.y_offset_text = drag_text_offset;
    }
    return annotation;
  }

  create_trace_width_annotations() {
    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const shape = trace_layout.shape;
      const trace = trace_layout.parent;
      const text = trace.width.name;
      if (text) {
        {
          const offset: Position = { x: shape.x_left, y: shape.y_base }
          const width = shape.x_right-shape.x_left;
          const drag_up = shape.y_base < shape.y_taper;
          const annotation = this.create_inline_width_annotation(offset, width, text, drag_up);
          this.width_annotations.push(annotation);
        }
        {
          const offset: Position = { x: shape.x_left_taper, y: shape.y_taper };
          const width = shape.x_right_taper-shape.x_left_taper;
          const drag_up = shape.y_base > shape.y_taper;
          const annotation = this.create_inline_width_annotation(offset, width, `${text}1`, drag_up);
          this.width_annotations.push(annotation);
        }
      }
    }
  }

  create_spacing_annotations() {
    const trace_orientations: Partial<Record<TraceId, Orientation>> = {};
    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const trace = trace_layout.parent;
      trace_orientations[trace.id] = trace.orientation;
    }

    for (const spacing_layout of this.layout.spacings) {
      const spacing = spacing_layout.parent;
      const text = spacing.width.name;
      if (text) {
        const y_mid = spacing_layout.y_mid;
        const left = spacing_layout.left_anchor;
        const right = spacing_layout.right_anchor;
        const delta_y = Math.abs(left.y-right.y);
        // coplanar separator
        if (delta_y < 1e-3) {
          const orientation = trace_orientations[spacing.left_trace.id];
          const drag_up = orientation == "up";
          const offset = { x: left.x, y: y_mid };
          const width = right.x-left.x;
          const annotation = this.create_inline_width_annotation(offset, width, text, drag_up);
          this.width_annotations.push(annotation);
        // vertical separator
        } else {
          const left_overhang = y_mid-left.y;
          const right_overhang = y_mid-right.y;
          const left_arm_shrink = spacing.left_trace.attach == "center" ? center_overhang_margin : 0;
          const right_arm_shrink = spacing.right_trace.attach == "center" ? center_overhang_margin : 0;
          this.width_annotations.push({
            offset: { x: left.x, y: y_mid },
            width: right.x-left.x,
            y_offset_text: font_size*0.6,
            left_arm_overhang: {
              top: Math.max(left_overhang-left_arm_shrink, min_arm_overhang),
              bottom: Math.max(-left_overhang-left_arm_shrink, min_arm_overhang),
            },
            right_arm_overhang: {
              top: Math.max(right_overhang-right_arm_shrink, min_arm_overhang),
              bottom: Math.max(-right_overhang-right_arm_shrink, min_arm_overhang),
            },
            text,
          });
        }
      }
    }
  }
}

const viewer = computed(() => {
  const layout = create_layout_from_stackup(stackup.value, (param) => param.placeholder_value);
  const viewer = new Viewer(layout);
  return viewer;
});

</script>

<template>
<svg
  version="1.1" xmlns="http://www.w3.org/2000/svg"
  :viewBox="`${viewer.viewport.x_min} ${viewer.viewport.y_min} ${viewer.viewport.width} ${viewer.viewport.height}`"
  preserveAspectRatio="xMidYMid meet"
  class="w-full"
>
  <template v-for="(layer, index) in viewer.layout.layers" :key="index">
    <template v-if="layer.type == 'soldermask'">
      <template v-if="layer.mask">
        <template v-for="(trace_mask, trace_index) in layer.mask.traces" :key="trace_index">
          <polygon
            :points="trapezoid_shape_to_points(trace_mask)"
            :fill="colours.dielectric_soldermask" :stroke="stroke.colour" :stroke-width="stroke.width"
          />
        </template>
        <rect
          :x="viewer.stackup.x_min" :y="layer.mask.surface.y_start"
          :width="viewer.stackup.width" :height="layer.mask.surface.height"
          :fill="colours.dielectric_soldermask" :stroke="stroke.colour" :stroke-width="stroke.width"
        ></rect>
      </template>
    </template>
    <template v-if="layer.type == 'core'">
      <rect
        :x="viewer.stackup.x_min" :y="layer.bounding_box.y_start"
        :width="viewer.stackup.width" :height="layer.bounding_box.height"
        :fill="colours.dielectric_core" :stroke="stroke.colour" :stroke-width="stroke.width"
      ></rect>
    </template>
    <template v-if="layer.type == 'prepreg'">
      <rect
        :x="viewer.stackup.x_min" :y="layer.bounding_box.y_start"
        :width="viewer.stackup.width" :height="layer.bounding_box.height"
        :fill="colours.dielectric_prepreg" :stroke="stroke.colour" :stroke-width="stroke.width"
      ></rect>
    </template>
  </template>
  <template v-for="(conductor, index) in viewer.layout.conductors" :key="index">
    <template v-if="conductor.type == 'trace'">
      <polygon
        :points="trapezoid_shape_to_points(conductor.shape)"
        :fill="colours.copper" :stroke="stroke.colour" :stroke-width="stroke.width"
      />
    </template>
    <template v-else-if="conductor.type == 'plane'">
      <rect
        :x="viewer.stackup.x_min" :y="conductor.shape.y_start"
        :width="viewer.stackup.width" :height="conductor.shape.height"
        :fill="colours.copper" :stroke="stroke.colour" :stroke-width="stroke.width"
      ></rect>
    </template>
  </template>
  <!-- Height annotations -->
  <template v-for="(label, index) in viewer.height_annotations" :key="index">
    <g :transform="`translate(${viewer.height_annotation.x_min},${label.y_offset})`">
      <line
        x1="0" :x2="viewer.height_annotation.width+label.overhang_top"
        y1="0" y2="0"
        stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
      <line
        x1="0" :x2="viewer.height_annotation.width+label.overhang_bottom"
        :y1="label.height" :y2="label.height"
        stroke="#000000" stroke-width="0.5" stroke-dasharray="2,2"/>
      <text
        x="1" :y="label.height/2"
        :font-size="font_size"
        font-weight="500"
        alignment-baseline="central"
      >
        {{ label.text }}
      </text>
      <g :transform="`translate(${viewer.height_annotation.width-5},0)`">
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
  <!-- Width annotations -->
  <template v-for="(label, index) in viewer.width_annotations" :key="index">
    <g :transform="`translate(${label.offset.x}, ${label.offset.y})`">
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
        :font-size="font_size"
        text-anchor="middle"
        font-weight="500"
        alignment-baseline="central"
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
  </template>
  <!-- Epsilon annotations -->
  <template v-for="(label, index) in viewer.epsilon_annotations" :key="index">
    <text
      :x="viewer.epsilon_annotation_x_offset" :y="label.y_offset"
      :font-size="font_size"
      font-weight="500"
      alignment-baseline="central"
    >
      {{ label.text }}
    </text>
  </template>
</svg>
</template>
