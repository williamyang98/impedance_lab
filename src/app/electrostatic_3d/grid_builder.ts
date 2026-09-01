import { LinesBuilder } from "../mesher/lines_builder.ts";
import { generate_region_mesh_segments, RegionToGridMap, type RegionSpecification } from "../mesher/regions.ts";
import { Profiler } from "../../utility/profiler.ts";
import { CpuGrid } from "./grid.ts";
import { type Vec3, type Axis3D, type Bound, AXES_3D } from "../../utility/dim_types.ts";

type Position3D = Vec3<number>;
type IgnoreBoundary = Partial<Vec3<Partial<Bound<boolean>>>>;
export type GridBuilderPadding = Vec3<Bound<boolean>>;

export interface MeshConfig {
  min_gridlines: Partial<Vec3<number>>;
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
  padding_size_multiplier: { // amount of air padding to add around simulation region
    x: number;
    y: number;
    z: number;
  };
  mesh: Vec3<{
    max_ratio: number, // maximum ratio between adjacent grid sections
    min_subdivisions: number, // minimum number of grid sections between region lines
  }>;
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
  region_id: Vec3<Partial<Bound<number>>>;
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
  region_lines_builder: Vec3<LinesBuilder>;
  region_to_grid_map: Vec3<RegionToGridMap>;
  min_gridlines: Vec3<{
    region_id_min: number,
    region_id_max: number,
    count: number,
  }[]>;
  unpadded_boundary: Vec3<Bound<number>>;
  padded_boundary: Vec3<Partial<Bound<number>>>;
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

