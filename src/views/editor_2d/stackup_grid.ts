import {
  GridLines, RegionGrid,
} from "../../engine/grid_2d.ts";

import { calculate_grid_regions, type RegionSpecification } from "../../engine/mesher.ts";
import {
  type TraceAlignment, type Stackup, type Id, StackupRules,
  type Layer,
} from "./stackup.ts";
import {
  type LayerParameters,
  type StackupParameters,
} from "./stackup_parameters.ts";

function get_log_median(dims: number[]): number {
  const log_dims = dims.map(x => Math.log10(x));
  log_dims.sort();
  const median_log_dim =
    (log_dims.length % 2 != 0) ?
    log_dims[Math.floor(log_dims.length/2)] : // exact median if odd
    (log_dims[log_dims.length/2-1]+log_dims[log_dims.length/2])/2.0; // weighted median if even
  const median_dim = Math.pow(10, median_log_dim);
  return median_dim;
}

// x=0,y=0 is top left
const sdf_slope_bottom_left = (x: number, y: number) => (y > x) ? 1.0 : 0.0;
const sdf_slope_bottom_right = (x: number, y: number) => (y > 1-x) ? 1.0 : 0.0;
const sdf_slope_top_left = (x: number, y: number) => (y < 1-x) ? 1.0 : 0.0;
const sdf_slope_top_right = (x: number, y: number) => (y < x) ? 1.0 : 0.0;

function get_sdf_multisample(sdf: (x: number, y: number) => number) {
  const My = 2;
  const Mx = 2;
  const total_samples = My*Mx;
  function transform(
    [y_start, x_start]: [number, number],
    [y_size, x_size]: [number, number]): number
  {
    // multisampling
    let total_beta = 0;
    for (let my = 0; my < My; my++) {
      const ey = (my+0.5)/My;
      const y_norm = y_start + y_size*ey;
      for (let mx = 0; mx < Mx; mx++) {
        const ex = (mx+0.5)/Mx;
        const x_norm = x_start + x_size*ex;
        total_beta += sdf(x_norm, y_norm);
      }
    }
    const beta = total_beta/total_samples;
    return beta;
  }
  return transform;
}

function voltage_sdf(sdf: (x: number, y: number) => number, voltage_index: number) {
  const sdf_multisample = get_sdf_multisample(sdf);
  function transform(
    _value: number,
    [y_start, x_start]: [number, number],
    [y_size, x_size]: [number, number]): number
  {
    const beta = sdf_multisample([y_start, x_start], [y_size, x_size]);
    const beta_quantised = Math.floor(0xFFFF*beta);
    return (voltage_index << 16) | beta_quantised;
  }
  return transform;
}

function epsilon_sdf(sdf: (x: number, y: number) => number, old_epsilon: number, new_epsilon: number) {
  const sdf_multisample = get_sdf_multisample(sdf);
  function transform(
    _old_epsilon: number,
    [y_start, x_start]: [number, number],
    [y_size, x_size]: [number, number]): number
  {
    const beta = sdf_multisample([y_start, x_start], [y_size, x_size]);
    const epsilon = (1-beta)*old_epsilon + beta*new_epsilon;
    return epsilon;
  }
  return transform;
}

interface VerticalRegion {
  iy_start: number;
  iy_end: number;
}

interface AttachedVerticalRegion {
  iy_attach: number;
  iy_surface: number;
}

interface TraceRegion extends AttachedVerticalRegion {
  ix_taper_left: number;
  ix_signal_left: number;
  ix_signal_right: number;
  ix_taper_right: number;
  voltage_index: number;
}

interface CopperLayerRegion extends VerticalRegion {
  voltage_index: number;
}

interface InnerLayerRegion {
  dielectric: VerticalRegion;
  traces: Partial<Record<TraceAlignment, AttachedVerticalRegion>>;
}

interface SurfaceLayerRegion {
  trace?: AttachedVerticalRegion;
  soldermask_base?: AttachedVerticalRegion;
  soldermask_trace?: AttachedVerticalRegion;
}

