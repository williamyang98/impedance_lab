import {
  GridLines, RegionGrid, normalise_regions,
  get_voltage_transform,
  sdf_slope_bottom_left,
  sdf_slope_bottom_right,
  // sdf_slope_top_left,
  // sdf_slope_top_right,
} from "./grid_2d.ts";

import { calculate_grid_regions } from "./mesher.ts";

interface Trace {
  ix_taper_left: number;
  ix_signal_left: number;
  ix_signal_right: number;
  ix_taper_right: number;
}

interface Layer {
  iy_start: number;
  iy_end: number;
}

const voltage_slope_bottom_left = (voltage_index: number) => get_voltage_transform(sdf_slope_bottom_left, voltage_index);
const voltage_slope_bottom_right = (voltage_index: number) => get_voltage_transform(sdf_slope_bottom_right, voltage_index);

class TransmissionLineLayout {
  x_grid_lines = new GridLines();
  y_grid_lines = new GridLines();
  x_location: number = 0;
  y_location: number = 0;
  x_tolerance: number = 1e-6;
  y_tolerance: number = 1e-6;
  traces: Trace[] = [];
  layers: Layer[] = [];
  region_grid?: RegionGrid = undefined;

  push_symmetric_trace(width: number, taper: number): Trace {
    return this.push_asymmetric_trace(width, taper, taper);
  }

  push_asymmetric_trace(width: number, left_taper: number, right_taper: number): Trace {
    const x_left = this.x_location;
    this.x_location += width;
    const x_right = this.x_location;

    const ix_taper_left = this.x_grid_lines.push(x_left, this.x_tolerance);
    const ix_taper_right = this.x_grid_lines.push(x_right, this.x_tolerance);
    const ix_signal_left = this.x_grid_lines.push(x_left+left_taper, this.x_tolerance);
    const ix_signal_right = this.x_grid_lines.push(x_right-right_taper, this.x_tolerance);

    const trace = {
      ix_taper_left,
      ix_taper_right,
      ix_signal_left,
      ix_signal_right,
    };
    this.traces.push(trace);
    return trace;
  }

  push_horizontal_separation(width: number) {
    this.x_grid_lines.push(this.x_location, this.x_tolerance);
    this.x_location += width;
    this.x_grid_lines.push(this.x_location, this.x_tolerance);
  }

  push_layer(height: number): Layer {
    const y_start = this.y_location;
    this.y_location += height;
    const y_end = this.y_location;

    const iy_start = this.y_grid_lines.push(y_start, this.y_tolerance);
    const iy_end = this.y_grid_lines.push(y_end, this.y_tolerance);
    const layer = {
      iy_start,
      iy_end,
    };
    this.layers.push(layer);
    return layer;
  }

  create_grid(): RegionGrid {
    if (this.region_grid !== undefined) {
      throw Error(`Tried to reinitialise region grid again`);
    }
    const x_regions = this.x_grid_lines.to_regions();
    const y_regions = this.y_grid_lines.to_regions();
    normalise_regions(x_regions, y_regions);

    const x_min_subdivisions = 10;
    const y_min_subdivisions = 10;
    const x_max_ratio = 0.5;
    const y_max_ratio = 0.5;
    const x_region_grids = calculate_grid_regions(x_regions, x_min_subdivisions, x_max_ratio);
    const y_region_grids = calculate_grid_regions(y_regions, y_min_subdivisions, y_max_ratio);

    // TODO: figure out a better place to set this up
    //       also avoid having to hack this by overriding the number of splines
    const bottom_layer = y_region_grids[0];
    const top_layer = y_region_grids[y_region_grids.length-1];
    if (bottom_layer.type == "symmetric") { bottom_layer.grid.n = 3; }
    if (top_layer.type == "symmetric") { top_layer.grid.n = 3; }

    const region_grid = new RegionGrid(x_region_grids, y_region_grids);
    this.region_grid = region_grid;
    region_grid.grid.epsilon_k.fill(1);
    return region_grid;
  }

