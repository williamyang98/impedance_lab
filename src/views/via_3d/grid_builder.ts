import { LinesBuilder } from "../../app/mesher/lines_builder.ts";
import { generate_region_mesh_segments, type RegionSpecification, RegionToGridMap } from "../../app/mesher/regions.ts";
import { Profiler } from "../../utility/profiler.ts";
import { CpuGrid } from "./grid.ts";

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

// override default mesh settings
export interface MeshConfig {
  min_x_gridlines: number;
  min_y_gridlines: number;
  min_z_gridlines: number;
}

export type Axis3D = "x" | "y" | "z";

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
  max_x_ratio: number; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_x_subdivisions: number; // minimum number of grid lines each region should have
  max_y_ratio: number; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_y_subdivisions: number; // minimum number of grid lines each region should have
  max_z_ratio: number; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_z_subdivisions: number; // minimum number of grid lines each region should have
}

export interface GridBuilderPadding {
  x_left?: boolean;
  x_right?: boolean;
  y_top?: boolean;
  y_bottom?: boolean;
  z_top?: boolean;
  z_bottom?: boolean;
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
  rx_left?: number;
  rx_right?: number;
  ry_top?: number;
  ry_bottom?: number;
  rz_top?: number;
  rz_bottom?: number;
  fill: {
    readonly type: "point",
    // x=0,y=0,z=0 is front top left
    sdf: (z: number, y: number, x: number) => number,
  } | {
    readonly type: "constant",
  };
}

