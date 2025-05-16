import {
  type Stackup,
  type SizeParameter,
  type Orientation, type LayerId, type TraceId,
  type HorizontalSpacing, type AttachPoint,
  type CopperTrace, type CopperPlane,
  type UnmaskedLayer, type SoldermaskLayer, type CoreLayer, type PrepregLayer,
} from "./stackup.ts";

// describe shapes
export interface Position {
  x: number;
  y: number;
}

export interface TrapezoidShape {
  y_base: number;
  y_taper: number;
  x_left: number;
  x_right: number;
  x_left_taper: number;
  x_right_taper: number;
}

export interface RectangularShape {
  offset: Position;
  width: number;
  height: number;
}

export interface InfinitePlaneShape {
  y_start: number;
  height: number;
}

// describe layout associated with each stackup entity
export interface CopperTraceLayout {
  parent: CopperTrace;
  shape: TrapezoidShape;
}

export interface CopperPlaneLayout {
  parent: CopperPlane;
  shape: InfinitePlaneShape;
}

export type ConductorLayout =
  { type: "trace" } & CopperTraceLayout |
  { type: "plane" } & CopperPlaneLayout;

export interface HorizontalSpacingLayout {
  parent: HorizontalSpacing;
  left_anchor: Position;
  right_anchor: Position;
  y_mid: number;
}

export interface UnmaskedLayerLayout {
  parent: UnmaskedLayer;
  bounding_box: InfinitePlaneShape;
  is_copper_plane: boolean;
}

export interface SoldermaskLayerLayout {
  parent: SoldermaskLayer;
  bounding_box: InfinitePlaneShape;
  mask?: {
    surface: InfinitePlaneShape;
    traces: TrapezoidShape[];
  }
  is_copper_plane: boolean;
}

export interface CoreLayerLayout {
  parent: CoreLayer;
  bounding_box: InfinitePlaneShape;
}

export interface PrepregLayerLayout {
  parent: PrepregLayer;
  bounding_box: InfinitePlaneShape;
  top: {
    shape: InfinitePlaneShape;
    is_copper_plane: boolean;
  };
  middle_shape: InfinitePlaneShape;
  bottom: {
    shape: InfinitePlaneShape;
    is_copper_plane: boolean;
  };
}

export type LayerLayout =
  { type: "unmasked" } & UnmaskedLayerLayout |
  { type: "soldermask" } & SoldermaskLayerLayout |
  { type: "core" } & CoreLayerLayout |
  { type: "prepreg" } & PrepregLayerLayout;

