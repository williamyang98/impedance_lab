import { LinesBuilder } from "../mesher/lines_builder.ts";
import { generate_region_mesh_segments, type RegionSpecification } from "../mesher/regions.ts";
import { Profiler } from "../../utility/profiler.ts";
import { CpuGrid } from "./grid.ts";

export type Axis3D = "x" | "y" | "z";
export const axes: Axis3D[] = ["x", "y", "z"];
export type AxisValue<T> = Record<Axis3D, T>;
export type AxisBound<T> = Record<Axis3D, { min: T, max: T}>;

export type Position3D = AxisValue<number>;

export interface MeshConfig {
  min_gridlines: Partial<AxisValue<number>>;
}

export interface CylinderShape {
  readonly type: "cylinder";
  center: Position3D;
  radius: number;
  length?: number; // extend along entire axis if undefined
  axis: Axis3D;
  config: Partial<MeshConfig>;
}

export interface CuboidShape {
  readonly type: "cuboid";
  start: Partial<Position3D>; // extend to edge of grid if undefined
  end: Partial<Position3D>;
  config: Partial<MeshConfig>;
}

export interface TriangularPrismShape {
  readonly type: "triangular_prism";
  base: Position3D; // first point of triangular
  width: number; // second point base displacement relative to base
  height: number; // third point height displacement relative to base
  length?: number; // extend along entire axis if undefined
  // meaning of width/height for axis extrusion
  // for axis = x, width = dy, height = dz
  // for axis = y, width = dx, height = dz
  // for axis = z, width = dx, height = dy
  axis: Axis3D;
  config: Partial<MeshConfig>;
}

export type Shape = CylinderShape | CuboidShape | TriangularPrismShape;

export type IgnoreBoundary = Partial<AxisValue<{ min?: boolean, max?: boolean }>>;

export interface VoltageRegion {
  readonly type: "voltage";
  voltage: number | null; // null = remove voltage from that region
  ignore_boundary?: IgnoreBoundary;
  shapes: Shape[];
}

export interface DielectricRegion {
  readonly type: "dielectric";
  epsilon: number | null; // null = remove dielectric from that region
  shapes: Shape[];
}

export interface EmptyRegion {
  readonly type: "empty";
  shapes: Shape[];
}

export type Region = VoltageRegion | DielectricRegion | EmptyRegion;
export type RegionType = Region["type"];

export interface GridBuilderConfig {
  minimum_grid_resolution: number; // smallest possible region size before it is ignored
  padding_size_multiplier: number; // amount of air padding to add around simulation region
  mesh: AxisValue<{
    max_ratio: number, // maximum ratio between adjacent grid sections
    min_subdivisions: number, // minimum number of grid sections between region lines
  }>;
}

export type GridBuilderPadding = AxisBound<boolean>;

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
  region_id: AxisBound<number | undefined>;
  fill: {
    readonly type: "point",
    // x=0,y=0,z=0 is front top left
    sdf: (z: number, y: number, x: number) => number,
  } | {
    readonly type: "constant",
  };
}

type RegionSDF =
  { type: "voltage", sdfs: SDF[], voltage: number | null, ignore_boundary?: IgnoreBoundary } |
  { type: "dielectric", sdfs: SDF[], epsilon: number | null } |
  { type: "empty", sdfs: SDF[] };

const er0 = 1.0;

// Grid builder breaks down regions into the following heirarchy
// (0,0,0) is front-top-left
// positive x-axis goes from left to right
// positive y-axis goes from top to bottom
// positive z-axis goes from front to back
// Region -> Shapes[] -> SDF[]
export class GridBuilder {
  grid: CpuGrid;
  regions: Region[];
  padding: GridBuilderPadding;
  sdf_regions: RegionSDF[];
  grid_lines_builder: AxisValue<LinesBuilder>;
  min_gridlines: AxisValue<{
    region_id_min: number,
    region_id_max: number,
    count: number,
  }[]>;
  unpadded_boundary: AxisBound<number>;
  padded_boundary: Partial<AxisBound<number>>;
  grid_scale: number = 1.0;
  dielectric_indices = new Set<number>();
  voltage_indices = new Set<number>();
  config: GridBuilderConfig;
  profiler?: Profiler;

