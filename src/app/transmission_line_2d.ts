import {
  RegionGrid, normalise_regions,
  get_voltage_transform,
  sdf_slope_bottom_left,
  sdf_slope_bottom_right,
  // sdf_slope_top_left,
  // sdf_slope_top_right,
} from "../engine/grid_2d.ts";

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

const voltage_slope_bottom_left = (voltage_index: number) => get_voltage_transform(sdf_slope_bottom_left, voltage_index);
const voltage_slope_bottom_right = (voltage_index: number) => get_voltage_transform(sdf_slope_bottom_right, voltage_index);

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

    let x_regions: number[] = [];
    const has_taper = trace_taper > 0.0;
    if (has_taper) {
      x_regions = [
        trace_taper/2, signal_width-trace_taper, trace_taper/2,
        signal_separation,
        trace_taper/2, signal_width-trace_taper, trace_taper/2,
      ];
    } else {
      x_regions = [signal_width, signal_separation, signal_width];
    }
    const y_regions = [plane_height_bottom, trace_height, plane_height_top];
    normalise_regions(x_regions, y_regions);
    const region_grid = new RegionGrid({
      x_regions,
      y_regions,
      y_pad_height: 2,
      x_min_subdivisions: 10,
      y_min_subdivisions: 10,
    });

    const Nx = region_grid.x_regions.length;
    const Ny = region_grid.y_regions.length;

    const v_force = region_grid.v_force_region_view();
    const epsilon_k = region_grid.epsilon_k_region_view();

    function create_trace(x_start: number, voltage_index: number, mask?: number): number {
      mask = mask ?? 0b111;
      let x_offset = x_start;
      const y_offset = 2;
      if ((mask & 0b100) == 0b100) {
        v_force.transform_norm_region([y_offset,x_offset], [y_offset+1,x_offset+1], voltage_slope_bottom_right(voltage_index));
        x_offset++;
      }
      if ((mask & 0b010) == 0b010) {
        v_force.get_region([y_offset,x_offset], [y_offset+1,x_offset+1]).fill((voltage_index << 16) | 0xFFFF);
        x_offset++;
      }
      if ((mask & 0b001) == 0b001) {
        v_force.transform_norm_region([y_offset,x_offset], [y_offset+1,x_offset+1], voltage_slope_bottom_left(voltage_index));
        x_offset++;
      }
      return x_offset-x_start;
    }

    // ground planes
    v_force.get_region([0,0],[1,Nx]).fill((0<<16) | 0xFFFF);
    v_force.get_region([Ny-1,0],[Ny,Nx]).fill((0<<16) | 0xFFFF);
    let x_offset = 1;
    x_offset += create_trace(x_offset, 1, has_taper ? 0b111 : 0b010); // positive trace
    x_offset++; // signal separation
    x_offset += create_trace(x_offset, 2, has_taper ? 0b111 : 0b010); // negative trace
    void x_offset;
    // dielectric
    epsilon_k.get_region([1,0],[2,Nx]).fill(plane_epsilon_bottom);
    epsilon_k.get_region([Ny-1,0],[Ny,Nx]).fill(plane_epsilon_top);
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

    const has_taper = trace_taper > 0.0;

    let x_regions: number[] = [];
    if (has_taper) {
      x_regions = [
        coplanar_width-trace_taper, trace_taper/2,
        coplanar_separation,
        trace_taper/2, signal_width-trace_taper, trace_taper/2,
        signal_separation,
        trace_taper/2, signal_width-trace_taper, trace_taper/2,
        coplanar_separation,
        trace_taper/2, coplanar_width-trace_taper,
      ];
    } else {
      x_regions = [
        coplanar_width, coplanar_separation,
        signal_width, signal_separation, signal_width,
        coplanar_separation, coplanar_width,
      ];
    }

    const y_regions = [
      plane_height_1a,
      plane_height_1b,
      trace_height,
      plane_height_2a,
      plane_height_2b,
    ];
    normalise_regions(x_regions, y_regions);
    const taper_ratio = trace_taper/Math.max(coplanar_width, signal_width);
    const x_min_subdivisions = ((taper_ratio > 0.1) || !has_taper) ? 10 : 5;
    const region_grid = new RegionGrid({
      x_regions,
      y_regions,
      y_pad_height: 2,
      x_min_subdivisions,
      y_min_subdivisions: 10,
    });

    const Nx = region_grid.x_regions.length;
    const Ny = region_grid.y_regions.length;

    const v_force = region_grid.v_force_region_view();
    const epsilon_k = region_grid.epsilon_k_region_view();

    function create_trace(x_start: number, voltage_index: number, mask?: number): number {
      mask = mask ?? 0b111;
      const y_offset = 3;
      let x_offset = x_start;
      if ((mask & 0b100) == 0b100) {
        v_force.transform_norm_region([y_offset,x_offset], [y_offset+1,x_offset+1], voltage_slope_bottom_right(voltage_index));
        x_offset++;
      }
      if ((mask & 0b010) == 0b010) {
        v_force.get_region([y_offset,x_offset], [y_offset+1,x_offset+1]).fill((voltage_index << 16) | 0xFFFF);
        x_offset++;
      }
      if ((mask & 0b001) == 0b001) {
        v_force.transform_norm_region([y_offset,x_offset], [y_offset+1,x_offset+1], voltage_slope_bottom_left(voltage_index));
        x_offset++;
      }
      return x_offset-x_start;
    }

    // ground planes
    v_force.get_region([0,0],[1,Nx]).fill((0<<16) | 0xFFFF);
    v_force.get_region([Ny-1,0],[Ny,Nx]).fill((0<<16) | 0xFFFF);
    let x_offset = 1;
    x_offset += create_trace(x_offset, 0, has_taper ? 0b011 : 0b010); // coplanar trace left
    x_offset++; // coplanar separation
    x_offset += create_trace(x_offset, 1, has_taper ? 0b111 : 0b010); // positive trace
    x_offset++; // signal separation
    x_offset += create_trace(x_offset, 2, has_taper ? 0b111 : 0b010); // negative trace
    x_offset++; // coplanar separation
    x_offset += create_trace(x_offset, 0, has_taper ? 0b110: 0b010); // coplanar trace right
    void x_offset;
    // dielectric
    epsilon_k.get_region([1,0],[2,Nx]).fill(plane_epsilon_1a);
    epsilon_k.get_region([2,0],[3,Nx]).fill(plane_epsilon_1b);
    epsilon_k.get_region([3,0],[5,Nx]).fill(plane_epsilon_2a);
    epsilon_k.get_region([5,0],[6,Nx]).fill(plane_epsilon_2b);
    return region_grid;
  }
}