    this.region_lines_builder = {
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
    this.setup_rescale_region_lines();
    this.region_to_grid_map = this.setup_subdivide_region_lines();
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
        const region_id: Vec3<Partial<Bound<number>>> = {
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

        const r0_lines = this.region_lines_builder[r0_axis];
        const r1_lines = this.region_lines_builder[r1_axis];
        const length_lines = this.region_lines_builder[length_axis];
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
        const region_id: Vec3<Partial<Bound<number>>> = {
          x: { min: undefined, max: undefined },
          y: { min: undefined, max: undefined },
          z: { min: undefined, max: undefined },
        };
        for (const axis of AXES_3D) {
          const lines_builder = this.region_lines_builder[axis];
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
        const region_id: Vec3<Partial<Bound<number>>> = {
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

        const width_lines = this.region_lines_builder[width_axis];
        const height_lines = this.region_lines_builder[height_axis];
        const length_lines = this.region_lines_builder[length_axis];

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
      for (const axis of AXES_3D) {
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

  setup_calculate_unpadded_boundary(): Vec3<Bound<number>> {
    this.profiler?.begin("calculate_unpadded_boundary");
    const bound: Vec3<Partial<Bound<number>>> = {
      x: { min: undefined, max: undefined, },
      y: { min: undefined, max: undefined, },
      z: { min: undefined, max: undefined, },
    };
    for (const axis of AXES_3D) {
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
    return bound as Vec3<Bound<number>>;
  }

  setup_pad_grid(): typeof this.padded_boundary {
    this.profiler?.begin("pad_grid");
    const padded_boundary: typeof this.padded_boundary = {
      x: { min: undefined, max: undefined },
      y: { min: undefined, max: undefined },
      z: { min: undefined, max: undefined },
    };

    for (const axis of AXES_3D) {
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
    for (const axis of AXES_3D) {
      const lines_builder = this.region_lines_builder[axis];
      lines_builder.merge(merge_size);
    }
    this.profiler?.end();
  }

  setup_rescale_region_lines() {
    this.profiler?.begin("rescale_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    const region_sizes = [];
    for (const axis of AXES_3D) {
      const regions = this.region_lines_builder[axis].to_regions();
      for (const region of regions) {
        if (region < merge_size) continue;
        region_sizes.push(region);
      }
    }
    // rescale for best accuracy for 32bit floating point
    const log_mean = get_log_median(region_sizes);
    const scale = 1.0/log_mean;
    for (const axis of AXES_3D) {
      this.region_lines_builder[axis].apply_scale(scale);
    }
    this.grid_scale *= scale;
    this.profiler?.end();
  }

  setup_subdivide_region_lines(): Vec3<RegionToGridMap> {
    const region_to_grid_map: Partial<Vec3<RegionToGridMap>> = {};
    for (const axis of AXES_3D) {
      const specs: RegionSpecification[] = [];
      const line_builder = this.region_lines_builder[axis];
      const spacings = line_builder.to_regions();
      for (const spacing of spacings) {
        specs.push({ size: spacing });
      }
      const mesh_config = this.config.mesh[axis];
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

      const segments = generate_region_mesh_segments(specs, mesh_config.min_subdivisions, mesh_config.max_ratio);
      region_to_grid_map[axis] = new RegionToGridMap(line_builder, segments);
    }
    return region_to_grid_map as Vec3<RegionToGridMap>;
  }

  setup_create_simulation_grid(): CpuGrid {
    this.profiler?.begin("create_simulation_grid");
    const grid = new CpuGrid({
      x: this.region_to_grid_map.x.grid_lines.length-1,
      y: this.region_to_grid_map.y.grid_lines.length-1,
      z: this.region_to_grid_map.z.grid_lines.length-1,
    });
    grid.dx.data.set(this.region_to_grid_map.x.grid_segments);
    grid.dy.data.set(this.region_to_grid_map.y.grid_segments);
    grid.dz.data.set(this.region_to_grid_map.z.grid_segments);
    grid.x.data.set(this.region_to_grid_map.x.grid_lines);
    grid.y.data.set(this.region_to_grid_map.y.grid_lines);
    grid.z.data.set(this.region_to_grid_map.z.grid_lines);
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

    const grid_size: Vec3<number> = {
      x: 0,
      y: 0,
      z: 0,
    };
    let set_data = undefined as (undefined | ((i: number, beta: number) => void));
    switch (region.type) {
      case "dielectric": {
        grid_size.z = this.grid.er.shape[0];
        grid_size.y = this.grid.er.shape[1];
        grid_size.x = this.grid.er.shape[2];
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
        grid_size.z = this.grid.b.shape[0];
        grid_size.y = this.grid.b.shape[1];
        grid_size.x = this.grid.b.shape[2];
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

    const grid_size_x = grid_size.x;
    const grid_size_xy = grid_size.x*grid_size.y;

    for (const sdf of region.sdfs) {
      const { region_id, fill } = sdf;

      const partial_grid_bound: Vec3<Partial<Bound<number>>> = {
        x: { min: undefined, max: undefined },
        y: { min: undefined, max: undefined },
        z: { min: undefined, max: undefined },
      };

      for (const axis of AXES_3D) {
        const id = region_id[axis];
        const region_to_grid_map = this.region_to_grid_map[axis];
        if (id.min !== undefined) {
          partial_grid_bound[axis].min = region_to_grid_map.id_to_grid_index(id.min);
        }
        if (id.max !== undefined) {
          partial_grid_bound[axis].max = region_to_grid_map.id_to_grid_index(id.max);
        }
      }

      for (const axis of AXES_3D) {
        if (partial_grid_bound[axis].min === undefined) {
          partial_grid_bound[axis].min = 0;
        }
        if (partial_grid_bound[axis].max === undefined) {
          partial_grid_bound[axis].max = grid_size[axis];
        }
      }

      const grid_absolute_bound: Vec3<Bound<number>> = {
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
        z: { min: 0, max: 0 },
      };
      for (const axis of AXES_3D) {
        const partial_bound = partial_grid_bound[axis];
        const bound = grid_absolute_bound[axis];
        bound.min = partial_bound.min ?? 0;
        bound.max = partial_bound.max ?? grid_size[axis];
      }

      // get normalised grid coordinates for SDFs
      const grid_count: Vec3<number> = {
        x: 0,
        y: 0,
        z: 0,
      };
      for (const axis of AXES_3D) {
        const bound = grid_absolute_bound[axis];
        grid_count[axis] = bound.max - bound.min;
      }

      const grid_offset: Vec3<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      const grid_spacing: Vec3<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      for (const axis of AXES_3D) {
        const bound = grid_absolute_bound[axis];
        const region_to_grid_map = this.region_to_grid_map[axis];
        grid_offset[axis] = region_to_grid_map.grid_lines.slice(bound.min, bound.max);
        grid_spacing[axis] = region_to_grid_map.grid_segments.slice(bound.min, bound.max);
      }

      if (region.type === "dielectric") {
        // centre coordinate for dielectric cell
        for (const axis of AXES_3D) {
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

      const grid_total_size: Vec3<number> = {
        x: 0,
        y: 0,
        z: 0,
      };
      for (const axis of AXES_3D) {
        const sizes = grid_spacing[axis];
        let sum = 0;
        for (let i = 0; i < sizes.length; i++) {
          sum += sizes[i];
        }
        grid_total_size[axis] = sum;
      }
      const grid_norm_spacing: Vec3<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      const grid_norm_offset: Vec3<number[]> = {
        x: [],
        y: [],
        z: [],
      };
      for (const axis of AXES_3D) {
        const total_size = grid_total_size[axis];
        const offsets = grid_offset[axis];
        const min_offset = offsets[0];
        grid_norm_spacing[axis] = grid_spacing[axis].map(size => size/total_size);
        grid_norm_offset[axis] = grid_offset[axis].map(line => (line-min_offset)/total_size);
      }

      const grid_relative_bound: Vec3<Bound<number>> = {
        x: { min: 0, max: grid_count.x },
        y: { min: 0, max: grid_count.y },
        z: { min: 0, max: grid_count.z },
      };
      // voltage region allows customisation of whether outer or inner boundaries are used
      if (region.type === "voltage" && region.ignore_boundary !== undefined) {
        const boundary = region.ignore_boundary;
        for (const axis of AXES_3D) {
          const bound = boundary[axis];
          if (bound === undefined) continue;
          if (bound.min) grid_relative_bound[axis].min = 1;
          if (bound.max) grid_relative_bound[axis].max = grid_count[axis]-1;
        }
      }

      switch (fill.type) {
        case "point": {
          const sdf = fill.sdf;
          for (let z = grid_relative_bound.z.min; z < grid_relative_bound.z.max; z++) {
            const norm_z = grid_norm_offset.z[z];
            const gz = grid_absolute_bound.z.min+z;
            for (let y = grid_relative_bound.y.min; y < grid_relative_bound.y.max; y++) {
              const norm_y = grid_norm_offset.y[y];
              const gy = grid_absolute_bound.y.min+y;
              for (let x = grid_relative_bound.x.min; x < grid_relative_bound.x.max; x++) {
                const norm_x = grid_norm_offset.x[x];
                const gx = grid_absolute_bound.x.min+x;
                const i = gx + gy*grid_size.x + gz*grid_size_xy;
                const beta = sdf(norm_z, norm_y, norm_x);
                set_data(i, beta);
              }
            }
          }
          break;
        }
        case "constant": {
          const beta: number = 1.0;
          for (let z = grid_relative_bound.z.min; z < grid_relative_bound.z.max; z++) {
            const gz = grid_absolute_bound.z.min+z;
            for (let y = grid_relative_bound.y.min; y < grid_relative_bound.y.max; y++) {
              const gy = grid_absolute_bound.y.min+y;
              for (let x = grid_relative_bound.x.min; x < grid_relative_bound.x.max; x++) {
                const gx = grid_absolute_bound.x.min+x;
                const i = gx + gy*grid_size_x + gz*grid_size_xy;
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
