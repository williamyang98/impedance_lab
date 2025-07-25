// import { type StackupLayout, type TrapezoidShape, type CopperTraceLayout, create_layout_from_stackup, type SoldermaskLayerLayout } from "./layout";
import type {
  Visualiser, Viewport,
  HorizontalDimensionLine, VerticalDimensionLine, RectangleShape, PolygonShape, PolygonPoint,
  TextLabel, IconLabel,
  Entity,
} from "../visualiser_2d/visualiser.ts";
import {
  is_same_position,
  type Stackup, type Position, type SpacingMode,
  type Layer, type SurfaceLayer, type InnerLayer,
  type LayerTraces, type Voltage, type BroadsidePair,
} from "./stackup.ts";
import { CirclePlusIcon, CircleMinusIcon } from "lucide-vue-next";
import { font, stroke, colours } from "../visualiser_2d/pcb_defaults.ts";

const sizes = {
  soldermask_height: 17,
  copper_layer_height: 10,
  trace_height: 20,
  etch_width: 20*0.35,
  signal_trace_width: 40,
  ground_trace_width: 45,
  core_height: 45,
  broadside_width_separation: 45,
  signal_width_separation: 20,
  ground_width_separation: 20,
  voltage_icon: 12,
};

// TODO: have more of config located here instead of randomly scattered constants
export interface VisualiserConfig {
  stackup_minimum_width: number;
  stackup_minimum_x_padding: number;
}

export function get_default_viewer_config(): VisualiserConfig {
  return {
    stackup_minimum_width: 200,
    stackup_minimum_x_padding: 50,
  }
}

interface XLayout {
  x_left: number;
  x_right: number;
}

interface TraceXLayout extends XLayout {
  voltage: Voltage;
  label?: string;
}

interface SpacingXLayout extends XLayout {
  label?: string;
}

interface TracesXLayout {
  traces: TraceXLayout[];
  spacings: SpacingXLayout[];
  x_left: number;
  x_right: number;
  width: number;
}

interface ColinearXLayout extends TracesXLayout {
  readonly type: "colinear";
}

interface BroadsideXLayout {
  readonly type: "broadside";
  pair: Record<BroadsidePair, TracesXLayout>;
  broadside_spacing: XLayout;
  x_left: number;
  x_right: number;
  width: number;
}

type StackupTracesXLayout = ColinearXLayout | BroadsideXLayout;

interface TraceYRegion {
  y_base: number;
  y_taper: number;
}

interface TraceEntity extends PolygonShape {
  is_solid: boolean;
}

export class StackupVisualiser implements Visualiser {
  config: VisualiserConfig;
  stackup: Stackup;
  is_editing: boolean;

  stackup_traces_x_layout: StackupTracesXLayout;
  stackup_x: {
    width: number;
    left: number;
    right: number;
    padding: number;
  };
  stackup_y: {
    top: number;
    bottom: number;
    height: number;
  };
  height_label: {
    x_text: number;
    x_line: number;
    x_extension: number;
  };
  width_label: {
    min_extension_size: number;
    text_drag_offset: number;
    overlap_extension_margin: number;
    y_top: number;
    y_bottom: number;
  };
  epsilon_label: {
    x_left: number;
  };
  broadside_y_region: Partial<Record<BroadsidePair, TraceYRegion>> = {};

  dielectric_layers: RectangleShape[] = [];
  soldermask_layers: PolygonShape[] = [];
  solid_traces: TraceEntity[] = [];
  ghost_traces: TraceEntity[] = [];
  trace_groups = new Map<string, TraceEntity[]>();
  solid_planes: RectangleShape[] = [];
  ghost_planes: RectangleShape[] = [];
  height_labels: VerticalDimensionLine[] = [];
  spacing_labels: HorizontalDimensionLine[] = [];
  epsilon_labels: TextLabel[] = [];
  voltage_labels: IconLabel[] = [];