  set_trace_voltage(trace: Trace, layer: Layer, voltage_index: number) {
    if (this.region_grid === undefined) {
      throw Error(`Did not create region grid`);
    }

    const rx_signal_left = this.x_grid_lines.get_index(trace.ix_signal_left);
    const rx_taper_left = this.x_grid_lines.get_index(trace.ix_taper_left);
    const rx_taper_right = this.x_grid_lines.get_index(trace.ix_taper_right);
    const rx_signal_right = this.x_grid_lines.get_index(trace.ix_signal_right);
    const ry_start = this.y_grid_lines.get_index(layer.iy_start);
    const ry_end = this.y_grid_lines.get_index(layer.iy_end);

    const v_force = this.region_grid.v_force_region_view();
    const [Ny, Nx] = v_force.view.shape;

    const gx_taper_left = v_force.x_region_to_grid(rx_taper_left);
    const gx_signal_left = v_force.x_region_to_grid(rx_signal_left);
    const gx_signal_right = v_force.x_region_to_grid(rx_signal_right);
    const gx_taper_right = v_force.x_region_to_grid(rx_taper_right);
    const gy_start = v_force.y_region_to_grid(ry_start);
    const gy_end = v_force.y_region_to_grid(ry_end);

    // expand voltage field to include the next index so voltage along boundary of conductor is met
    // also allow infinitely flat traces (gy_start == gy_end)
    if (gx_taper_left < gx_signal_left) {
      v_force.transform_norm_grid(
        [gy_start, gx_taper_left],
        [Math.min(gy_end+1,Ny), gx_signal_left],
        voltage_slope_bottom_right(voltage_index),
      );
    }
    if (rx_signal_left < rx_signal_right) {
      v_force
        .get_grid(
          [gy_start, gx_signal_left],
          [Math.min(gy_end+1,Ny), Math.min(gx_signal_right+1,Nx)],
        )
        .fill((voltage_index << 16) | 0xFFFF);
    }
    if (rx_signal_right < rx_taper_right) {
      v_force.transform_norm_grid(
        [gy_start,gx_signal_right],
        [Math.min(gy_end+1,Ny), Math.min(gx_taper_right+1,Nx)],
        voltage_slope_bottom_left(voltage_index),
      );
    }
  }

  set_layer_voltage(layer: Layer, voltage_index: number) {
    if (this.region_grid === undefined) {
      throw Error(`Did not create region grid`);
    }
    const ry_start = this.y_grid_lines.get_index(layer.iy_start);
    const ry_end = this.y_grid_lines.get_index(layer.iy_end);
    const rx_start = 0;
    const rx_end = this.region_grid.x_regions.length;

    const v_force = this.region_grid.v_force_region_view();
    const [Ny, Nx] = v_force.view.shape;

    const gx_start = v_force.x_region_to_grid(rx_start);
    const gx_end = v_force.x_region_to_grid(rx_end);
    const gy_start = v_force.y_region_to_grid(ry_start);
    const gy_end = v_force.y_region_to_grid(ry_end);

    // expand voltage field to include the next index so voltage along boundary of conductor is met
    // also allow infinitely flat traces (gy_start == gy_end)
    if (rx_start < rx_end) {
      v_force
        .get_grid(
          [gy_start, gx_start],
          [Math.min(gy_end+1,Ny), Math.min(gx_end+1,Nx)],
        )
        .fill((voltage_index << 16) | 0xFFFF);
    }
  }

  fill_dielectric(layer: Layer, ek: number) {
    if (this.region_grid === undefined) {
      throw Error(`Did not create region grid`);
    }

    const ry_start = this.y_grid_lines.get_index(layer.iy_start);
    const ry_end = this.y_grid_lines.get_index(layer.iy_end);
    const rx_start = 0;
    const rx_end = this.region_grid.x_regions.length;
    const epsilon_k = this.region_grid.epsilon_k_region_view();
    if (ry_start < ry_end) {
      epsilon_k.get_region([ry_start,rx_start],[ry_end,rx_end]).fill(ek);
    }
  }
}


export type ValidationErrorType = "success" | "warn" | "error";
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
}

export interface SearchConfig {
  min_value: number;
  max_value?: number;
  positive_correlation: boolean; // does it correlate to impedance
}

export interface Parameter {
  name: string;
  value?: number;
  error?: ValidationError;
  search_config: SearchConfig;
}

export interface TransmissionLineSetup {
  get_parameters(): Parameter[];
  create_region_grid(): RegionGrid | null;
}

export class SingleEndedMicrostrip implements TransmissionLineSetup {
  signal_width: Parameter;
  trace_taper: Parameter;
  trace_height: Parameter;
  plane_height: Parameter;
  plane_epsilon: Parameter;

