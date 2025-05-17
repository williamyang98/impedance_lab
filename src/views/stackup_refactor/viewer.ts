import { type Orientation, type LayerId, type TraceId } from "./stackup.ts";
import { type StackupLayout } from "./layout.ts";

export const font_size = 9;

export const sizes = {
  soldermask_height: 17,
  copper_layer_height: 10,
  trace_height: 20,
  trace_taper: 15,
  signal_trace_width: 40,
  ground_trace_width: 50,
  core_height: 40,
  broadside_width_separation: 30+40,
  signal_width_separation: 30,
  ground_width_separation: 40,
};

const width_label_config = (() => {
  const min_arm_overhang = 5;
  const text_offset = font_size*0.6;
  const center_overhang_margin = min_arm_overhang*2 + font_size*0.6;
  return {
    min_arm_overhang,
    text_offset,
    center_overhang_margin,
  }
}) ();

export interface Position {
  x: number;
  y: number;
}

export interface HeightLabel {
  y_offset: number;
  overhang_top: number;
  overhang_bottom: number;
  height: number;
  text: string;
}

export interface WidthLabel {
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

export interface EpsilonLabel {
  y_offset: number;
  text: string;
}

export class Viewer {
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
  height_labels: HeightLabel[] = [];
  width_labels: WidthLabel[] = [];
  epsilon_labels: EpsilonLabel[] = [];
  epsilon_label_x_offset: number;
  height_label_config: {
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

    const height_label_width = 23;
    const epsilon_label_x_offset = stackup_x_min+font_size/2;

    const viewport_width = stackup_width+height_label_width;
    const viewport_height = layout.total_height;
    const viewport_x_min = stackup_x_min-height_label_width;
    const viewport_y_min = layout.y_min;

    this.epsilon_label_x_offset = epsilon_label_x_offset;
    this.height_label_config = {
      x_min: stackup_x_min-height_label_width,
      width: height_label_width,
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

    this.create_height_labels();
    this.create_trace_width_labels();
    this.create_spacing_labels();
    this.create_epsilon_labels();
    this.fit_viewport_to_labels();
  }

  create_height_labels() {
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
    const get_layer_label_overhang = (layer_id: LayerId, orientation: Orientation): number => {
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
            const overhang = get_layer_label_overhang(layer.id, layer.orientation);
            this.height_labels.push({
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
              const overhang = get_layer_label_overhang(layer.id, layer.orientation);
              if (layer.orientation == "down") {
                const y_start = layer_layout.bounding_box.y_start;
                if (layer.soldermask_height.name) {
                  this.height_labels.push({
                    y_offset: y_start,
                    height: soldermask_height,
                    overhang_top: overhang,
                    overhang_bottom: overhang,
                    text: layer.soldermask_height.name,
                  });
                }
                if (layer.trace_height.name) {
                  this.height_labels.push({
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
                  this.height_labels.push({
                    y_offset: y_start,
                    height: trace_height,
                    overhang_top: overhang,
                    overhang_bottom: 0,
                    text: layer.trace_height.name,
                  });
                }
                if (layer.soldermask_height.name) {
                  this.height_labels.push({
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
                this.height_labels.push({
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
            this.height_labels.push({
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
            const overhang = get_layer_label_overhang(layer.id, "up");
            this.height_labels.push({
              y_offset: layer_layout.top.shape.y_start,
              height: layer_layout.top.shape.height,
              overhang_top: 0,
              overhang_bottom: overhang,
              text: layer.trace_height.name,
            })
          }
          if (layer.height.name) {
            this.height_labels.push({
              y_offset: layer_layout.middle_shape.y_start,
              height: layer_layout.middle_shape.height,
              overhang_top: 0,
              overhang_bottom: 0,
              text: layer.height.name,
            })
          }
          if (!layer_layout.bottom.is_copper_plane && layer.trace_height.name) {
            const overhang = get_layer_label_overhang(layer.id, "down");
            this.height_labels.push({
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

  create_inline_width_label(offset: Position, width: number, text: string, drag_up: boolean): WidthLabel {
    const label: WidthLabel = {
      offset: { ...offset },
      width,
      y_offset_text: 0,
      left_arm_overhang: { top: 0, bottom: 0 },
      right_arm_overhang: { top: 0, bottom: 0 },
      text,
    };
    if (drag_up) {
      label.offset.y -= width_label_config.min_arm_overhang;
      label.left_arm_overhang.bottom = width_label_config.min_arm_overhang;
      label.right_arm_overhang.bottom = width_label_config.min_arm_overhang;
      label.left_arm_overhang.top = width_label_config.min_arm_overhang;
      label.right_arm_overhang.top = width_label_config.min_arm_overhang;
      label.y_offset_text = -width_label_config.text_offset;
    } else {
      label.offset.y += width_label_config.min_arm_overhang;
      label.left_arm_overhang.top = width_label_config.min_arm_overhang;
      label.right_arm_overhang.top = width_label_config.min_arm_overhang;
      label.left_arm_overhang.bottom = width_label_config.min_arm_overhang;
      label.right_arm_overhang.bottom = width_label_config.min_arm_overhang;
      label.y_offset_text = width_label_config.text_offset;
    }
    return label;
  }

  create_trace_width_labels() {
    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const shape = trace_layout.shape;
      const trace = trace_layout.parent;
      const text = trace.width.name;
      if (text) {
        {
          const offset: Position = { x: shape.x_left, y: shape.y_base }
          const width = shape.x_right-shape.x_left;
          const drag_up = shape.y_base < shape.y_taper;
          const label = this.create_inline_width_label(offset, width, text, drag_up);
          this.width_labels.push(label);
        }
        {
          const offset: Position = { x: shape.x_left_taper, y: shape.y_taper };
          const width = shape.x_right_taper-shape.x_left_taper;
          const drag_up = shape.y_base > shape.y_taper;
          const label = this.create_inline_width_label(offset, width, `${text}1`, drag_up);
          this.width_labels.push(label);
        }
      }
    }
  }

  create_spacing_labels() {
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
          const label = this.create_inline_width_label(offset, width, text, drag_up);
          this.width_labels.push(label);
        // vertical separator
        } else {
          const left_overhang = y_mid-left.y;
          const right_overhang = y_mid-right.y;
          const left_arm_shrink = spacing.left_trace.attach == "center" ? width_label_config.center_overhang_margin : 0;
          const right_arm_shrink = spacing.right_trace.attach == "center" ? width_label_config.center_overhang_margin : 0;
          this.width_labels.push({
            offset: { x: left.x, y: y_mid },
            width: right.x-left.x,
            y_offset_text: width_label_config.text_offset,
            left_arm_overhang: {
              top: Math.max(left_overhang-left_arm_shrink, width_label_config.min_arm_overhang),
              bottom: Math.max(-left_overhang-left_arm_shrink, width_label_config.min_arm_overhang),
            },
            right_arm_overhang: {
              top: Math.max(right_overhang-right_arm_shrink, width_label_config.min_arm_overhang),
              bottom: Math.max(-right_overhang-right_arm_shrink, width_label_config.min_arm_overhang),
            },
            text,
          });
        }
      }
    }
  }

  create_epsilon_labels() {
    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "unmasked": {
          break;
        }
        case "soldermask": {
          const surface_mask = layer_layout.mask?.surface;
          const text = layer_layout.parent.epsilon?.name;
          if (surface_mask && text) {
            const y_start = surface_mask.y_start;
            const y_end = y_start+surface_mask.height;
            const y_offset = (y_start+y_end)/2.0
            this.epsilon_labels.push({ y_offset, text });
          }
          break;
        }
        case "core": // @fallthrough
        case "prepreg": {
          const bbox = layer_layout.bounding_box;
          const text = layer_layout.parent.epsilon?.name;
          if (text) {
            const y_start = bbox.y_start;
            const y_end = y_start+bbox.height;
            const y_offset = (y_start+y_end)/2.0
            this.epsilon_labels.push({ y_offset, text });
          }
          break;
        }
      }
    }
  }

  fit_viewport_to_labels() {
    let x_min: number = Infinity;
    let x_max: number = -Infinity;
    let y_min: number = Infinity;
    let y_max: number = -Infinity;

    for (const label of this.width_labels) {
      const x_left = label.offset.x;
      const x_right = x_left + label.width;
      const y_top = label.offset.y + Math.max(label.left_arm_overhang.top, label.right_arm_overhang.top);
      const y_bottom = label.offset.y + Math.max(label.left_arm_overhang.bottom, label.right_arm_overhang.bottom);
      const y_text = label.offset.y + label.y_offset_text + font_size*0.5;

      x_min = Math.min(x_min, x_left, x_right);
      x_max = Math.max(x_max, x_left, x_right);
      y_min = Math.min(y_min, y_top, y_bottom, y_text);
      y_max = Math.max(y_max, y_top, y_bottom, y_text);
    }

    this.fit_viewport_to_bounds(x_min, x_max, y_min, y_max);
  }

  fit_viewport_to_bounds(x_min: number, x_max: number, y_min: number, y_max: number) {
    const dx_left = Math.max(0, this.viewport.x_min-x_min);
    const dx_right = Math.max(0, x_max-this.viewport.width+this.viewport.x_min);
    const dy_top = Math.max(0, this.viewport.y_min-y_min);
    const dy_bottom = Math.max(0, y_max-this.viewport.height+this.viewport.y_min);
    this.viewport.x_min -= dx_left;
    this.viewport.y_min -= dy_top;
    this.viewport.width += dx_left+dx_right;
    this.viewport.height += dy_top+dy_bottom;
  }
}