  constructor(stackup: Stackup, is_editing: boolean, config?: VisualiserConfig) {
    this.stackup = stackup;
    this.config = config ?? get_default_viewer_config();
    this.is_editing = is_editing;

    this.stackup_traces_x_layout = this.create_stackup_traces_x_layout();

    {
      // pad stackup width
      const copper_width = this.stackup_traces_x_layout.width;
      let stackup_width = copper_width+this.config.stackup_minimum_x_padding
      stackup_width = Math.max(stackup_width, this.config.stackup_minimum_width);
      const padding_width = (stackup_width-copper_width)/2;
      const x_left = this.stackup_traces_x_layout.x_left-padding_width;
      const x_right = x_left + stackup_width;
      this.stackup_x = {
        width: stackup_width,
        left: x_left,
        right: x_right,
        padding: padding_width,
      };
    }
    {
      this.width_label = {
        min_extension_size: 5,
        text_drag_offset: font.size*font.glyph_height,
        overlap_extension_margin: 5*2 + font.size*font.glyph_height,
        y_top: Infinity,
        y_bottom: -Infinity,
      };
    }
    {
      // height label x positioning
      const x_right = this.stackup_x.left;
      const x_left_offset = 25;
      this.height_label = {
        x_extension: x_right-x_left_offset,
        x_line: x_right-5,
        x_text: x_right-x_left_offset+2,
      };
    }
    {
      this.epsilon_label = {
        x_left: this.stackup_x.left+5,
      };
    }
    {
      const height = this.create_stackup();
      this.stackup_y = {
        height,
        top: 0,
        bottom: height,
      };
    }

    if (this.stackup_traces_x_layout.type === "broadside" && this.stackup.type === "broadside") {
      const spacing = this.stackup_traces_x_layout.broadside_spacing;
      const left = this.broadside_y_region.left;
      const right = this.broadside_y_region.right;
      const label = this.stackup.broadside_spacing.label;
      if (left !== undefined && right !== undefined && label !== undefined) {
        const is_left_top = left.y_base < right.y_base;
        let y_left = undefined;
        let y_right = undefined;
        const margin = this.width_label.overlap_extension_margin;
        if (is_left_top) {
          y_left = Math.max(left.y_base, left.y_taper)+margin;
          y_right = Math.min(right.y_base, right.y_taper)-margin;
        } else {
          y_left = Math.min(left.y_base, left.y_taper)-margin;
          y_right = Math.max(right.y_base, right.y_taper)+margin;
        }
        const y_line = (y_left+y_right)/2;
        this.create_broadside_width_label(spacing.x_left, spacing.x_right, y_line, y_left, y_right, label);
      }
    }

    this.readjust_height_labels_x();
  }

  get_spacing_width(mode: SpacingMode): number {
    switch (mode) {
      case "trace": return sizes.signal_width_separation;
      case "coplanar": return sizes.ground_width_separation;
    }
  }

  get_trace_width(voltage: Voltage): number {
    switch (voltage) {
      case "ground": return sizes.ground_trace_width;
      case "positive": return sizes.signal_trace_width;
      case "negative": return sizes.signal_trace_width;
    }
  }

  create_layer_traces_x_layout(layer_traces: LayerTraces): TracesXLayout {
    const layout: TracesXLayout = {
      traces: [],
      spacings: [],
      x_left: 0,
      x_right: 0,
      width: 0,
    }
    let x_offset = 0;
    const Ntraces = layer_traces.traces.length;
    const Nspacings = layer_traces.spacings.length;
    if (Ntraces !== (Nspacings+1)) {
      throw Error(`Expected number of traces ${Ntraces} to be number of spacings ${Nspacings} + 1`);
    }
    for (let i = 0; i < Ntraces; i++) {
      const trace = layer_traces.traces[i];
      {
        const width = this.get_trace_width(trace.voltage);
        const x_left = x_offset;
        const x_right = x_left + width;
        layout.traces.push({ x_left, x_right, voltage: trace.voltage, label: trace.width.label });
        x_offset += width;
      }
      const spacing = layer_traces.spacings.at(i);
      if (spacing !== undefined) {
        const width = this.get_spacing_width(spacing.mode);
        const x_left = x_offset;
        const x_right = x_left + width;
        layout.spacings.push({ x_left, x_right, label: spacing.width.label });
        x_offset += width;
      }
    }
    layout.x_right = x_offset;
    layout.width = x_offset;
    return layout;
  }

