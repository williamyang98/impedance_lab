import { run_discrete_global_section_search, run_binary_search } from "../utility/search.ts";

export interface IMeshSegment {
  generate_deltas(): number[];
  get_size(): number;
  get_total_elements(): number;
}

export class LinearMeshSegment implements IMeshSegment {
  readonly type = "linear";
  a: number;
  n: number;

  constructor(a: number, n: number) {
    this.a = a;
    this.n = n;
  }

  generate_deltas(): number[] {
      return new Array(this.n).fill(this.a);
  }

  get_size(): number {
    return this.a*this.n;
  }

  get_total_elements(): number {
    return this.n;
  }
}

export class OpenGeometricMeshSegment implements IMeshSegment {
  readonly type = "open_geometric";
  a: number;
  r: number;
  n: number;
  is_reversed: boolean;

  constructor(a: number, r: number, n: number, is_reversed: boolean) {
    this.a = a;
    this.r = r;
    this.n = n;
    this.is_reversed = is_reversed;
  }

  generate_deltas(): number[] {
    const arr = new Array(this.n);
    let s = this.a;
    for (let i = 0; i < this.n; i++) {
      arr[i] = s;
      s *= this.r;
    }
    if (this.is_reversed) {
      arr.reverse();
    }
    return arr;
  }

  get_size(): number {
    return OpenGeometricMeshSegment.calculate_sum(this.a, this.r, this.n);
  }

  get_total_elements(): number {
    return this.n;
  }

  static calculate_sum(a: number, r: number, n: number): number {
    if (Math.abs(1-r) < 1e-3) {
      return a*n;
    }
    return a*(Math.pow(r, n)-1)/(r-1);
  }

  static calculate_n(sum: number, r: number, a: number): number {
    return Math.log(1 + sum*(r-1)/a)/Math.log(r);
  }

  static estimate_r(sum: number, a: number, n: number): number {
    function search_r(r: number) {
      const pred_sum = OpenGeometricMeshSegment.calculate_sum(a, r, n);
      const error = (pred_sum - sum)/2;
      return { error };
    }
    const result = run_binary_search(search_r, 0, 1);
    return result.best_value;
  }

  static search_best_fit(
    A_target: number,
    a: number,
    r_max: number, n_min: number,
  ): OpenGeometricMeshSegment {
    const n_estimate = OpenGeometricMeshSegment.calculate_n(A_target, r_max, a);
    const n = Math.max(n_min, Math.ceil(n_estimate));
    const r = OpenGeometricMeshSegment.estimate_r(A_target, a, n);
    return new OpenGeometricMeshSegment(a, r, n, false);
  }
}

export class ClosedGeometricMeshSegment implements IMeshSegment {
  readonly type = "closed_geometric";
  left: OpenGeometricMeshSegment;
  right: OpenGeometricMeshSegment;

  constructor(a0: number, a1: number, r0: number, r1: number, n0: number, n1: number) {
    this.left = new OpenGeometricMeshSegment(a0, r0, n0, false);
    this.right = new OpenGeometricMeshSegment(a1, r1, n1, true);
  }

  generate_deltas(): number[] {
    const left_deltas = this.left.generate_deltas();
    const right_deltas = this.right.generate_deltas();
    return [...left_deltas, ...right_deltas];
  }

  get_size(): number {
    return this.left.get_size() + this.right.get_size();
  }

  get_total_elements(): number {
    return this.left.get_total_elements() + this.right.get_total_elements();
  }

  static search_lowest_maximum_ratio(
    A_target: number,
    a_left: number, a_right: number,
    n_lower: number, n_upper: number,
  ): ClosedGeometricMeshSegment {
    function search_n(n: number) {
      function search_n0(n0: number) {
        function search_r0(r0: number) {
          const n1: number = n-n0;
          // make last gridpoint of each geometric grid equal in size by constraining r1
          const r1 = Math.pow((a_left/a_right)*Math.pow(r0, n0+1), 1/n1);
          const mesh = new ClosedGeometricMeshSegment(a_left, a_right, r0, r1, n0, n1);
          const A_pred = mesh.get_size();
          const error = (A_pred-A_target)/A_target;
          return { mesh, error };
        }
        const result = run_binary_search(search_r0, 0, 1);
        const mesh = result.best_result.mesh;
        const error = Math.max(Math.abs(1-mesh.left.r), Math.abs(1-mesh.right.r));
        return { mesh, error };
      }
      const result = run_discrete_global_section_search(search_n0, 1, n-1);
      return result.best_result;
    }
    const result = run_discrete_global_section_search(search_n, n_lower, n_upper);
    return result.best_result.mesh;
  }
}

export type MeshSegment = LinearMeshSegment | OpenGeometricMeshSegment | ClosedGeometricMeshSegment;