export interface StackupLayout {
  spacings: HorizontalSpacingLayout[];
  conductors: ConductorLayout[];
  layers: LayerLayout[];
  total_width: number;
  total_height: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

export function create_layout_from_stackup(
  stackup: Stackup,
  get_size: (size_param: SizeParameter) => number,
): StackupLayout {
  const layout: StackupLayout = {
    spacings: [],
    conductors: [],
    layers: [],
    total_width: 0,
    total_height: 0,
    x_min: 0, x_max: 0,
    y_min: 0, y_max: 0,
  };

  // get x regions
  interface XRegion {
    x_left: number;
    x_right: number;
  }
  function get_anchor_in_x_region(region: XRegion, attach: AttachPoint): number {
    switch (attach) {
      case "center": return (region.x_left+region.x_right)/2;
      case "left": return region.x_left;
      case "right": return region.x_right;
    }
  }

  function get_x_region_from_anchor(attach: AttachPoint, width: number, anchor: number): XRegion {
    switch (attach) {
      case "left": return { x_left: anchor, x_right: anchor+width };
      case "center": return { x_left: anchor-width/2, x_right: anchor+width/2 };
      case "right": return { x_left: anchor-width, x_right: anchor };
    }
  }

  interface TraceXRegion extends XRegion {
    id: TraceId;
  }
  const traces: CopperTrace[] = stackup.conductors.filter(conductor => conductor.type == "trace");
  const trace_table: Partial<Record<TraceId, CopperTrace>> = {};
  for (const trace of traces) {
    trace_table[trace.id] = trace;
  }
  const trace_x_regions: TraceXRegion[] = [];
  const trace_x_region_table: Partial<Record<TraceId, TraceXRegion>> = {};
  const push_trace_x_region = (region: TraceXRegion) => {
    trace_x_regions.push(region);
    trace_x_region_table[region.id] = region;
  };
  const spacing_x_region_table: Partial<Record<number, XRegion>> = {};
  const push_spacing_x_region = (index: number, region: XRegion) => {
    spacing_x_region_table[index] = region;
  };

  {
    const spacings = stackup.spacings;
    // seed position of at least one trace
    if (traces.length > 0) {
      const trace = traces[0];
      const trace_width = get_size(trace.width);
      push_trace_x_region({ id: trace.id, x_left: 0, x_right: trace_width });
    }
    // continuously sweep spacings until they are all created
    let index_spacing = 0;
    let running_count_unmarked = 0;
    let running_count_marked = 0;
    while (true) {
      if (running_count_marked == spacings.length) {
        break;
      }
      if (running_count_unmarked == spacings.length) {
        throw Error(`Failed to layout traces horizontally since not all spacings were resolved`);
      }

      const curr_index_spacing = index_spacing;
      const spacing = spacings[curr_index_spacing];
      index_spacing = (index_spacing+1) % spacings.length;

      const left_region = trace_x_region_table[spacing.left_trace.id];
      const right_region = trace_x_region_table[spacing.right_trace.id];
      if (left_region === undefined && right_region === undefined) {
        running_count_unmarked++;
        running_count_marked = 0;
        continue;
      }
      if (left_region === undefined && right_region !== undefined) {
        const spacing_width = get_size(spacing.width);
        const left_trace = trace_table[spacing.left_trace.id];
        if (left_trace === undefined) throw Error(`Invalid trace id ${spacing.left_trace.id}`);
        const left_trace_width = get_size(left_trace.width);
        const x_anchor_right = get_anchor_in_x_region(right_region, spacing.right_trace.attach);
        const x_anchor_left = x_anchor_right-spacing_width;
        const new_left_region = get_x_region_from_anchor(spacing.left_trace.attach, left_trace_width, x_anchor_left);
        push_trace_x_region({ id: spacing.left_trace.id, ...new_left_region });
        push_spacing_x_region(curr_index_spacing, { x_left: x_anchor_left, x_right: x_anchor_right });
      } else if (left_region !== undefined && right_region === undefined) {
        const spacing_width = get_size(spacing.width);
        const right_trace = trace_table[spacing.right_trace.id];
        if (right_trace === undefined) throw Error(`Invalid trace id ${spacing.right_trace.id}`);
        const right_trace_width = get_size(right_trace.width);
        const x_anchor_left = get_anchor_in_x_region(left_region, spacing.left_trace.attach);
        const x_anchor_right = x_anchor_left+spacing_width;
        const new_right_region = get_x_region_from_anchor(spacing.right_trace.attach, right_trace_width, x_anchor_right);
        push_trace_x_region({ id: spacing.right_trace.id, ...new_right_region });
        push_spacing_x_region(curr_index_spacing, { x_left: x_anchor_left, x_right: x_anchor_right });
      }
      running_count_unmarked = 0;
      running_count_marked++;
    }
    if (trace_x_regions.length != traces.length) {
      throw Error(`Failed to find x position of all traces. Found ${trace_x_regions.length} but needed ${traces.length}`);
    }
  }

  const x_min = trace_x_regions.reduce((x,trace) => Math.min(x, trace.x_left), Infinity);
  const x_max = trace_x_regions.reduce((x,trace) => Math.max(x, trace.x_right), 0);
  layout.total_width = x_max-x_min;
  layout.x_min = x_min;
  layout.x_max = x_max;

  // get y regions
  const conductor_in_layer_table: Partial<Record<LayerId, Set<Orientation>>> = {};
  const plane_in_layer_table: Partial<Record<LayerId, Partial<Record<Orientation, CopperPlane>>>> = {};
  for (const conductor of stackup.conductors) {
    const layer_id = conductor.layer_id;
    {
      let orientations = conductor_in_layer_table[layer_id];
      if (orientations === undefined) {
        orientations = new Set();
        conductor_in_layer_table[layer_id] = orientations;
      }
      orientations.add(conductor.orientation);
    }
    if (conductor.type == "plane") {
      let orientations = plane_in_layer_table[layer_id];
      if (orientations === undefined) {
        orientations = {};
        plane_in_layer_table[layer_id] = orientations;
      }
      orientations[conductor.orientation] = conductor;
    }
  }
  const is_conductor_here = (layer_id: LayerId, orientation: Orientation) => {
    const orientations = conductor_in_layer_table[layer_id];
    if (orientations === undefined) return false;
    return orientations.has(orientation);
  };
  const get_plane_here = (layer_id: LayerId, orientation: Orientation): CopperPlane | undefined => {
    const orientations = plane_in_layer_table[layer_id];
    if (orientations === undefined) return undefined;
    return orientations[orientation];
  };

  const layer_layout_table: Partial<Record<LayerId, LayerLayout>> = {};
  const layer_taper_table: Partial<Record<LayerId, number>> = {};
  const layer_trace_height_table: Partial<Record<LayerId, number>> = {};

  const push_layer_layout = (layer_layout: LayerLayout) => {
    layout.layers.push(layer_layout);
    layer_layout_table[layer_layout.parent.id] = layer_layout;
  }

  {
    let y_offset: number = 0;
    for (const layer of stackup.layers) {
      switch (layer.type) {
        case "unmasked": {
          const y_start = y_offset;
          const plane = get_plane_here(layer.id, layer.orientation);
          if (plane) {
            y_offset += get_size(plane.height);
          } else if (is_conductor_here(layer.id, layer.orientation)) {
            const trace_height = get_size(layer.trace_height);
            layer_trace_height_table[layer.id] = trace_height;
            const trace_taper = get_size(layer.trace_taper);
            layer_taper_table[layer.id] = trace_taper;
            y_offset += trace_height;
          }
          const y_end = y_offset;
          push_layer_layout({
            type: "unmasked",
            parent: layer,
            bounding_box: {
              y_start,
              height: y_end-y_start,
            },
            is_copper_plane: plane !== undefined,
          });
          break;
        }
        case "soldermask": {
          const y_start = y_offset;
          let has_surface_mask = false;
          // precalculate total height
          const plane = get_plane_here(layer.id, layer.orientation);
          if (plane) {
            y_offset += get_size(plane.height);
          } else {
            const soldermask_height = get_size(layer.soldermask_height);
            has_surface_mask = true;
            if (is_conductor_here(layer.id, layer.orientation)) {
              const trace_height = get_size(layer.trace_height);
              layer_trace_height_table[layer.id] = trace_height;
              const trace_taper = get_size(layer.trace_taper);
              layer_taper_table[layer.id] = trace_taper;
              y_offset += trace_height;
              y_offset += soldermask_height;
            } else {
              y_offset += soldermask_height;
            }
          }
          const y_end = y_offset;
          const bounding_box: InfinitePlaneShape = {
            y_start,
            height: y_end-y_start,
          }
          // determine location of soldermask base
          let surface_mask: InfinitePlaneShape | undefined = undefined;
          if (has_surface_mask) {
            const soldermask_height = get_size(layer.soldermask_height);
            if (layer.orientation == "up") {
              surface_mask = {
                y_start,
                height: soldermask_height,
              };
            } else {
              surface_mask = {
                y_start: y_end-soldermask_height,
                height: soldermask_height,
              };
            }
          }
          push_layer_layout({
            type: "soldermask",
            parent: layer,
            bounding_box,
            mask: surface_mask !== undefined ? {
              surface: surface_mask,
              traces: [],
            } : undefined,
            is_copper_plane: plane !== undefined,
          });
          break;
        }
        case "core": {
          const y_start = y_offset;
          const height = get_size(layer.height);
          y_offset += height;
          const y_end = y_offset;
          push_layer_layout({
            type: "core",
            parent: layer,
            bounding_box: {
              y_start,
              height: y_end-y_start,
            },
          });
          break;
        }
        case "prepreg": {
          const y_start = y_offset;
          // top of prepreg
          let top_shape: InfinitePlaneShape | undefined = undefined;
          const top_plane = get_plane_here(layer.id, "up");
          if (top_plane) {
            const plane_height = get_size(top_plane.height);
            top_shape = {
              y_start: y_offset,
              height: plane_height,
            };
            y_offset += plane_height;
          } else {
            const trace_height = get_size(layer.trace_height);
            layer_trace_height_table[layer.id] = trace_height;
            top_shape = {
              y_start: y_offset,
              height: trace_height,
            };
            y_offset += trace_height;
            if (is_conductor_here(layer.id, "up")) {
              const trace_taper = get_size(layer.trace_taper);
              layer_taper_table[layer.id] = trace_taper;
            }
          }
          // middle of prepreg
          const dielectric_height = get_size(layer.height);
          const middle_shape: InfinitePlaneShape = {
            y_start: y_offset,
            height: dielectric_height,
          };
          y_offset += dielectric_height;
          // bottom of prepreg
          let bottom_shape: InfinitePlaneShape | undefined = undefined;
          const bottom_plane = get_plane_here(layer.id, "down");
          if (bottom_plane) {
            const plane_height = get_size(bottom_plane.height);
            bottom_shape = {
              y_start: y_offset,
              height: plane_height,
            };
            y_offset += plane_height;
          } else {
            const trace_height = get_size(layer.trace_height);
            bottom_shape = {
              y_start: y_offset,
              height: trace_height,
            };
            layer_trace_height_table[layer.id] = trace_height;
            y_offset += trace_height;
            if (is_conductor_here(layer.id, "down")) {
              const trace_taper = get_size(layer.trace_taper);
              layer_taper_table[layer.id] = trace_taper;
            }
          }
          const y_end = y_offset;
          push_layer_layout({
            type: "prepreg",
            parent: layer,
            bounding_box: {
              y_start,
              height: y_end-y_start,
            },
            top: {
              shape: top_shape,
              is_copper_plane: top_plane !== undefined,
            },
            middle_shape,
            bottom: {
              shape: bottom_shape,
              is_copper_plane: bottom_plane !== undefined,
            },
          });
          break;
        }
      }
    }
    layout.total_height = y_offset;
    layout.y_min = 0;
    layout.y_max = y_offset;
  }

  // create conductor layouts
  const layer_trace_layout_table: Partial<Record<LayerId, Partial<Record<Orientation, CopperTraceLayout[]>>>> = {};
  const trace_layout_table: Partial<Record<TraceId, CopperTraceLayout>> = {};
  const push_trace_layout = (layer_id: LayerId, orientation: Orientation, trace_layout: CopperTraceLayout) => {
    let orientation_table = layer_trace_layout_table[layer_id];
    if (orientation_table === undefined) {
      orientation_table = {};
      layer_trace_layout_table[layer_id] = orientation_table;
    }
    let trace_layouts = orientation_table[orientation];
    if (trace_layouts === undefined) {
      trace_layouts = [];
      orientation_table[orientation] = trace_layouts;
    }
    trace_layouts.push(trace_layout);
    trace_layout_table[trace_layout.parent.id] = trace_layout;
  };

  for (const conductor of stackup.conductors) {
    switch (conductor.type) {
      case "plane": {
        const layer_id = conductor.layer_id;
        const layer_layout = layer_layout_table[layer_id];
        if (layer_layout === undefined) throw Error(`Plane references missing layer layout id ${layer_id}`);
        const plane_height = get_size(conductor.height);
        const y_start = layer_layout.bounding_box.y_start;
        const y_end = y_start+layer_layout.bounding_box.height;
        const plane_y_region = conductor.orientation == "up" ? {
          y_start: y_start,
          y_end: y_start+plane_height,
        } : {
          y_start: y_end-plane_height,
          y_end: y_end,
        };
        layout.conductors.push({
          type: "plane",
          parent: conductor,
          shape: {
            y_start: plane_y_region.y_start,
            height: plane_y_region.y_end-plane_y_region.y_start,
          },
        });
        break;
      }
      case "trace": {
        const layer_id = conductor.layer_id;
        const layer_layout = layer_layout_table[layer_id];
        if (layer_layout === undefined) throw Error(`Plane references invalid layer layout id ${layer_id}`);
        const x_region = trace_x_region_table[conductor.id];
        if (x_region === undefined) throw Error(`Trace does not have an x region ${conductor.id}`);
        const trace_taper = layer_taper_table[layer_id];
        if (trace_taper === undefined) throw Error(`Plane references layer id without trace taper ${layer_id}`);
        const trace_height = layer_trace_height_table[layer_id];
        if (trace_height === undefined) throw Error(`Plane references layer id without trace height ${layer_id}`);
        const y_start = layer_layout.bounding_box.y_start;
        const y_end = y_start+layer_layout.bounding_box.height;
        const trapezoid_y_shape = conductor.orientation == "up" ? {
          y_base: y_start,
          y_taper: y_start+trace_height,
        } : {
          y_base: y_end,
          y_taper: y_end-trace_height,
        };
        const trace_layout: CopperTraceLayout = {
          parent: conductor,
          shape: {
            x_left: x_region.x_left,
            x_right: x_region.x_right,
            x_left_taper: x_region.x_left + trace_taper/2,
            x_right_taper: x_region.x_right - trace_taper/2,
            ...trapezoid_y_shape,
          },
        };
        layout.conductors.push({ type: "trace", ...trace_layout });
        push_trace_layout(layer_id, conductor.orientation, trace_layout);
        break;
      }
    }
  }

  // create spacing layouts
  function get_closest_value(target: number, ...values: number[]): number {
    let closest_value = 0;
    let min_distance = Infinity;
    for (const value of values) {
      const distance = Math.abs(target-value);
      if (distance < min_distance) {
        closest_value = value;
        min_distance = distance;
      }
    }
    return closest_value;
  }
  for (let spacing_index = 0; spacing_index < stackup.spacings.length; spacing_index++) {
    const spacing = stackup.spacings[spacing_index];
    const x_region = spacing_x_region_table[spacing_index];
    if (x_region === undefined) throw Error(`Spacing is missing x region ${spacing_index}`);
    const left_trace_layout = trace_layout_table[spacing.left_trace.id];
    if (left_trace_layout === undefined) throw Error(`Spacing ${spacing_index} is missing left trace layout ${spacing.left_trace.id}`);
    const right_trace_layout = trace_layout_table[spacing.right_trace.id];
    if (right_trace_layout === undefined) throw Error(`Spacing ${spacing_index} is missing right trace layout ${spacing.right_trace.id}`);

    const left_trace = left_trace_layout.parent;
    const right_trace = right_trace_layout.parent;
    const left_shape = left_trace_layout.shape;
    const right_shape = right_trace_layout.shape;

    const y_mid =
      (left_trace.layer_id == right_trace.layer_id) ?
      (left_shape.y_base+right_shape.y_base)/2 :
      (left_shape.y_base+left_shape.y_taper+right_shape.y_base+right_shape.y_taper)/4;
    const y_left =
      (spacing.left_trace.attach == "center") ?
      get_closest_value(y_mid, left_shape.y_base, left_shape.y_taper) :
      left_shape.y_base;
    const y_right =
      (spacing.right_trace.attach == "center") ?
      get_closest_value(y_mid, right_shape.y_base, right_shape.y_taper) :
      right_shape.y_base;

    layout.spacings.push({
      parent: spacing,
      left_anchor: {
        x: x_region.x_left,
        y: y_left,
      },
      right_anchor: {
        x: x_region.x_right,
        y: y_right,
      },
      y_mid,
    });
  }

  // finish layer layout for soldermask layers now that we have trace shapes
  for (const soldermask_layout of layout.layers.filter(layer => layer.type == "soldermask")) {
    const layer = soldermask_layout.parent;
    const trace_layouts = layer_trace_layout_table[layer.id]?.[layer.orientation];
    if (trace_layouts === undefined) continue;
    const soldermask_height = get_size(layer.soldermask_height);
    const y_shift = layer.orientation == "up" ? soldermask_height : -soldermask_height;
    for (const trace_layout of trace_layouts) {
      const shape = trace_layout.shape;
      if (soldermask_layout.mask?.traces) {
        soldermask_layout.mask.traces.push({
          ...shape,
          y_base: shape.y_base+y_shift,
          y_taper: shape.y_taper+y_shift,
        });
      }
    }
  }

  return layout;
}
