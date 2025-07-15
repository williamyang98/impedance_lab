// concave function minima search with discrete search values (https://en.wikipedia.org/wiki/Golden-section_search)
function run_golden_section_search<T extends { error: number }>(
  func: (value: number) => T, v_lower: number, v_upper: number,
): T {
  const cache: Partial<Record<number, T>> = {};
  const run_search = (value: number): T => {
    let result = cache[value];
    if (result === undefined) {
      result = func(value);
      cache[value] = result;
    }
    return result;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  };

  const max_steps = v_upper-v_lower+1;
  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    if (v_upper-v_lower <= 1) break;
    const v_range = v_upper-v_lower;
    const v_left = clamp(Math.round(v_lower+v_range/3), v_lower+1, v_upper);
    const v_right = clamp(Math.round(v_lower+2*v_range/3), v_lower+1, v_upper);
    const result_left = run_search(v_left);
    const result_right = run_search(v_right);
    // Assuming a concave error function, we can narrow the search interval
    if (Math.abs(result_left.error) < Math.abs(result_right.error)) {
      v_upper = v_right;
    } else {
      v_lower = v_left;
    }
  }

  const result_lower = run_search(v_lower);
  const result_upper = run_search(v_upper);
  const best_result = (result_lower.error < result_upper.error) ? result_lower : result_upper;
  return best_result;
}

// monotonically increasing function search
function run_binary_search<T extends { error: number }>(
  func: (value: number) => T, v_min: number, v_initial: number,
): T {
  const max_steps = 16;
  const error_threshold = 1e-4;
  const value_threshold = 1e-4;

  let v_lower: number = v_min;
  let v_upper: number | undefined = undefined;
  let v_unbounded_search = v_initial;

  let best_result: T | undefined = undefined;
  const run_search = (v_search: number): T => {
    const result = func(v_search);
    if (best_result === undefined || (Math.abs(result.error) < Math.abs(best_result.error))) {
      best_result = result;
    }
    return result;
  };

  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    // determine search value
    const v_search: number = (v_upper === undefined) ? v_unbounded_search : (v_lower+v_upper)/2.0;
    const result = run_search(v_search);
    if (Math.abs(result.error) < error_threshold) break;
    // exit if search range reaches target resolution
    if (v_upper && (Math.abs(v_upper-v_lower) < value_threshold)) break;
    if (result.error > 0) {
      v_upper = v_search;
    } else {
      v_lower = v_search;
    }
    // still searching for upper bound
    if (v_upper === undefined) {
      v_unbounded_search = v_search*2;
    }
  }

  if (best_result === undefined) {
    throw Error("Failed to find any best result");
  }
  return best_result;
}


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
      return { error, r };
    }
    const result = run_binary_search(search_r, 0, 1);
    return result.r;
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
        const mesh = result.mesh;
        const error = Math.max(Math.abs(1-mesh.left.r), Math.abs(1-mesh.right.r));
        return { mesh, error };
      }
      const result = run_golden_section_search(search_n0, 1, n-1);
      return result;
    }
    const result = run_golden_section_search(search_n, n_lower, n_upper);
    return result.mesh;
  }
}

export type MeshSegment = LinearMeshSegment | OpenGeometricMeshSegment | ClosedGeometricMeshSegment;
