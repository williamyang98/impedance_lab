import { type StackupLayout, type TrapezoidShape, type CopperTraceLayout, create_layout_from_stackup, type SoldermaskLayerLayout } from "./layout";
import type {
  Visualiser, Viewport,
  HorizontalDimensionLine, VerticalDimensionLine, RectangleShape, PolygonShape, PolygonPoint,
  TextLabel, IconLabel,
  Entity,
} from "../visualiser_2d/visualiser.ts";
import type { LayerId, Orientation, TraceId, Parameter, Stackup } from "./stackup.ts";
import { CirclePlusIcon, CircleMinusIcon } from "lucide-vue-next";

export const stackup_sizes = {
  soldermask_height: 17,
  copper_layer_height: 10,
  trace_height: 20,
  etch_factor: 0.35,
  signal_trace_width: 40,
  ground_trace_width: 50,
  core_height: 45,
  broadside_width_separation: 35,
  signal_width_separation: 30,
  ground_width_separation: 30,
};

// const font_glyph_width = 0.85;
const font_glyph_height = 0.75;

const font = {
  size: 9,
  colour: "#000000",
  weight: 500,
};
const voltage_size = 12;
const width_label_config = (() => {
  const min_extension_size = 5;
  const text_drag_offset = font.size*font_glyph_height;
  const overlap_extension_margin = min_extension_size*2 + font.size*font_glyph_height;
  return {
    min_extension_size,
    text_drag_offset,
    overlap_extension_margin,
  }
}) ();

const colours = {
  copper: "#eacc2d",
  copper_selectable: "#eacc2d88",
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
  arm_stroke_style: [2,2],
  line_colour: "#000000",
  line_width: 0.5,
  arrow_size: 4,
};

function get_name(param?: { name?: string }): string | undefined {
  return param?.name;
}

function get_taper_suffix(param?: { taper_suffix?: string }): string | undefined {
  return param?.taper_suffix;
}

function get_value(param: Parameter): number {
  switch (param.type) {
    case "epsilon": return 1; // not actually needed
    case "etch_factor": return param.placeholder_value;
    case "size": return param.placeholder_value;
  }
};

export interface VisualiserConfig {
  stackup_minimum_width: number;
  stackup_minimum_x_padding: number;
}

// TODO: have more of config located here instead of randomly scattered constants
export function get_default_viewer_config(): VisualiserConfig {
  return {
    stackup_minimum_width: 150,
    stackup_minimum_x_padding: 25,
  }
}

export interface CopperTraceEntity extends PolygonShape {
  parent: StackupVisualiser;
  layout: CopperTraceLayout;
  is_solid: boolean;
}

export interface CopperPlaneEntity extends RectangleShape {
  is_solid: boolean;
}

export class StackupVisualiser implements Visualiser {
  layout: StackupLayout;
  _viewport: Viewport;
  stackup: {
    x_min: number;
    y_min: number;
    width: number;
    height: number;
  };
  epsilon_label_config: {
    x_offset: number;
  };
  height_label_config: {
    x_text: number;
    x_line: number;
    x_extension: number;
  };

  dielectric_layers: RectangleShape[] = [];
  soldermask_layers: PolygonShape[] = [];
  copper_traces: CopperTraceEntity[] = [];
  copper_trace_groups = new Map<string, CopperTraceEntity[]>();
  copper_planes: CopperPlaneEntity[] = [];
  height_labels: VerticalDimensionLine[] = [];
  spacing_labels: HorizontalDimensionLine[] = [];
  epsilon_labels: TextLabel[] = [];
  voltage_labels: IconLabel[] = [];

