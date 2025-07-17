import { ManagedObject, WasmModule } from "../../wasm/index.ts";
import { Grid } from "./grid.ts";
import { LinesBuilder } from "../mesher/lines_builder.ts";
import { generate_region_mesh_segments, type RegionSpecification, RegionToGridMap } from "../mesher/regions.ts";
import { Profiler } from "../../utility/profiler.ts";

export interface CircleShape {
  readonly type: "circle";
  x: number;
  y: number;
  radius: number;
  min_x_gridlines?: number;
  min_y_gridlines?: number;
}

export interface DonutShape {
  readonly type: "donut";
  x: number;
  y: number;
  outer_radius: number;
  inner_radius: number;
  min_x_gridlines?: number;
  min_y_gridlines?: number;
}

 export interface RectangleShape {
  readonly type: "rectangle";
  x_left?: number; // undefined means unbounded
  x_right?: number;
  y_top?: number;
  y_bottom?: number;
  min_x_gridlines?: number;
  min_y_gridlines?: number;
}

export interface TriangleShape {
  readonly type: "triangle";
  x_base: number;
  x_tip: number;
  y_base: number;
  y_tip: number;
  min_x_gridlines?: number;
  min_y_gridlines?: number;
}

export type Shape = CircleShape | DonutShape | RectangleShape | TriangleShape;

export interface VoltageRegion {
  readonly type: "voltage";
  voltage_index: number;
  shapes: Shape[];
}

export interface DielectricRegion {
  readonly type: "dielectric";
  epsilon_index: number;
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
  padding_size_multiplier: number; // amount of air padding to add around simulation region
  max_x_ratio: number; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_x_subdivisions: number; // minimum number of grid lines each region should have
  max_y_ratio: number; // maximum rate at which grid regions can grow/shrink relative to their neighbour
  min_y_subdivisions: number; // minimum number of grid lines each region should have
}

export interface GridBuilderPadding {
  x_left?: boolean;
  x_right?: boolean;
  y_top?: boolean;
  y_bottom?: boolean;
}

// x=0,y=0 is top left
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
  rx_left?: number;
  rx_right?: number;
  ry_top?: number;
  ry_bottom?: number;
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
  { type: "voltage", sdfs: SDF[], voltage_index: number } |
  { type: "dielectric", sdfs: SDF[], epsilon_index: number } |
  { type: "empty", sdfs: SDF[] };

// Grid builder breaks down regions into the following heirarchy
// Region -> Shapes[] -> SDF[]
export class GridBuilder extends ManagedObject {
  grid: Grid;
  regions: Region[];
  padding: GridBuilderPadding;
  sdf_regions: RegionSDF[];
  x_region_lines_builder = new LinesBuilder();
  y_region_lines_builder = new LinesBuilder();
  x_min_gridlines: { rx_left: number, rx_right: number, count: number }[] = [];
  y_min_gridlines: { ry_top: number, ry_bottom: number, count: number }[] = [];
  x_region_to_grid_map: RegionToGridMap;
  y_region_to_grid_map: RegionToGridMap;
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

