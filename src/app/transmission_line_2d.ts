import {
  GridLines, RegionGrid, normalise_regions,
  get_voltage_transform,
  sdf_slope_bottom_left,
  sdf_slope_bottom_right,
  // sdf_slope_top_left,
  // sdf_slope_top_right,
} from "../engine/grid_2d.ts";

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

    const ix_taper_left = this.x_grid_lines.push(x_left);
    const ix_taper_right = this.x_grid_lines.push(x_right);
    const ix_signal_left = this.x_grid_lines.push(x_left+left_taper);
    const ix_signal_right = this.x_grid_lines.push(x_right-right_taper);

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
    this.x_grid_lines.push(this.x_location);
    this.x_location += width;
    this.x_grid_lines.push(this.x_location);
  }

  push_layer(height: number): Layer {
    const y_start = this.y_location;
    this.y_location += height;
    const y_end = this.y_location;

    const iy_start = this.y_grid_lines.push(y_start);
    const iy_end = this.y_grid_lines.push(y_end);
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
    const region_grid = new RegionGrid({
      x_regions,
      y_regions,
      x_min_subdivisions: 10,
      y_min_subdivisions: 10,
    });
    this.region_grid = region_grid;
    region_grid.grid.epsilon_k.fill(1);
    return region_grid;
  }

  set_trace_voltage(trace: Trace, layer: Layer, voltage_index: number) {
    if (this.region_grid === undefined) {
      throw Error(`Did not create region grid`);
    }
    // add 1 to region indices to account for padding
    const rx_signal_left = this.x_grid_lines.get_index(trace.ix_signal_left);
    const rx_taper_left = this.x_grid_lines.get_index(trace.ix_taper_left);
    const rx_taper_right = this.x_grid_lines.get_index(trace.ix_taper_right);
    const rx_signal_right = this.x_grid_lines.get_index(trace.ix_signal_right);
    const ry_start = this.y_grid_lines.get_index(layer.iy_start);
    const ry_end = this.y_grid_lines.get_index(layer.iy_end);

    const v_force = this.region_grid.v_force_region_view();
    if (rx_taper_left < rx_signal_left) {
      v_force.transform_norm_region(
        [ry_start,rx_taper_left], [ry_end,rx_signal_left],
        voltage_slope_bottom_right(voltage_index),
      );
    }
    if (rx_signal_left < rx_signal_right) {
      v_force
        .get_region([ry_start,rx_signal_left], [ry_end,rx_signal_right])
        .fill((voltage_index << 16) | 0xFFFF);
    }
    if (rx_signal_right < rx_taper_right) {
      v_force.transform_norm_region(
        [ry_start,rx_signal_right], [ry_end,rx_taper_right],
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
    v_force
      .get_region([ry_start,rx_start], [ry_end,rx_end])
      .fill((voltage_index << 16) | 0xFFFF);
  }

  fill_dielectric(layer: Layer, ek: number) {
    if (this.region_grid === undefined) {
      throw Error(`Did not create region grid`);
    }

    // add 1 to region indices to account for padding
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
    layout.push_horizontal_separation(1);
    const trace_left = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(signal_separation);
    const trace_right = layout.push_symmetric_trace(signal_width, trace_taper/2);
    layout.push_horizontal_separation(1);

    const layer_bottom = layout.push_layer(0.1);
    const layer_1a = layout.push_layer(plane_height_bottom);
    const layer_trace = layout.push_layer(trace_height);
    const layer_1b = layout.push_layer(plane_height_top);
    const layer_top = layout.push_layer(0.1);

    const region_grid = layout.create_grid();

    // forcing potentials
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