  constructor(stackup: Stackup, config?: VisualiserConfig) {
    const layout = create_layout_from_stackup(stackup, get_value);
    this.layout = layout;
    config = config ?? get_default_viewer_config();

    const stackup_x_padding = Math.max(config.stackup_minimum_x_padding, config.stackup_minimum_width-layout.total_width);
    const stackup_x_min = layout.x_min-stackup_x_padding;
    const stackup_x_max = layout.x_max+stackup_x_padding;
    const stackup_width = stackup_x_max-stackup_x_min;
    const stackup_height = layout.total_height;
    const stackup_y_min = layout.y_min;

    const height_label_width = 23;
    const epsilon_label_x_offset = stackup_x_min+font.size/2;

    const viewport_x_min = stackup_x_min-height_label_width;
    const viewport_x_max = stackup_x_max;
    const viewport_y_min = layout.y_min;
    const viewport_y_max = layout.y_min+layout.total_height;

    this.epsilon_label_config = {
      x_offset: epsilon_label_x_offset,
    };
    this.height_label_config = {
      x_text: stackup_x_min-height_label_width+2,
      x_line: stackup_x_min-stroke.arrow_size,
      x_extension: stackup_x_min-height_label_width,
    };
    this.layout = layout;
    this._viewport = {
      x_left: viewport_x_min,
      x_right: viewport_x_max,
      y_top: viewport_y_min,
      y_bottom: viewport_y_max,
    };
    this.stackup = {
      x_min: stackup_x_min,
      y_min: stackup_y_min,
      width: stackup_width,
      height: stackup_height,
    };

    this.create_dielectric_layers();
    this.create_height_labels();
    this.create_copper_traces();
    this.create_copper_planes();
    this.create_spacing_labels();
    this.create_epsilon_labels();
    this.fit_viewport_to_spacing_labels();
  }

  create_dielectric_layers() {
    const create_infinite_plane_layer = (y: number, height: number, colour: string): RectangleShape => {
      return {
        type: "rectangle_shape",
        x_left: this.stackup.x_min,
        x_right: this.stackup.x_min+this.stackup.width,
        y_top: y,
        y_bottom: y+height,
        fill_colour: colour,
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
      }
    };

    const create_soldermask_layer = (layout: SoldermaskLayerLayout): PolygonShape | undefined => {
      const x_left = this.stackup.x_min;
      const x_right = this.stackup.x_min+this.stackup.width;
      const mask = layout.mask;
      if (mask === undefined) return undefined;
      const y_top = mask.surface.y_start;
      const y_bottom = mask.surface.y_start+mask.surface.height;
      const y_surface = layout.parent.orientation === "up" ? y_top : y_bottom;
      const y_mask = layout.parent.orientation === "up" ? y_bottom : y_top;
      const points: PolygonPoint[] = [];
      points.push(
        { x: x_left, y: y_surface },
        { x: x_left, y: y_mask },
      );
      for (const trace of mask.traces) {
        points.push(
          { x: trace.x_left, y: trace.y_base },
          { x: trace.x_left_taper, y: trace.y_taper },
          { x: trace.x_right_taper, y: trace.y_taper },
          { x: trace.x_right, y: trace.y_base },
        )
      }
      points.push(
        { x: x_right, y: y_mask },
        { x: x_right, y: y_surface },
      );
      return {
        type: "polygon_shape",
        points,
        fill_colour: colours.dielectric_soldermask,
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
      }
    };

    for (const layout of this.layout.layers) {
      switch (layout.type) {
        case "core": {
          const shape = layout.bounding_box;
          const layer = create_infinite_plane_layer(shape.y_start, shape.height, colours.dielectric_core);
          this.dielectric_layers.push(layer);
          break;
        }
        case "prepreg": {
          const shape = layout.bounding_box;
          const layer = create_infinite_plane_layer(shape.y_start, shape.height, colours.dielectric_prepreg);
          this.dielectric_layers.push(layer);
          break;
        }
        case "soldermask": {
          const layer = create_soldermask_layer(layout);
          if (layer) this.soldermask_layers.push(layer);
          break;
        }
        case "unmasked": break;
      }
    }
  }

