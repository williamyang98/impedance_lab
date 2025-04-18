// func should ideally be a concave error function
export interface GlobalSectionSearchResults {
  best_value: number;
  lowest_error: number;
  search_points: Record<number, number>;
}

export function run_global_section_search(
  func: (v: number) => number,
  v_lower: number, v_upper: number,
): GlobalSectionSearchResults {
  const error_cache: Record<number, number> = {};
  function get_error(v: number): number {
    let error: number | undefined = error_cache[v];
    if (error !== undefined) return error;
    error = func(v);
    error_cache[v] = error;
    return error;
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
    const error_left = get_error(v_left);
    const error_right = get_error(v_right);
    // Assuming a concave error function, we can narrow the search interval
    if (error_left < error_right) {
      v_upper = v_right;
    } else {
      v_lower = v_left;
    }
  }

  const error_lower = get_error(v_lower);
  const error_upper = get_error(v_upper);
  let lowest_error = undefined;
  let best_value = undefined;
  if (error_lower < error_upper) {
    lowest_error = error_lower;
    best_value = v_lower;
  } else {
    lowest_error = error_upper;
    best_value = v_upper;
  }

  return {
    best_value,
    lowest_error,
    search_points: error_cache,
  };
}

export function run_binary_search(
  func: (v: number) => number,
  v_lower: number, v_upper: number,
  max_steps?: number, threshold?: number,
): number {
  max_steps = max_steps ?? 32;
  threshold = threshold ?? 1e-3;

  let v_best: number | undefined = undefined;
  let error_min = Infinity;
  let is_found_upper = false;

  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    const v_pivot = is_found_upper ? (v_lower+v_upper)/2.0 : v_upper*2;
    const error = func(v_pivot);
    const error_abs = Math.abs(error);
    if (error_abs < error_min) {
      error_min = error_abs;
      v_best = v_pivot;
    }
    if (error_abs < threshold) break;
    if (error > 0) {
      is_found_upper = true;
      v_upper = v_pivot;
    } else {
      v_lower = v_pivot;
    }
  }

  return v_best as number;
}
