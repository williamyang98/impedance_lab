import { NdarrayView } from "../utility/ndarray.ts";
import { type GridRegion, GridRegionUtility } from "./mesher.ts";
import { Grid } from "./electrostatic_2d.ts";

function generate_grid_deltas(deltas: NdarrayView, grids: GridRegion[]) {
  let offset = 0;
  for (let i = 0; i < grids.length; i++) {
    const region = grids[i];
    const delta = GridRegionUtility.get_total_grid_lines(region);
    const view = deltas.lo([offset]).hi([delta]);
    const subdivisions = GridRegionUtility.generate_grid(region);
    for (let j = 0; j < subdivisions.length; j++) {
      view.set([j], subdivisions[j]);
    }
    offset += delta;
  }
}

function get_grid_lines_from_deltas(deltas: number[]): number[] {
  let x = 0;
  const x_grid: number[] = [x];
  for (const dx of deltas) {
    x += dx;
    x_grid.push(x);
  }
  return x_grid;
}

export interface RegionGridBuilder {
  x_regions: number[];
  y_regions: number[];
  x_max_ratio?: number;
  y_max_ratio?: number;
  x_min_subdivisions?: number;
  y_min_subdivisions?: number;
}

export class RegionView {
  region_grid: RegionGrid;
  view: NdarrayView;

  constructor(region_grid: RegionGrid, view: NdarrayView) {
    this.region_grid = region_grid;
    this.view = view;
  }

  x_region_to_grid(rx: number): number {
    const gx = this.region_grid.x_region_to_grid_indices[rx];
    return gx;
  }

  y_region_to_grid(ry: number): number {
    const gy = this.region_grid.y_region_to_grid_indices[ry];
    return gy;
  }

  region_to_grid(
    region_start: [number, number], region_end: [number, number],
  ): [[number, number], [number, number]] {
    const [region_y_start, region_x_start] = region_start;
    const [region_y_end, region_x_end] = region_end;

    const grid_y_start = this.region_grid.y_region_to_grid_indices[region_y_start];
    const grid_x_start = this.region_grid.x_region_to_grid_indices[region_x_start];
    const grid_y_end = this.region_grid.y_region_to_grid_indices[region_y_end];
    const grid_x_end = this.region_grid.x_region_to_grid_indices[region_x_end];
    const grid_start: [number, number] = [grid_y_start, grid_x_start];
    const grid_end: [number, number] = [grid_y_end, grid_x_end];
    return [grid_start, grid_end];
  }

  get_region(region_start: [number, number], region_end: [number, number]): NdarrayView {
    const [grid_start, grid_end] = this.region_to_grid(region_start, region_end);
    return this.get_grid(grid_start, grid_end);
  }

  get_grid(grid_start: [number, number], grid_end: [number, number]): NdarrayView {
    return this.view.hi(grid_end).lo(grid_start);
  }

  transform_norm_region(
    region_start: [number, number], region_end: [number, number],
    transform: (value: number, [y_start, x_start]: [number, number], [y_size, x_size]: [number, number]) => number,
  ) {
    const [grid_start, grid_end] = this.region_to_grid(region_start, region_end);
    this.transform_norm_grid(grid_start, grid_end, transform);
  }

  transform_norm_grid(
    grid_start: [number, number], grid_end: [number, number],
    transform: (value: number, [y_start, x_start]: [number, number], [y_size, x_size]: [number, number]) => number,
  ) {
    const [grid_y_start, grid_x_start] = grid_start;
    const [grid_y_end, grid_x_end] = grid_end;

    const dx_grid = this.region_grid.dx_grid.slice(grid_x_start, grid_x_end);
    const dy_grid = this.region_grid.dy_grid.slice(grid_y_start, grid_y_end);
    const width = dx_grid.reduce((a,b) => a+b, 0);
    const height = dy_grid.reduce((a,b) => a+b, 0);
    const norm_grid_dx = dx_grid.map(x => x/width);
    const norm_grid_dy = dy_grid.map(y => y/height);
    const view = this.view.hi(grid_end).lo(grid_start);
    const [Ny, Nx] = view.shape;

    const norm_y_offsets: number[] = new Array(Ny);
    const norm_x_offsets: number[] = new Array(Nx);
    for (let y = 0, y_offset = 0; y < Ny; y++) {
      const dy = norm_grid_dy[y];
      norm_y_offsets[y] = y_offset;
      y_offset += dy;
    }
    for (let x = 0, x_offset = 0; x < Nx; x++) {
      const dx = norm_grid_dx[x];
      norm_x_offsets[x] = x_offset;
      x_offset += dx;
    }

    for (let y = 0; y < Ny; y++) {
      const y_offset = norm_y_offsets[y];
      const dy = norm_grid_dy[y];
      for (let x = 0; x < Nx; x++) {
        const x_offset = norm_x_offsets[x];
        const dx = norm_grid_dx[x];
        const i = [y,x];
        const value = view.get(i);
        const new_value = transform(value, [y_offset, x_offset], [dy, dx]);
        view.set(i, new_value);
      }
    }
  }
}

export class RegionGrid {
  grid: Grid;

  x_regions: number[];
  y_regions: number[];
  x_grid_regions: GridRegion[];
  y_grid_regions: GridRegion[];
  x_region_to_grid_indices: number[];
  y_region_to_grid_indices: number[];
  x_region_lines: number[];
  y_region_lines: number[];
  x_grid_lines: number[];
  y_grid_lines: number[];
  dx_grid: number[];
  dy_grid: number[];