  constructor() {
    function make_param(name: string, min_value: number, positive_correlation: boolean): Parameter {
      return {
        name,
        search_config: { min_value, positive_correlation},
      };
    }
    this.signal_width = make_param("Trace width", 0, false);
    this.trace_taper = make_param("Trace taper", 0, true);
    this.trace_height = make_param("Trace height", 0, false);
    this.plane_height = make_param("Plane height", 0, true);
    this.plane_epsilon = make_param("Plane epsilon", 1, false);
  }

  get_parameters(): Parameter[] {
    return [
      this.signal_width,
      this.trace_taper,
      this.trace_height,
      this.plane_height,
      this.plane_epsilon,
    ]
  }

  validate(): boolean {
    if (this.signal_width.value === undefined) return false;
    if (this.trace_taper.value === undefined) return false;
    if (this.trace_height.value === undefined) return false;
    if (this.plane_height.value === undefined) return false;
    if (this.plane_epsilon.value === undefined) return false;
    return true;
  }

  create_region_grid(): RegionGrid | null {
    if (!this.validate()) {
      return null;
    }

    const signal_width = this.signal_width.value!;
    const trace_taper = this.trace_taper.value!;
    const trace_height = this.trace_height.value!;
    const plane_height = this.plane_height.value!;
    const plane_epsilon = this.plane_epsilon.value!;

    const layout = new TransmissionLineLayout();
    const tolerance_alpha = 0.9;
    layout.x_tolerance = [signal_width, trace_taper/2, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;
    layout.y_tolerance = [trace_height, plane_height, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;

    const padding_width = signal_width*20;
    layout.push_horizontal_separation(padding_width);
    const trace_signal = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(padding_width);

    const padding_height = plane_height;
    const layer_bottom = layout.push_layer(padding_height);
    const layer_1a = layout.push_layer(plane_height);
    const layer_trace = layout.push_layer(trace_height);
    const layer_1b = layout.push_layer(plane_height);
    const layer_top = layout.push_layer(padding_height);

    const region_grid = layout.create_grid();

    // forcing potentials
    region_grid.grid.v_table.set([0], 0);
    region_grid.grid.v_table.set([1], 1);
    region_grid.grid.v_input = 1;
    layout.set_layer_voltage(layer_bottom, 0);
    layout.set_layer_voltage(layer_top, 0);
    layout.set_trace_voltage(trace_signal, layer_trace, 1);
    // dielectric
    layout.fill_dielectric(layer_1a, plane_epsilon);
    layout.fill_dielectric(layer_trace, plane_epsilon);
    layout.fill_dielectric(layer_1b, plane_epsilon);
    return region_grid;
  }
}

export class DifferentialMicrostrip implements TransmissionLineSetup {
  signal_width: Parameter;
  signal_separation: Parameter;
  trace_taper: Parameter;
  trace_height: Parameter;
  plane_height_bottom: Parameter;
  plane_height_top: Parameter;
  plane_epsilon_bottom: Parameter;
  plane_epsilon_top: Parameter;

  constructor() {
    function make_param(name: string, min_value: number, positive_correlation: boolean): Parameter {
      return {
        name,
        search_config: { min_value, positive_correlation},
      };
    }
    this.signal_width = make_param("Trace width", 0, false);
    this.signal_separation = make_param("Trace separation", 0, true);
    this.trace_taper = make_param("Trace taper", 0, true);
    this.trace_height = make_param("Trace height", 0, false);
    this.plane_height_bottom = make_param("Plane height 1", 0, true);
    this.plane_height_top = make_param("Plane height 2", 0, true);
    this.plane_epsilon_bottom = make_param("Plane epsilon 1", 1, false);
    this.plane_epsilon_top = make_param("Plane epsilon 2", 1, false);
  }

  get_parameters(): Parameter[] {
    return [
      this.signal_width,
      this.signal_separation,
      this.trace_taper,
      this.trace_height,
      this.plane_height_bottom,
      this.plane_height_top,
      this.plane_epsilon_bottom,
      this.plane_epsilon_top,
    ]
  }

  validate(): boolean {
    if (this.signal_width.value === undefined) return false;
    if (this.signal_separation.value === undefined) return false;
    if (this.trace_taper.value === undefined) return false;
    if (this.trace_height.value === undefined) return false;
    if (this.plane_height_bottom.value === undefined) return false;
    if (this.plane_height_top.value === undefined) return false;
    if (this.plane_epsilon_bottom.value === undefined) return false;
    if (this.plane_epsilon_top.value === undefined) return false;
    return true;
  }

  create_region_grid(): RegionGrid | null {
    if (!this.validate()) {
      return null;
    }

    const signal_width = this.signal_width.value!;
    const signal_separation = this.signal_separation.value!;
    const trace_taper = this.trace_taper.value!;
    const trace_height = this.trace_height.value!;
    const plane_height_bottom = this.plane_height_bottom.value!;
    const plane_height_top = this.plane_height_top.value!;
    const plane_epsilon_bottom = this.plane_epsilon_bottom.value!;
    const plane_epsilon_top = this.plane_epsilon_top.value!;

    const layout = new TransmissionLineLayout();
    const tolerance_alpha = 0.9;
    layout.x_tolerance = [signal_width, signal_separation, trace_taper/2, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;
    layout.y_tolerance = [trace_height, plane_height_bottom, plane_height_top, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;

    const padding_width_factor = 10;
    const padding_width = [signal_width, signal_separation]
      .reduce((a,b) => Math.max(a,b), 0)
      *padding_width_factor;
    layout.push_horizontal_separation(padding_width);
    const trace_left = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(signal_separation);
    const trace_right = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(padding_width);

    const padding_height = [plane_height_bottom, plane_height_top].reduce((a,b) => Math.min(a,b), Infinity)*2;
    const layer_bottom = layout.push_layer(padding_height);
    const layer_1a = layout.push_layer(plane_height_bottom);
    const layer_trace = layout.push_layer(trace_height);
    const layer_1b = layout.push_layer(plane_height_top);
    const layer_top = layout.push_layer(padding_height);

    const region_grid = layout.create_grid();

    // forcing potentials
    region_grid.grid.v_table.set([0], 0);
    region_grid.grid.v_table.set([1], 1);
    region_grid.grid.v_table.set([2], -1);
    region_grid.grid.v_input = 2;
    layout.set_layer_voltage(layer_bottom, 0);
    layout.set_layer_voltage(layer_top, 0);
    layout.set_trace_voltage(trace_left, layer_trace, 1);
    layout.set_trace_voltage(trace_right, layer_trace, 2);
    // dielectric
    layout.fill_dielectric(layer_1a, plane_epsilon_bottom);
    layout.fill_dielectric(layer_trace, plane_epsilon_top);
    layout.fill_dielectric(layer_1b, plane_epsilon_top);
    return region_grid;
  }
}


export class DifferentialCoplanarCompositeMicrostrip implements TransmissionLineSetup {
  signal_separation: Parameter;
  signal_width: Parameter;
  coplanar_separation: Parameter;
  coplanar_width: Parameter;
  trace_taper: Parameter;
  trace_height: Parameter;
  plane_height_1a: Parameter;
  plane_height_1b: Parameter;
  plane_height_2a: Parameter;
  plane_height_2b: Parameter;
  plane_epsilon_1a: Parameter;
  plane_epsilon_1b: Parameter;
  plane_epsilon_2a: Parameter;
  plane_epsilon_2b: Parameter;

  constructor() {
    function make_param(name: string, min_value: number, positive_correlation: boolean): Parameter {
      return {
        name,
        search_config: { min_value, positive_correlation},
      };
    }
    this.signal_separation = make_param("Signal separation", 0, true);
    this.signal_width = make_param("Signal width", 0, false);
    this.coplanar_width = make_param("Coplanar width", 0, false);
    this.coplanar_separation = make_param("Coplanar separation", 0, true);
    this.trace_taper = make_param("Trace taper",  0, true);
    this.trace_height = make_param("Trace height", 0, false);
    this.plane_height_1a = make_param("Plane height 1a", 0, true);
    this.plane_height_1b = make_param("Plane height 1b", 0, true);
    this.plane_height_2a = make_param("Plane height 2a", 0, true);
    this.plane_height_2b = make_param("Plane height 2b", 0, true);
    this.plane_epsilon_1a = make_param("Plane epsilon 1a", 1, false);
    this.plane_epsilon_1b = make_param("Plane epsilon 1b", 1, false);
    this.plane_epsilon_2a = make_param("Plane epsilon 2a", 1, false);
    this.plane_epsilon_2b = make_param("Plane epsilon 2b", 1, false);
  }

  get_parameters(): Parameter[] {
    return [
      this.signal_separation,
      this.signal_width,
      this.coplanar_separation,
      this.coplanar_width,
      this.trace_taper,
      this.trace_height,
      this.plane_height_1a,
      this.plane_height_1b,
      this.plane_height_2a,
      this.plane_height_2b,
      this.plane_epsilon_1a,
      this.plane_epsilon_1b,
      this.plane_epsilon_2a,
      this.plane_epsilon_2b,
    ];
  }

  validate(): boolean {
    if (this.signal_width.value === undefined) return false;
    if (this.signal_separation.value === undefined) return false;
    if (this.coplanar_separation.value === undefined) return false;
    if (this.coplanar_width.value === undefined) return false;
    if (this.trace_taper.value === undefined) return false;
    if (this.trace_height.value === undefined) return false;
    if (this.plane_height_1a.value === undefined) return false;
    if (this.plane_height_1b.value === undefined) return false;
    if (this.plane_height_2a.value === undefined) return false;
    if (this.plane_height_2b.value === undefined) return false;
    if (this.plane_epsilon_1a.value === undefined) return false;
    if (this.plane_epsilon_1b.value === undefined) return false;
    if (this.plane_epsilon_2a.value === undefined) return false;
    if (this.plane_epsilon_2b.value === undefined) return false;
    return true;
  }

  create_region_grid(): RegionGrid | null {
    if (!this.validate()) {
      return null;
    }

    const signal_width = this.signal_width.value!;
    const signal_separation = this.signal_separation.value!;
    const coplanar_separation = this.coplanar_separation.value!;
    const coplanar_width = this.coplanar_width.value!;
    const trace_taper = this.trace_taper.value!;
    const trace_height = this.trace_height.value!;
    const plane_height_1a = this.plane_height_1a.value!;
    const plane_height_1b = this.plane_height_1b.value!;
    const plane_height_2a = this.plane_height_2a.value!;
    const plane_height_2b = this.plane_height_2b.value!;
    const plane_epsilon_1a = this.plane_epsilon_1a.value!;
    const plane_epsilon_1b = this.plane_epsilon_1b.value!;
    const plane_epsilon_2a = this.plane_epsilon_2a.value!;
    const plane_epsilon_2b = this.plane_epsilon_2b.value!;

    const layout = new TransmissionLineLayout();
    const tolerance_alpha = 0.9;
    layout.x_tolerance = [signal_width, coplanar_separation, coplanar_width, signal_separation, trace_taper/2, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;
    layout.y_tolerance = [trace_height, plane_height_1a, plane_height_1b, plane_height_2a, plane_height_2b, 1e-6]
      .filter(a => a > 0)
      .reduce((a,b) => Math.min(a,b), Infinity)
      *tolerance_alpha;

    const trace_coplanar_left = layout.push_asymmetric_trace(coplanar_width, 0, trace_taper/2);
    layout.push_horizontal_separation(coplanar_separation);
    const trace_signal_left = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(signal_separation);
    const trace_signal_right = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(coplanar_separation);
    const trace_coplanar_right = layout.push_asymmetric_trace(coplanar_width, trace_taper/2, 0);

    // create y grid lines
    const layer_bottom = layout.push_layer(0.1);
    const layer_1a = layout.push_layer(plane_height_1a);
    const layer_1b = layout.push_layer(plane_height_1b);
    const layer_trace = layout.push_layer(trace_height);
    const layer_2a = layout.push_layer(plane_height_2a);
    const layer_2b = layout.push_layer(plane_height_2b);
    const layer_top = layout.push_layer(0.1);

    const region_grid = layout.create_grid();

    // forcing potentials
    region_grid.grid.v_table.set([0], 0);
    region_grid.grid.v_table.set([1], 1);
    region_grid.grid.v_table.set([2], -1);
    region_grid.grid.v_input = 2;
    layout.set_layer_voltage(layer_bottom, 0);
    layout.set_layer_voltage(layer_top, 0);
    layout.set_trace_voltage(trace_coplanar_left, layer_trace, 0);
    layout.set_trace_voltage(trace_coplanar_right, layer_trace, 0);
    layout.set_trace_voltage(trace_signal_left, layer_trace, 1);
    layout.set_trace_voltage(trace_signal_right, layer_trace, 2);
    // dielectric
    layout.fill_dielectric(layer_1a, plane_epsilon_1a);
    layout.fill_dielectric(layer_1b, plane_epsilon_1b);
    layout.fill_dielectric(layer_trace, plane_epsilon_2a);
    layout.fill_dielectric(layer_2a, plane_epsilon_2a);
    layout.fill_dielectric(layer_2b, plane_epsilon_2b);
    return region_grid;
  }
}