  create_stackup_traces_x_layout(): StackupTracesXLayout {
    switch (this.stackup.type) {
      case "colinear": {
        const parent_layout = this.stackup.trace_layout;
        const layer_layout: ColinearXLayout = {
          type: "colinear" as const,
          ...this.create_layer_traces_x_layout(parent_layout),
        };
        return layer_layout;
      }
      case "broadside": {
        const parent_layout = this.stackup.trace_layout;
        const left_layout = this.create_layer_traces_x_layout(parent_layout.left);
        const right_layout = this.create_layer_traces_x_layout(parent_layout.right);
        // determine broadside spacing
        let broadside_spacing = undefined as (XLayout | undefined);
        let right_layout_offset = undefined as (number | undefined);
        {
          const left_trace_layout = left_layout.traces[parent_layout.left.broadside_index];
          const right_trace_layout = right_layout.traces[parent_layout.right.broadside_index];
          const x_left = (left_trace_layout.x_left+left_trace_layout.x_right)/2;
          const x_right = (right_trace_layout.x_left+right_trace_layout.x_right)/2;
          const new_x_right = x_left + sizes.broadside_width_separation;
          broadside_spacing = { x_left, x_right: new_x_right };
          right_layout_offset = new_x_right-x_right;
        }
        // offset right layout
        {
          for (const x_layout of [...right_layout.traces, ...right_layout.spacings]) {
            x_layout.x_left += right_layout_offset;
            x_layout.x_right += right_layout_offset;
          }
          right_layout.x_left += right_layout_offset;
          right_layout.x_right += right_layout_offset;
        }
        // determine overall bounds of layout
        const x_copper_min = Math.min(left_layout.x_left, right_layout.x_left);
        const x_copper_max = Math.max(left_layout.x_right, right_layout.x_right);
        const layer_layout: BroadsideXLayout = {
          type: "broadside" as const,
          pair: {
            left: left_layout,
            right: right_layout,
          },
          x_left: x_copper_min,
          x_right: x_copper_max,
          width: x_copper_max-x_copper_min,
          broadside_spacing,
        };
        return layer_layout;
      }
    }
  }

