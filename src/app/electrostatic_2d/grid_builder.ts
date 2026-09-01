import { ManagedObject, WasmModule } from "../../wasm/index.ts";
import { Grid } from "./grid.ts";
import { LinesBuilder } from "../mesher/lines_builder.ts";
import { generate_region_mesh_segments, type RegionSpecification, RegionToGridMap } from "../mesher/regions.ts";
import { Profiler } from "../../utility/profiler.ts";
import { Float32ModuleNdarray } from "../../utility/module_ndarray.ts";
import { type Vec2, type Bound, AXES_2D } from "../../utility/dim_types.ts";
import type { MeshLines } from "../../components/mesh_viewer/mesh_lines.ts";

type Pos2D = Vec2<number>;

export interface CircleShape {
  readonly type: "circle";
  center: Pos2D;
  radius: number;
  min_gridlines?: Partial<Vec2<number>>;
}

export interface RectangleShape {
  readonly type: "rectangle";
  box: Partial<Vec2<Partial<Bound<number>>>>;
  min_gridlines?: Partial<Vec2<number>>;
}

export interface TriangleShape {
  readonly type: "triangle";
  base: Pos2D;
  tip: Pos2D;
  min_gridlines?: Partial<Vec2<number>>;
}

export type Shape = CircleShape | RectangleShape | TriangleShape;
export type IgnoreBoundary = Partial<Vec2<Partial<Bound<boolean>>>>;

export interface VoltageRegion {
  readonly type: "voltage";
  voltage_index: number | null; // null removes voltage
  ignore_boundary?: IgnoreBoundary;
  shapes: Shape[];
}

export interface DielectricRegion {
  readonly type: "dielectric";
  dielectric_index: number | null; // null removes dielectric
  shapes: Shape[];
}

export interface EmptyRegion {
  readonly type: "empty";
  shapes: Shape[];
}

export type Region = VoltageRegion | DielectricRegion | EmptyRegion;
export type RegionType = "voltage" | "dielectric" | "empty";

export interface GridBuilderConfig {
  minimum_grid_resolution: number; // smallest possible region size before it is ignored
  padding_size_multiplier: Vec2<number>; // amount of air padding to add around simulation region
  max_ratio: Vec2<number>; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_subdivisions: Vec2<number>; // minimum number of grid lines each region should have
  min_epsilon_resolution: number; // smallest possible difference in dielectric epsilon values before they are considered the same
  signal_amplitude: number; // voltage value to use for +/- signals
}

export type GridBuilderPadding = Vec2<Partial<Bound<boolean>>>;

