import { type Parameter, type Voltage } from "./stackup.ts";
import { type StackupLayout, type TrapezoidShape, type InfinitePlaneShape } from "./layout.ts";
import { Float32ModuleNdarray } from "../../utility/module_ndarray.ts";

import {
  GridLines, RegionGrid,
} from "../../engine/grid_2d.ts";
import { Grid } from "../../engine/electrostatic_2d.ts";
import { calculate_grid_regions, type RegionSpecification } from "../../engine/mesher.ts";

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

function index_beta_sdf(sdf: (x: number, y: number) => number, index: number) {
  const sdf_multisample = get_sdf_multisample(sdf);
  function transform(
    _value: number,
    [y_start, x_start]: [number, number],
    [y_size, x_size]: [number, number]): number
  {
    const beta = sdf_multisample([y_start, x_start], [y_size, x_size]);
    return Grid.pack_index_beta(index, beta);
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
  { type: "trace", region: TrapezoidRegion, voltage: Voltage } |
  { type: "plane", region: InfinitePlaneRegion, voltage: Voltage, total_divisions: number };

type EpsilonCategory = "soldermask" | "core";

interface EpsilonValue {
  category: EpsilonCategory;
  value: number;
}

export class StackupGrid {
  layout: StackupLayout;
  voltage_indexes: {
    v_table: Record<Voltage, number>,
    v_set: Set<Voltage>,
  };
  epsilon_indexes: {
    ek_table: EpsilonValue[];
    soldermask_indices: Set<number>;
  };
  conductor_regions: ConductorRegion[];
  dielectric_regions: DielectricRegion[];
  x_grid_lines: GridLines;
  y_grid_lines: GridLines;
  region_grid: RegionGrid;

  constructor(layout: StackupLayout) {
    this.layout = layout;
    this.x_grid_lines = new GridLines();
    this.y_grid_lines = new GridLines();
    this.voltage_indexes = {
      v_table: {
        "ground": 0,
        "positive": 1,
        "negative": 2,
      },
      v_set: new Set(),
    };
    this.epsilon_indexes = {
      ek_table: [],
      soldermask_indices: new Set(),
    };

    this.dielectric_regions = this.setup_create_dielectric_regions();
    this.conductor_regions = this.setup_create_conductor_regions();
    this.setup_pad_grid();
    this.setup_merge_nearby_grid_lines();
    this.region_grid = this.setup_create_region_grid();
    this.setup_fill_dielectric_regions();
    this.setup_fill_voltage_regions();

    const grid = this.region_grid.grid;
    // fit voltage and epsilon_k table
    grid.v_table.delete();
    grid.ek_table.delete();
    grid.v_table = new Float32ModuleNdarray([3]);
    grid.ek_table = new Float32ModuleNdarray([this.epsilon_indexes.ek_table.length]);
  }

  get_infinite_plane_region(shape: InfinitePlaneShape): InfinitePlaneRegion {
    const { y_start, height } = shape;
    const y_end = y_start+height;
    return {
      iy_start: this.y_grid_lines.push(y_start),
      iy_end: this.y_grid_lines.push(y_end),
    };
  };

  get_trapezoid_region(shape: TrapezoidShape): TrapezoidRegion {
    return {
      ix_signal_left: this.x_grid_lines.push(shape.x_left),
      ix_taper_left: this.x_grid_lines.push(shape.x_left_taper),
      ix_taper_right: this.x_grid_lines.push(shape.x_right_taper),
      ix_signal_right: this.x_grid_lines.push(shape.x_right),
      iy_base: this.y_grid_lines.push(shape.y_base),
      iy_taper: this.y_grid_lines.push(shape.y_taper),
    }
  };

  setup_create_dielectric_regions(): DielectricRegion[] {
    const get_epsilon = (param: Parameter): number => {
      const epsilon = param.value;
      if (epsilon === undefined) {
        param.error = "Dielectric constant must be provided";
        throw Error("Missing epsilon field value");
      }
      return epsilon;
    };

    const dielectric_regions: DielectricRegion[] = [];
    for (const layer_layout of this.layout.layers) {
      switch (layer_layout.type) {
        case "unmasked": {
          break;
        }
        case "soldermask": {
          const mask = layer_layout.mask;
          if (mask) {
            const layer = layer_layout.parent;
            const epsilon = get_epsilon(layer.epsilon);
            const base_region = this.get_infinite_plane_region(mask.surface);
            const trace_regions: TrapezoidRegion[] = mask.traces.map(shape => this.get_trapezoid_region(shape));
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
          const region = this.get_infinite_plane_region(layer_layout.bounding_box);
          dielectric_regions.push({
            type: "plane",
            region,
            epsilon,
          });
          break;
        }
      }
    }
    return dielectric_regions;
  }

  setup_create_conductor_regions(): ConductorRegion[] {
    const conductor_regions: ConductorRegion[] = [];
    for (const conductor_layout of this.layout.conductors) {
      switch (conductor_layout.type) {
        case "trace": {
          const trace = conductor_layout.parent;
          const region = this.get_trapezoid_region(conductor_layout.shape);
          conductor_regions.push({
            type: "trace",
            region,
            voltage: trace.voltage,
          })
          break;
        }
        case "plane": {
          const plane = conductor_layout.parent;
          const total_divisions = plane.grid?.override_total_divisions || 2;
          conductor_regions.push({
            type: "plane",
            region: this.get_infinite_plane_region(conductor_layout.shape),
            voltage: plane.voltage,
            total_divisions,
          })
          break;
        }
      }
    }
    return conductor_regions;
  }

  setup_pad_grid() {
    const x_min = this.x_grid_lines.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const x_max = this.x_grid_lines.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const y_min = this.y_grid_lines.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const y_max = this.y_grid_lines.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const stackup_width = x_max-x_min;
    const stackup_height = y_max-y_min;
    const padding_size = Math.max(stackup_width, stackup_height);
    this.x_grid_lines.push(x_min-padding_size);
    this.x_grid_lines.push(x_max+padding_size);
    // only pad y-axis if copper planes don't exist at the ends
    const y_plane_min = this.conductor_regions
      .filter(conductor => conductor.type == "plane")
      .map(plane => this.y_grid_lines.get_line(plane.region.iy_start))
      .reduce((a,b) => Math.min(a,b), Infinity);
    const y_plane_max = this.conductor_regions
      .filter(conductor => conductor.type == "plane")
      .map(plane => this.y_grid_lines.get_line(plane.region.iy_end))
      .reduce((a,b) => Math.max(a,b), -Infinity);
    if (y_plane_min > y_min) {
      this.y_grid_lines.push(y_min-padding_size);
    }
    if (y_plane_max < y_max) {
      this.y_grid_lines.push(y_max+padding_size);
    }
  }

  setup_merge_nearby_grid_lines() {
    const x_region_sizes = this.x_grid_lines.to_regions();
    const y_region_sizes = this.y_grid_lines.to_regions();
    const region_sizes = [...x_region_sizes, ...y_region_sizes]
      .filter(size => size > 0); // avoid normalising to 0 which causes infinities
    const log_mean = get_log_median(region_sizes);
    const merge_threshold = log_mean*1e-3;
    this.x_grid_lines.merge(merge_threshold);
    this.y_grid_lines.merge(merge_threshold);
    this.x_grid_lines.scale(1.0/log_mean);
    this.y_grid_lines.scale(1.0/log_mean);
  }

  setup_create_region_grid(): RegionGrid {
    const size_to_region_spec = (size: number): RegionSpecification => {
      return {
        size,
      };
    };
    const x_region_sizes = this.x_grid_lines.to_regions();
    const y_region_sizes = this.y_grid_lines.to_regions();
    const x_region_specs: RegionSpecification[] = x_region_sizes.map(size_to_region_spec);
    const y_region_specs: RegionSpecification[] = y_region_sizes.map(size_to_region_spec);

    // NOTE: copper planes don't need to be divided fancily to avoid numerical errors
    //       just used a fixed number of divisions since it gives the same result and is faster to compute
    for (const plane of this.conductor_regions.filter(conductor => conductor.type == "plane")) {
      const { region, total_divisions } = plane;
      const ry_start = this.y_grid_lines.get_index(region.iy_start);
      const ry_end = this.y_grid_lines.get_index(region.iy_end);
      for (let i = ry_start; i < ry_end; i++) {
        y_region_specs[i].total_grid_lines = total_divisions;
      }
    }

    // create region grid
    const x_max_ratio = 0.7;
    const y_max_ratio = 0.7;
    const x_min_subdivisions = 5;
    const y_min_subdivisions = 5;
    const x_region_grids = calculate_grid_regions(x_region_specs, x_min_subdivisions, x_max_ratio);
    const y_region_grids = calculate_grid_regions(y_region_specs, y_min_subdivisions, y_max_ratio);
    const region_grid = new RegionGrid(x_region_grids, y_region_grids);
    return region_grid;
  }

  push_epsilon(epsilon_k: number, category: EpsilonCategory, threshold?: number): number {
    threshold = threshold ?? 1e-3;
    const ek_table = this.epsilon_indexes.ek_table;
    for (let i = 0; i < ek_table.length; i++) {
      const elem = ek_table[i];
      if (elem.category != category) continue;
      const delta = Math.abs(elem.value-epsilon_k);
      if (delta < threshold) return i;
    }
    const index = ek_table.length;
    ek_table.push({
      category,
      value: epsilon_k,
    });
    return index;
  }

  fill_dielectric_plane(region: InfinitePlaneRegion, ek_index: number) {
    const ry_start = this.y_grid_lines.get_index(region.iy_start);
    const ry_end = this.y_grid_lines.get_index(region.iy_end);
    const rx_start = 0;
    const rx_end = this.region_grid.x_grid_regions.length;

    const ek_index_beta = this.region_grid.ek_index_beta_region_view();
    const ek_beta = 1.0;

    if (ry_start < ry_end) {
      ek_index_beta
        .get_region(
            [ry_start,rx_start],
            [ry_end,rx_end],
        )
        .fill(Grid.pack_index_beta(ek_index, ek_beta));
    }
  };

  fill_dielectric_trapezoid(region: TrapezoidRegion, ek_index: number) {
    const rx_signal_left = this.x_grid_lines.get_index(region.ix_signal_left);
    const rx_signal_right = this.x_grid_lines.get_index(region.ix_signal_right);
    const rx_taper_left = this.x_grid_lines.get_index(region.ix_taper_left);
    const rx_taper_right = this.x_grid_lines.get_index(region.ix_taper_right);

    const ry_base = this.y_grid_lines.get_index(region.iy_base);
    const ry_taper = this.y_grid_lines.get_index(region.iy_taper);
    const ry_start = Math.min(ry_base, ry_taper);
    const ry_end = Math.max(ry_base, ry_taper);

    const ek_index_beta = this.region_grid.ek_index_beta_region_view();

    if (rx_signal_left < rx_taper_left && ry_start < ry_end) {
      const left_taper_sdf =
        (ry_taper > ry_base) ?
        index_beta_sdf(sdf_slope_top_right, ek_index) :
        index_beta_sdf(sdf_slope_bottom_right, ek_index);
      ek_index_beta.transform_norm_region(
        [ry_start, rx_signal_left],
        [ry_end, rx_taper_left],
        left_taper_sdf,
      );
    }
    if (rx_taper_left < rx_taper_right && ry_start < ry_end) {
      ek_index_beta
        .get_region([ry_start, rx_taper_left], [ry_end, rx_taper_right])
        .fill(Grid.pack_index_beta(ek_index, 1.0));
    }
    if (rx_taper_right < rx_signal_right && ry_start < ry_end) {
      const right_taper_sdf =
        (ry_taper > ry_base) ?
        index_beta_sdf(sdf_slope_top_left, ek_index) :
        index_beta_sdf(sdf_slope_bottom_left, ek_index);
      ek_index_beta.transform_norm_region(
        [ry_start, rx_taper_right],
        [ry_end, rx_signal_right],
        right_taper_sdf,
      );
    }
  };

  setup_fill_dielectric_regions() {
    const er0 = 1.0; // dielectric of vacuum
    const index_er0 = this.push_epsilon(er0, "core");
    this.region_grid.grid.ek_index_beta.ndarray.fill(Grid.pack_index_beta(index_er0, 1.0));

    for (const dielectric_region of this.dielectric_regions) {
      switch (dielectric_region.type) {
        case "plane": {
          const { region } = dielectric_region;
          const ek_index = this.push_epsilon(dielectric_region.epsilon, "core");
          this.fill_dielectric_plane(region, ek_index);
          break;
        };
        case "soldermask": {
          // @NOTE: we do this so we can toggle it on and off for mask/unmasked impedance calculation
          const ek_index = this.push_epsilon(dielectric_region.epsilon, "soldermask");
          this.epsilon_indexes.soldermask_indices.add(ek_index);
          const { base_region, trace_regions } = dielectric_region;
          this.fill_dielectric_plane(base_region, ek_index);
          for (const region of trace_regions) {
            this.fill_dielectric_trapezoid(region, ek_index);
          }
          break;
        };
      }
    }
  }

  push_voltage(voltage: Voltage): number {
    this.voltage_indexes.v_set.add(voltage);
    return this.voltage_indexes.v_table[voltage];
  }

  fill_voltage_plane(region: InfinitePlaneRegion, voltage: Voltage) {
    const ry_start = this.y_grid_lines.get_index(region.iy_start);
    const ry_end = this.y_grid_lines.get_index(region.iy_end);
    const rx_start = 0;
    const rx_end = this.region_grid.x_grid_regions.length;

    const v_index_beta = this.region_grid.v_index_beta_region_view();
    const v_index = this.push_voltage(voltage);
    const [Ny, Nx] = v_index_beta.view.shape;

    const gx_start = v_index_beta.x_region_to_grid(rx_start);
    const gx_end = v_index_beta.x_region_to_grid(rx_end);
    const gy_start = v_index_beta.y_region_to_grid(ry_start);
    const gy_end = v_index_beta.y_region_to_grid(ry_end);

    // expand voltage field to include the next index so voltage along boundary of conductor is met
    // also allow infinitely flat traces (gy_start == gy_end)
    v_index_beta
      .get_grid(
        [gy_start, gx_start],
        [Math.min(gy_end+1,Ny), Math.min(gx_end+1,Nx)],
      )
      .fill(Grid.pack_index_beta(v_index, 1.0));
  };

  fill_voltage_trapezoid(region: TrapezoidRegion, voltage: Voltage) {
    const rx_signal_left = this.x_grid_lines.get_index(region.ix_signal_left);
    const rx_signal_right = this.x_grid_lines.get_index(region.ix_signal_right);
    const rx_taper_left = this.x_grid_lines.get_index(region.ix_taper_left);
    const rx_taper_right = this.x_grid_lines.get_index(region.ix_taper_right);

    const ry_base = this.y_grid_lines.get_index(region.iy_base);
    const ry_taper = this.y_grid_lines.get_index(region.iy_taper);
    const ry_start = Math.min(ry_base, ry_taper);
    const ry_end = Math.max(ry_base, ry_taper);

    const v_index_beta = this.region_grid.v_index_beta_region_view();
    const v_index = this.push_voltage(voltage);
    const [Ny, Nx] = v_index_beta.view.shape;

    const gx_taper_left = v_index_beta.x_region_to_grid(rx_taper_left);
    const gx_signal_left = v_index_beta.x_region_to_grid(rx_signal_left);
    const gx_signal_right = v_index_beta.x_region_to_grid(rx_signal_right);
    const gx_taper_right = v_index_beta.x_region_to_grid(rx_taper_right);
    const gy_start = v_index_beta.y_region_to_grid(ry_start);
    const gy_end = v_index_beta.y_region_to_grid(ry_end);

    // allow infinitely flat traces (gy_start == gy_end)
    if (gx_signal_left < gx_taper_left) {
      const left_taper_sdf =
        (ry_taper > ry_base) ?
        index_beta_sdf(sdf_slope_top_right, v_index) :
        index_beta_sdf(sdf_slope_bottom_right, v_index);
      v_index_beta.transform_norm_grid(
        [gy_start, gx_signal_left],
        [Math.min(gy_end+1,Ny), gx_taper_left],
        left_taper_sdf,
      );
    }
    // also allow for infinite thin traces (gx_taper_left == gx_taper_right)
    if (gx_taper_left <= gx_taper_right) {
      v_index_beta
        .get_grid(
          [gy_start, gx_taper_left],
          [Math.min(gy_end+1,Ny), Math.min(gx_taper_right+1,Nx)],
        )
        .fill(Grid.pack_index_beta(v_index, 1.0));
    }
    if (gx_taper_right < gx_signal_right) {
      const right_taper_sdf =
        (ry_taper > ry_base) ?
        index_beta_sdf(sdf_slope_top_left, v_index) :
        index_beta_sdf(sdf_slope_bottom_left, v_index);
      v_index_beta.transform_norm_grid(
        [gy_start, gx_taper_right],
        [Math.min(gy_end+1,Ny), Math.min(gx_signal_right+1,Nx)],
        right_taper_sdf,
      );
    }
  };

  setup_fill_voltage_regions() {
    for (const conductor of this.conductor_regions) {
      switch (conductor.type) {
        case "plane": {
          this.fill_voltage_plane(conductor.region, conductor.voltage);
          break;
        }
        case "trace": {
          this.fill_voltage_trapezoid(conductor.region, conductor.voltage);
          break;
        }
      }
    }
  }

  is_differential_pair(): boolean {
    const v_set =  this.voltage_indexes.v_set;
    return v_set.has("positive") && v_set.has("negative");
  }

  configure_odd_mode_diffpair_voltage() {
    const grid = this.region_grid.grid;
    const v_table = grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = -1;
    grid.v_input = 2;
  }

  configure_even_mode_diffpair_voltage() {
    const grid = this.region_grid.grid;
    const v_table = grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = 1;
    grid.v_input = 1;
  }

  configure_single_ended_voltage() {
    const grid = this.region_grid.grid;
    const v_table = grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = 1;
    grid.v_input = 1;
  }

  configure_masked_dielectric() {
    const grid = this.region_grid.grid;
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = grid.ek_table.array_view;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = src_ek_table[i];
      dst_ek_table[i] = ek.value;
    }
  }

  configure_unmasked_dielectric() {
    const grid = this.region_grid.grid;
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = grid.ek_table.array_view;
    const soldermask_indices = this.epsilon_indexes.soldermask_indices;
    const er0 = src_ek_table[0].value;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = soldermask_indices.has(i) ? er0 : src_ek_table[i].value;
      dst_ek_table[i] = ek;
    }
  }
}
