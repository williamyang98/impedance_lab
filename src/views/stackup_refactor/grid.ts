import { type Parameter } from "./stackup.ts";
import { type StackupLayout, type TrapezoidShape, type InfinitePlaneShape } from "./layout.ts";
import { Ndarray } from "../../utility/ndarray.ts";

import {
  GridLines, RegionGrid,
} from "../../engine/grid_2d.ts";
import { calculate_grid_regions, type RegionSpecification } from "../../engine/mesher.ts";

function _get_log_median(dims: number[]): number {
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

interface TrapezoidRegion {
  ix_taper_left: number;
  ix_signal_left: number;
  ix_signal_right: number;
  ix_taper_right: number;
  iy_base: number;
  iy_taper: number;
}

interface InfinitePlaneRegion {
  iy_start: number;
  iy_end: number;
}

interface InfinitePlaneDielectricRegion {
  epsilon: number;
  region: InfinitePlaneRegion;
}

interface SoldermaskDielectricRegion {
  epsilon: number;
  base_region: InfinitePlaneRegion;
  trace_regions: TrapezoidRegion[];
}

type DielectricRegion =
  { type: "plane" } & InfinitePlaneDielectricRegion |
  { type: "soldermask" } & SoldermaskDielectricRegion;

type ConductorRegion =
  { type: "trace", region: TrapezoidRegion, voltage_index: number } |
  { type: "plane", region: InfinitePlaneRegion, voltage_index: number, total_divisions: number };

export interface StackupGrid {
  layout: StackupLayout;
  voltages: number[];
  x_grid_lines: GridLines;
  y_grid_lines: GridLines;
  region_grid: RegionGrid;
}

export function get_stackup_grid_from_stackup_layout(layout: StackupLayout): StackupGrid {
  const x_grid_lines = new GridLines();
  const y_grid_lines = new GridLines();
  const voltages: number[] = [];

  const push_voltage = (voltage: number): number => {
    const epsilon = 1e-3;
    for (let i = 0; i < voltages.length; i++) {
      const other_voltage = voltages[i];
      const delta = Math.abs(other_voltage-voltage);
      if (delta < epsilon) return i;
    }
    const index = voltages.length;
    voltages.push(voltage);
    return index;
  }

  const get_epsilon = (param: Parameter): number => {
    const epsilon = param.value;
    if (epsilon === undefined) {
      param.error = "Dielectric constant must be provided";
      throw Error("Missing epsilon field value");
    }
    return epsilon;
  };

  const get_infinite_plane_region = (shape: InfinitePlaneShape): InfinitePlaneRegion => {
    const { y_start, height } = shape;
    const y_end = y_start+height;
    return {
      iy_start: y_grid_lines.push(y_start),
      iy_end: y_grid_lines.push(y_end),
    };
  };

  const get_trapezoid_region = (shape: TrapezoidShape): TrapezoidRegion => {
    return {
      ix_signal_left: x_grid_lines.push(shape.x_left),
      ix_taper_left: x_grid_lines.push(shape.x_left_taper),
      ix_taper_right: x_grid_lines.push(shape.x_right_taper),
      ix_signal_right: x_grid_lines.push(shape.x_right),
      iy_base: y_grid_lines.push(shape.y_base),
      iy_taper: y_grid_lines.push(shape.y_taper),
    }
  };

  const dielectric_regions: DielectricRegion[] = [];
  const conductor_regions: ConductorRegion[] = [];

  // create dielectric regions
  for (const layer_layout of layout.layers) {
    switch (layer_layout.type) {
      case "unmasked": {
        break;
      }
      case "soldermask": {
        const mask = layer_layout.mask;
        if (mask) {
          const layer = layer_layout.parent;
          const epsilon = get_epsilon(layer.epsilon);
          const base_region = get_infinite_plane_region(mask.surface);
          const trace_regions: TrapezoidRegion[] = mask.traces.map(shape => get_trapezoid_region(shape));
          dielectric_regions.push({
            type: "soldermask",
            base_region,
            trace_regions,
            epsilon,
          });
        }
        break;
      }
      case "core": // @fallthrough
      case "prepreg": {
        const layer = layer_layout.parent;
        const epsilon = get_epsilon(layer.epsilon);
        const region = get_infinite_plane_region(layer_layout.bounding_box);
        dielectric_regions.push({
          type: "plane",
          region,
          epsilon,
        });
        break;
      }
    }
  }

  // create conductor regions
  for (const conductor_layout of layout.conductors) {
    switch (conductor_layout.type) {
      case "trace": {
        const trace = conductor_layout.parent;
        const region = get_trapezoid_region(conductor_layout.shape);
        conductor_regions.push({
          type: "trace",
          region,
          voltage_index: push_voltage(trace.voltage),
        })
        break;
      }
      case "plane": {
        const plane = conductor_layout.parent;
        const total_divisions = plane.grid?.override_total_divisions || 2;
        conductor_regions.push({
          type: "plane",
          region: get_infinite_plane_region(conductor_layout.shape),
          voltage_index: push_voltage(plane.voltage),
          total_divisions,
        })
        break;
      }
    }
  }

  // pad simulation grid to include far field
  const x_min = x_grid_lines.lines.reduce((a,b) => Math.min(a,b), Infinity);
  const x_max = x_grid_lines.lines.reduce((a,b) => Math.max(a,b), -Infinity);
  const y_min = y_grid_lines.lines.reduce((a,b) => Math.min(a,b), Infinity);
  const y_max = y_grid_lines.lines.reduce((a,b) => Math.max(a,b), -Infinity);
  const stackup_width = x_max-x_min;
  const stackup_height = y_max-y_min;
  const padding_size = Math.max(stackup_width, stackup_height);
  x_grid_lines.push(x_min-padding_size);
  x_grid_lines.push(x_max+padding_size);
  // only pad y-axis if copper planes don't exist at the ends
  const y_plane_min = conductor_regions
    .filter(conductor => conductor.type == "plane")
    .map(plane => y_grid_lines.get_line(plane.region.iy_start))
    .reduce((a,b) => Math.min(a,b), Infinity);
  const y_plane_max = conductor_regions
    .filter(conductor => conductor.type == "plane")
    .map(plane => y_grid_lines.get_line(plane.region.iy_end))
    .reduce((a,b) => Math.max(a,b), -Infinity);
  if (y_plane_min > y_min) {
    y_grid_lines.push(y_min-padding_size);
  }
  if (y_plane_max < y_max) {
    y_grid_lines.push(y_max+padding_size);
  }

  // create regions
  const x_region_sizes = x_grid_lines.to_regions();
  const y_region_sizes = y_grid_lines.to_regions();
  const x_max_ratio = 0.7;
  const y_max_ratio = 0.7;
  const x_min_subdivisions = 5;
  const y_min_subdivisions = 5;

  const x_region_specs: RegionSpecification[] = x_region_sizes.map(size => { return { size }; });
  const y_region_specs: RegionSpecification[] = y_region_sizes.map(size => { return { size }; });

  // NOTE: copper planes don't need to be divided fancily to avoid numerical errors
  //       just used a fixed number of divisions since it gives the same result and is faster to compute
  for (const plane of conductor_regions.filter(conductor => conductor.type == "plane")) {
    const { region, total_divisions } = plane;
    const ry_start = y_grid_lines.get_index(region.iy_start);
    const ry_end = y_grid_lines.get_index(region.iy_end);
    for (let i = ry_start; i < ry_end; i++) {
      y_region_specs[i].total_grid_lines = total_divisions;
    }
  }

  // create region grid
  const x_region_grids = calculate_grid_regions(x_region_specs, x_min_subdivisions, x_max_ratio);
  const y_region_grids = calculate_grid_regions(y_region_specs, y_min_subdivisions, y_max_ratio);
  const region_grid = new RegionGrid(x_region_grids, y_region_grids);

  // fill dielectric regions
  const er0 = 1.0; // dielectric of vacuum
  region_grid.grid.epsilon_k.fill(er0);

  const fill_dielectric_plane = (region: InfinitePlaneRegion, epsilon: number) => {
    const ry_start = y_grid_lines.get_index(region.iy_start);
    const ry_end = y_grid_lines.get_index(region.iy_end);
    const rx_start = 0;
    const rx_end = x_region_grids.length;
    const epsilon_k = region_grid.epsilon_k_region_view();
    if (ry_start < ry_end) {
      epsilon_k
        .get_region(
            [ry_start,rx_start],
            [ry_end,rx_end],
        )
        .fill(epsilon);
    }
  };

  const fill_dielectric_trapezoid = (region: TrapezoidRegion, epsilon: number) => {
    const rx_signal_left = x_grid_lines.get_index(region.ix_signal_left);
    const rx_signal_right = x_grid_lines.get_index(region.ix_signal_right);
    const rx_taper_left = x_grid_lines.get_index(region.ix_taper_left);
    const rx_taper_right = x_grid_lines.get_index(region.ix_taper_right);

    const ry_base = y_grid_lines.get_index(region.iy_base);
    const ry_taper = y_grid_lines.get_index(region.iy_taper);
    const ry_start = Math.min(ry_base, ry_taper);
    const ry_end = Math.max(ry_base, ry_taper);

    const epsilon_k = region_grid.epsilon_k_region_view();
    if (rx_signal_left < rx_taper_left && ry_start < ry_end) {
      const left_taper_sdf =
        (ry_taper > ry_base) ?
        epsilon_sdf(sdf_slope_top_right, er0, epsilon) :
        epsilon_sdf(sdf_slope_bottom_right, er0, epsilon);
      epsilon_k.transform_norm_region(
        [ry_start, rx_signal_left],
        [ry_end, rx_taper_left],
        left_taper_sdf,
      );
    }
    if (rx_taper_left < rx_taper_right && ry_start < ry_end) {
      epsilon_k
        .get_region([ry_start, rx_taper_left], [ry_end, rx_taper_right])
        .fill(epsilon);
    }
    if (rx_taper_right < rx_signal_right && ry_start < ry_end) {
      const right_taper_sdf =
        (ry_taper > ry_base) ?
        epsilon_sdf(sdf_slope_top_left, er0, epsilon) :
        epsilon_sdf(sdf_slope_bottom_left, er0, epsilon);
      epsilon_k.transform_norm_region(
        [ry_start, rx_taper_right],
        [ry_end, rx_signal_right],
        right_taper_sdf,
      );
    }
  };

  for (const dielectric_region of dielectric_regions) {
    switch (dielectric_region.type) {
      case "plane": {
        const { region, epsilon } = dielectric_region;
        fill_dielectric_plane(region, epsilon);
        break;
      };
      case "soldermask": {
        const { base_region, trace_regions, epsilon} = dielectric_region;
        fill_dielectric_plane(base_region, epsilon);
        for (const region of trace_regions) {
          fill_dielectric_trapezoid(region, epsilon);
        }
        break;
      };
    }
  }

  // fill voltage regions
  const fill_voltage_plane = (region: InfinitePlaneRegion, voltage_index: number) => {
    const ry_start = y_grid_lines.get_index(region.iy_start);
    const ry_end = y_grid_lines.get_index(region.iy_end);
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
  };

  const fill_voltage_trapezoid = (region: TrapezoidRegion, voltage_index: number) => {
    const rx_signal_left = x_grid_lines.get_index(region.ix_signal_left);
    const rx_signal_right = x_grid_lines.get_index(region.ix_signal_right);
    const rx_taper_left = x_grid_lines.get_index(region.ix_taper_left);
    const rx_taper_right = x_grid_lines.get_index(region.ix_taper_right);

    const ry_base = y_grid_lines.get_index(region.iy_base);
    const ry_taper = y_grid_lines.get_index(region.iy_taper);
    const ry_start = Math.min(ry_base, ry_taper);
    const ry_end = Math.max(ry_base, ry_taper);

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
      const left_taper_sdf =
        (ry_taper > ry_base) ?
        voltage_sdf(sdf_slope_top_right, voltage_index) :
        voltage_sdf(sdf_slope_bottom_right, voltage_index);
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
      const right_taper_sdf =
        (ry_taper > ry_base) ?
        voltage_sdf(sdf_slope_top_left, voltage_index) :
        voltage_sdf(sdf_slope_bottom_left, voltage_index);
      v_force.transform_norm_grid(
        [gy_start, gx_taper_right],
        [Math.min(gy_end+1,Ny), Math.min(gx_signal_right+1,Nx)],
        right_taper_sdf,
      );
    }
  };

  for (const conductor of conductor_regions) {
    switch (conductor.type) {
      case "plane": {
        fill_voltage_plane(conductor.region, conductor.voltage_index);
        break;
      }
      case "trace": {
        fill_voltage_trapezoid(conductor.region, conductor.voltage_index);
        break;
      }
    }
  }

  // setup voltage lookup table
  const grid = region_grid.grid;
  if (voltages.length > 0) {
    const voltage_min = voltages.reduce((a,b) => Math.min(a,b), Infinity);
    const voltage_max = voltages.reduce((a,b) => Math.max(a,b), -Infinity);
    const voltage_delta = voltage_max-voltage_min;
    grid.v_input = voltage_delta;
    grid.v_table = Ndarray.create_zeros([voltages.length], "f32");
    for (let i = 0; i < voltages.length; i++) {
      grid.v_table.set([i], voltages[i]);
    }
  } else {
    grid.v_input = 0;
  }
  grid.bake();

  return {
    layout,
    voltages,
    x_grid_lines,
    y_grid_lines,
    region_grid,
  }
}
