import { type EpsilonParameter, type Voltage } from "./stackup.ts";
import { type ManagedObject } from "../../wasm/index.ts";
import { type StackupLayout, type TrapezoidShape, type InfinitePlaneShape } from "./layout.ts";
import { Float32ModuleNdarray } from "../../utility/module_ndarray.ts";
import { Globals } from "../../global.ts";

import { Grid } from "./electrostatic_2d.ts";
import { LinesBuilder } from "../../utility/lines_builder.ts";
import { generate_region_mesh_segments, type RegionSpecification, RegionToGridMap } from "../../utility/regions.ts";
import { Profiler } from "../../utility/profiler.ts";

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
type SDF = (y: number, x: number) => number;
const sdf_slope_bottom_left: SDF = (y: number, x: number) => (y >= x) ? 1.0 : 0.0;
const sdf_slope_bottom_right: SDF = (y: number, x: number) => (y >= 1-x) ? 1.0 : 0.0;
const sdf_slope_top_left: SDF = (y: number, x: number) => (y <= 1-x) ? 1.0 : 0.0;
const sdf_slope_top_right: SDF = (y: number, x: number) => (y <= x) ? 1.0 : 0.0;

type MultisampledSDF = (y: number, x: number, height: number, width: number) => number;
function get_sdf_multisample(sdf: SDF): MultisampledSDF {
  function transform(y: number, x: number, dy: number, dx: number): number {
    // multisampling
    let total_beta = 0;
    total_beta += sdf(y-dy, x-dx);
    total_beta += sdf(y-dy, x+dx);
    total_beta += sdf(y+dy, x-dx);
    total_beta += sdf(y+dy, x+dx);
    const beta = total_beta/4;
    return beta;
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
  type: "plane";
  epsilon: number;
  region: InfinitePlaneRegion;
}

interface SoldermaskDielectricRegion {
  type: "soldermask";
  epsilon: number;
  base_region: InfinitePlaneRegion;
  trace_regions: TrapezoidRegion[];
}

type DielectricRegion = InfinitePlaneDielectricRegion | SoldermaskDielectricRegion;

interface TraceConductorRegion {
  type: "trace";
  region: TrapezoidRegion;
  voltage: Voltage;
}

interface PlaneConductorRegion {
  type: "plane";
  region: InfinitePlaneRegion;
  voltage: Voltage;
  total_divisions: number;
}

type ConductorRegion = TraceConductorRegion | PlaneConductorRegion;

type EpsilonCategory = "soldermask" | "core";

interface EpsilonValue {
  category: EpsilonCategory;
  value: number;
}

export class StackupGrid implements ManagedObject {
  readonly module = Globals.wasm_module;
  _is_deleted: boolean = false;
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
  x_region_lines_builder: LinesBuilder;
  y_region_lines_builder: LinesBuilder;
  x_region_to_grid_map: RegionToGridMap;
  y_region_to_grid_map: RegionToGridMap;
  minimum_grid_resolution: number;
  grid: Grid;
  profiler?: Profiler;

  constructor(
    layout: StackupLayout,
    get_epsilon: (param: EpsilonParameter) => number,
    profiler: Profiler | undefined,
    minimum_grid_resolution?: number,
  ) {
    this.minimum_grid_resolution = minimum_grid_resolution ?? 1e-3;
    this.layout = layout;
    this.x_region_lines_builder = new LinesBuilder();
    this.y_region_lines_builder = new LinesBuilder();
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

    this.profiler = profiler;
    this.dielectric_regions = this.setup_create_dielectric_regions(get_epsilon);
    this.conductor_regions = this.setup_create_conductor_regions();
    this.setup_pad_grid();
    this.setup_merge_nearby_grid_lines();
    this.x_region_to_grid_map = this.setup_create_x_region_to_grid_map();
    this.y_region_to_grid_map = this.setup_create_y_region_to_grid_map();
    this.grid = this.setup_create_simulation_grid();
    this.setup_fill_dielectric_regions();
    this.setup_fill_voltage_regions();

    // fit voltage and epsilon_k table
    this.grid.v_table = Float32ModuleNdarray.from_shape(this.module, [3]);
    this.grid.ek_table = Float32ModuleNdarray.from_shape(this.module, [this.epsilon_indexes.ek_table.length]);
    this.module.register_parent_and_children(this, this.grid);
  }

  delete(): boolean {
    if (this._is_deleted) return false;
    this._is_deleted = true;
    this.module.unregister_parent_and_children(this);
    return true;
  }

  is_deleted(): boolean {
    return this._is_deleted;
  }

  get_infinite_plane_region(shape: InfinitePlaneShape): InfinitePlaneRegion {
    const { y_start, height } = shape;
    const y_end = y_start+height;
    return {
      iy_start: this.y_region_lines_builder.push(y_start),
      iy_end: this.y_region_lines_builder.push(y_end),
    };
  };

  get_trapezoid_region(shape: TrapezoidShape): TrapezoidRegion {
    return {
      ix_signal_left: this.x_region_lines_builder.push(shape.x_left),
      ix_taper_left: this.x_region_lines_builder.push(shape.x_left_taper),
      ix_taper_right: this.x_region_lines_builder.push(shape.x_right_taper),
      ix_signal_right: this.x_region_lines_builder.push(shape.x_right),
      iy_base: this.y_region_lines_builder.push(shape.y_base),
      iy_taper: this.y_region_lines_builder.push(shape.y_taper),
    }
  };

  setup_create_dielectric_regions(get_epsilon: (param: EpsilonParameter) => number): DielectricRegion[] {
    this.profiler?.begin("create_dielectric_regions");
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
    this.profiler?.end();
    return dielectric_regions;
  }

  setup_create_conductor_regions(): ConductorRegion[] {
    this.profiler?.begin("create_conductor_regions");
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
    this.profiler?.end();
    return conductor_regions;
  }

  setup_pad_grid() {
    this.profiler?.begin("pad_grid");
    const x_min = this.x_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const x_max = this.x_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const y_min = this.y_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const y_max = this.y_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const stackup_width = x_max-x_min;
    const stackup_height = y_max-y_min;
    const padding_size = Math.max(stackup_width, stackup_height);
    this.x_region_lines_builder.push(x_min-padding_size);
    this.x_region_lines_builder.push(x_max+padding_size);
    // only pad y-axis if copper planes don't exist at the ends
    const y_plane_min = this.conductor_regions
      .filter(conductor => conductor.type == "plane")
      .map(plane => this.y_region_lines_builder.get_line(plane.region.iy_start))
      .reduce((a,b) => Math.min(a,b), Infinity);
    const y_plane_max = this.conductor_regions
      .filter(conductor => conductor.type == "plane")
      .map(plane => this.y_region_lines_builder.get_line(plane.region.iy_end))
      .reduce((a,b) => Math.max(a,b), -Infinity);
    if (y_plane_min > y_min) {
      this.y_region_lines_builder.push(y_min-padding_size);
    }
    if (y_plane_max < y_max) {
      this.y_region_lines_builder.push(y_max+padding_size);
    }
    this.profiler?.end();
  }

  setup_merge_nearby_grid_lines() {
    this.profiler?.begin("merge_grid_lines");
    const x_region_sizes = this.x_region_lines_builder.to_regions();
    const y_region_sizes = this.y_region_lines_builder.to_regions();
    const merge_size = 0.99*this.minimum_grid_resolution;
    const region_sizes = [...x_region_sizes, ...y_region_sizes].filter(size => size > merge_size);
    this.x_region_lines_builder.merge(merge_size);
    this.y_region_lines_builder.merge(merge_size);
    // rescale for best accuracy for 32bit floating point
    const log_mean = get_log_median(region_sizes);
    this.x_region_lines_builder.apply_scale(1.0/log_mean);
    this.y_region_lines_builder.apply_scale(1.0/log_mean);
    this.profiler?.end();
  }

  setup_create_x_region_to_grid_map(): RegionToGridMap {
    this.profiler?.begin("create_x_region_to_grid_map");
    const size_to_region_spec = (size: number): RegionSpecification => {
      return {
        size,
      };
    };
    const x_region_sizes = this.x_region_lines_builder.to_regions();
    const x_region_specs: RegionSpecification[] = x_region_sizes.map(size_to_region_spec);
    const x_max_ratio = 0.7;
    const x_min_subdivisions = 5;
    const x_region_segments = generate_region_mesh_segments(x_region_specs, x_min_subdivisions, x_max_ratio);
    this.profiler?.end();
    return new RegionToGridMap(this.x_region_lines_builder, x_region_segments);
  }

  setup_create_y_region_to_grid_map() {
    this.profiler?.begin("create_y_region_to_grid_map");
    const size_to_region_spec = (size: number): RegionSpecification => {
      return {
        size,
      };
    };
    const y_region_sizes = this.y_region_lines_builder.to_regions();
    const y_region_specs: RegionSpecification[] = y_region_sizes.map(size_to_region_spec);

    // NOTE: copper planes don't need to be divided fancily to avoid numerical errors
    //       just used a fixed number of divisions since it gives the same result and is faster to compute
    for (const plane of this.conductor_regions.filter(conductor => conductor.type == "plane")) {
      const { region, total_divisions } = plane;
      const ry_start = this.y_region_lines_builder.get_index(region.iy_start);
      const ry_end = this.y_region_lines_builder.get_index(region.iy_end);
      for (let i = ry_start; i < ry_end; i++) {
        y_region_specs[i].total_grid_lines = total_divisions;
      }
    }

    const y_max_ratio = 0.7;
    const y_min_subdivisions = 5;
    const y_region_segments = generate_region_mesh_segments(y_region_specs, y_min_subdivisions, y_max_ratio);
    this.profiler?.end();
    return new RegionToGridMap(this.y_region_lines_builder, y_region_segments);
  }

  setup_create_simulation_grid(): Grid {
    this.profiler?.begin("create_simulation_grid");
    const grid = new Grid(
      this.y_region_to_grid_map.total_grid_segments,
      this.x_region_to_grid_map.total_grid_segments,
    );
    grid.dx.array_view.set(this.x_region_to_grid_map.grid_segments);
    grid.dy.array_view.set(this.y_region_to_grid_map.grid_segments);
    this.profiler?.end();
    return grid;
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

  fill_dielectric_constant(
    gx_start: number, gx_end: number, gy_start: number, gy_end: number,
    ek_index: number,
  ) {
    const grid = this.grid.ek_index_beta.ndarray;
    const [_Ny, Nx] = grid.shape;
    const buf = grid.data;
    const width = gx_end-gx_start;
    const value = Grid.pack_index_beta(ek_index, 1.0);
    for (let y = gy_start; y < gy_end; y++) {
      const gi = gx_start + y*Nx;
      buf.fill(value, gi, gi+width);
    }
  }

  fill_dielectric_sdf(
    gx_start: number, gx_end: number, gy_start: number, gy_end: number,
    ek_index: number, sdf: SDF,
  ) {
    const grid = this.grid.ek_index_beta.ndarray;
    const [_Ny, Nx] = grid.shape;
    const buf = grid.data;

    const X = this.x_region_to_grid_map.grid_lines.slice(gx_start, gx_end);
    const Y = this.y_region_to_grid_map.grid_lines.slice(gy_start, gy_end);
    const dX = this.x_region_to_grid_map.grid_segments.slice(gx_start, gx_end);
    const dY = this.y_region_to_grid_map.grid_segments.slice(gy_start, gy_end);
    const abs_width = dX.reduce((a,b) => a+b, 0);
    const abs_height = dY.reduce((a,b) => a+b, 0);
    const norm_dX = dX.map(dx => dx/abs_width);
    const norm_dY = dY.map(dy => dy/abs_height);
    const norm_X = X.map(x => (x-X[0])/abs_width);
    const norm_Y = Y.map(y => (y-Y[0])/abs_height);

    const width = gx_end-gx_start;
    const height = gy_end-gy_start;

    const multisampled_sdf = get_sdf_multisample(sdf);
    function index_beta_sdf(y: number, x: number, height: number, width: number): number {
      const beta = multisampled_sdf(y+height/2, x+width/2, height/2, width/2);
      return Grid.pack_index_beta(ek_index, beta);
    }

    for (let y = 0; y < height; y++) {
      const norm_y = norm_Y[y];
      const norm_dy = norm_dY[y];
      const gy = gy_start+y;
      for (let x = 0; x < width; x++) {
        const norm_x = norm_X[x];
        const norm_dx = norm_dX[x];
        const gx = gx_start+x;
        const gi = gx + gy*Nx;
        const value = index_beta_sdf(norm_y, norm_x, norm_dy, norm_dx);
        buf[gi] = value;
      }
    }
  }

  fill_dielectric_plane(region: InfinitePlaneRegion, ek_index: number) {
    const gy_start = this.y_region_to_grid_map.id_to_grid_index(region.iy_start);
    const gy_end = this.y_region_to_grid_map.id_to_grid_index(region.iy_end);
    const gx_start = 0;
    const gx_end = this.x_region_to_grid_map.total_grid_segments;
    this.fill_dielectric_constant(
      gx_start, gx_end, gy_start, gy_end,
      ek_index,
    );
  };

  fill_dielectric_trapezoid(region: TrapezoidRegion, ek_index: number) {
    const gx_signal_left = this.x_region_to_grid_map.id_to_grid_index(region.ix_signal_left);
    const gx_taper_left = this.x_region_to_grid_map.id_to_grid_index(region.ix_taper_left);
    const gx_taper_right = this.x_region_to_grid_map.id_to_grid_index(region.ix_taper_right);
    const gx_signal_right = this.x_region_to_grid_map.id_to_grid_index(region.ix_signal_right);

    const gy_base = this.y_region_to_grid_map.id_to_grid_index(region.iy_base);
    const gy_taper = this.y_region_to_grid_map.id_to_grid_index(region.iy_taper);
    const gy_start = Math.min(gy_base, gy_taper);
    const gy_end = Math.max(gy_base, gy_taper);

    if (gx_signal_left < gx_taper_left && gy_start < gy_end) {
      const sdf = (gy_taper > gy_base) ? sdf_slope_top_right : sdf_slope_bottom_right;
      this.fill_dielectric_sdf(
        gx_signal_left, gx_taper_left, gy_start, gy_end,
        ek_index, sdf,
      );
    }
    if (gx_taper_left < gx_taper_right && gy_start < gy_end) {
      this.fill_dielectric_constant(
        gx_taper_left, gx_taper_right, gy_start, gy_end,
        ek_index,
      );
    }
    if (gx_taper_right < gx_signal_right && gy_start < gy_end) {
      const sdf = (gy_taper > gy_base) ? sdf_slope_top_left: sdf_slope_bottom_left;
      this.fill_dielectric_sdf(
        gx_taper_right, gx_signal_right, gy_start, gy_end,
        ek_index, sdf,
      );
    }
  };

  setup_fill_dielectric_regions() {
    this.profiler?.begin("fill_dielectric_regions");
    const er0 = 1.0; // dielectric of vacuum
    const index_er0 = this.push_epsilon(er0, "core");
    this.grid.ek_index_beta.ndarray.fill(Grid.pack_index_beta(index_er0, 0.0));

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
    this.profiler?.end();
  }

  push_voltage(voltage: Voltage): number {
    this.voltage_indexes.v_set.add(voltage);
    return this.voltage_indexes.v_table[voltage];
  }

  fill_voltage_constant(
    gx_start: number, gx_end: number, gy_start: number, gy_end: number,
    v_index: number,
  ) {
    const grid = this.grid.v_index_beta.ndarray;
    const [Ny, Nx] = grid.shape;
    const buf = grid.data;

    // include boundary of grid cell
    gx_end = Math.min(Nx, gx_end+1);
    gy_end = Math.min(Ny, gy_end+1);
    const width = gx_end-gx_start;
    const value = Grid.pack_index_beta(v_index, 1.0);
    for (let y = gy_start; y < gy_end; y++) {
      const gi = gx_start + y*Nx;
      buf.fill(value, gi, gi+width);
    }
  }

  fill_voltage_sdf(
    gx_start: number, gx_end: number, gy_start: number, gy_end: number,
    v_index: number, sdf: SDF,
  ) {
    const grid = this.grid.v_index_beta.ndarray;
    const [Ny, Nx] = grid.shape;
    const buf = grid.data;

    const dX = this.x_region_to_grid_map.grid_segments.slice(gx_start, gx_end);
    const dY = this.y_region_to_grid_map.grid_segments.slice(gy_start, gy_end);
    const abs_width = dX.reduce((a,b) => a+b, 0);
    const abs_height = dY.reduce((a,b) => a+b, 0);
    const norm_dX = dX.map(dx => dx/abs_width);
    const norm_dY = dY.map(dy => dy/abs_height);

    // include boundary of grid cell
    gx_end = Math.min(Nx, gx_end+1);
    gy_end = Math.min(Ny, gy_end+1);
    const width = gx_end-gx_start;
    const height = gy_end-gy_start;
    const X = this.x_region_to_grid_map.grid_lines.slice(gx_start, gx_end);
    const Y = this.y_region_to_grid_map.grid_lines.slice(gy_start, gy_end);
    const norm_X = X.map(x => (x-X[0])/abs_width);
    const norm_Y = Y.map(y => (y-Y[0])/abs_height);

    const multisampled_sdf = get_sdf_multisample(sdf);
    function index_beta_sdf(y: number, x: number, dy: number, dx: number): number {
      const beta = multisampled_sdf(y, x, dy/2, dx/2);
      return Grid.pack_index_beta(v_index, beta);
    }

    for (let y = 0; y < height; y++) {
      const norm_y = norm_Y[y];
      const norm_dy = norm_dY[y] ?? norm_dY[norm_dY.length-1];
      const gy = gy_start+y;
      for (let x = 0; x < width; x++) {
        const norm_x = norm_X[x];
        const norm_dx = norm_dX[x] ?? norm_dX[norm_dX.length-1];
        const gx = gx_start+x;
        const gi = gx + gy*Nx;
        const value = index_beta_sdf(norm_y, norm_x, norm_dy, norm_dx);
        buf[gi] = value;
      }
    }
  }


  fill_voltage_plane(region: InfinitePlaneRegion, voltage: Voltage) {
    const gy_start = this.y_region_to_grid_map.id_to_grid_index(region.iy_start);
    const gy_end = this.y_region_to_grid_map.id_to_grid_index(region.iy_end);
    const gx_start = 0;
    const gx_end = this.x_region_to_grid_map.total_grid_segments;

    const v_index = this.push_voltage(voltage);
    this.fill_voltage_constant(
      gx_start, gx_end, gy_start, gy_end,
      v_index,
    );
  };

  fill_voltage_trapezoid(region: TrapezoidRegion, voltage: Voltage) {
    const gx_signal_left = this.x_region_to_grid_map.id_to_grid_index(region.ix_signal_left);
    const gx_taper_left = this.x_region_to_grid_map.id_to_grid_index(region.ix_taper_left);
    const gx_taper_right = this.x_region_to_grid_map.id_to_grid_index(region.ix_taper_right);
    const gx_signal_right = this.x_region_to_grid_map.id_to_grid_index(region.ix_signal_right);

    const gy_base = this.y_region_to_grid_map.id_to_grid_index(region.iy_base);
    const gy_taper = this.y_region_to_grid_map.id_to_grid_index(region.iy_taper);
    const gy_start = Math.min(gy_base, gy_taper);
    let gy_end = Math.max(gy_base, gy_taper);
    // also set edge of region to voltage
    gy_end = Math.min(gy_end+1, this.y_region_to_grid_map.total_grid_lines);

    const v_index = this.push_voltage(voltage);

    if (gx_signal_left < gx_taper_left) {
      const sdf = (gy_taper > gy_base) ? sdf_slope_top_right : sdf_slope_bottom_right;
      this.fill_voltage_sdf(
        gx_signal_left, gx_taper_left, gy_start, gy_end,
        v_index, sdf,
      );
    }
    if (gx_taper_left <= gx_taper_right) {
      this.fill_voltage_constant(
        gx_taper_left, gx_taper_right, gy_start, gy_end,
        v_index,
      );
    }
    if (gx_taper_right < gx_signal_right) {
      const sdf = (gy_taper > gy_base) ? sdf_slope_top_left : sdf_slope_bottom_left;
      this.fill_voltage_sdf(
        gx_taper_right, gx_signal_right, gy_start, gy_end,
        v_index, sdf,
      );
    }
  };

  setup_fill_voltage_regions() {
    this.profiler?.begin("fill_voltage_regions");
    for (const conductor of this.conductor_regions) {
      switch (conductor.type) {
        case "plane": {
          this.profiler?.begin("fill_voltage_plane");
          this.fill_voltage_plane(conductor.region, conductor.voltage);
          this.profiler?.end();
          break;
        }
        case "trace": {
          this.profiler?.begin("fill_voltage_trace");
          this.fill_voltage_trapezoid(conductor.region, conductor.voltage);
          this.profiler?.end();
          break;
        }
      }
    }
    this.profiler?.end();
  }

  is_differential_pair(): boolean {
    const v_set =  this.voltage_indexes.v_set;
    return v_set.has("positive") && v_set.has("negative");
  }

  has_soldermask(): boolean {
    return this.epsilon_indexes.soldermask_indices.size > 0;
  }

  configure_odd_mode_diffpair_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = -1;
    this.grid.v_input = 2;
  }

  configure_even_mode_diffpair_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = 1;
    this.grid.v_input = 2;
  }

  configure_single_ended_voltage() {
    const v_table = this.grid.v_table.array_view;
    v_table[0] = 0;
    v_table[1] = 1;
    v_table[2] = 1;
    this.grid.v_input = 1;
  }

  configure_masked_dielectric() {
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = this.grid.ek_table.array_view;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = src_ek_table[i];
      dst_ek_table[i] = ek.value;
    }
  }

  configure_unmasked_dielectric() {
    const src_ek_table = this.epsilon_indexes.ek_table;
    const dst_ek_table = this.grid.ek_table.array_view;
    const soldermask_indices = this.epsilon_indexes.soldermask_indices;
    const er0 = src_ek_table[0].value;
    for (let i = 0; i < src_ek_table.length; i++) {
      const ek = soldermask_indices.has(i) ? er0 : src_ek_table[i].value;
      dst_ek_table[i] = ek;
    }
  }
}