type RegionSDF =
  { type: "voltage", sdfs: SDF[], voltage: number | null } |
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
  x_region_lines_builder = new LinesBuilder();
  y_region_lines_builder = new LinesBuilder();
  z_region_lines_builder = new LinesBuilder();
  x_min_gridlines: { rx_left: number, rx_right: number, count: number }[] = [];
  y_min_gridlines: { ry_top: number, ry_bottom: number, count: number }[] = [];
  z_min_gridlines: { rz_top: number, rz_bottom: number, count: number }[] = [];
  x_region_to_grid_map: RegionToGridMap;
  y_region_to_grid_map: RegionToGridMap;
  z_region_to_grid_map: RegionToGridMap;
  unpadded_boundary: {
    x_left: number;
    x_right: number;
    y_top: number;
    y_bottom: number;
    z_top: number;
    z_bottom: number;
  };
  padded_boundary: {
    x_left?: number;
    x_right?: number;
    y_top?: number;
    y_bottom?: number;
    z_top?: number;
    z_bottom?: number;
  };
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

    this.sdf_regions = this.setup_create_sdf_regions(regions);
    this.unpadded_boundary = this.setup_calculate_unpadded_boundary();
    this.padded_boundary = this.setup_pad_grid();
    this.setup_merge_nearby_region_lines();
    this.setup_rescale_region_lines();
    this.x_region_to_grid_map = this.setup_create_x_region_to_grid_map();
    this.y_region_to_grid_map = this.setup_create_y_region_to_grid_map();
    this.z_region_to_grid_map = this.setup_create_z_region_to_grid_map();
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
        let x_min = undefined as (undefined | number);
        let x_max = undefined as (undefined | number);
        let y_min = undefined as (undefined | number);
        let y_max = undefined as (undefined | number);
        let z_min = undefined as (undefined | number);
        let z_max = undefined as (undefined | number);
        let sdf = undefined as (undefined | ((z: number, y: number, x: number) => number));
        const radius_squared = 0.5**2;
        const common_sdf = (x: number, y: number): number => {
          return ((x-0.5)**2 + (y-0.5)**2 < radius_squared) ? 1.0 : 0.0;
        };
        switch (shape.axis) {
          case "x": {
            // y,z
            y_min = shape.center.y-shape.radius;
            y_max = shape.center.y+shape.radius;
            z_min = shape.center.z-shape.radius;
            z_max = shape.center.z+shape.radius;
            if (shape.length !== undefined) {
              x_min = Math.min(shape.center.x, shape.center.x+shape.length);
              x_max = Math.max(shape.center.x, shape.center.x+shape.length);
            }
            sdf = (z: number, y: number, _x: number) => common_sdf(y,z);
            break;
          }
          case "y": {
            // x,z
            x_min = shape.center.x-shape.radius;
            x_max = shape.center.x+shape.radius;
            z_min = shape.center.z-shape.radius;
            z_max = shape.center.z+shape.radius;
            if (shape.length !== undefined) {
              y_min = Math.min(shape.center.y, shape.center.y+shape.length);
              y_max = Math.max(shape.center.y, shape.center.y+shape.length);
            }
            sdf = (z: number, _y: number, x: number) => common_sdf(x,z);
            break;
          }
          case "z": {
            // x,y
            x_min = shape.center.x-shape.radius;
            x_max = shape.center.x+shape.radius;
            y_min = shape.center.y-shape.radius;
            y_max = shape.center.y+shape.radius;
            if (shape.length !== undefined) {
              z_min = Math.min(shape.center.z, shape.center.z+shape.length);
              z_max = Math.max(shape.center.z, shape.center.z+shape.length);
            }
            sdf = (_z: number, y: number, x: number) => common_sdf(x,y);
            break;
          }
        }

        const rx_min = x_min !== undefined ? this.x_region_lines_builder.push(x_min) : undefined;
        const rx_max = x_max !== undefined ? this.x_region_lines_builder.push(x_max) : undefined;
        const ry_min = y_min !== undefined ? this.y_region_lines_builder.push(y_min) : undefined;
        const ry_max = y_max !== undefined ? this.y_region_lines_builder.push(y_max) : undefined;
        const rz_min = z_min !== undefined ? this.z_region_lines_builder.push(z_min) : undefined;
        const rz_max = z_max !== undefined ? this.z_region_lines_builder.push(z_max) : undefined;

        region_sdf = {
          rx_left: rx_min,
          rx_right: rx_max,
          ry_top: ry_min,
          ry_bottom: ry_max,
          rz_top: rz_min,
          rz_bottom: rz_max,
          fill: {
            type: "point",
            sdf,
          },
        };
        break;
      }
      case "cuboid": {
        const rx_left = shape.start.x !== undefined ? this.x_region_lines_builder.push(shape.start.x) : undefined;
        const rx_right = shape.end.x !== undefined ? this.x_region_lines_builder.push(shape.end.x) : undefined;
        const ry_top = shape.start.y !== undefined ? this.y_region_lines_builder.push(shape.start.y) : undefined;
        const ry_bottom = shape.end.y !== undefined ? this.y_region_lines_builder.push(shape.end.y) : undefined;
        const rz_top = shape.start.z !== undefined ? this.z_region_lines_builder.push(shape.start.z) : undefined;
        const rz_bottom = shape.end.z !== undefined ? this.z_region_lines_builder.push(shape.end.z) : undefined;

        region_sdf = {
          rx_left,
          rx_right,
          ry_top,
          ry_bottom,
          rz_top,
          rz_bottom,
          fill: {
            type: "constant",
          },
        };
        break;
      }
      case "triangular_prism": {
        let x_min = undefined as (undefined | number);
        let x_max = undefined as (undefined | number);
        let y_min = undefined as (undefined | number);
        let y_max = undefined as (undefined | number);
        let z_min = undefined as (undefined | number);
        let z_max = undefined as (undefined | number);

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

        let sdf = undefined as (undefined | ((z: number, y: number, x: number) => number));
        switch (shape.axis) {
          case "x": {
            // y,z
            y_min = Math.min(shape.base.y, shape.base.y+shape.width);
            y_max = Math.max(shape.base.y, shape.base.y+shape.width);
            z_min = Math.min(shape.base.z, shape.base.z+shape.height);
            z_max = Math.max(shape.base.z, shape.base.z+shape.height);
            if (shape.length !== undefined) {
              x_min = Math.min(shape.base.x, shape.base.x+shape.length);
              x_max = Math.max(shape.base.x, shape.base.x+shape.length);
            }
            sdf = (z: number, y: number, _x: number) => common_sdf(z, y);
            break;
          }
          case "y": {
            // x,z
            x_min = Math.min(shape.base.x, shape.base.x+shape.width);
            x_max = Math.max(shape.base.x, shape.base.x+shape.width);
            z_min = Math.min(shape.base.z, shape.base.z+shape.height);
            z_max = Math.max(shape.base.z, shape.base.z+shape.height);
            if (shape.length !== undefined) {
              y_min = Math.min(shape.base.y, shape.base.y+shape.length);
              y_max = Math.max(shape.base.y, shape.base.y+shape.length);
            }
            sdf = (z: number, _y: number, x: number) => common_sdf(z, x);
            break;
          }
          case "z": {
            // x,y
            x_min = Math.min(shape.base.x, shape.base.x+shape.width);
            x_max = Math.max(shape.base.x, shape.base.x+shape.width);
            y_min = Math.min(shape.base.y, shape.base.y+shape.height);
            y_max = Math.max(shape.base.y, shape.base.y+shape.height);
            if (shape.length !== undefined) {
              z_min = Math.min(shape.base.z, shape.base.z+shape.length);
              z_max = Math.max(shape.base.z, shape.base.z+shape.length);
            }
            sdf = (_z: number, y: number, x: number) => common_sdf(y, x);
            break;
          }
        }

        const rx_min = x_min !== undefined ? this.x_region_lines_builder.push(x_min) : undefined;
        const rx_max = x_max !== undefined ? this.x_region_lines_builder.push(x_max) : undefined;
        const ry_min = y_min !== undefined ? this.y_region_lines_builder.push(y_min) : undefined;
        const ry_max = y_max !== undefined ? this.y_region_lines_builder.push(y_max) : undefined;
        const rz_min = z_min !== undefined ? this.z_region_lines_builder.push(z_min) : undefined;
        const rz_max = z_max !== undefined ? this.z_region_lines_builder.push(z_max) : undefined;

        region_sdf = {
          rx_left: rx_min,
          rx_right: rx_max,
          ry_top: ry_min,
          ry_bottom: ry_max,
          rz_top: rz_min,
          rz_bottom: rz_max,
          fill: {
            type: "point",
            sdf,
          },
        };
        break;
      }
    }

    const config = shape.config;
    if (config.min_x_gridlines !== undefined && region_sdf.rx_left !== undefined && region_sdf.rx_right !== undefined) {
      this.x_min_gridlines.push({
        rx_left: region_sdf.rx_left,
        rx_right: region_sdf.rx_right,
        count: config.min_x_gridlines,
      });
    }

    if (config.min_y_gridlines !== undefined && region_sdf.ry_top !== undefined && region_sdf.ry_bottom !== undefined) {
      this.y_min_gridlines.push({
        ry_top: region_sdf.ry_top,
        ry_bottom: region_sdf.ry_bottom,
        count: config.min_y_gridlines,
      });
    }

    if (config.min_z_gridlines !== undefined && region_sdf.rz_top !== undefined && region_sdf.rz_bottom !== undefined) {
      this.z_min_gridlines.push({
        rz_top: region_sdf.rz_top,
        rz_bottom: region_sdf.rz_bottom,
        count: config.min_z_gridlines,
      });
    }
    this.profiler?.end();
    return region_sdf;
  }

  setup_calculate_unpadded_boundary(): typeof this.unpadded_boundary {
    this.profiler?.begin("calculate_unpadded_boundary");
    const x_left = this.x_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const x_right = this.x_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const y_top = this.y_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const y_bottom = this.y_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const z_top = this.z_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const z_bottom = this.z_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    this.profiler?.end();
    return { x_left, x_right, y_top, y_bottom, z_top, z_bottom };
  }

  setup_pad_grid(): typeof this.padded_boundary {
    this.profiler?.begin("pad_grid");
    const { x_left, x_right, y_top, y_bottom, z_top, z_bottom } = this.unpadded_boundary;
    const stackup_width = x_right-x_left;
    const stackup_height = y_bottom-y_top;
    const padding_size = Math.max(stackup_width, stackup_height)*this.config.padding_size_multiplier;
    const padded_boundary: typeof this.padded_boundary = {};
    if (this.padding.x_left) {
      const x_left_pad = x_left-padding_size;
      this.x_region_lines_builder.push(x_left_pad);
      padded_boundary.x_left = x_left_pad;
    }
    if (this.padding.x_right) {
      const x_right_pad = x_right+padding_size;
      this.x_region_lines_builder.push(x_right_pad);
      padded_boundary.x_right = x_right_pad;
    }
    if (this.padding.y_top) {
      const y_top_pad = y_top-padding_size;
      this.y_region_lines_builder.push(y_top_pad);
      padded_boundary.y_top = y_top_pad;
    }
    if (this.padding.y_bottom) {
      const y_bottom_pad = y_bottom+padding_size;
      this.y_region_lines_builder.push(y_bottom_pad);
      padded_boundary.y_bottom = y_bottom_pad;
    }
    if (this.padding.z_top) {
      const z_top_pad = z_top-padding_size;
      this.z_region_lines_builder.push(z_top_pad);
      padded_boundary.z_top = z_top_pad;
    }
    if (this.padding.z_bottom) {
      const z_bottom_pad = z_bottom+padding_size;
      this.z_region_lines_builder.push(z_bottom_pad);
      padded_boundary.z_bottom = z_bottom_pad;
    }
    this.profiler?.end();
    return padded_boundary;
  }

  setup_merge_nearby_region_lines() {
    this.profiler?.begin("merge_nearby_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    this.x_region_lines_builder.merge(merge_size);
    this.y_region_lines_builder.merge(merge_size);
    this.z_region_lines_builder.merge(merge_size);
    this.profiler?.end();
  }

  setup_rescale_region_lines() {
    this.profiler?.begin("rescale_region_lines");
    const merge_size = this.config.minimum_grid_resolution;
    const x_region_sizes = this.x_region_lines_builder.to_regions();
    const y_region_sizes = this.y_region_lines_builder.to_regions();
    const z_region_sizes = this.z_region_lines_builder.to_regions();
    const region_sizes = [...x_region_sizes, ...y_region_sizes, ...z_region_sizes]
      .filter(size => size >= merge_size);
    // rescale for best accuracy for 32bit floating point
    const log_mean = get_log_median(region_sizes);
    const scale = 1.0/log_mean;
    this.x_region_lines_builder.apply_scale(scale);
    this.y_region_lines_builder.apply_scale(scale);
    this.z_region_lines_builder.apply_scale(scale);
    this.grid_scale *= scale;
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

    // override minimum number of gridlines if specified
    for (const x_min of this.x_min_gridlines) {
      const ix_left = this.x_region_lines_builder.get_index(x_min.rx_left);
      const ix_right = this.x_region_lines_builder.get_index(x_min.rx_right);
      for (let i = ix_left; i < ix_right; i++) {
        const old_count = x_region_specs[i].total_grid_lines;
        const new_count = old_count === undefined ? x_min.count : Math.max(old_count, x_min.count);
        x_region_specs[i].total_grid_lines = new_count;
      }
    }

    const x_region_segments = generate_region_mesh_segments(x_region_specs, this.config.min_x_subdivisions, this.config.max_x_ratio);
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

    // override minimum number of gridlines if specified
    for (const y_min of this.y_min_gridlines) {
      const iy_top = this.y_region_lines_builder.get_index(y_min.ry_top);
      const iy_bottom = this.y_region_lines_builder.get_index(y_min.ry_bottom);
      for (let i = iy_top; i < iy_bottom; i++) {
        const old_count = y_region_specs[i].total_grid_lines;
        const new_count = old_count === undefined ? y_min.count : Math.max(old_count, y_min.count);
        y_region_specs[i].total_grid_lines = new_count;
      }
    }

    const y_region_segments = generate_region_mesh_segments(y_region_specs, this.config.min_y_subdivisions, this.config.max_y_ratio);
    this.profiler?.end();
    return new RegionToGridMap(this.y_region_lines_builder, y_region_segments);
  }

  setup_create_z_region_to_grid_map() {
    this.profiler?.begin("create_z_region_to_grid_map");
    const size_to_region_spec = (size: number): RegionSpecification => {
      return {
        size,
      };
    };
    const z_region_sizes = this.z_region_lines_builder.to_regions();
    const z_region_specs: RegionSpecification[] = z_region_sizes.map(size_to_region_spec);

    // override minimum number of gridlines if specified
    for (const z_min of this.z_min_gridlines) {
      const iz_top = this.z_region_lines_builder.get_index(z_min.rz_top);
      const iz_bottom = this.z_region_lines_builder.get_index(z_min.rz_bottom);
      for (let i = iz_top; i < iz_bottom; i++) {
        const old_count = z_region_specs[i].total_grid_lines;
        const new_count = old_count === undefined ? z_min.count : Math.max(old_count, z_min.count);
        z_region_specs[i].total_grid_lines = new_count;
      }
    }

    const z_region_segments = generate_region_mesh_segments(z_region_specs, this.config.min_z_subdivisions, this.config.max_z_ratio);
    this.profiler?.end();
    return new RegionToGridMap(this.z_region_lines_builder, z_region_segments);
  }

  setup_create_simulation_grid(): CpuGrid {
    this.profiler?.begin("create_simulation_grid");
    const grid = new CpuGrid({
      x: this.x_region_to_grid_map.total_grid_lines,
      y: this.y_region_to_grid_map.total_grid_lines,
      z: this.z_region_to_grid_map.total_grid_lines,
    });
    grid.dx.data.set(this.x_region_to_grid_map.grid_segments);
    grid.dy.data.set(this.y_region_to_grid_map.grid_segments);
    grid.dz.data.set(this.z_region_to_grid_map.grid_segments);
    grid.x.data.set(this.x_region_to_grid_map.grid_lines);
    grid.y.data.set(this.y_region_to_grid_map.grid_lines);
    grid.z.data.set(this.z_region_to_grid_map.grid_lines);
    grid.er.data.fill(er0);
    this.profiler?.end();
    return grid;
  }

  setup_fill_sdf_regions() {
    this.profiler?.begin("fill_sdfs");
    for (const fill of this.sdf_regions) {
      switch (fill.type) {
        case "voltage": {
          fill.sdfs.forEach(region => { this.setup_fill_sdf(region, "voltage", fill.voltage); });
          break;
        }
        case "dielectric": {
          fill.sdfs.forEach(region => { this.setup_fill_sdf(region, "dielectric", fill.epsilon); });
          break;
        }
        case "empty": {
          break;
        }
      }
    }
    this.profiler?.end();
  }

  setup_fill_sdf(sdf: SDF, type: "voltage" | "dielectric", value: number | null) {
    const {
      rx_left,
      rx_right,
      ry_top,
      ry_bottom,
      rz_top,
      rz_bottom,
      fill,
    } = sdf;

    let Nz = undefined as (undefined | number);
    let Ny = undefined as (undefined | number);
    let Nx = undefined as (undefined | number);
    let set_data = undefined as (undefined | ((i: number, beta: number) => void));
    switch (type) {
      case "dielectric": {
        Nz = this.grid.er.shape[0];
        Ny = this.grid.er.shape[1];
        Nx = this.grid.er.shape[2];
        const er = this.grid.er.data;
        if (value === null) {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            er[i] = er0;
          }
        } else {
          set_data = (i: number, beta: number) => {
            if (beta < 0.5) return;
            er[i] = value;
          }
        }
        break;
      }
      case "voltage": {
        Nz = this.grid.b.shape[0];
        Ny = this.grid.b.shape[1];
        Nx = this.grid.b.shape[2];
        const b = this.grid.b.data;
        const mask = this.grid.mask.data;
        const mask_bits = 32;
        if (value === null) {
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
            b[i] = value;
            const imask = Math.floor(i/mask_bits);
            const imask_offset = i-imask*mask_bits;
            mask[imask] |= (1 << imask_offset);
          }
        }
        break;
      }
    }
    const Nxy = Nx*Ny;

    let gx_left = rx_left !== undefined ? this.x_region_to_grid_map.id_to_grid_index(rx_left) : undefined;
    let gx_right = rx_right !== undefined ? this.x_region_to_grid_map.id_to_grid_index(rx_right) : undefined;
    let gy_top = ry_top !== undefined ? this.y_region_to_grid_map.id_to_grid_index(ry_top) : undefined;
    let gy_bottom = ry_bottom !== undefined ? this.y_region_to_grid_map.id_to_grid_index(ry_bottom) : undefined;
    let gz_top = rz_top !== undefined ? this.z_region_to_grid_map.id_to_grid_index(rz_top) : undefined;
    let gz_bottom = rz_bottom !== undefined ? this.z_region_to_grid_map.id_to_grid_index(rz_bottom) : undefined;

    // voltage SDF should include boundaries of grid region
    if (type === "voltage") {
      if (gx_right !== undefined) gx_right += 1;
      if (gy_bottom !== undefined) gy_bottom += 1;
      if (gz_bottom !== undefined) gz_bottom += 1;
    }

    gx_left = gx_left ?? 0;
    gx_right = gx_right ?? Nx;
    gy_top = gy_top ?? 0;
    gy_bottom = gy_bottom ?? Ny;
    gz_top = gz_top ?? 0;
    gz_bottom = gz_bottom ?? Nz;

    // get normalised grid coordinates for SDFs
    const Mz = gz_bottom-gz_top;
    const My = gy_bottom-gy_top;
    const Mx = gx_right-gx_left;
    const X = this.x_region_to_grid_map.grid_lines.slice(gx_left, gx_right);
    const Y = this.y_region_to_grid_map.grid_lines.slice(gy_top, gy_bottom);
    const Z = this.z_region_to_grid_map.grid_lines.slice(gz_top, gz_bottom);
    const dX = this.x_region_to_grid_map.grid_segments.slice(gx_left, gx_right);
    const dY = this.y_region_to_grid_map.grid_segments.slice(gy_top, gy_bottom);
    const dZ = this.z_region_to_grid_map.grid_segments.slice(gz_top, gz_bottom);
    if (type === "dielectric") {
      // centre coordinate for dielectric cell
      for (let x = 0; x < Mx; x++) {
        X[x] += dX[x]/2;
      }
      for (let y = 0; y < My; y++) {
        Y[y] += dY[y]/2;
      }
      for (let z = 0; z < Mz; z++) {
        Z[z] += dZ[z]/2;
      }
    }

    const abs_width = dX.reduce((a,b) => a+b, 0);
    const abs_height = dY.reduce((a,b) => a+b, 0);
    const abs_depth = dZ.reduce((a,b) => a+b, 0);
    const norm_X = X.map(x => (x-X[0])/abs_width);
    const norm_Y = Y.map(y => (y-Y[0])/abs_height);
    const norm_Z = Z.map(z => (z-Z[0])/abs_depth);

    switch (fill.type) {
      case "point": {
        const sdf = fill.sdf;
        for (let z = 0; z < Mz; z++) {
          const norm_z = norm_Z[z];
          const gz = gz_top+z;
          for (let y = 0; y < My; y++) {
            const norm_y = norm_Y[y];
            const gy = gy_top+y;
            for (let x = 0; x < Mx; x++) {
              const norm_x = norm_X[x];
              const gx = gx_left+x;
              const i = gx + gy*Nx + gz*Nxy;
              const beta = sdf(norm_z, norm_y, norm_x);
              set_data(i, beta);
            }
          }
        }
        break;
      }
      case "constant": {
        const beta: number = 1.0;
        for (let z = 0; z < Mz; z++) {
          const gz = gz_top+z;
          for (let y = 0; y < My; y++) {
            const gy = gy_top+y;
            for (let x = 0; x < Mx; x++) {
              const gx = gx_left+x;
              const i = gx + gy*Nx + gz*Nxy;
              set_data(i, beta);
            }
          }
        }
        break;
      }

    }
  }
}