  create_height_label(y_offset: number, height: number, x_top: number, x_bottom: number, text: string) {
    const label = {
      type: "vertical_dimension_line" as const,
      parent: this,
      y_top: y_offset,
      y_bottom: y_offset+height,
      get x_line() { return this.parent.height_label.x_line; },
      text: {
        data: text,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      get x_text() { return this.parent.height_label.x_text; },
      text_horizontal_align: "left" as const,
      text_vertical_align: "middle" as const,
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      top_extension_line: {
        parent: this,
        get x_left() { return this.parent.height_label.x_extension; },
        x_right: x_top,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
      bottom_extension_line: {
        parent: this,
        get x_left() { return this.parent.height_label.x_extension; },
        x_right: x_bottom,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
    };
    this.height_labels.push(label);
  }

  create_infinite_rectangle_layer(y: number, height: number, colour: string): RectangleShape {
    return {
      type: "rectangle_shape",
      x_left: this.stackup_x.left,
      x_right: this.stackup_x.right,
      y_top: y,
      y_bottom: y+height,
      fill_colour: colour,
      stroke_colour: stroke.outline_colour,
      stroke_width: stroke.outline_width,
    }
  }

  create_inline_width_label(x_left: number, x_right: number, y: number, label: string, drag_up: boolean) {
    const push_y_bound = (y: number) => {
      this.width_label.y_top = Math.min(this.width_label.y_top, y)
      this.width_label.y_bottom = Math.max(this.width_label.y_bottom, y)
    };

    const extension = this.width_label.min_extension_size;
    const line = {
      type: "horizontal_dimension_line" as const,
      x_left,
      x_right,
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
      text_vertical_align: "middle" as const,
      text_horizontal_align: "center" as const,
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
      line.y_text -= extension+this.width_label.text_drag_offset;
      line.left_extension_line.y_top -= extension*2;
      line.right_extension_line.y_top -= extension*2;
    } else {
      line.y_line += extension;
      line.y_text += extension+this.width_label.text_drag_offset;
      line.left_extension_line.y_bottom += extension*2;
      line.right_extension_line.y_bottom += extension*2;
    }

    push_y_bound(line.left_extension_line.y_top);
    push_y_bound(line.left_extension_line.y_bottom);
    push_y_bound(line.right_extension_line.y_top);
    push_y_bound(line.right_extension_line.y_bottom);
    const font_height = font.size*font.glyph_height;
    push_y_bound(line.y_text+font_height/2);
    push_y_bound(line.y_text-font_height/2);

    this.spacing_labels.push(line);
  }

  create_trace(y_offset: number, position: Position, layout: TraceXLayout, is_real: boolean, pair?: BroadsidePair): TraceEntity {
    const y_top = y_offset;
    const y_bottom = y_top+sizes.trace_height;
    let y_base = undefined;
    let y_taper = undefined;
    switch (position.orientation) {
      case "top": {
        y_base = y_top;
        y_taper = y_bottom;
        break;
      }
      case "bottom": {
        y_base = y_bottom;
        y_taper = y_top;
        break;
      }
    }
    const x_left = layout.x_left;
    const x_right = layout.x_right;
    const x_left_taper = x_left+sizes.etch_width;
    const x_right_taper = x_right-sizes.etch_width;
    const trace = {
      type: "polygon_shape" as const,
      parent: this,
      points: [
        { x: x_left, y: y_base },
        { x: x_left_taper, y: y_taper },
        { x: x_right_taper, y: y_taper },
        { x: x_right, y: y_base },
      ],
      get fill_colour() {
        return this.is_solid ? colours.copper : colours.copper_selectable;
      },
      stroke_colour: stroke.outline_colour,
      stroke_width: stroke.outline_width,
      is_solid: true,
    };
    // voltage icon
    if (is_real) {
      const x = (layout.x_left+layout.x_right)/2;
      const y = y_offset+sizes.trace_height/2;
      switch (layout.voltage) {
        case "ground": break;
        case "positive":
        case "negative": {
          const label = this.create_voltage_label(x, y, layout.voltage);
          this.voltage_labels.push(label);
          break;
        }
      }
    }
    // width labels
    const width_label = layout.label;
    const layer_index = this.stackup.get_layer_index(position.layer_id);
    if (is_real && width_label !== undefined) {
      const is_upright = position.orientation === "bottom";
      const taper_label = `${width_label}${layer_index}`
      this.create_inline_width_label(x_left, x_right, y_base, width_label, !is_upright);
      this.create_inline_width_label(x_left_taper, x_right_taper, y_taper, taper_label, is_upright);
    }
    // broadside label
    if (is_real && pair !== undefined) {
      const region: TraceYRegion = {
        y_base,
        y_taper,
      };
      this.broadside_y_region[pair] = region;
    }
    return trace;
  }

  create_trace_group(
    y_offset: number, position: Position, layouts: TracesXLayout,
    is_real: boolean, pair?: BroadsidePair,
    hover_id?: string, on_click?: () => void,
  ): TraceEntity[] {
    const traces: TraceEntity[] = [];
    for (const layout of layouts.traces) {
      // trace
      const trace = {
        ...this.create_trace(y_offset, position, layout, is_real, pair),
        parent: this,
        is_solid: hover_id !== undefined ? false : true,
        get fill_colour(): string {
          return this.is_solid ? colours.copper : colours.copper_selectable;
        },
        on_hover(is_hover: boolean) {
          if (hover_id !== undefined) {
            this.parent.on_trace_hover(hover_id, is_hover);
          }
        },
        on_click,
      };
      if (hover_id !== undefined) {
        this.register_hoverable_trace(trace, hover_id);
      }
      traces.push(trace);
    }
    // spacing labels
    if (is_real) {
      let y_spacing = undefined;
      let is_upright = undefined;
      switch (position.orientation) {
        case "top": {
          y_spacing = y_offset;
          is_upright = false;
          break;
        }
        case "bottom": {
          y_spacing = y_offset+sizes.trace_height;
          is_upright = true;
          break;
        }
      }
      for (const spacing of layouts.spacings) {
        const label = spacing.label;
        if (label !== undefined) {
          this.create_inline_width_label(spacing.x_left, spacing.x_right, y_spacing, label, !is_upright);
        }
      }
    }
    return traces;
  }

  create_layer_traces(y_offset: number, position: Position, layer: Layer): boolean {
    const traces_x_layout = this.stackup_traces_x_layout;
    const stackup = this.stackup;

    const create_trace_height_label = (x_left: number) => {
      const height_label = layer.trace_height.label;
      if (height_label === undefined) return;
      let x_top = undefined;
      let x_bottom = undefined;
      switch (position.orientation) {
        case "top": {
          x_top = this.stackup_x.left;
          x_bottom = x_left+sizes.etch_width;
          break;
        }
        case "bottom": {
          x_top = x_left+sizes.etch_width;
          x_bottom = this.stackup_x.left;
          break;
        }
      }
      this.create_height_label(y_offset, sizes.trace_height, x_top, x_bottom, height_label);
    };

    let has_traces = false;
    switch (stackup.type) {
      case "colinear": {
        if (traces_x_layout.type !== stackup.type) {
          throw Error(`Mismatch between stackup type (${stackup.type}) and x layout type (${traces_x_layout.type})`)
        }
        if (is_same_position(stackup.trace_position, position)) {
          const traces = this.create_trace_group(y_offset, position, traces_x_layout, true);
          this.solid_traces.push(...traces);
          // create height label for real trace
          const x_left = traces_x_layout.x_left;
          create_trace_height_label(x_left);
          has_traces = true;
        }
        if (this.is_editing && stackup.can_move_trace(position)) {
          const group_id = `${position.layer_id}_${position.orientation}`;
          const on_click = () => { stackup.move_trace(position); };
          const traces  = this.create_trace_group(
            y_offset, position, traces_x_layout,
            false, undefined,
            group_id, on_click,
          );
          this.ghost_traces.push(...traces);
          has_traces = true;
        }
        break;
      }
      case "broadside": {
        if (traces_x_layout.type !== stackup.type) {
          throw Error(`Mismatch between stackup type (${stackup.type}) and x layout type (${traces_x_layout.type})`)
        }
        let render_trace_height = false as boolean;
        let x_trace_left = Infinity;
        const render_pair = (pair: BroadsidePair) => {
          const traces_layout = traces_x_layout.pair[pair];
          if (is_same_position(stackup.get_trace_position(pair), position)) {
            const traces = this.create_trace_group(
              y_offset, position, traces_layout,
              true, pair,
            );
            this.solid_traces.push(...traces);
            render_trace_height = true;
            has_traces = true;
            x_trace_left = Math.min(x_trace_left, traces_layout.x_left);
          }
          if (this.is_editing && stackup.can_move_trace(position, pair)) {
            const group_id = `${position.layer_id}_${position.orientation}_${pair}`;
            const on_click = () => { stackup.move_trace(position, pair); };
            const traces  = this.create_trace_group(
              y_offset, position, traces_layout,
              false, pair,
              group_id, on_click,
            );
            this.ghost_traces.push(...traces);
            has_traces = true;
            x_trace_left = Math.min(x_trace_left, traces_layout.x_left);
          }
        };
        render_pair("left");
        render_pair("right");
        // render trace height label
        if (render_trace_height && Number.isFinite(x_trace_left)) {
          create_trace_height_label(x_trace_left);
        }
        break;
      }
    }
    return has_traces;
  }

  create_copper_plane(y_offset: number): RectangleShape {
    const height = sizes.copper_layer_height;
    const plane = {
      ...this.create_infinite_rectangle_layer(y_offset, height, colours.copper),
      stroke_colour: stroke.outline_colour,
      stroke_width: stroke.outline_width,
    };
    return plane;
  }

  create_layer_planes(y_offset: number, position: Position): boolean {
    if (this.stackup.has_plane(position)) {
      let on_click = undefined;
      if (this.is_editing && this.stackup.can_delete_plane(position)) {
        on_click = () => { this.stackup.delete_plane(position); };
      }
      const plane = {
        ...this.create_copper_plane(y_offset),
        fill_colour: colours.copper,
        on_click,
      };
      this.solid_planes.push(plane);
      return true;
    }
    if (this.is_editing && this.stackup.can_add_plane(position)) {
      const plane = {
        ...this.create_copper_plane(y_offset),
        on_click: () => { this.stackup.add_plane(position); },
        is_solid: false,
        get fill_colour(): string {
          return this.is_solid ? colours.copper : colours.copper_selectable;
        },
        on_hover(is_hover: boolean) {
          this.is_solid = is_hover;
        },
      };
      this.ghost_planes.push(plane);
      return true;
    }
    return false;
  }

  create_epsilon_label(y: number, label: string) {
    const epsilon_label = {
      type: "text_label" as const,
      parent: this,
      horizontal_align: "left" as const,
      vertical_align: "middle" as const,
      y,
      get x(): number {
        return this.parent.epsilon_label.x_left;
      },
      text: {
        data: label,
        size: font.size,
        weight: font.weight,
        colour: font.colour,
      },
    };
    this.epsilon_labels.push(epsilon_label);
  }

  // return overall height of surface layer included traces/planes
  create_soldermask(y_offset: number, layer: SurfaceLayer): number {
    const position: Position = { layer_id: layer.id, orientation: layer.orientation };
    const stackup = this.stackup;
    const is_editing = this.is_editing;

    // determine if plane is visible
    let has_plane = false;
    has_plane ||= stackup.has_plane(position);
    if (has_plane) {
      return sizes.copper_layer_height;
    }

    has_plane ||= (is_editing && stackup.can_add_plane(position));
    if (has_plane && !is_editing) {
      return sizes.copper_layer_height;
    }

    // determine trace layout for soldermask
    const traces_x_layout = this.stackup_traces_x_layout;
    const traces: XLayout[] = [];
    switch (stackup.type) {
      case "colinear": {
        if (traces_x_layout.type !== stackup.type) {
          throw Error(`Mismatch between stackup type (${stackup.type}) and x layout type (${traces_x_layout.type})`)
        }
        let has_traces = false;
        has_traces ||= stackup.has_traces(position);
        has_traces ||= is_editing && stackup.can_move_trace(position);
        if (has_traces) {
          traces.push(...traces_x_layout.traces);
        }
        break;
      }
      case "broadside": {
        if (traces_x_layout.type !== stackup.type) {
          throw Error(`Mismatch between stackup type (${stackup.type}) and x layout type (${traces_x_layout.type})`)
        }
        let has_left_traces = false;
        let has_right_traces = false;
        has_left_traces ||= stackup.has_traces_pair(position, "left");
        has_left_traces ||= is_editing && stackup.can_move_trace(position, "left");
        has_right_traces ||= stackup.has_traces_pair(position, "right");
        has_right_traces ||= is_editing && stackup.can_move_trace(position, "right");
        if (has_left_traces) {
          traces.push(...traces_x_layout.pair.left.traces);
        }
        if (has_right_traces) {
          traces.push(...traces_x_layout.pair.right.traces);
        }
        break;
      }
    }

    // determine copper height
    let copper_height = 0;
    const has_traces = traces.length > 0;
    if (has_traces) copper_height = Math.max(copper_height, sizes.trace_height);
    if (has_plane) copper_height = Math.max(copper_height, sizes.copper_layer_height);

    // in view only mode without soldermask
    if (!layer.has_soldermask && !this.is_editing) {
      return copper_height;
    }

    // rectangular mask layer if there are no traces
    if (!has_traces) {
      const height = sizes.soldermask_height;
      let on_click = undefined;
      if (is_editing) {
        on_click = () => { layer.has_soldermask = !layer.has_soldermask; };
      }
      const soldermask = {
        ...this.create_infinite_rectangle_layer(y_offset, height, colours.dielectric_soldermask),
        parent: layer,
        is_solid: layer.has_soldermask,
        get fill_colour(): string {
          return this.is_solid ? colours.dielectric_soldermask : colours.dielectric_soldermask_selectable;
        },
        on_click,
        on_hover(is_hover: boolean) {
          if (is_editing && !layer.has_soldermask) {
            this.is_solid = is_hover;
          }
        },
      };
      this.dielectric_layers.push(soldermask);
      // height label
      const height_label = layer.soldermask_height.label;
      if (layer.has_soldermask && height_label !== undefined) {
        const x_stackup = this.stackup_x.left;
        this.create_height_label(y_offset, height, x_stackup, x_stackup, height_label);
      }
      // epsilon label
      const epsilon_label = layer.epsilon.label;
      if (layer.has_soldermask && epsilon_label !== undefined) {
        this.create_epsilon_label(y_offset+height/2, epsilon_label);
      }
      return height;
    }

    // tight wrapping soldermask layer
    traces.sort((a, b) => {
      return a.x_left-b.x_left;
    });
    const merged_traces: XLayout[] = [];
    {
      let x_left = undefined as (number | undefined);
      let x_right = undefined as (number | undefined);
      for (const trace of traces) {
        // begin new trace merge group
        if (x_left === undefined || x_right === undefined) {
          x_left = trace.x_left;
          x_right = trace.x_right;
          continue;
        }
        // determine if traces should be merged
        if (trace.x_left <= x_right) {
          x_right = trace.x_right;
          continue;
        }
        // if traces are sufficiently separate begin new group
        merged_traces.push({ x_left, x_right });
        x_left = trace.x_left;
        x_right = trace.x_right;
      }
      if (x_left !== undefined && x_right !== undefined) {
        merged_traces.push({ x_left, x_right });
      }
    }

    // determine soldermask y-axis values depending on orientation
    const height = sizes.soldermask_height+sizes.trace_height;
    const y_top = y_offset;
    const y_bottom = y_top+height;
    let y_surface = undefined;
    let y_base = undefined;
    let y_trace = undefined;
    let y_taper = undefined;
    switch (layer.orientation) {
      case "top": {
        y_surface = y_top;
        y_base = y_top+sizes.soldermask_height;
        y_trace = y_top+sizes.trace_height;
        y_taper = y_bottom;
        break;
      }
      case "bottom": {
        y_surface = y_bottom;
        y_base = y_bottom-sizes.soldermask_height;
        y_trace = y_bottom-sizes.trace_height;
        y_taper = y_top;
        break;
      }
    }

    {
      let on_click = undefined;
      if (is_editing) {
        on_click = () => { layer.has_soldermask = !layer.has_soldermask; };
      }
      // soldermask polygon
      const points: PolygonPoint[] = [];
      points.push({ x: this.stackup_x.left, y: y_surface });
      points.push({ x: this.stackup_x.left, y: y_base });
      for (const trace of merged_traces) {
        points.push({ x: trace.x_left, y: y_base });
        points.push({ x: trace.x_left+sizes.etch_width, y: y_taper });
        points.push({ x: trace.x_right-sizes.etch_width, y: y_taper });
        points.push({ x: trace.x_right, y: y_base });
      }
      points.push({ x: this.stackup_x.right, y: y_base });
      points.push({ x: this.stackup_x.right, y: y_surface });
      const soldermask = {
        type: "polygon_shape" as const,
        parent: layer,
        is_solid: layer.has_soldermask,
        get fill_colour(): string {
          return this.is_solid ? colours.dielectric_soldermask : colours.dielectric_soldermask_selectable;
        },
        points,
        on_click,
        on_hover(is_hover: boolean) {
          if (is_editing && !layer.has_soldermask) {
            this.is_solid = is_hover;
          }
        },
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
      };
      this.soldermask_layers.push(soldermask);

      // height label
      const height_label = layer.soldermask_height.label;
      if (layer.has_soldermask && height_label !== undefined) {
        const x_left = merged_traces[0].x_left+sizes.etch_width;
        const y_top = Math.min(y_trace, y_taper);
        this.create_height_label(y_top, sizes.soldermask_height, x_left, x_left, height_label);
      }
      // epsilon label
      const epsilon_label = layer.epsilon.label;
      if (layer.has_soldermask && epsilon_label !== undefined) {
        const y = Math.min(y_base, y_surface);
        this.create_epsilon_label(y+sizes.soldermask_height/2, epsilon_label);
      }
      return height;
    }
  }

  create_surface_layer(y_offset: number, layer: SurfaceLayer): number {
    const position: Position = { layer_id: layer.id, orientation: layer.orientation };
    switch (layer.orientation) {
      case "top": {
        // create traces/planes
        this.create_layer_planes(y_offset, position);
        this.create_layer_traces(y_offset, position, layer);
        const height = this.create_soldermask(y_offset, layer);
        return height;
      }
      case "bottom": {
        const height = this.create_soldermask(y_offset, layer);
        const y_trace = y_offset+height;
        this.create_layer_traces(y_trace-sizes.trace_height, position, layer);
        this.create_layer_planes(y_trace-sizes.copper_layer_height, position);
        return height;
      }
    }
  }

  create_inner_layer(y_offset: number, layer: InnerLayer): number {
    let has_traces = false;
    const y_total_top = y_offset;
    {
      // top copper
      const position: Position = { layer_id: layer.id, orientation: "top" };
      let height = 0;
      if (this.create_layer_planes(y_offset, position)) {
        height = Math.max(height, sizes.copper_layer_height);
      }
      if (this.create_layer_traces(y_offset, position, layer)) {
        height = Math.max(height, sizes.trace_height);
      }
      if (this.stackup.has_traces(position)) {
        has_traces = true;
      }
      y_offset += height;
    }
    {
      const y_top = y_offset;
      y_offset += sizes.core_height;
      const y_bottom = y_offset;
      const height = y_bottom-y_top;
      // height label
      const height_label = layer.dielectric_height.label;
      if (height_label !== undefined) {
        const x_stackup = this.stackup_x.left;
        this.create_height_label(y_top, height, x_stackup, x_stackup, height_label);
      }
      // epsilon label
      const epsilon_label = layer.epsilon.label;
      if (epsilon_label !== undefined) {
        this.create_epsilon_label(y_top+height/2, epsilon_label);
      }
    }
    {
      // bottom copper
      const position: Position = { layer_id: layer.id, orientation: "bottom" };
      let height = 0;
      let y_plane = y_offset;
      if (this.create_layer_traces(y_offset, position, layer)) {
        height = Math.max(height, sizes.trace_height);
        y_plane = y_offset+sizes.trace_height-sizes.copper_layer_height;
      }
      if (this.create_layer_planes(y_plane, position)) {
        height = Math.max(height, sizes.copper_layer_height);
      }
      if (this.stackup.has_traces(position)) {
        has_traces = true;
      }
      y_offset += height;
    }

    const y_total_bottom = y_offset;
    const height = y_total_bottom-y_total_top;
    {
      const colour = has_traces ? colours.dielectric_prepreg : colours.dielectric_core;
      const layer = this.create_infinite_rectangle_layer(y_total_top, height, colour);
      this.dielectric_layers.push(layer);
    }
    return height;
  }

  create_stackup(): number {
    let y_offset = 0;
    const y_top = y_offset;
    for (const layer of this.stackup.layers) {
      switch (layer.type) {
        case "surface": {
          y_offset += this.create_surface_layer(y_offset, layer);
          break;
        }
        case "inner": {
          y_offset += this.create_inner_layer(y_offset, layer);
          break;
        }
      }
    }
    const y_bottom = y_offset;
    const height = y_bottom-y_top;
    return height;
  }

  readjust_height_labels_x() {
    let max_text_width = 0;
    for (const label of this.height_labels) {
      const text = label.text.data;
      const text_width = text.length*font.size*font.glyph_width;
      max_text_width = Math.max(text_width, max_text_width);
    }
    const min_right_padding = 5;
    const min_left_padding = 3;
    this.height_label.x_extension = this.stackup_x.left-min_right_padding-max_text_width-min_left_padding;
    this.height_label.x_text = this.height_label.x_extension+min_left_padding;
  }

  register_hoverable_trace(trace: TraceEntity, group_tag: string) {
    let traces = this.trace_groups.get(group_tag);
    if (traces === undefined) {
      traces = [];
      this.trace_groups.set(group_tag, traces);
    }
    traces.push(trace);
  }

  on_trace_hover(group_tag: string, is_hover: boolean) {
    const traces = this.trace_groups.get(group_tag);
    if (traces === undefined) return;
    for (const trace of traces) {
      trace.is_solid = is_hover;
    }
  }

  create_broadside_width_label(
    x_left: number, x_right: number,
    y_line: number, y_left: number, y_right: number,
    text: string,
  ) {
    const extension_size = this.width_label.min_extension_size;
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

  create_voltage_label(x: number, y: number, voltage: "positive" | "negative"): IconLabel {
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
        width: sizes.voltage_icon,
        height: sizes.voltage_icon,
      },
      horizontal_align: "center",
      vertical_align: "middle",
    };
  }

  get viewport(): Viewport {
    const padding = 0.5;
    const y_top = Math.min(this.stackup_y.top, this.width_label.y_top);
    const y_bottom = Math.max(this.stackup_y.bottom, this.width_label.y_bottom);
    return {
      x_left: this.height_label.x_extension-padding,
      x_right: this.stackup_x.right+padding,
      y_top: y_top-padding,
      y_bottom: y_bottom+padding,
    }
  }

  get entities(): Entity[] {
    return [
      ...this.dielectric_layers,
      ...this.soldermask_layers,
      ...this.solid_planes,
      ...this.solid_traces,
      ...this.ghost_traces,
      ...this.ghost_planes,
      ...this.epsilon_labels,
      ...this.spacing_labels,
      ...this.voltage_labels,
      ...this.height_labels,
    ];
  }
}