function get_sdf_multisample(sdf: (y: number, x: number) => number) {
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

interface SDF {
  region_id: Vec2<Partial<Bound<number>>>;
  fill: {
    readonly type: "point",
    sdf: (y: number, x: number) => number,
  } | {
    readonly type: "multisample",
    sdf: (y: number, x: number, dy: number, dx: number) => number,
  } | {
    readonly type: "constant",
  };
}

type RegionSDF =
  { type: "voltage", sdfs: SDF[], voltage_index: number | null, ignore_boundary?: IgnoreBoundary } |
  { type: "dielectric", sdfs: SDF[], dielectric_index: number | null } |
  { type: "empty", sdfs: SDF[] };

// Grid builder breaks down regions into the following heirarchy
// (0,0) is top-left
// positive x-axis goes from left to right
// positive y-axis goes from top to bottom
// Region -> Shapes[] -> SDF[]
export class GridBuilder extends ManagedObject {
  grid: Grid;
  regions: Region[];
  padding: GridBuilderPadding;
  sdf_regions: RegionSDF[];
  region_lines_builder: Vec2<LinesBuilder>;
  region_to_grid_map: Vec2<RegionToGridMap>;
  min_gridlines: Vec2<{
    region_id_min: number,
    region_id_max: number,
    count: number,
  }[]>;
  unpadded_boundary: Vec2<Bound<number>>;
  padded_boundary: Vec2<Partial<Bound<number>>>;
  grid_scale: number = 1.0;
  dielectric_indices = new Set<number>();
  voltage_indices = new Set<number>();
  config: GridBuilderConfig;
  profiler?: Profiler;

  constructor(
    module: WasmModule, regions: Region[],
    config: GridBuilderConfig, padding: GridBuilderPadding,
    profiler?: Profiler,
  ) {
    super(module);
    this.regions = regions;
    this.config = config;
    this.padding = padding;
    this.profiler = profiler;

    this.region_lines_builder = {
      x: new LinesBuilder(),
      y: new LinesBuilder(),
    };
    this.min_gridlines = {
      x: [],
      y: [],
    };

    this.sdf_regions = this.setup_create_sdf_regions(regions);
    this.unpadded_boundary = this.setup_calculate_unpadded_boundary();
    this.padded_boundary = this.setup_pad_grid();
    this.setup_merge_nearby_region_lines();
    this.setup_rescale_region_lines();
    this.region_to_grid_map = this.setup_subdivide_region_lines();
    this.grid = this.setup_create_simulation_grid();
    this._child_objects.add(this.grid);
    this.setup_fill_sdf_regions();
    this.setup_allocate_lookup_tables();
  }

  setup_create_sdf_regions(regions: Region[]) {
    this.profiler?.begin("create_fill_regions");
    const fill_regions: RegionSDF[] = [];
    for (const region of regions) {
      const sdfs = region.shapes.map(region => this.setup_create_sdf_from_shape(region));
      switch (region.type) {
        case "voltage": {
          if (region.voltage_index !== null) {
            this.voltage_indices.add(region.voltage_index);
          }
          fill_regions.push({
            type: "voltage" as const,
            sdfs: sdfs,
            voltage_index: region.voltage_index,
            ignore_boundary: region.ignore_boundary,
          });
          break;
        }
        case "dielectric": {
          if (region.dielectric_index !== null) {
            this.dielectric_indices.add(region.dielectric_index);
          }
          fill_regions.push({
            type: "dielectric" as const,
            sdfs: sdfs,
            dielectric_index: region.dielectric_index,
          });
          break;
        }
        case "empty": {
          fill_regions.push({
            type: "empty" as const,
            sdfs: sdfs,
          });
          break;
        }
      }
    }
    this.profiler?.end();
    return fill_regions;
  }

  setup_create_sdf_from_shape(shape: Shape): SDF {
    this.profiler?.begin(
      "create_region_sdf",
      "Create a rectangular region where the internal fill is defined by a signed distance function",
      {
        type: shape.type,
      },
    );

    let region_sdf: SDF | undefined = undefined;
    switch (shape.type) {
      case "circle": {
        const x_min = shape.center.x-shape.radius;
        const x_max = shape.center.x+shape.radius;
        const y_min = shape.center.y-shape.radius;
        const y_max = shape.center.y+shape.radius;

        const rx_min = this.region_lines_builder.x.push(x_min);
        const rx_max = this.region_lines_builder.x.push(x_max);
        const ry_min = this.region_lines_builder.y.push(y_min);
        const ry_max = this.region_lines_builder.y.push(y_max);

        const epsilon = 1e-3;
        const radius_squared = 0.5**2 + epsilon;
        const sdf = (y: number, x: number) => ((y-0.5)**2 + (x-0.5)**2 <= radius_squared) ? 1.0 : 0.0;
        const multisample_sdf = get_sdf_multisample(sdf);
        region_sdf = {
          region_id: {
            x: { min: rx_min, max: rx_max },
            y: { min: ry_min, max: ry_max },
          },
          fill: {
            type: "multisample",
            sdf: multisample_sdf,
          },
        };
        break;
      }
      case "rectangle": {
        const x_min = shape.box.x?.min;
        const x_max = shape.box.x?.max;
        const y_min = shape.box.y?.min;
        const y_max = shape.box.y?.max;

        const rx_min = x_min !== undefined ? this.region_lines_builder.x.push(x_min) : undefined;
        const rx_max = x_max !== undefined ? this.region_lines_builder.x.push(x_max) : undefined;
        const ry_min = y_min !== undefined ? this.region_lines_builder.y.push(y_min) : undefined;
        const ry_max = y_max !== undefined ? this.region_lines_builder.y.push(y_max) : undefined;

        region_sdf = {
          region_id: {
            x: { min: rx_min, max: rx_max },
            y: { min: ry_min, max: ry_max },
          },
          fill: {
            type: "constant",
          },
        };
        break;
      }
      case "triangle": {
        const x_min = Math.min(shape.base.x, shape.tip.x);
        const x_max = Math.max(shape.base.x, shape.tip.x);
        const y_min = Math.min(shape.base.y, shape.tip.y);
        const y_max = Math.max(shape.base.y, shape.tip.y);

        const rx_min = this.region_lines_builder.x.push(x_min);
        const rx_max = this.region_lines_builder.x.push(x_max);
        const ry_min = this.region_lines_builder.y.push(y_min);
        const ry_max = this.region_lines_builder.y.push(y_max);

        const sdf_slope_bottom_left = (y: number, x: number) => (y >= x) ? 1.0 : 0.0;
        const sdf_slope_bottom_right = (y: number, x: number) => (y >= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_left = (y: number, x: number) => (y <= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_right = (y: number, x: number) => (y <= x) ? 1.0 : 0.0;
        let sdf = undefined;
        if (shape.tip.y > shape.base.y) {
          if (shape.base.x > shape.tip.x) {
            sdf = sdf_slope_top_left;
          } else {
            sdf = sdf_slope_top_right;
          }
        } else {
          if (shape.base.x > shape.tip.x) {
            sdf = sdf_slope_bottom_left;
          } else {
            sdf = sdf_slope_bottom_right;
          }
        }
        const multisample_sdf = get_sdf_multisample(sdf);
        region_sdf = {
          region_id: {
            x: { min: rx_min, max: rx_max },
            y: { min: ry_min, max: ry_max },
          },
          fill: {
            type: "multisample",
            sdf: multisample_sdf,
          },
        };
        break;
      }
    }

    if (shape.min_gridlines !== undefined) {
      for (const axis of AXES_2D) {
        const min_gridlines = shape.min_gridlines[axis];
        const region_id = region_sdf.region_id[axis];
        if (min_gridlines === undefined) continue;
        if (region_id.min === undefined) continue;
        if (region_id.max === undefined) continue;
        this.min_gridlines[axis].push({
          region_id_min: region_id.min,
          region_id_max: region_id.max,
          count: min_gridlines,
        });
      }
    }
    this.profiler?.end();
    return region_sdf;
  }

  setup_calculate_unpadded_boundary(): Vec2<Bound<number>> {
    this.profiler?.begin("calculate_unpadded_boundary");
    const bound: Vec2<Partial<Bound<number>>> = {
      x: { min: undefined, max: undefined, },
      y: { min: undefined, max: undefined, },
    };
    for (const axis of AXES_2D) {
      const line_builder = this.region_lines_builder[axis];
      line_builder.sort();
      const lines = line_builder.lines;
      if (lines.length <= 0) {
        throw Error(`No lines provided for axis ${axis}`);
      }
      bound[axis].min = lines[0];
      bound[axis].max = lines[lines.length-1];
    }
    this.profiler?.end();
    return bound as Vec2<Bound<number>>;
  }

  setup_pad_grid(): Vec2<Partial<Bound<number>>> {
    this.profiler?.begin("pad_grid");
    const padded_boundary: Vec2<Partial<Bound<number>>> = {
      x: { min: undefined, max: undefined },
      y: { min: undefined, max: undefined },
    };

    for (const axis of AXES_2D) {
      const unpadded_bound = this.unpadded_boundary[axis];
      const unpadded_size = unpadded_bound.max-unpadded_bound.min;
      const multiplier = this.config.padding_size_multiplier[axis];
      const padding_size = unpadded_size*multiplier;

      const lines_builder = this.region_lines_builder[axis];
      const bound = this.unpadded_boundary[axis];
      const is_pad = this.padding[axis];
      const padded = padded_boundary[axis];
      if (is_pad.min) {
        const pad_min = bound.min-padding_size;
        lines_builder.push(pad_min);
        padded.min = pad_min;
      }
      if (is_pad.max) {
        const pad_max = bound.max+padding_size;
        lines_builder.push(pad_max);
        padded.max = pad_max;
      }
    }
    this.profiler?.end();
    return padded_boundary;
  }

  setup_merge_nearby_region_lines() {
    this.profiler?.begin("merge_nearby_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    for (const axis of AXES_2D) {
      const lines_builder = this.region_lines_builder[axis];
      lines_builder.merge(merge_size);
    }
    this.profiler?.end();
  }

  setup_rescale_region_lines() {
    this.profiler?.begin("rescale_region_lines");
    const region_sizes = [];
    for (const axis of AXES_2D) {
      const regions = this.region_lines_builder[axis].to_regions();
      for (const region of regions) {
        region_sizes.push(region);
      }
    }
    // rescale for best accuracy for 32bit floating point
    const log_mean = get_log_median(region_sizes);
    const scale = 1.0/log_mean;
    for (const axis of AXES_2D) {
      this.region_lines_builder[axis].apply_scale(scale);
    }
    this.grid_scale *= scale;
    this.profiler?.end();
  }

  setup_subdivide_region_lines(): Vec2<RegionToGridMap> {
    this.profiler?.begin("create_x_region_to_grid_map");
    const region_to_grid_map: Partial<Vec2<RegionToGridMap>> = {};

    for (const axis of AXES_2D) {
      const line_builder = this.region_lines_builder[axis];
      const spacings = line_builder.to_regions();
      const specs: RegionSpecification[] = spacings.map((spacing) => {
        return { size: spacing };
      });

      const overrides = this.min_gridlines[axis];
      for (const override of overrides) {
        const i_start = line_builder.get_index(override.region_id_min);
        const i_end = line_builder.get_index(override.region_id_max);
        for (let i = i_start; i < i_end; i++) {
          const spec = specs[i];
          if (spec.total_grid_lines === undefined || spec.total_grid_lines < override.count) {
            spec.total_grid_lines = override.count;
          }
        }
      }

      const min_subdivisions = this.config.min_subdivisions[axis];
      const max_ratio = this.config.max_ratio[axis];
      const segments = generate_region_mesh_segments(specs, min_subdivisions, max_ratio);
      region_to_grid_map[axis] = new RegionToGridMap(line_builder, segments);
    }
    return region_to_grid_map as Vec2<RegionToGridMap>;
  }

  setup_create_simulation_grid(): Grid {
    this.profiler?.begin("create_simulation_grid");
    const size: Vec2<number> = {
      x: this.region_to_grid_map.x.total_grid_segments,
      y: this.region_to_grid_map.y.total_grid_segments,
    };
    const grid = new Grid(this.module, size);
    grid.dx.array_view.set(this.region_to_grid_map.x.grid_segments);
    grid.dy.array_view.set(this.region_to_grid_map.y.grid_segments);
    grid.x.array_view.set(this.region_to_grid_map.x.grid_lines);
    grid.y.array_view.set(this.region_to_grid_map.y.grid_lines);
    this.profiler?.end();
    return grid;
  }

  setup_fill_sdf_regions() {
    this.profiler?.begin("fill_sdfs");
    for (const region of this.sdf_regions) {
      this.setup_fill_sdf_region(region);
    }
    this.profiler?.end();
  }

  setup_fill_sdf_region(region: RegionSDF) {
    if (region.type === "empty") return;

    const grid_size: Vec2<number> = {
      x: 0,
      y: 0,
    };
    let set_data = undefined as (undefined | ((i: number, beta: number) => void));
    switch (region.type) {
      case "voltage": {
        const arr = this.grid.v_index_beta;
        const data = arr.array_view;
        grid_size.y = arr.shape[0];
        grid_size.x = arr.shape[1];
        const index = region.voltage_index;
        if (index === null) {
          const v_none = Grid.pack_index_beta(0, 0);
          set_data = (i: number, beta: number): void => {
            if (beta > 0.5) data[i] = v_none;
          }
        } else {
          set_data = (i: number, beta: number): void => {
            const old_value = data[i];
            const { index: old_index, beta: old_beta } = Grid.unpack_index_beta(old_value);
            if (old_index !== index) {
              data[i] = Grid.pack_index_beta(index, beta);
            } else {
              const new_beta = Math.min(beta+old_beta, 1.0);
              data[i] = Grid.pack_index_beta(index, new_beta);
            }
          }
        }
        break;
      }
      case "dielectric": {
        const arr = this.grid.ek_index_beta;
        const data = arr.array_view;
        grid_size.y = arr.shape[0];
        grid_size.x = arr.shape[1];
        const index = region.dielectric_index;
        if (index === null) {
          const er0 = Grid.pack_index_beta(0, 0);
          set_data = (i: number, beta: number): void => {
            if (beta > 0.5) data[i] = er0;
          }
        } else {
          set_data = (i: number, beta: number): void => {
            const old_value = data[i];
            const { index: old_index, beta: old_beta } = Grid.unpack_index_beta(old_value);
            if (old_index !== index) {
              data[i] = Grid.pack_index_beta(index, beta);
            } else {
              const new_beta = Math.min(beta+old_beta, 1.0);
              data[i] = Grid.pack_index_beta(index, new_beta);
            }
          }
        }
        break;
      }
    }

    for (const sdf of region.sdfs) {
      const { region_id, fill } = sdf;

      const partial_grid_bound: Vec2<Partial<Bound<number>>> = {
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined },
      };

      for (const axis of AXES_2D) {
        const id = region_id[axis];
        const region_to_grid_map = this.region_to_grid_map[axis];
        if (id.min !== undefined) {
          partial_grid_bound[axis].min = region_to_grid_map.id_to_grid_index(id.min);
        }
        if (id.max !== undefined) {
          partial_grid_bound[axis].max = region_to_grid_map.id_to_grid_index(id.max);
        }
      }

      // voltage SDF should include boundaries of grid region
      if (region.type === "voltage") {
        for (const axis of AXES_2D) {
          if (partial_grid_bound[axis].max !== undefined) {
            partial_grid_bound[axis].max += 1;
          }
        }
      }

      for (const axis of AXES_2D) {
        if (partial_grid_bound[axis].min === undefined) {
          partial_grid_bound[axis].min = 0;
        }
        if (partial_grid_bound[axis].max === undefined) {
          partial_grid_bound[axis].max = grid_size[axis];
        }
      }

      const grid_absolute_bound: Vec2<Bound<number>> = {
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
      };
      for (const axis of AXES_2D) {
        const partial_bound = partial_grid_bound[axis];
        const bound = grid_absolute_bound[axis];
        bound.min = partial_bound.min ?? 0;
        bound.max = partial_bound.max ?? grid_size[axis];
      }

      // get normalised grid coordinates for SDFs
      const grid_count: Vec2<number> = {
        x: 0,
        y: 0,
      };
      for (const axis of AXES_2D) {
        const bound = grid_absolute_bound[axis];
        grid_count[axis] = bound.max-bound.min;
      }

      const grid_offset: Vec2<number[]> = {
        x: [],
        y: [],
      };
      const grid_spacing: Vec2<number[]> = {
        x: [],
        y: [],
      };
      for (const axis of AXES_2D) {
        const bound = grid_absolute_bound[axis];
        const region_to_grid_map = this.region_to_grid_map[axis];
        grid_offset[axis] = region_to_grid_map.grid_lines.slice(bound.min, bound.max);
        grid_spacing[axis] = region_to_grid_map.grid_segments.slice(bound.min, bound.max);
      }

      if (region.type === "dielectric") {
        // centre coordinate to dielectric cell
        for (const axis of AXES_2D) {
          const N = grid_count[axis];
          const offsets = grid_offset[axis];
          const spacings = grid_spacing[axis];
          if (offsets.length !== spacings.length) {
            throw Error(`Mismatch between grid lines (${offsets.length}) and grid spacing (${spacings.length}) array lengths along axis: ${axis}`);
          }
          for (let i = 0; i < N; i++) {
            offsets[i] += spacings[i]/2;
          }
        }
      }

      const grid_total_size: Vec2<number> = {
        x: 0,
        y: 0,
      };
      for (const axis of AXES_2D) {
        const sizes = grid_spacing[axis];
        let sum = 0;
        for (let i = 0; i < sizes.length; i++) {
          sum += sizes[i];
        }
        grid_total_size[axis] = sum;
      }
      const grid_norm_spacing: Vec2<number[]> = {
        x: [],
        y: [],
      };
      const grid_norm_offset: Vec2<number[]> = {
        x: [],
        y: [],
      };
      for (const axis of AXES_2D) {
        const total_size = grid_total_size[axis];
        const offsets = grid_offset[axis];
        const min_offset = offsets[0];
        grid_norm_spacing[axis] = grid_spacing[axis].map(size => size/total_size);
        grid_norm_offset[axis] = grid_offset[axis].map(line => (line-min_offset)/total_size);
      }

      const grid_relative_bound: Vec2<Bound<number>> = {
        x: { min: 0, max: grid_count.x },
        y: { min: 0, max: grid_count.y },
      };
      // voltage region allows customisation of whether outer or inner boundaries are used
      if (region.type === "voltage" && region.ignore_boundary !== undefined) {
        const boundary = region.ignore_boundary;
        for (const axis of AXES_2D) {
          const bound = boundary[axis];
          if (bound === undefined) continue;
          if (bound.min) grid_relative_bound[axis].min = 1;
          if (bound.max) grid_relative_bound[axis].max = grid_count[axis]-1;
        }
      }

      switch (fill.type) {
        case "point": {
          const sdf = fill.sdf;
          for (let y = grid_relative_bound.y.min; y < grid_relative_bound.y.max; y++) {
            const norm_y = grid_norm_offset.y[y];
            const gy = grid_absolute_bound.y.min+y;
            for (let x = grid_relative_bound.x.min; x < grid_relative_bound.x.max; x++) {
              const norm_x = grid_norm_offset.x[x];
              const gx = grid_absolute_bound.x.min+x;
              const i = gx + gy*grid_size.x;
              const beta = sdf(norm_y, norm_x);
              set_data(i, beta);
            }
          }
          break;
        }
        case "multisample": {
          const sdf = fill.sdf;
          for (let y = grid_relative_bound.y.min; y < grid_relative_bound.y.max; y++) {
            const norm_y = grid_norm_offset.y[y];
            const norm_dy = grid_norm_spacing.y[y];
            const gy = grid_absolute_bound.y.min+y;
            for (let x = grid_relative_bound.x.min; x < grid_relative_bound.x.max; x++) {
              const norm_x = grid_norm_offset.x[x];
              const norm_dx = grid_norm_spacing.x[x];
              const gx = grid_absolute_bound.x.min+x;
              const i = gx + gy*grid_size.x;
              const beta = sdf(norm_y, norm_x, norm_dy, norm_dx);
              set_data(i, beta);
            }
          }
          break;
        }
        case "constant": {
          const beta = 1.0;
          for (let y = grid_relative_bound.y.min; y < grid_relative_bound.y.max; y++) {
            const gy = grid_absolute_bound.y.min+y;
            for (let x = grid_relative_bound.x.min; x < grid_relative_bound.x.max; x++) {
              const gx = grid_absolute_bound.x.min+x;
              const i = gx + gy*grid_size.x;
              set_data(i, beta);
            }
          }
          break;
        }
      }
    }
  }

  setup_allocate_lookup_tables() {
    this.profiler?.begin("allocate_lookup_tables");
    let voltage_table_size = 1;
    for (const index of this.voltage_indices.values()) {
      voltage_table_size = Math.max(voltage_table_size, index+1);
    }

    let dielectric_table_size = 1;
    for (const index of this.dielectric_indices.values()) {
      dielectric_table_size = Math.max(dielectric_table_size, index+1);
    }

    this.grid.v_table = Float32ModuleNdarray.from_shape(this.module, [voltage_table_size]);
    this.grid.ek_table = Float32ModuleNdarray.from_shape(this.module, [dielectric_table_size]);
    this.profiler?.end();
  }

  get mesh_lines(): Vec2<MeshLines> {
    const mesh: Partial<Vec2<MeshLines>> = {};
    for (const axis of AXES_2D) {
      const region_to_grid_map = this.region_to_grid_map[axis];
      mesh[axis] = {
        region_lines: region_to_grid_map.region_lines,
        grid_lines: region_to_grid_map.grid_lines,
        scale: region_to_grid_map.region_lines_builder.scale,
        unpadded_boundary: this.unpadded_boundary[axis],
        padded_boundary: this.padded_boundary[axis],
        mesh_segments: region_to_grid_map.region_segments,
        flip: false,
      };
    }
    return mesh as Vec2<MeshLines>;
  }
}