  constructor(regions: Region[], config: GridBuilderConfig, padding: GridBuilderPadding, profiler?: Profiler) {
    this.regions = regions;
    this.config = config;
    this.padding = padding;
    this.profiler = profiler;

    this.grid_lines_builder = {
      x: new LinesBuilder(),
      y: new LinesBuilder(),
      z: new LinesBuilder(),
    };
    this.min_gridlines = {
      x: [],
      y: [],
      z: [],
    };
    this.sdf_regions = this.setup_create_sdf_regions(regions);
    this.unpadded_boundary = this.setup_calculate_unpadded_boundary();
    this.padded_boundary = this.setup_pad_grid();
    this.setup_merge_nearby_region_lines();
    this.setup_subdivide_region_lines();
    this.setup_rescale_region_lines();
    this.grid = this.setup_create_simulation_grid();
    this.setup_fill_sdf_regions();
  }
  setup_create_sdf_regions(regions: Region[]) {
    this.profiler?.begin("create_fill_regions");
    const fill_regions: RegionSDF[] = [];
    for (const region of regions) {
      const sdfs = region.shapes.map(region => this.setup_create_sdf_from_shape(region));
      switch (region.type) {
        case "voltage": {
          fill_regions.push({
            type: "voltage" as const,
            sdfs: sdfs,
            voltage: region.voltage,
            ignore_boundary: region.ignore_boundary,
          });
          break;
        }
        case "dielectric": {
          fill_regions.push({
            type: "dielectric" as const,
            sdfs: sdfs,
            epsilon: region.epsilon,
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
      case "cylinder": {
        const region_id: AxisBound<number | undefined> = {
          x: { min: undefined, max: undefined },
          y: { min: undefined, max: undefined },
          z: { min: undefined, max: undefined },
        };
        let sdf = undefined as (undefined | ((z: number, y: number, x: number) => number));
        const epsilon = 1e-3; // guarantee boundaries are included
        const radius_squared = 0.5**2 + epsilon;
        const common_sdf = (x: number, y: number): number => {
          return ((x-0.5)**2 + (y-0.5)**2 <= radius_squared) ? 1.0 : 0.0;
        };

        let r0_axis = undefined as (undefined | Axis3D);
        let r1_axis = undefined as (undefined | Axis3D);
        let length_axis = undefined as (undefined | Axis3D);
        switch (shape.axis) {
          case "x": {
            length_axis = "x";
            r0_axis = "y";
            r1_axis = "z";
            sdf = (z: number, y: number, _x: number) => common_sdf(y,z);
            break;
          }
          case "y": {
            length_axis = "y";
            r0_axis = "x";
            r1_axis = "z";
            sdf = (z: number, _y: number, x: number) => common_sdf(x,z);
            break;
          }
          case "z": {
            length_axis = "z";
            r0_axis = "x";
            r1_axis = "y";
            sdf = (_z: number, y: number, x: number) => common_sdf(x,y);
            break;
          }
        }

        const r0_lines = this.grid_lines_builder[r0_axis];
        const r1_lines = this.grid_lines_builder[r1_axis];
        const length_lines = this.grid_lines_builder[length_axis];
        region_id[r0_axis].min = r0_lines.push(shape.center[r0_axis]-shape.radius);
        region_id[r0_axis].max = r0_lines.push(shape.center[r0_axis]+shape.radius);
        region_id[r1_axis].min = r1_lines.push(shape.center[r1_axis]-shape.radius);
        region_id[r1_axis].max = r1_lines.push(shape.center[r1_axis]+shape.radius);
        // make sure radii of circle is correctly represented
        r0_lines.push(shape.center[r0_axis]);
        r1_lines.push(shape.center[r1_axis]);
        // for (let theta_n = 0; theta_n < 3; theta_n++) {
        //   // make sure we at least have a boundary condition near k*45'
        //   const dr0 = Math.sin((theta_n+1)*Math.PI/6);
        //   const dr1 = Math.cos((theta_n+1)*Math.PI/6);
        //   const threshold = shape.radius*0.1;
        //   r0_lines.push(shape.center[r0_axis]-shape.radius*dr0, threshold);
        //   r0_lines.push(shape.center[r0_axis]+shape.radius*dr0, threshold);
        //   r1_lines.push(shape.center[r1_axis]-shape.radius*dr1, threshold);
        //   r1_lines.push(shape.center[r1_axis]+shape.radius*dr1, threshold);
        // }
        if (shape.length !== undefined) {
          const length_0 = shape.center[length_axis];
          const length_1 = shape.center[length_axis] + shape.length;
          region_id[length_axis].min = length_lines.push(Math.min(length_0, length_1));
          region_id[length_axis].max = length_lines.push(Math.max(length_0, length_1));
        }

        region_sdf = {
          region_id,
          fill: {
            type: "point",
            sdf,
          },
        };
        break;
      }
      case "cuboid": {
        const region_id: AxisBound<number | undefined> = {
          x: { min: undefined, max: undefined },
          y: { min: undefined, max: undefined },
          z: { min: undefined, max: undefined },
        };
        for (const axis of axes) {
          const lines_builder = this.grid_lines_builder[axis];
          region_id[axis].min = shape.start[axis] !== undefined ? lines_builder.push(shape.start[axis]) : undefined;
          region_id[axis].max = shape.end[axis] !== undefined ? lines_builder.push(shape.end[axis]) : undefined;
        }

        region_sdf = {
          region_id,
          fill: {
            type: "constant",
          },
        };
        break;
      }
      case "triangular_prism": {
        const region_id: AxisBound<number | undefined> = {
          x: { min: undefined, max: undefined },
          y: { min: undefined, max: undefined },
          z: { min: undefined, max: undefined },
        };

        const sdf_slope_bottom_left = (y: number, x: number) => (y >= x) ? 1.0 : 0.0;
        const sdf_slope_bottom_right = (y: number, x: number) => (y >= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_left = (y: number, x: number) => (y <= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_right = (y: number, x: number) => (y <= x) ? 1.0 : 0.0;
        let common_sdf = undefined;
        if (shape.height > 0) {
          if (shape.width > 0) {
            common_sdf = sdf_slope_top_left;
          } else {
            common_sdf = sdf_slope_top_right;
          }
        } else {
          if (shape.width > 0) {
            common_sdf = sdf_slope_bottom_left;
          } else {
            common_sdf = sdf_slope_bottom_right;
          }
        }

        let width_axis = undefined as (undefined | Axis3D);
        let height_axis = undefined as (undefined | Axis3D);
        let length_axis = undefined as (undefined | Axis3D);

        let sdf = undefined as (undefined | ((z: number, y: number, x: number) => number));
        switch (shape.axis) {
          case "x": {
            length_axis = "x";
            width_axis = "y";
            height_axis = "z";
            sdf = (z: number, y: number, _x: number) => common_sdf(z, y);
            break;
          }
          case "y": {
            length_axis = "y";
            width_axis = "x";
            height_axis = "z";
            sdf = (z: number, _y: number, x: number) => common_sdf(z, x);
            break;
          }
          case "z": {
            length_axis = "z";
            width_axis = "x";
            height_axis = "y";
            sdf = (_z: number, y: number, x: number) => common_sdf(y, x);
            break;
          }
        }

        const width_lines = this.grid_lines_builder[width_axis];
        const height_lines = this.grid_lines_builder[height_axis];
        const length_lines = this.grid_lines_builder[length_axis];

        const width_0 = shape.base[width_axis];
        const width_1 = shape.base[width_axis] + shape.width;
        const height_0 = shape.base[height_axis];
        const height_1 = shape.base[height_axis] + shape.height;

        region_id[width_axis].min = width_lines.push(Math.min(width_0, width_1));
        region_id[width_axis].max = width_lines.push(Math.max(width_0, width_1));
        region_id[height_axis].min = height_lines.push(Math.min(height_0, height_1));
        region_id[height_axis].max = height_lines.push(Math.max(height_0, height_1));
        if (shape.length !== undefined) {
          const length_0 = shape.base[length_axis];
          const length_1 = shape.base[length_axis] + shape.length;
          region_id[length_axis].min = length_lines.push(Math.min(length_0, length_1));
          region_id[length_axis].max = length_lines.push(Math.max(length_0, length_1));
        }
        region_sdf = {
          region_id,
          fill: {
            type: "point",
            sdf,
          },
        };
        break;
      }
    }

    const config = shape.config;
    if (config.min_gridlines !== undefined) {
      for (const axis of axes) {
        const count = config.min_gridlines[axis];
        const bound = region_sdf.region_id[axis];
        if (count === undefined) continue;
        if (bound.min === undefined) continue;
        if (bound.max === undefined) continue;
        this.min_gridlines[axis].push({
          region_id_min: bound.min,
          region_id_max: bound.max,
          count,
        });
      }
    }
    this.profiler?.end();
    return region_sdf;
  }

  setup_calculate_unpadded_boundary(): typeof this.unpadded_boundary {
    this.profiler?.begin("calculate_unpadded_boundary");
    const bound: AxisBound<number | undefined> = {
      x: { min: undefined, max: undefined, },
      y: { min: undefined, max: undefined, },
      z: { min: undefined, max: undefined, },
    };
    for (const axis of axes) {
      const line_builder = this.grid_lines_builder[axis];
      line_builder.sort();
      const lines = line_builder.lines;
      if (lines.length <= 0) {
        throw Error(`No lines provided for axis ${axis}`);
      }
      bound[axis].min = lines[0];
      bound[axis].max = lines[lines.length-1];
    }
    this.profiler?.end();
    return bound as AxisBound<number>;
  }

  setup_pad_grid(): typeof this.padded_boundary {
    this.profiler?.begin("pad_grid");
    const padding_size = axes
      .map(axis => this.unpadded_boundary[axis])
      .map(bound => bound.max-bound.min)
      .reduce((a,b) => Math.max(a,b), -Infinity)
      *this.config.padding_size_multiplier;

    const padded_boundary: typeof this.padded_boundary = {};
    for (const axis of axes) {
      const bound = this.unpadded_boundary[axis];
      const pad_min = bound.min-padding_size;
      const pad_max = bound.max+padding_size;
      padded_boundary[axis] = { min: pad_min, max: pad_max };
      const lines_builder = this.grid_lines_builder[axis];
      lines_builder.push(pad_min);
      lines_builder.push(pad_max);
    }
    this.profiler?.end();
    return padded_boundary;
  }

  setup_merge_nearby_region_lines() {
    this.profiler?.begin("merge_nearby_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    for (const axis of axes) {
      const lines_builder = this.grid_lines_builder[axis];
      lines_builder.merge(merge_size);
    }
    this.profiler?.end();
  }

  setup_rescale_region_lines() {
    this.profiler?.begin("rescale_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    const region_sizes = [];
    for (const axis of axes) {
      const regions = this.grid_lines_builder[axis].to_regions();
      for (const region of regions) {
        if (region < merge_size) continue;
        region_sizes.push(region);
      }
    }
    // rescale for best accuracy for 32bit floating point
    const log_mean = get_log_median(region_sizes);
    const scale = 1.0/log_mean;
    for (const axis of axes) {
      this.grid_lines_builder[axis].apply_scale(scale);
    }
    this.grid_scale *= scale;
    this.profiler?.end();
  }

  setup_subdivide_region_lines() {
    for (const axis of axes) {
      const specs: RegionSpecification[] = [];
      const line_builder = this.grid_lines_builder[axis];
      const spacings = line_builder.to_regions();
      for (const spacing of spacings) {
        specs.push({ size: spacing });
      }
      const mesh_config = this.config.mesh[axis];
      const overrides = this.min_gridlines[axis];
      for (const override of overrides) {
        const i_start = line_builder.get_index(override.region_id_min);
        const i_end = line_builder.get_index(override.region_id_min);
        for (let i = i_start; i < i_end; i++) {
          const spec = specs[i];
          if (spec.total_grid_lines === undefined || spec.total_grid_lines < override.count) {
            spec.total_grid_lines = override.count;
          }
        }
      }

      const segments = generate_region_mesh_segments(specs, mesh_config.min_subdivisions, mesh_config.max_ratio);
      const offsets = line_builder.lines.slice(0, segments.length);
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        let offset = offsets[i];
        const deltas = segment.generate_deltas();
        for (const delta of deltas) {
          offset += delta;
          line_builder.push(offset);
        }
      }
      line_builder.merge(this.config.minimum_grid_resolution*0.99);
    }
  }

  setup_create_simulation_grid(): CpuGrid {
    this.profiler?.begin("create_simulation_grid");
    const grid = new CpuGrid({
      x: this.grid_lines_builder.x.lines.length-1,
      y: this.grid_lines_builder.y.lines.length-1,
      z: this.grid_lines_builder.z.lines.length-1,
    });
    grid.dx.data.set(this.grid_lines_builder.x.to_regions());
    grid.dy.data.set(this.grid_lines_builder.y.to_regions());
    grid.dz.data.set(this.grid_lines_builder.z.to_regions());
    grid.x.data.set(this.grid_lines_builder.x.lines);
    grid.y.data.set(this.grid_lines_builder.y.lines);
    grid.z.data.set(this.grid_lines_builder.z.lines);
    grid.er.data.fill(er0);
    this.profiler?.end();
    return grid;
  }

  setup_fill_sdf_regions() {
    this.profiler?.begin("fill_sdfs");
    for (const fill of this.sdf_regions) {
      this.setup_fill_sdf_region(fill);
    }
    this.profiler?.end();
  }

  setup_fill_sdf_region(region: RegionSDF) {
    if (region.type === "empty") return;

    const grid_count: AxisValue<number> = {
      x: 0,
      y: 0,
      z: 0,
    };
    let set_data = undefined as (undefined | ((i: number, beta: number) => void));
    switch (region.type) {
      case "dielectric": {
        grid_count.z = this.grid.er.shape[0];
        grid_count.y = this.grid.er.shape[1];
        grid_count.x = this.grid.er.shape[2];
        const er = this.grid.er.data;
        const epsilon = region.epsilon;
        if (epsilon === null) {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            er[i] = er0;
          }
        } else {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            er[i] = epsilon;
          }
        }
        break;
      }
      case "voltage": {
        grid_count.z = this.grid.b.shape[0];
        grid_count.y = this.grid.b.shape[1];
        grid_count.x = this.grid.b.shape[2];
        const b = this.grid.b.data;
        const mask = this.grid.mask.data;
        const mask_bits = 32;
        const voltage = region.voltage;
        if (voltage === null) {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            b[i] = 0;
            const imask = Math.floor(i/mask_bits);
            const imask_offset = i-imask*mask_bits;
            mask[imask] &= ~(1 << imask_offset);
          }
        } else {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            b[i] = voltage;
            const imask = Math.floor(i/mask_bits);
            const imask_offset = i-imask*mask_bits;
            mask[imask] |= (1 << imask_offset);
          }
        }
        break;
      }
    }

    const grid_count_x = grid_count.x;
    const grid_count_xy = grid_count.x*grid_count.y;

    for (const sdf of region.sdfs) {
      const { region_id, fill } = sdf;

      const partial_region_bound: AxisBound<number | undefined> = {
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined },
        z: { min: undefined, max: undefined },
      };

      for (const axis of axes) {
        const id = region_id[axis];
        const lines_builder = this.grid_lines_builder[axis];
        if (id.min !== undefined) {
          partial_region_bound[axis].min = lines_builder.get_index(id.min);
        }
        if (id.max !== undefined) {
          partial_region_bound[axis].max = lines_builder.get_index(id.max);
        }
      }

      for (const axis of axes) {
        if (partial_region_bound[axis].min === undefined) {
          partial_region_bound[axis].min = 0;
        }
        if (partial_region_bound[axis].max === undefined) {
          partial_region_bound[axis].max = grid_count[axis];
        }
      }

      const region_absolute_bound: AxisBound<number> = {
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
        z: { min: 0, max: 0 },
      };
      for (const axis of axes) {
        const partial_bound = partial_region_bound[axis];
        const bound = region_absolute_bound[axis];
        bound.min = partial_bound.min ?? 0;
        bound.max = partial_bound.max ?? grid_count[axis];
      }

      // get normalised grid coordinates for SDFs
      const region_count: AxisValue<number> = {
        x: 0,
        y: 0,
        z: 0,
      };
      for (const axis of axes) {
        const bound = region_absolute_bound[axis];
        region_count[axis] = bound.max - bound.min;
      }

      const region_offset: AxisValue<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      const region_spacing: AxisValue<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      for (const axis of axes) {
        const bound = region_absolute_bound[axis];
        const lines_builder = this.grid_lines_builder[axis];
        region_offset[axis] = lines_builder.lines.slice(bound.min, bound.max);
        region_spacing[axis] = lines_builder.to_regions().slice(bound.min, bound.max);
      }

      if (region.type === "dielectric") {
        // centre coordinate for dielectric cell
        for (const axis of axes) {
          const N = region_count[axis];
          const offsets = region_offset[axis];
          const spacings = region_spacing[axis];
          if (offsets.length !== spacings.length) {
            throw Error(`Mismatch between grid lines (${offsets.length}) and grid spacing (${spacings.length}) array lengths along axis: ${axis}`);
          }
          for (let i = 0; i < N; i++) {
            offsets[i] += spacings[i]/2;
          }
        }
      }

      const region_total_size: AxisValue<number> = {
        x: 0,
        y: 0,
        z: 0,
      };
      for (const axis of axes) {
        const sizes = region_spacing[axis];
        let sum = 0;
        for (let i = 0; i < sizes.length; i++) {
          sum += sizes[i];
        }
        region_total_size[axis] = sum;
      }
      const region_norm_spacing: AxisValue<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      const region_norm_offset: AxisValue<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      for (const axis of axes) {
        const total_size = region_total_size[axis];
        const offsets = region_offset[axis];
        const min_offset = offsets[0];
        region_norm_spacing[axis] = region_spacing[axis].map(size => size/total_size);
        region_norm_offset[axis] = region_offset[axis].map(line => (line-min_offset)/total_size);
      }

      const region_relative_bound: AxisBound<number> = {
        x: { min: 0, max: region_count.x },
        y: { min: 0, max: region_count.y },
        z: { min: 0, max: region_count.z },
      };
      // voltage region allows customisation of whether outer or inner boundaries are used
      if (region.type === "voltage" && region.ignore_boundary !== undefined) {
        const boundary = region.ignore_boundary;
        for (const axis of axes) {
          const bound = boundary[axis];
          if (bound === undefined) continue;
          if (bound.min) region_relative_bound[axis].min = 1;
          if (bound.max) region_relative_bound[axis].max = region_count[axis]-1;
        }
      }

      switch (fill.type) {
        case "point": {
          const sdf = fill.sdf;
          for (let z = region_relative_bound.z.min; z < region_relative_bound.z.max; z++) {
            const norm_z = region_norm_offset.z[z];
            const gz = region_absolute_bound.z.min+z;
            for (let y = region_relative_bound.y.min; y < region_relative_bound.y.max; y++) {
              const norm_y = region_norm_offset.y[y];
              const gy = region_absolute_bound.y.min+y;
              for (let x = region_relative_bound.x.min; x < region_relative_bound.x.max; x++) {
                const norm_x = region_norm_offset.x[x];
                const gx = region_absolute_bound.x.min+x;
                const i = gx + gy*grid_count.x + gz*grid_count_xy;
                const beta = sdf(norm_z, norm_y, norm_x);
                set_data(i, beta);
              }
            }
          }
          break;
        }
        case "constant": {
          const beta: number = 1.0;
          for (let z = region_relative_bound.z.min; z < region_relative_bound.z.max; z++) {
            const gz = region_absolute_bound.z.min+z;
            for (let y = region_relative_bound.y.min; y < region_relative_bound.y.max; y++) {
              const gy = region_absolute_bound.y.min+y;
              for (let x = region_relative_bound.x.min; x < region_relative_bound.x.max; x++) {
                const gx = region_absolute_bound.x.min+x;
                const i = gx + gy*grid_count_x + gz*grid_count_xy;
                set_data(i, beta);
              }
            }
          }
          break;
        }

      }
    }
  }
}
