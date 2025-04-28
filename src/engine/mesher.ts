import { run_global_section_search, run_binary_search } from "../utility/search.ts";

export interface GeometricGrid {
  a: number;
  r: number;
  n: number;
  direction: "right" | "left";
}

export function generate_geometric_grid(grid: GeometricGrid): number[] {
  const arr = new Array(grid.n);
  let s = grid.a;
  for (let i = 0; i < grid.n; i++) {
    arr[i] = s;
    s *= grid.r;
  }
  if (grid.direction == "left") {
    arr.reverse();
  }
  return arr;
}

export function get_geometric_sum(a: number, r: number, n: number) {
  if (Math.abs(1-r) < 1e-3) {
    return a*n;
  }
  return a*(Math.pow(r, n)-1)/(r-1);
}

function get_geometric_n(sum: number, r: number, a: number): number {
  return Math.log(1 + sum*(r-1)/a)/Math.log(r);
}

function get_geometric_r(sum: number, a: number, n: number): number {
  function search_function(r: number): number {
    const pred_sum = get_geometric_sum(a, r, n);
    return (pred_sum - sum)/2;
  }
  const r = run_binary_search(search_function, 0, 1);
  return r;
}

export interface AsymmetricGeometricGrid {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  n0: number;
  n1: number;
}

function get_asymmetric_geometric_sum(grid: AsymmetricGeometricGrid): number {
  const A1 = get_geometric_sum(grid.a0, grid.r0, grid.n0);
  const A2 = get_geometric_sum(grid.a1, grid.r1, grid.n1);
  return A1+A2;
}

export function generate_asymmetric_geometric_grid(grid: AsymmetricGeometricGrid): number[] {
  const k: number = grid.n0+grid.n1;
  const arr = new Array(k);
  let s0: number = grid.a0;
  for (let i = 0; i < grid.n0; i++) {
    arr[i] = s0;
    s0 *= grid.r0;
  }
  let s1: number = grid.a1;
  for (let i = 0; i < grid.n1; i++) {
    arr[k-1-i] = s1;
    s1 *= grid.r1;
  }
  return arr;
}

function find_best_asymmetric_geometric_grid(
  A: number, a0: number, a1: number,
  n_lower: number, n_upper: number,
): AsymmetricGeometricGrid {
  const grid: AsymmetricGeometricGrid = {
    a0,
    a1,
    r0: 0.0,
    r1: 0.0,
    n0: 0,
    n1: 0,
  };
  let lowest_error: number = Infinity;

  function search_n(n: number): number {
    function search_n0(n0: number): number {
      const n1: number = n-n0;
      // make last gridpoint of each geometric grid equal in size by constraining r1
      function get_r1(r0: number): number {
        // a0*r0^(n0+1) = a1*r1^n1
        const r1 = Math.pow((a0/a1)*Math.pow(r0, n0+1), 1/n1);
        return r1;
      }
      function search_r0(r0: number): number {
        const r1 = get_r1(r0);
        const A_pred = get_asymmetric_geometric_sum({
          a0, a1,
          r0, r1,
          n0, n1,
        });
        const error = (A_pred-A)/A;
        return error;
      }
      const r0 = run_binary_search(search_r0, 0, 1);
      const r1 = get_r1(r0);
      const error = Math.max(Math.abs(1-r0), Math.abs(1-r1));
      if (error < lowest_error) {
        lowest_error = error;
        grid.r0 = r0;
        grid.r1 = r1;
        grid.n0 = n0;
        grid.n1 = n1;
      }
      return error;
    }
    const results = run_global_section_search(search_n0, 1, n-1);
    return results.lowest_error;
  }
  const _results = run_global_section_search(search_n, n_lower, n_upper);
  return grid;
}

export type GridRegion =
  { type: "symmetric", grid: GeometricGrid } |
  { type: "asymmetric", grid: AsymmetricGeometricGrid };

export function calculate_grid_regions(
  regions: number[],
  min_region_subdivisions?: number,
  max_ratio?: number,
): GridRegion[] {
  const min_region = regions.reduce((a,b) => Math.min(a,b), Infinity);
  min_region_subdivisions = min_region_subdivisions ?? 3;
  max_ratio = max_ratio ?? 0.5;

  const min_grid_resolution = regions
    .map((region) => region/min_region_subdivisions)
    .reduce((a,b) => Math.min(a,b), Infinity);
  const a_estimate = regions.map((region) => {
    const size_scale = region/min_region;
    return Math.sqrt(size_scale)*min_grid_resolution;
  });
  const grids: GridRegion[] = [];
  const N = regions.length;
  for (let i = 0; i < N; i++) {
    const a = a_estimate[i];
    const a_left = (i > 0) ? a_estimate[i-1] : a;
    const a_right = (i < (N-1)) ? a_estimate[i+1] : a;
    const a0 = Math.min(a_left, a);
    const a1 = Math.min(a_right, a);

    const A = regions[i];
    if (i == 0) {
      const n_estimate = Math.ceil(get_geometric_n(A, 1+max_ratio, a1));
      const n = Math.max(min_region_subdivisions, n_estimate);
      const r = get_geometric_r(A, a1, n);
      const grid: GeometricGrid = { a: a1, r, n, direction: "left" };
      grids.push({ type: "symmetric", grid });
    } else if (i == (N-1)) {
      const n_estimate = Math.ceil(get_geometric_n(A, 1+max_ratio, a0));
      const n = Math.max(min_region_subdivisions, n_estimate);
      const r = get_geometric_r(A, a0, n);
      const grid: GeometricGrid = { a: a0, r, n, direction: "right" };
      grids.push({ type: "symmetric", grid });
    } else {
      const n_lower = min_region_subdivisions-1;
      const n_upper_estimate = Math.ceil(get_geometric_n(A/2, 1.0+max_ratio, Math.min(a0,a1))*2);
      const n_upper = Math.max(min_region_subdivisions, n_upper_estimate);
      const grid = find_best_asymmetric_geometric_grid(A, a0, a1, n_lower, n_upper);
      grids.push({ type: "asymmetric", grid });
    }
  }
  return grids;
}