    this.sdf_regions = this.setup_create_sdf_regions(regions);
    this.setup_pad_grid();
    this.setup_merge_nearby_grid_lines();
    this.x_region_to_grid_map = this.setup_create_x_region_to_grid_map();
    this.y_region_to_grid_map = this.setup_create_y_region_to_grid_map();
    this.grid = this.setup_create_simulation_grid();
    this._child_objects.add(this.grid);
    this.setup_fill_sdf_regions();
  }

  setup_create_sdf_regions(regions: Region[]) {
    this.profiler?.begin("create_fill_regions");
    const fill_regions: RegionSDF[] = [];
    for (const region of regions) {
      const sdfs = region.shapes.map(region => this.setup_create_sdf_from_shape(region));
      if (region.type === "voltage") {
        fill_regions.push({
          type: "voltage" as const,
          sdfs: sdfs,
          voltage_index: region.voltage_index,
        });
      } else if (region.type === "dielectric") {
        fill_regions.push({
          type: "dielectric" as const,
          sdfs: sdfs,
          epsilon_index: region.epsilon_index,
        });
      } else if (region.type === "empty") {
        fill_regions.push({
          type: "empty" as const,
          sdfs: sdfs,
        });
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
        const x_left = shape.x-shape.radius;
        const x_right = shape.x+shape.radius;
        const y_top = shape.y-shape.radius;
        const y_bottom = shape.y+shape.radius;

        const rx_left = this.x_region_lines_builder.push(x_left);
        const rx_right = this.x_region_lines_builder.push(x_right);
        const ry_top = this.y_region_lines_builder.push(y_top);
        const ry_bottom = this.y_region_lines_builder.push(y_bottom);

        const radius_squared = 0.5**2;
        const sdf = (y: number, x: number) => ((y-0.5)**2 + (x-0.5)**2 < radius_squared) ? 1.0 : 0.0;
        const multisample_sdf = get_sdf_multisample(sdf);
        region_sdf = {
          rx_left,
          rx_right,
          ry_top,
          ry_bottom,
          fill: {
            type: "multisample",
            sdf: multisample_sdf,
          },
        };
        break;
      }
      case "donut": {
        const x_left = shape.x-shape.outer_radius;
        const x_right = shape.x+shape.outer_radius;
        const y_top = shape.y-shape.outer_radius;
        const y_bottom = shape.y+shape.outer_radius;

        const rx_left = this.x_region_lines_builder.push(x_left);
        const rx_right = this.x_region_lines_builder.push(x_right);
        const ry_top = this.y_region_lines_builder.push(y_top);
        const ry_bottom = this.y_region_lines_builder.push(y_bottom);


        const inner_radius_norm = shape.inner_radius/shape.outer_radius
        const outer_radius_squared = 0.5**2;
        const inner_radius_squared = (inner_radius_norm*0.5)**2;

        const sdf = (y: number, x: number) => {
          const r2 = (y-0.5)**2 + (x-0.5)**2;
          const inside_donut = r2 > inner_radius_squared && r2 < outer_radius_squared;
          return inside_donut ? 1.0 : 0.0;
        };
        const multisample_sdf = get_sdf_multisample(sdf);
        region_sdf = {
          rx_left,
          rx_right,
          ry_top,
          ry_bottom,
          fill: {
            type: "multisample",
            sdf: multisample_sdf,
          },
        };
        break;
      }
      case "rectangle": {
        const x_left = shape.x_left;
        const x_right = shape.x_right;
        const y_top = shape.y_top;
        const y_bottom = shape.y_bottom;

        const rx_left = x_left !== undefined ? this.x_region_lines_builder.push(x_left) : undefined;
        const rx_right = x_right !== undefined ? this.x_region_lines_builder.push(x_right) : undefined;
        const ry_top = y_top !== undefined ? this.y_region_lines_builder.push(y_top) : undefined;
        const ry_bottom = y_bottom !== undefined ? this.y_region_lines_builder.push(y_bottom) : undefined;

        region_sdf = {
          rx_left,
          rx_right,
          ry_top,
          ry_bottom,
          fill: {
            type: "constant",
          },
        };
        break;
      }
      case "triangle": {
        const x_left = Math.min(shape.x_base, shape.x_tip);
        const x_right = Math.max(shape.x_base, shape.x_tip);
        const y_top = Math.min(shape.y_base, shape.y_tip);
        const y_bottom = Math.max(shape.y_base, shape.y_tip);

        const rx_left = this.x_region_lines_builder.push(x_left);
        const rx_right = this.x_region_lines_builder.push(x_right);
        const ry_top = this.y_region_lines_builder.push(y_top);
        const ry_bottom = this.y_region_lines_builder.push(y_bottom);

        const sdf_slope_bottom_left = (y: number, x: number) => (y >= x) ? 1.0 : 0.0;
        const sdf_slope_bottom_right = (y: number, x: number) => (y >= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_left = (y: number, x: number) => (y <= 1-x) ? 1.0 : 0.0;
        const sdf_slope_top_right = (y: number, x: number) => (y <= x) ? 1.0 : 0.0;
        let sdf = undefined;
        if (shape.y_tip > shape.y_base) {
          if (shape.x_base > shape.x_tip) {
            sdf = sdf_slope_top_left;
          } else {
            sdf = sdf_slope_top_right;
          }
        } else {
          if (shape.x_base > shape.x_tip) {
            sdf = sdf_slope_bottom_left;
          } else {
            sdf = sdf_slope_bottom_right;
          }
        }
        const multisample_sdf = get_sdf_multisample(sdf);
        region_sdf = {
          rx_left,
          rx_right,
          ry_top,
          ry_bottom,
          fill: {
            type: "multisample",
            sdf: multisample_sdf,
          },
        };
        break;
      }
    }

    if (shape.min_x_gridlines !== undefined && region_sdf.rx_left !== undefined && region_sdf.rx_right !== undefined) {
      this.x_min_gridlines.push({
        rx_left: region_sdf.rx_left,
        rx_right: region_sdf.rx_right,
        count: shape.min_x_gridlines,
      });
    }

    if (shape.min_y_gridlines !== undefined && region_sdf.ry_top !== undefined && region_sdf.ry_bottom !== undefined) {
      this.y_min_gridlines.push({
        ry_top: region_sdf.ry_top,
        ry_bottom: region_sdf.ry_bottom,
        count: shape.min_y_gridlines,
      });
    }

    this.profiler?.end();
    return region_sdf;
  }

  setup_pad_grid() {
    this.profiler?.begin("pad_grid");
    const x_min = this.x_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const x_max = this.x_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const y_min = this.y_region_lines_builder.lines.reduce((a,b) => Math.min(a,b), Infinity);
    const y_max = this.y_region_lines_builder.lines.reduce((a,b) => Math.max(a,b), -Infinity);
    const stackup_width = x_max-x_min;
    const stackup_height = y_max-y_min;
    const padding_size = Math.max(stackup_width, stackup_height)*this.config.padding_size_multiplier;
    if (this.padding.x_left) this.x_region_lines_builder.push(x_min-padding_size);
    if (this.padding.x_right) this.x_region_lines_builder.push(x_max+padding_size);
    if (this.padding.y_top) this.y_region_lines_builder.push(y_min-padding_size);
    if (this.padding.y_bottom) this.y_region_lines_builder.push(y_max+padding_size);
    this.profiler?.end();
  }

  setup_merge_nearby_grid_lines() {
    this.profiler?.begin("merge_grid_lines");
    const x_region_sizes = this.x_region_lines_builder.to_regions();
    const y_region_sizes = this.y_region_lines_builder.to_regions();
    const merge_size = 0.99*this.config.minimum_grid_resolution;
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

  setup_create_simulation_grid(): Grid {
    this.profiler?.begin("create_simulation_grid");
    const grid = new Grid(
      this.module,
      this.y_region_to_grid_map.total_grid_segments,
      this.x_region_to_grid_map.total_grid_segments,
    );
    grid.dx.array_view.set(this.x_region_to_grid_map.grid_segments);
    grid.dy.array_view.set(this.y_region_to_grid_map.grid_segments);
    this.profiler?.end();
    return grid;
  }

  setup_fill_sdf_regions() {
    this.profiler?.begin("fill_sdfs");
    for (const fill of this.sdf_regions) {
      if (fill.type === "voltage") {
        const get_value = (beta: number) => Grid.pack_index_beta(fill.voltage_index, beta);
        fill.sdfs.forEach(region => this.setup_fill_sdf(region, true, get_value));
      } else if (fill.type === "dielectric") {
        const get_value = (beta: number) => Grid.pack_index_beta(fill.epsilon_index, beta);
        fill.sdfs.forEach(region => this.setup_fill_sdf(region, false, get_value));
      } else if (fill.type === "empty") {
        // do nothing
      }
    }
    this.profiler?.end();
  }

  setup_fill_sdf(sdf: SDF, is_voltage: boolean, get_value: (beta: number) => number) {
    const {
      rx_left,
      rx_right,
      ry_top,
      ry_bottom,
      fill,
    } = sdf;

    const grid = is_voltage ? this.grid.v_index_beta : this.grid.ek_index_beta;
    const [Ny, Nx] = grid.shape;
    const data = grid.ndarray.data;

    let gx_left = rx_left !== undefined ? this.x_region_to_grid_map.id_to_grid_index(rx_left) : undefined;
    let gx_right = rx_right !== undefined ? this.x_region_to_grid_map.id_to_grid_index(rx_right) : undefined;
    let gy_top = ry_top !== undefined ? this.y_region_to_grid_map.id_to_grid_index(ry_top) : undefined;
    let gy_bottom = ry_bottom !== undefined ? this.y_region_to_grid_map.id_to_grid_index(ry_bottom) : undefined;

    // voltage SDF should include boundaries of grid region
    if (is_voltage) {
      if (gx_right !== undefined && gx_left !== gx_right) gx_right += 1;
      if (gy_bottom !== undefined && gy_top !== gy_bottom) gy_bottom += 1;
    }

    gx_left = gx_left ?? 0;
    gx_right = gx_right ?? Nx;
    gy_top = gy_top ?? 0;
    gy_bottom = gy_bottom ?? Ny;

    // get normalised grid coordinates for SDFs
    const X = this.x_region_to_grid_map.grid_lines.slice(gx_left, gx_right);
    const Y = this.y_region_to_grid_map.grid_lines.slice(gy_top, gy_bottom);
    const dX = this.x_region_to_grid_map.grid_segments.slice(gx_left, gx_right);
    const dY = this.y_region_to_grid_map.grid_segments.slice(gy_top, gy_bottom);
    const abs_width = dX.reduce((a,b) => a+b, 0);
    const abs_height = dY.reduce((a,b) => a+b, 0);
    const norm_X = X.map(x => (x-X[0])/abs_width);
    const norm_Y = Y.map(y => (y-Y[0])/abs_height);
    const norm_dX = dX.map(dx => dx/abs_width);
    const norm_dY = dY.map(dy => dy/abs_height);

    const My = gy_bottom-gy_top;
    const Mx = gx_right-gx_left;

    if (fill.type === "point") {
      const sdf = fill.sdf;
      for (let y = 0; y < My; y++) {
        const norm_y = norm_Y[y];
        const gy = gy_top+y;
        for (let x = 0; x < Mx; x++) {
          const norm_x = norm_X[x];
          const gx = gx_left+x;
          const i = gx + gy*Nx;
          const beta = sdf(norm_y, norm_x);
          const value = get_value(beta);
          data[i] = value;
        }
      }
      return;
    }

    if (fill.type === "multisample") {
      const sdf = fill.sdf;
      for (let y = 0; y < My; y++) {
        const norm_y = norm_Y[y];
        const norm_dy = norm_dY[y];
        const gy = gy_top+y;
        for (let x = 0; x < Mx; x++) {
          const norm_x = norm_X[x];
          const norm_dx = norm_dX[x];
          const gx = gx_left+x;
          const i = gx + gy*Nx;
          const beta = sdf(norm_y, norm_x, norm_dy, norm_dx);
          const value = get_value(beta);
          data[i] = value;
        }
      }
      return;
    }

    if (fill.type === "constant") {
      const beta = 1.0;
      const value = get_value(beta);
      for (let y = 0; y < My; y++) {
        const gy = gy_top+y;
        for (let x = 0; x < Mx; x++) {
          const gx = gx_left+x;
          const i = gx + gy*Nx;
          data[i] = value;
        }
      }
      return;
    }
  }
}