  create_height_label(y_offset: number, height: number, x_top: number, x_bottom: number, text: string) {
    const label: VerticalDimensionLine = {
      type: "vertical_dimension_line",
      y_top: y_offset,
      y_bottom: y_offset+height,
      x_line: this.height_label_config.x_line,
      text: {
        data: text,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      x_text: this.height_label_config.x_text,
      text_horizontal_align: "left",
      text_vertical_align: "middle",
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      top_extension_line: {
        x_left: this.height_label_config.x_extension,
        x_right: x_top,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
      bottom_extension_line: {
        x_left: this.height_label_config.x_extension,
        x_right: x_bottom,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
    };
    this.height_labels.push(label);
  };

  create_height_labels() {
    const layer_to_trace_x_min = new Map<string, number>();
    const get_trace_x_min_key = (layer_id: LayerId, orientation: Orientation) => `${layer_id}_${orientation}`;

    for (const trace_layout of this.layout.conductors) {
      if (trace_layout.type !== "trace") continue;
      const trace = trace_layout.parent;
      if (trace.viewer?.display === "none") continue;
      const x_min = trace_layout.shape.x_left_taper;
      const key = get_trace_x_min_key(trace.position.layer_id, trace.position.orientation);
      const old_x_min = layer_to_trace_x_min.get(key);
      if (old_x_min === undefined || old_x_min > x_min) {
        layer_to_trace_x_min.set(key, x_min);
      }
    }

    const get_trace_x_min = (layer_id: LayerId, orientation: Orientation): number | undefined => {
      const key = get_trace_x_min_key(layer_id, orientation);
      return layer_to_trace_x_min.get(key);
    };

    // determine anchoring point for extension lines
    let layer_x_min = undefined;
    for (const layer of this.layout.layers) {
      if (layer.type !== "unmasked") {
        layer_x_min = this.stackup.x_min;
        break;
      }
    }
    if (layer_x_min === undefined) {
      for (const trace of this.layout.conductors.filter(conductor => conductor.type === "trace")) {
        if (layer_x_min === undefined || layer_x_min > trace.shape.x_left) {
          layer_x_min = trace.shape.x_left;
        }
      }
    }
    if (layer_x_min === undefined) return;

    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "unmasked": {
          const layer = layer_layout.parent;
          const text = get_name(layer.trace_height);
          const height = layer_layout.bounding_box.height;
          const is_copper_plane = layer_layout.is_copper_plane;
          if (height > 0 && !is_copper_plane && text) {
            const trace_x_min = get_trace_x_min(layer.id, layer.orientation) ?? layer_x_min;
            this.create_height_label(
              layer_layout.bounding_box.y_start,
              layer_layout.bounding_box.height,
              layer.orientation == "up" ? layer_x_min : trace_x_min,
              layer.orientation == "up" ? trace_x_min : layer_x_min,
              text,
            );
          }
          break;
        }
        case "soldermask": {
          const layer = layer_layout.parent;
          if (layer_layout.mask) {
            const soldermask_height = layer_layout.mask.surface.height;
            const soldermask_height_name = get_name(layer.height);
            // label both trace height and soldermask height
            if (layer_layout.mask.traces.length > 0) {
              const trace = layer_layout.mask.traces[0];
              const trace_height = Math.abs(trace.y_base-trace.y_taper);
              const trace_height_name = get_name(layer.trace_height);
              const y_start = layer_layout.bounding_box.y_start;
              const trace_x_min = get_trace_x_min(layer.id, layer.orientation) ?? layer_x_min;
              if (layer.orientation == "down") {
                if (soldermask_height_name) {
                  this.create_height_label(
                    y_start,
                    soldermask_height,
                    trace_x_min,
                    trace_x_min,
                    soldermask_height_name,
                  );
                }
                if (trace_height_name) {
                  this.create_height_label(
                    y_start+soldermask_height,
                    trace_height,
                    trace_x_min,
                    layer_x_min,
                    trace_height_name,
                  );
                }
              } else {
                if (trace_height_name) {
                  this.create_height_label(
                    y_start,
                    trace_height,
                    layer_x_min,
                    trace_x_min,
                    trace_height_name,
                  );
                }
                if (soldermask_height_name) {
                  this.create_height_label(
                    y_start+trace_height,
                    soldermask_height,
                    trace_x_min,
                    trace_x_min,
                    soldermask_height_name,
                  );
                }
              }
            // label just the soldermask height
            } else {
              if (soldermask_height_name) {
                this.create_height_label(
                  layer_layout.mask.surface.y_start,
                  soldermask_height,
                  layer_x_min,
                  layer_x_min,
                  soldermask_height_name,
                );
              }
            }
          }
          break;
        }
        case "core": {
          const layer = layer_layout.parent;
          const text = get_name(layer.height);
          const height = layer_layout.bounding_box.height;
          if (height > 0 && text) {
            this.create_height_label(
              layer_layout.bounding_box.y_start,
              layer_layout.bounding_box.height,
              layer_x_min,
              layer_x_min,
              text,
            );
          }
          break;
        }
        case "prepreg": {
          const layer = layer_layout.parent;
          const trace_height_name = get_name(layer.trace_height);
          const layer_height_name = get_name(layer.height);
          if (!layer_layout.top.is_copper_plane && trace_height_name) {
            const trace_x_min = get_trace_x_min(layer.id, "up") ?? layer_x_min;
            this.create_height_label(
              layer_layout.top.shape.y_start,
              layer_layout.top.shape.height,
              layer_x_min,
              trace_x_min,
              trace_height_name,
            );
          }
          if (layer_height_name) {
            const trace_x_min_top = get_trace_x_min(layer.id, "up") ?? layer_x_min;
            const trace_x_min_bottom = get_trace_x_min(layer.id, "down") ?? layer_x_min;
            this.create_height_label(
              layer_layout.middle_shape.y_start,
              layer_layout.middle_shape.height,
              trace_x_min_top,
              trace_x_min_bottom,
              layer_height_name,
            );
          }
          if (!layer_layout.bottom.is_copper_plane && trace_height_name) {
            const trace_x_min = get_trace_x_min(layer.id, "down") ?? layer_x_min;
            this.create_height_label(
              layer_layout.bottom.shape.y_start,
              layer_layout.bottom.shape.height,
              trace_x_min,
              layer_x_min,
              trace_height_name,
            );
          }
          break;
        }
      }
    }
  }

  create_inline_width_label(x: number, y: number, width: number, label: string, drag_up: boolean) {
    const extension = width_label_config.min_extension_size;
    const line: HorizontalDimensionLine = {
      type: "horizontal_dimension_line",
      x_left: x,
      x_right: x+width,
      y_line: y,
      y_text: y,
      text: {
        data: label,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      text_vertical_align: "middle",
      text_horizontal_align: "center",
      left_extension_line: {
        y_top: y,
        y_bottom: y,
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
      right_extension_line: {
        y_top: y,
        y_bottom: y,
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
    };

    if (drag_up) {
      line.y_line -= extension;
      line.y_text! -= extension+width_label_config.text_drag_offset;
      line.left_extension_line!.y_top -= extension*2;
      line.right_extension_line!.y_top -= extension*2;
    } else {
      line.y_line += extension;
      line.y_text! += extension+width_label_config.text_drag_offset;
      line.left_extension_line!.y_bottom += extension*2;
      line.right_extension_line!.y_bottom += extension*2;
    }

    this.spacing_labels.push(line);
  }

  create_voltage_label(shape: TrapezoidShape, voltage: "positive" | "negative"): IconLabel {
    const x = (shape.x_left+shape.x_right)/2;
    const y = (shape.y_base+shape.y_taper)/2;

    let icon = undefined;
    switch (voltage) {
      case "negative": icon = CircleMinusIcon; break;
      case "positive": icon = CirclePlusIcon; break;
    }

    return {
      type: "icon_label",
      x,
      y,
      icon: {
        component: icon,
        colour: font.colour,
        width: voltage_size,
        height: voltage_size,
      },
      horizontal_align: "center",
      vertical_align: "middle",
    };
  }

  create_copper_traces() {
    const trace_taper_suffixes = new Map<LayerId, string>();
    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "core": break;
        case "soldermask": // @fallthrough
        case "prepreg": // @fallthrough
        case "unmasked": {
          const layer = layer_layout.parent;
          const trace_taper_name = get_taper_suffix(layer.etch_factor);
          if (trace_taper_name) trace_taper_suffixes.set(layer.id, trace_taper_name);
          break;
        }
      }
    }

    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const shape = trace_layout.shape;
      const trace = trace_layout.parent;
      const display_type = trace.viewer?.display || "solid";
      if (display_type == "none") continue;
      // trace labels
      const trace_width_name = get_name(trace.width);
      if (trace_width_name && trace.viewer?.is_labeled !== false) {
        {
          const width = shape.x_right-shape.x_left;
          const drag_up = shape.y_base < shape.y_taper;
          this.create_inline_width_label(shape.x_left, shape.y_base, width, trace_width_name, drag_up);
        }
        const trace_taper_suffix = trace_taper_suffixes.get(trace.position.layer_id);
        if (trace_taper_suffix) {
          const width = shape.x_right_taper-shape.x_left_taper;
          const drag_up = shape.y_base > shape.y_taper;
          this.create_inline_width_label(shape.x_left_taper, shape.y_taper, width, `${trace_width_name}${trace_taper_suffix}`, drag_up);
        }
      }
      if (display_type == "solid" && trace.voltage !== 'ground') {
        const voltage_label = this.create_voltage_label(shape, trace.voltage);
        this.voltage_labels.push(voltage_label);
      }
      // trace shape
      const group_tag = trace.viewer?.group_tag;
      const polygon_shape: CopperTraceEntity = {
        type: "polygon_shape",
        parent: this,
        points: [
          { x: trace_layout.shape.x_left, y: trace_layout.shape.y_base },
          { x: trace_layout.shape.x_left_taper, y: trace_layout.shape.y_taper },
          { x: trace_layout.shape.x_right_taper, y: trace_layout.shape.y_taper },
          { x: trace_layout.shape.x_right, y: trace_layout.shape.y_base },
        ],
        is_solid: display_type !== "selectable",
        get fill_colour(): string {
          return this.is_solid ? colours.copper : colours.copper_selectable;
        },
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
        layout: trace_layout,
        on_hover(is_hover: boolean) {
          if (group_tag) this.parent.on_trace_hover(group_tag, is_hover);
        },
        on_click: trace.viewer?.on_click,
      };

      this.copper_traces.push(polygon_shape);
      if (group_tag) {
        let trace_group = this.copper_trace_groups.get(group_tag);
        if (trace_group === undefined) {
          trace_group = [];
          this.copper_trace_groups.set(group_tag, trace_group);
        }
        trace_group.push(polygon_shape);
      }
    }
  }

  on_trace_hover(group_tag: string, is_hover: boolean) {
    const traces = this.copper_trace_groups.get(group_tag);
    if (traces === undefined) return;
    for (const trace of traces) {
      if (trace.layout.parent.viewer?.display === "selectable") {
        trace.is_solid = is_hover;
      }
    }
  }

  create_copper_planes() {
    for (const plane_layout of this.layout.conductors.filter(conductor => conductor.type == "plane")) {
      const plane = plane_layout.parent;
      const display_type = plane.viewer?.display || "solid";
      if (display_type === "none") continue;
      this.copper_planes.push({
        type: "rectangle_shape",
        x_left: this.stackup.x_min,
        x_right: this.stackup.x_min+this.stackup.width,
        y_top: plane_layout.shape.y_start,
        y_bottom: plane_layout.shape.y_start+plane_layout.shape.height,
        get fill_colour(): string {
          return this.is_solid ? colours.copper : colours.copper_selectable;
        },
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
        is_solid: display_type !== "selectable",
        on_click: plane.viewer?.on_click,
        on_hover(is_hover: boolean) {
          if (display_type === 'selectable') {
            this.is_solid = is_hover;
          }
        },
      });
    }
  }

  create_broadside_width_label(
    x_left: number, x_right: number,
    y_line: number, y_left: number, y_right: number,
    text: string,
  ) {
    const extension_size = width_label_config.min_extension_size;
    const label: HorizontalDimensionLine = {
      type: "horizontal_dimension_line",
      x_left,
      x_right,
      y_line: y_line,
      text: {
        data: text,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      text_vertical_align: "middle",
      text_horizontal_align: "center",
      left_extension_line: {
        y_top: y_left,
        y_bottom: (y_line > y_left) ? y_line+extension_size : y_line-extension_size,
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
      right_extension_line: {
        y_top: y_right,
        y_bottom: (y_line > y_right) ? y_line+extension_size : y_line-extension_size,
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
    };
    this.spacing_labels.push(label);
  }

  create_spacing_labels() {
    const trace_orientations = new Map<TraceId, Orientation>();
    for (const trace_layout of this.layout.conductors.filter(conductor => conductor.type == "trace")) {
      const trace = trace_layout.parent;
      trace_orientations.set(trace.id, trace.position.orientation)
    }

    const viewer_traces = new Map<TraceId, CopperTraceEntity>();
    for (const trace of this.copper_traces) {
      viewer_traces.set(trace.layout.parent.id, trace);
    }

    for (const spacing_layout of this.layout.spacings) {
      const spacing = spacing_layout.parent;
      if (spacing.viewer?.is_display === false) continue;

      // avoid showing label if one of the traces is missing
      const left_trace_id = spacing.left_trace.id;
      const right_trace_id = spacing.right_trace.id;
      const left_trace = viewer_traces.get(left_trace_id);
      const right_trace = viewer_traces.get(right_trace_id);
      if (!left_trace) continue;
      if (!right_trace) continue;

      const text = get_name(spacing.width);
      if (!text) continue;

      const y_line = spacing_layout.y_mid;
      const left = spacing_layout.left_anchor;
      const right = spacing_layout.right_anchor;
      const delta_y = Math.abs(left.y-right.y);
      // coplanar separator
      if (delta_y < 1e-3) {
        const orientation = trace_orientations.get(left_trace_id);
        const drag_up = orientation == "up";
        const width = right.x-left.x;
        this.create_inline_width_label(left.x, y_line, width, text, drag_up);
      // vertical separator
      } else {
        // prevent extensions lines from crossing over existing dimension lines
        const margin_size = width_label_config.overlap_extension_margin;
        const is_left_margin = spacing.left_trace.attach == "center" && left_trace.layout.parent.viewer?.is_labeled !== false;
        const is_right_margin = spacing.right_trace.attach == "center" && right_trace.layout.parent.viewer?.is_labeled !== false;
        const left_margin_size = is_left_margin ? margin_size : 0;
        const right_margin_size = is_right_margin ? margin_size : 0;

        const y_left = (y_line > left.y) ? left.y+left_margin_size : left.y-left_margin_size;
        const y_right = (y_line > right.y) ? right.y+right_margin_size : right.y-right_margin_size;
        this.create_broadside_width_label(left.x, right.x, y_line, y_left, y_right, text);
      }
    }
  }

  create_epsilon_labels() {
    const create_epsilon_label = (y: number, text: string): TextLabel => {
      return {
        type: "text_label",
        text: {
          data: text,
          colour: font.colour,
          size: font.size,
          weight: font.weight,
        },
        x: this.epsilon_label_config.x_offset,
        y,
        horizontal_align: "left",
        vertical_align: "middle",
      }
    };

    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "unmasked": break;
        case "soldermask": {
          const surface_mask = layer_layout.mask?.surface;
          const text = get_name(layer_layout.parent.epsilon);
          if (surface_mask && text) {
            const y_start = surface_mask.y_start;
            const y_end = y_start+surface_mask.height;
            const y_offset = (y_start+y_end)/2.0
            const label = create_epsilon_label(y_offset, text);
            this.epsilon_labels.push(label);
          }
          break;
        }
        case "core": // @fallthrough
        case "prepreg": {
          const bbox = layer_layout.bounding_box;
          const text = get_name(layer_layout.parent.epsilon);
          if (text) {
            const y_start = bbox.y_start;
            const y_end = y_start+bbox.height;
            const y_offset = (y_start+y_end)/2.0
            const label = create_epsilon_label(y_offset, text);
            this.epsilon_labels.push(label);
          }
          break;
        }
      }
    }
  }

  fit_viewport_to_spacing_labels() {
    for (const label of this.spacing_labels) {
      const y = label.y_text ?? label.y_line;
      const dy = label.text.size*font_glyph_height;
      const y_min = y-dy*0.5;
      const y_max = y+dy*0.5;
      this._viewport.y_top = Math.min(this._viewport.y_top, y_min);
      this._viewport.y_bottom = Math.max(this._viewport.y_bottom, y_max);
    }
  }

  get viewport(): Viewport {
    const padding = 0.5;
    return {
      x_left: this._viewport.x_left-padding,
      x_right: this._viewport.x_right+padding,
      y_top: this._viewport.y_top-padding,
      y_bottom: this._viewport.y_bottom+padding,
    }
  }

  get entities(): Entity[] {
    return [
      ...this.dielectric_layers,
      ...this.soldermask_layers,
      ...this.copper_planes,
      ...this.copper_traces,
      ...this.height_labels,
      ...this.spacing_labels,
      ...this.epsilon_labels,
      ...this.voltage_labels,
    ];
  }
}
