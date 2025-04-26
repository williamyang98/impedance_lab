import { NdarrayView } from "../utility/ndarray.ts";
import {
  generate_asymmetric_geometric_grid_from_regions,
  generate_asymmetric_geometric_grid,
  type AsymmetricGeometricGrid,
} from "./mesher.ts";
import { Grid } from "./electrostatic_2d.ts";

function generate_deltas(deltas: NdarrayView, grids: AsymmetricGeometricGrid[]) {
  let offset = 0;
  for (let i = 0; i < grids.length; i++) {
    const grid = grids[i];
    const delta = grid.n0+grid.n1;
    const view = deltas.lo([offset]).hi([delta]);
    const subdivisions = generate_asymmetric_geometric_grid(grid);
    for (let j = 0; j < subdivisions.length; j++) {
      view.set([j], subdivisions[j]);
    }
    offset += delta;
  }
}

function generate_padding(deltas: NdarrayView, a: number, r: number): number {
  const N = deltas.shape[0];
  let v = a;
  let sum: number = 0;
  for (let i = 0; i < N; i++) {
    deltas.set([i], v);
    sum += v;
    v *= r;
  }
  return sum;
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

export class RegionGrid {
  grid: Grid;

  x_regions: number[];
  y_regions: number[];
  x_grids: AsymmetricGeometricGrid[];
  y_grids: AsymmetricGeometricGrid[];
  x_region_to_grid_indices: number[];
  y_region_to_grid_indices: number[];
  x_region_lines: number[];
  y_region_lines: number[];
  x_grid_lines: number[];
  y_grid_lines: number[];

  constructor(x_regions: number[], y_regions: number[]) {
    // For a (My-2,Mx-2) given regions we will get (My,Mx) actual regions due to padding regions
    // const Mx = x_regions.length+2;
    // const My = y_regions.length+2;

    // Map (My,Mx) regions to (Ny,Nx) grid
    const x_min_subdivisions = 10;
    const y_min_subdivisions = 5;
    const x_max_ratio = 0.30;
    const y_max_ratio = 0.35;
    const x_grids = generate_asymmetric_geometric_grid_from_regions(x_regions, x_min_subdivisions, x_max_ratio);
    const y_grids = generate_asymmetric_geometric_grid_from_regions(y_regions, y_min_subdivisions, y_max_ratio);

    const x_grid_widths = x_grids.map((grid) => grid.n0+grid.n1);
    const y_grid_heights = y_grids.map((grid) => grid.n0+grid.n1);

    const x_pad_width = x_grid_widths.reduce((a,b) => Math.max(a,b), 0);
    const y_pad_height = y_grid_heights.reduce((a,b) => Math.max(a,b), 0);

    const Nx = x_pad_width*2 + x_grid_widths.reduce((a,b) => a+b, 0);
    const Ny = y_pad_height*2 + y_grid_heights.reduce((a,b) => a+b, 0);

    const grid = new Grid(Ny, Nx);


    // grid feature lines
    generate_deltas(grid.dx.lo([x_pad_width]), x_grids);
    generate_deltas(grid.dy.lo([y_pad_height]), y_grids);
    // grid padding
    const x_pad_left_region = generate_padding(grid.dx.hi([x_pad_width]).reverse(), x_grids[0].a0, 1.0+x_max_ratio);
    const x_pad_right_region = generate_padding(grid.dx.lo([Nx-x_pad_width]), x_grids[x_grids.length-1].a1, 1.0+x_max_ratio);
    const y_pad_bottom_region = generate_padding(grid.dy.hi([y_pad_height]).reverse(), y_grids[0].a0, 1.0+y_max_ratio);
    const y_pad_top_region = generate_padding(grid.dy.lo([Ny-y_pad_height]), y_grids[y_grids.length-1].a1, 1.0+y_max_ratio);

    // convert from region space to grid space
    const x_region_to_grid_indices: number[] = [0, x_pad_width];
    for (let i = 0, x = x_pad_width; i < x_regions.length; i++) {
      x += x_grid_widths[i];
      x_region_to_grid_indices.push(x);
    }
    x_region_to_grid_indices.push(x_pad_width);
    const y_region_to_grid_indices: number[] = [0, y_pad_height];
    for (let i = 0, y = y_pad_height; i < y_regions.length; i++) {
      y += y_grid_heights[i];
      y_region_to_grid_indices.push(y);
    }
    y_region_to_grid_indices.push(y_pad_height);

    // create region and grid lines for visualisation
    const x_grid_lines = get_grid_lines_from_deltas(Array.from(grid.dx.data));
    const y_grid_lines = get_grid_lines_from_deltas(Array.from(grid.dy.data));
    const x_region_lines = get_grid_lines_from_deltas([x_pad_left_region, ...x_regions, x_pad_right_region]);
    const y_region_lines = get_grid_lines_from_deltas([y_pad_bottom_region, ...y_regions, y_pad_top_region]);

    this.grid = grid;
    this.x_regions = x_regions;
    this.y_regions = y_regions;
    this.x_grids = x_grids;
    this.y_grids = y_grids;
    this.x_region_to_grid_indices = x_region_to_grid_indices;
    this.y_region_to_grid_indices = y_region_to_grid_indices;
    this.x_grid_lines = x_grid_lines;
    this.y_grid_lines = y_grid_lines;
    this.x_region_lines = x_region_lines;
    this.y_region_lines = y_region_lines;
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

  v_force_region([y_start, x_start]: [number, number], [y_end, x_end]: [number, number]): NdarrayView {
    const i_start = [this.y_region_to_grid_indices[y_start], this.x_region_to_grid_indices[x_start]];
    const i_end = [this.y_region_to_grid_indices[y_end], this.x_region_to_grid_indices[x_end]];
    return this.grid.v_force.hi(i_end).lo(i_start);
  }

  v_field_region([y_start, x_start]: [number, number], [y_end, x_end]: [number, number]): NdarrayView {
    const i_start = [this.y_region_to_grid_indices[y_start], this.x_region_to_grid_indices[x_start]];
    const i_end = [this.y_region_to_grid_indices[y_end], this.x_region_to_grid_indices[x_end]];
    return this.grid.v_field.hi(i_end).lo(i_start);
  }

  e_field_region([y_start, x_start]: [number, number], [y_end, x_end]: [number, number]): NdarrayView {
    const i_start = [this.y_region_to_grid_indices[y_start], this.x_region_to_grid_indices[x_start], 0];
    const i_end = [this.y_region_to_grid_indices[y_end], this.x_region_to_grid_indices[x_end], 2];
    return this.grid.e_field.hi(i_end).lo(i_start);
  }

  epsilon_k_region([y_start, x_start]: [number, number], [y_end, x_end]: [number, number]): NdarrayView {
    const i_start = [this.y_region_to_grid_indices[y_start], this.x_region_to_grid_indices[x_start]];
    const i_end = [this.y_region_to_grid_indices[y_end], this.x_region_to_grid_indices[x_end]];
    return this.grid.epsilon_k.hi(i_end).lo(i_start);
  }
}