  constructor(x_grid_regions: GridRegion[], y_grid_regions: GridRegion[]) {
    // Map (My,Mx) regions to (Ny,Nx) grid
    const x_grid_widths = x_grid_regions.map(region => GridRegionUtility.get_total_grid_lines(region));
    const y_grid_heights = y_grid_regions.map(region => GridRegionUtility.get_total_grid_lines(region));

    const Nx = x_grid_widths.reduce((a,b) => a+b, 0);
    const Ny = y_grid_heights.reduce((a,b) => a+b, 0);

    const grid = new Grid(Ny, Nx);

    // grid feature lines
    generate_grid_deltas(grid.dx, x_grid_regions);
    generate_grid_deltas(grid.dy, y_grid_regions);

    // convert from region space to grid space
    const x_region_to_grid_indices: number[] = [0];
    for (let i = 0, x = 0; i < x_grid_widths.length; i++) {
      x += x_grid_widths[i];
      x_region_to_grid_indices.push(x);
    }
    const y_region_to_grid_indices: number[] = [0];
    for (let i = 0, y = 0; i < y_grid_heights.length; i++) {
      y += y_grid_heights[i];
      y_region_to_grid_indices.push(y);
    }

    // unwrap dx and dy from Ndarray to number[] to avoid n-dim indexing overhead
    const dx_grid = Array.from(grid.dx.cast(Float32Array));
    const dy_grid = Array.from(grid.dy.cast(Float32Array));

    // create region and grid lines for visualisation
    const x_grid_lines = get_grid_lines_from_deltas(Array.from(grid.dx.data));
    const y_grid_lines = get_grid_lines_from_deltas(Array.from(grid.dy.data));
    const x_regions = new Array(x_grid_regions.length);
    const y_regions = new Array(y_grid_regions.length);
    for (let i = 0; i < x_grid_regions.length; i++) {
      const grid_start = x_region_to_grid_indices[i];
      const grid_end = x_region_to_grid_indices[i+1];
      const x_start = x_grid_lines[grid_start];
      const x_end = x_grid_lines[grid_end];
      const width = x_end-x_start;
      x_regions[i] = width;
    }
    for (let i = 0; i < y_grid_regions.length; i++) {
      const grid_start = y_region_to_grid_indices[i];
      const grid_end = y_region_to_grid_indices[i+1];
      const y_start = y_grid_lines[grid_start];
      const y_end = y_grid_lines[grid_end];
      const height = y_end-y_start;
      y_regions[i] = height;
    }

    const x_region_lines = get_grid_lines_from_deltas(x_regions);
    const y_region_lines = get_grid_lines_from_deltas(y_regions);


    this.grid = grid;
    this.x_regions = x_regions;
    this.y_regions = y_regions;
    this.x_grid_regions = x_grid_regions;
    this.y_grid_regions = y_grid_regions;
    this.x_region_to_grid_indices = x_region_to_grid_indices;
    this.y_region_to_grid_indices = y_region_to_grid_indices;
    this.x_grid_lines = x_grid_lines;
    this.y_grid_lines = y_grid_lines;
    this.x_region_lines = x_region_lines;
    this.y_region_lines = y_region_lines;
    this.dx_grid = dx_grid;
    this.dy_grid = dy_grid;
  }

  dx_region(start: number, end: number): NdarrayView {
    const i_start = this.x_region_to_grid_indices[start];
    const i_end = this.x_region_to_grid_indices[end];
    return this.grid.dx.hi([i_end]).lo([i_start]);
  }

  dy_region(start: number, end: number): NdarrayView {
    const i_start = this.y_region_to_grid_indices[start];
    const i_end = this.y_region_to_grid_indices[end];
    return this.grid.dy.hi([i_end]).lo([i_start]);
  }

  v_force_region_view(): RegionView {
    return new RegionView(this, this.grid.v_force);
  }

  epsilon_k_region_view(): RegionView {
    return new RegionView(this, this.grid.epsilon_k);
  }

}

export class GridLines {
  id_to_index: number[] = [];
  lines: number[] = [];
  is_sorted: boolean = false;

  get length(): number {
    return this.id_to_index.length;
  }

  push(line: number, threshold?: number): number {
    threshold = threshold ?? 1e-6;
    // check if line already exists
    const N = this.lines.length;
    for (let i = 0; i < N; i++) {
      const other_line = this.lines[i];
      const dist = Math.abs(other_line-line);
      if (dist < threshold) {
        for (let id = 0; id < N; id++) {
          if (this.id_to_index[id] === i) {
            return id;
          }
        }
      }
    }

    const id = this.lines.length;
    if (id > 0 && this.lines[id-1] > line) {
      this.is_sorted = false;
    }
    this.lines.push(line);
    this.id_to_index.push(id);
    return id;
  }

  sort() {
    const N = this.lines.length;
    const sort_indices: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      sort_indices[i] = i;
    }

    sort_indices.sort((a,b) => this.lines[a] - this.lines[b]);
    this.lines = sort_indices.map((i) => this.lines[i]);
    const new_id_to_index = new Array(N);
    for (let i = 0; i < N; i++) {
      const new_i = sort_indices[i];
      new_id_to_index[new_i] = this.id_to_index[i];
    }
    this.id_to_index = new_id_to_index;
    this.is_sorted = true;
  }

  get_index(id: number) {
    return this.id_to_index[id];
  }

  get_line(id: number) {
    const index = this.id_to_index[id];
    return this.lines[index];
  }

  to_regions(): number[] {
    if (!this.is_sorted) this.sort();
    const N = this.id_to_index.length;
    if (N < 2) throw Error(`Need at least 2 grid lines for a region`);
    const regions = new Array(N-1);
    for (let i = 0; i < (N-1); i++) {
      regions[i] = this.lines[i+1]-this.lines[i];
    }
    return regions;
  }
}