type LayerRegion =
  { type: "copper" }  & CopperLayerRegion |
  { type: "inner", epsilon: number } & InnerLayerRegion |
  { type: "surface", epsilon?: number } & SurfaceLayerRegion;

export interface StackupGrid {
  x_grid_lines: GridLines;
  y_grid_lines: GridLines;
  traces: TraceRegion[];
  layers: LayerRegion[];
  region_grid: RegionGrid;
}

// NOTE: we throw an error if something is wrong with the parameter or stackup
export function create_stackup_grid_from_stackup_parameters(params: StackupParameters, stackup: Stackup): StackupGrid {
  const total_layers = stackup.layers.length;
  if (total_layers != params.layer_parameters.length) {
    throw Error(`Mismatch between number of layers in stackup parameters (${params.layer_parameters.length}) and stackup template (${stackup.layers.length})`);
  }

  // normalise parameters
  const dims: number[] = [];
  for (const param of params.layer_parameters) {
    if (param.height?.value) dims.push(param.height.value);
    if (param.trace_height?.value) dims.push(param.trace_height.value);
    if (param.trace_taper?.value) dims.push(param.trace_taper.value/2);
  }
  {
    const param = params.trace_parameters;
    if (param.coplanar_separation?.value) dims.push(param.coplanar_separation.value);
    if (param.signal_width?.value) dims.push(param.signal_width.value);
    if (param.signal_separation?.value) dims.push(param.signal_separation.value);
    if (param.coplanar_width?.value) dims.push(param.coplanar_width.value);
  }
  if (dims.length == 0) {
    throw Error("No dimensions were provided to create a grid");
  }

  // thresholds for rescaled parameters
  const x_threshold = 2.5e-3;
  const y_threshold = 2.5e-3;
  const x_min = x_threshold*1.05;
  const y_min = y_threshold*1.05;

  const dim_mean: number = 1.0;
  const dim_rescale = dim_mean/get_log_median(dims);

  const x_grid_lines = new GridLines();
  const y_grid_lines = new GridLines();

  const layer_regions: LayerRegion[] = [];
  const layer_regions_table: Partial<Record<Id, LayerRegion>> = {};
  const layer_tapers: Partial<Record<Id, number>> = {};
  let x_offset = 0;
  let y_offset = 0;
  // create layer stackup
  {
    const create_layer_region = (layer_index: number, layer: Layer, param: LayerParameters): LayerRegion => {
      switch (layer.type) {
        case "copper": {
          const iy_start = y_grid_lines.push(y_offset, y_threshold);
          y_offset += dim_mean;
          const iy_end = y_grid_lines.push(y_offset, y_threshold);
          return {
            type: "copper",
            iy_start,
            iy_end,
            voltage_index: 0,
          };
        }
        case "inner": {
          layer_tapers[layer.id] = param.trace_taper?.value;
          const epsilon = param.epsilon?.value;
          if (epsilon === undefined) {
            throw Error(`Missing dielectric epsilon value for layer ${layer_index}`);
          }
          const dielectric_height = param.height?.value;
          if (dielectric_height === undefined) {
            throw Error(`Missing dielectric height for layer ${layer_index}`);
          }
          const norm_dielectric_height = Math.max(dielectric_height*dim_rescale, y_min);
          const y_dielectric_start = y_offset;
          const trace_regions: Partial<Record<TraceAlignment, AttachedVerticalRegion>> = {};
          const trace_alignments: TraceAlignment[] = ["top", "bottom"];
          for (let i = 0; i < trace_alignments.length; i++) {
            const trace_alignment = trace_alignments[i];
            if (layer.trace_alignments.has(trace_alignment)) {
              const trace_height = param.trace_height?.value;
              if (trace_height === undefined) {
                throw Error(`Missing trace height for layer ${layer_index}`);
              }
              const norm_trace_height = Math.max(trace_height*dim_rescale, y_min);
              const y_trace_start = y_offset;
              y_offset += norm_trace_height;
              const y_trace_end = y_offset;
              const iy_trace_start = y_grid_lines.push(y_trace_start, y_threshold);
              const iy_trace_end = y_grid_lines.push(y_trace_end, y_threshold);
              const [iy_trace_attach, iy_trace_surface] =
                (trace_alignment == "top") ?
                [iy_trace_start, iy_trace_end] :
                [iy_trace_end, iy_trace_start];
              trace_regions[trace_alignment] = {
                iy_attach: iy_trace_attach,
                iy_surface: iy_trace_surface,
              }
            }
            if (i < (trace_alignments.length-1)) {
              y_offset += norm_dielectric_height;
            }
          }
          const y_dielectric_end = y_offset;
          const iy_dielectric_start = y_grid_lines.push(y_dielectric_start, y_threshold);
          const iy_dielectric_end = y_grid_lines.push(y_dielectric_end, y_threshold);
          return {
            type: "inner",
            dielectric: {
              iy_start: iy_dielectric_start,
              iy_end: iy_dielectric_end,
            },
            traces: trace_regions,
            epsilon,
          }
        }
        case "surface": {
          layer_tapers[layer.id] = param.trace_taper?.value;

          const has_trace = StackupRules.is_trace_layout_in_layer(layer, stackup.trace_layout);
          const has_soldermask = layer.has_soldermask;
          const trace_height = param.trace_height?.value;
          const dielectric_height = param.height?.value;
          const epsilon = param.epsilon?.value;
          // check if parameters are present
          if (has_soldermask && dielectric_height === undefined) {
            throw Error(`Missing dielectric height for layer ${layer_index}`);
          }
          const norm_dielectric_height = dielectric_height && Math.max(dielectric_height*dim_rescale, y_min);
          if (has_trace && trace_height === undefined) {
            throw Error(`Missing trace height for layer ${layer_index}`);
          }
          const norm_trace_height = trace_height && Math.max(trace_height*dim_rescale, y_min);
          if (has_soldermask && epsilon === undefined) {
            throw Error(`Missing dielectric epsilon value for layer ${layer_index}`);
          }
          // construct region
          const region: SurfaceLayerRegion = {};
          const y_start = y_offset;
          let norm_total_height = 0;
          if (has_soldermask) {
            norm_total_height += norm_dielectric_height as number;
          }
          if (has_trace) {
            norm_total_height += norm_trace_height as number;
          }
          y_offset += norm_total_height;
          const y_end = y_offset;
          y_grid_lines.push(y_start, y_threshold);
          y_grid_lines.push(y_end, y_threshold);
          if (layer.trace_alignment == "bottom") {
            if (has_soldermask) {
              const y_soldermask_attach = y_end;
              const y_soldermask_surface = y_soldermask_attach-(norm_dielectric_height as number);
              const iy_soldermask_attach = y_grid_lines.push(y_soldermask_attach, y_threshold);
              const iy_soldermask_surface = y_grid_lines.push(y_soldermask_surface, y_threshold);
              region.soldermask_base = { iy_attach: iy_soldermask_attach, iy_surface: iy_soldermask_surface };
            }
            if (has_trace) {
              const y_trace_attach = y_end;
              const y_trace_surface = y_trace_attach-(norm_trace_height as number);
              const iy_trace_attach = y_grid_lines.push(y_trace_attach, y_threshold);
              const iy_trace_surface = y_grid_lines.push(y_trace_surface, y_threshold);
              region.trace = { iy_attach: iy_trace_attach, iy_surface: iy_trace_surface };
              if (has_soldermask) {
                const y_soldermask_attach = y_trace_surface;
                const y_soldermask_surface = y_soldermask_attach-(norm_dielectric_height as number);
                const iy_soldermask_attach = y_grid_lines.push(y_soldermask_attach, y_threshold);
                const iy_soldermask_surface = y_grid_lines.push(y_soldermask_surface, y_threshold);
                region.soldermask_trace = { iy_attach: iy_soldermask_attach, iy_surface: iy_soldermask_surface };
              }
            }
          } else if (layer.trace_alignment == "top") {
            if (has_soldermask) {
              const y_soldermask_attach = y_start;
              const y_soldermask_surface = y_soldermask_attach+(norm_dielectric_height as number);
              const iy_soldermask_attach = y_grid_lines.push(y_soldermask_attach, y_threshold);
              const iy_soldermask_surface = y_grid_lines.push(y_soldermask_surface, y_threshold);
              region.soldermask_base = { iy_attach: iy_soldermask_attach, iy_surface: iy_soldermask_surface };
            }
            if (has_trace) {
              const y_trace_attach = y_start;
              const y_trace_surface = y_trace_attach+(norm_trace_height as number);
              const iy_trace_attach = y_grid_lines.push(y_trace_attach, y_threshold);
              const iy_trace_surface = y_grid_lines.push(y_trace_surface, y_threshold);
              region.trace = { iy_attach: iy_trace_attach, iy_surface: iy_trace_surface };
              if (has_soldermask) {
                const y_soldermask_attach = y_trace_surface;
                const y_soldermask_surface = y_soldermask_attach+(norm_dielectric_height as number);
                const iy_soldermask_attach = y_grid_lines.push(y_soldermask_attach, y_threshold);
                const iy_soldermask_surface = y_grid_lines.push(y_soldermask_surface, y_threshold);
                region.soldermask_trace = { iy_attach: iy_soldermask_attach, iy_surface: iy_soldermask_surface };
              }
            }
          }
          return { type: "surface", ...region, epsilon };
        }
      }
    };
    for (let layer_index = 0; layer_index < total_layers; layer_index++) {
      const param = params.layer_parameters[layer_index];
      const layer = stackup.layers[layer_index];
      const layer_region = create_layer_region(layer_index, layer, param);
      layer_regions.push(layer_region);
      layer_regions_table[layer.id] = layer_region;
    }
  }

  const dim_x_padding = dim_mean*20;
  const trace_regions: TraceRegion[] = [];
  const layout_items = StackupRules.get_layout_items_from_trace_layout(stackup.trace_layout);
  const trace_positions = StackupRules.get_layout_trace_positions(stackup.trace_layout);
  const voltage_table: number[] = [0, 1, -1];
  const total_signal_traces = layout_items.filter(item => item.type == "trace" && item.trace == "signal").length;
  if (total_signal_traces > 2) {
    throw Error(`Got more than 2 signal traces`);
  }
  let signal_trace_index = 0;
  {
    // x layout
    const param = params.trace_parameters;
    // left padding
    {
      const _rx_start = x_grid_lines.push(x_offset, x_threshold);
      x_offset += dim_x_padding;
      const _rx_end = x_grid_lines.push(x_offset, x_threshold);
    }
    let trace_index = 0;
    for (const item of layout_items) {
      switch (item.type) {
        case "trace": {
          // get voltage and trace width
          let voltage_index = 0;
          let width: number | undefined = undefined;
          switch (item.trace) {
            case "signal": {
              voltage_index = signal_trace_index+1;
              width = param.signal_width?.value;
              signal_trace_index++;
              break;
            }
            case "ground": {
              voltage_index = 0;
              width = param.coplanar_width?.value;
              break;
            }
          }
          if (width === undefined) {
            throw Error(`Trace width is missing from index ${trace_index}`);
          }
          const norm_width = Math.max(width*dim_rescale, x_min);

          // get trace y position
          const position = trace_positions[trace_index];
          const layer_region = layer_regions_table[position.layer_id];
          if (layer_region === undefined) {
            throw Error(`Failed to find layer with id ${position.layer_id}`);
          }
          let iy_attach: number | undefined = undefined;
          let iy_surface: number | undefined = undefined;
          switch (layer_region.type) {
            case "copper": {
              throw Error(`Got a copper layer when determining trace location`);
            }
            case "inner": {
              const y_region = layer_region.traces[position.alignment];
              if (y_region === undefined) {
                throw Error(`Missing y region for trace inside layer`);
              }
              iy_attach = y_region.iy_attach;
              iy_surface = y_region.iy_surface;
              break;
            }
            case "surface": {
              const y_region = layer_region.trace;
              if (y_region === undefined) {
                throw Error(`Missing y region for trace inside layer`);
              }
              iy_attach = y_region.iy_attach;
              iy_surface = y_region.iy_surface;
              break;
            }
          }

          // get trace x position
          const taper = layer_tapers[position.layer_id] || 0.0;
          const norm_taper = taper*dim_rescale; // allow 0 taper
          const x_signal_left = x_offset;
          x_offset += norm_width;
          const x_signal_right = x_offset;
          const x_taper_left = x_signal_left+norm_taper/2;
          const x_taper_right = x_signal_right-norm_taper/2;

          const ix_signal_left = x_grid_lines.push(x_signal_left, x_threshold);
          const ix_signal_right = x_grid_lines.push(x_signal_right, x_threshold);
          const ix_taper_left = x_grid_lines.push(x_taper_left, x_threshold);
          const ix_taper_right = x_grid_lines.push(x_taper_right, x_threshold);
          const trace_region: TraceRegion = {
            ix_taper_left,
            ix_taper_right,
            ix_signal_left,
            ix_signal_right,
            iy_attach,
            iy_surface,
            voltage_index,
          };
          trace_regions.push(trace_region);
          trace_index += 1;
          break;
        }
        case "spacing": {
          switch (item.spacing) {
            case "ground": {
              const spacing = param.coplanar_separation?.value;
              if (spacing === undefined) {
                throw Error(`Coplanar separation not provided`);
              }
              const norm_spacing = Math.max(spacing*dim_rescale, x_min);
              x_offset += norm_spacing;
              break;
            }
            case "signal": {
              const spacing = param.signal_separation?.value;
              if (spacing === undefined) {
                throw Error(`Signal separation not provided`);
              }
              const norm_spacing = Math.max(spacing*dim_rescale, x_min);
              x_offset += norm_spacing;
              break;
            }
            case "broadside": {
              const signal_width = param.signal_width?.value;
              if (signal_width === undefined) {
                throw Error(`Signal width not provided to determine broadside spacing horizontal offset`);
              }
              const norm_signal_width = Math.max(signal_width*dim_rescale, x_min);
              const spacing = param.signal_separation?.value;
              if (spacing === undefined) {
                throw Error(`Broadside spacing not specified`);
              }
              const norm_spacing = spacing*dim_rescale;
              x_offset += (-norm_signal_width+norm_spacing);
              break;
            }
          }
        }
      }
    }
    // right padding
    {
      const _rx_start = x_grid_lines.push(x_offset, x_threshold);
      x_offset += dim_x_padding;
      const _rx_end = x_grid_lines.push(x_offset, x_threshold);
    }
  }

  // top/bottom padding
  if (layer_regions[0].type != "copper") {
    y_grid_lines.push(0-dim_mean*20, y_threshold);
  }
  if (layer_regions[layer_regions.length-1].type != "copper") {
    y_grid_lines.push(y_offset+20*dim_mean, y_threshold);
  }

  // create regions
  const x_region_sizes = x_grid_lines.to_regions();
  const y_region_sizes = y_grid_lines.to_regions();
  // copper regions have an indeterminate that we don't care about
  const x_region_specs: RegionSpecification[] = x_region_sizes.map(size => { return { size }; });
  const y_region_specs: RegionSpecification[] = y_region_sizes.map(size => { return { size }; });
  for (const layer of layer_regions) {
    if (layer.type != "copper") continue;
    const ry_start = y_grid_lines.get_index(layer.iy_start);
    const ry_end = y_grid_lines.get_index(layer.iy_end);
    for (let i = ry_start; i < ry_end; i++) {
      y_region_specs[i].total_grid_lines = 2;
    }
  }

  const x_max_ratio = 0.7;
  const y_max_ratio = 0.7;
  const x_min_subdivisions = 5;
  const y_min_subdivisions = 5;
  const x_region_grids = calculate_grid_regions(x_region_specs, x_min_subdivisions, x_max_ratio);
  const y_region_grids = calculate_grid_regions(y_region_specs, y_min_subdivisions, y_max_ratio);

  const region_grid = new RegionGrid(x_region_grids, y_region_grids);
  const er0 = 1.0;
  region_grid.grid.epsilon_k.fill(er0);

  // create dielectric material
  for (let layer_index = 0; layer_index < layer_regions.length; layer_index++) {
    const layer_region = layer_regions[layer_index];
    switch (layer_region.type) {
      case "copper": {
        const voltage_index = layer_region.voltage_index;
        const ry_start = y_grid_lines.get_index(layer_region.iy_start);
        const ry_end = y_grid_lines.get_index(layer_region.iy_end);
        const rx_start = 0;
        const rx_end = x_region_grids.length;

        const v_force = region_grid.v_force_region_view();
        const [Ny, Nx] = v_force.view.shape;

        const gx_start = v_force.x_region_to_grid(rx_start);
        const gx_end = v_force.x_region_to_grid(rx_end);
        const gy_start = v_force.y_region_to_grid(ry_start);
        const gy_end = v_force.y_region_to_grid(ry_end);

        // expand voltage field to include the next index so voltage along boundary of conductor is met
        // also allow infinitely flat traces (gy_start == gy_end)
        v_force
          .get_grid(
            [gy_start, gx_start],
            [Math.min(gy_end+1,Ny), Math.min(gx_end+1,Nx)],
          )
          .fill((voltage_index << 16) | 0xFFFF);
        break;
      };
      case "inner": {
        const ry_start = y_grid_lines.get_index(layer_region.dielectric.iy_start);
        const ry_end = y_grid_lines.get_index(layer_region.dielectric.iy_end);
        const rx_start = 0;
        const rx_end = x_region_grids.length;
        const epsilon = layer_region.epsilon;

        const epsilon_k = region_grid.epsilon_k_region_view();
        if (ry_start < ry_end) {
          epsilon_k
            .get_region(
                [ry_start,rx_start],
                [ry_end,rx_end],
            )
            .fill(epsilon);
        }
        break;
      };
      case "surface": {
        if (layer_region.soldermask_base && layer_region.epsilon) {
          const ry_attach = y_grid_lines.get_index(layer_region.soldermask_base.iy_attach);
          const ry_surface = y_grid_lines.get_index(layer_region.soldermask_base.iy_surface);
          const ry_start = Math.min(ry_attach, ry_surface)
          const ry_end = Math.max(ry_attach, ry_surface)
          const rx_start = 0;
          const rx_end = x_region_grids.length;
          const epsilon = layer_region.epsilon;
          const epsilon_k = region_grid.epsilon_k_region_view();
          if (ry_start < ry_end) {
            epsilon_k
              .get_region(
                  [ry_start,rx_start],
                  [ry_end,rx_end],
              )
              .fill(epsilon);
          }
        }
        if (layer_region.soldermask_trace && layer_region.soldermask_base && layer_region.epsilon) {
          const layer = stackup.layers[layer_index];
          for (let trace_index = 0; trace_index < trace_regions.length; trace_index++) {
            const trace_region = trace_regions[trace_index];
            if (!StackupRules.is_trace_layout_in_layer(layer, stackup.trace_layout, trace_index)) continue;
            const rx_signal_left = x_grid_lines.get_index(trace_region.ix_signal_left);
            const rx_signal_right = x_grid_lines.get_index(trace_region.ix_signal_right);
            const rx_taper_left = x_grid_lines.get_index(trace_region.ix_taper_left);
            const rx_taper_right = x_grid_lines.get_index(trace_region.ix_taper_right);

            const ry_attach = y_grid_lines.get_index(layer_region.soldermask_base.iy_surface);
            const ry_surface = y_grid_lines.get_index(layer_region.soldermask_trace.iy_surface);
            const ry_start = Math.min(ry_attach, ry_surface);
            const ry_end = Math.max(ry_attach, ry_surface);

            const erk = layer_region.epsilon;
            const [left_taper_sdf, right_taper_sdf] =
              (ry_surface > ry_attach) ?
              [epsilon_sdf(sdf_slope_top_right, er0, erk), epsilon_sdf(sdf_slope_top_left, er0, erk)] :
              [epsilon_sdf(sdf_slope_bottom_right, er0, erk), epsilon_sdf(sdf_slope_bottom_left, er0, erk)];

            const epsilon_k = region_grid.epsilon_k_region_view();
            if (rx_signal_left < rx_taper_left && ry_start < ry_end) {
              epsilon_k.transform_norm_region(
                [ry_start, rx_signal_left],
                [ry_end, rx_taper_left],
                left_taper_sdf,
              );
            }
            if (rx_taper_left < rx_taper_right && ry_start < ry_end) {
              epsilon_k
                .get_region([ry_start, rx_taper_left], [ry_end, rx_taper_right])
                .fill(erk);
            }
            if (rx_taper_right < rx_signal_right && ry_start < ry_end) {
              epsilon_k.transform_norm_region(
                [ry_start, rx_taper_right],
                [ry_end, rx_signal_right],
                right_taper_sdf,
              );
            }
          }
        }
        break;
      };
    }

    // create traces
    for (let trace_index = 0; trace_index < trace_regions.length; trace_index++) {
      const trace_region = trace_regions[trace_index];

      const rx_signal_left = x_grid_lines.get_index(trace_region.ix_signal_left);
      const rx_signal_right = x_grid_lines.get_index(trace_region.ix_signal_right);
      const rx_taper_left = x_grid_lines.get_index(trace_region.ix_taper_left);
      const rx_taper_right = x_grid_lines.get_index(trace_region.ix_taper_right);

      const ry_attach = y_grid_lines.get_index(trace_region.iy_attach);
      const ry_surface = y_grid_lines.get_index(trace_region.iy_surface);
      const ry_start = Math.min(ry_attach, ry_surface);
      const ry_end = Math.max(ry_attach, ry_surface);

      const voltage_index = trace_region.voltage_index;
      const [left_taper_sdf, right_taper_sdf] =
        (ry_surface > ry_attach) ?
        [voltage_sdf(sdf_slope_top_right, voltage_index), voltage_sdf(sdf_slope_top_left, voltage_index)] :
        [voltage_sdf(sdf_slope_bottom_right, voltage_index), voltage_sdf(sdf_slope_bottom_left, voltage_index)];

      const v_force = region_grid.v_force_region_view();
      const [Ny, Nx] = v_force.view.shape;

      const gx_taper_left = v_force.x_region_to_grid(rx_taper_left);
      const gx_signal_left = v_force.x_region_to_grid(rx_signal_left);
      const gx_signal_right = v_force.x_region_to_grid(rx_signal_right);
      const gx_taper_right = v_force.x_region_to_grid(rx_taper_right);
      const gy_start = v_force.y_region_to_grid(ry_start);
      const gy_end = v_force.y_region_to_grid(ry_end);

      // allow infinitely flat traces (gy_start == gy_end)
      if (gx_signal_left < gx_taper_left) {
        v_force.transform_norm_grid(
          [gy_start, gx_signal_left],
          [Math.min(gy_end+1,Ny), gx_taper_left],
          left_taper_sdf,
        );
      }
      // also allow for infinite thin traces (gx_taper_left == gx_taper_right)
      if (gx_taper_left <= gx_taper_right) {
        v_force
          .get_grid(
            [gy_start, gx_taper_left],
            [Math.min(gy_end+1,Ny), Math.min(gx_taper_right+1,Nx)],
          )
          .fill((voltage_index << 16) | 0xFFFF);
      }
      if (gx_taper_right < gx_signal_right) {
        v_force.transform_norm_grid(
          [gy_start, gx_taper_right],
          [Math.min(gy_end+1,Ny), Math.min(gx_signal_right+1,Nx)],
          right_taper_sdf,
        );
      }
    }
  }

  for (let i = 0; i < voltage_table.length; i++) {
    region_grid.grid.v_table.set([i], voltage_table[i]);
  }
  if (total_signal_traces >= 2) {
    region_grid.grid.v_input = 2;
  } else {
    region_grid.grid.v_input = 1;
  }
  region_grid.grid.bake();

  return {
    x_grid_lines,
    y_grid_lines,
    traces: trace_regions,
    layers: layer_regions,
    region_grid,
  }
}
