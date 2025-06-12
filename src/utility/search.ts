export interface SearchResult {
  error: number;
}

export type SearchFunction<T extends SearchResult> = (value: number) => T;

// search function should ideally be a concave error function for global section search
export interface DiscreteGlobalSectionSearchResult<T extends SearchResult> {
  best_value: number;
  best_result: T;
  results: Partial<Record<number, T>>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
};

export function run_discrete_global_section_search<T extends SearchResult>(
  func: SearchFunction<T>,
  v_lower: number, v_upper: number,
): DiscreteGlobalSectionSearchResult<T> {
  const cache: Partial<Record<number, T>> = {};
  function get_cache(value: number): T {
    let result = cache[value];
    if (result === undefined) {
      result = func(value);
      cache[value] = result;
    }
    return result;
  }

  const max_steps = v_upper-v_lower+1;
  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    if (v_upper-v_lower <= 1) break;
    const v_range = v_upper-v_lower;
    const v_left = clamp(Math.round(v_lower+v_range/3), v_lower+1, v_upper);
    const v_right = clamp(Math.round(v_lower+2*v_range/3), v_lower+1, v_upper);
    const result_left = get_cache(v_left);
    const result_right = get_cache(v_right);
    // Assuming a concave error function, we can narrow the search interval
    if (Math.abs(result_left.error) < Math.abs(result_right.error)) {
      v_upper = v_right;
    } else {
      v_lower = v_left;
    }
  }

  const result_lower = get_cache(v_lower);
  const result_upper = get_cache(v_upper);
  let best_value = undefined;
  let best_result = undefined;
  if (result_lower.error < result_upper.error) {
    best_value = v_lower;
    best_result = result_lower;
  } else {
    best_value = v_upper;
    best_result = result_upper;
  }

  return {
    best_value,
    best_result,
    results: cache,
  };
}

export interface BinarySearchResult<T extends SearchResult> {
  best_value: number;
  best_result: T;
}

export function run_binary_search<T extends SearchResult>(
  func: SearchFunction<T>,
  v_lower: number, v_upper: number,
  max_steps?: number, threshold?: number,
): BinarySearchResult<T> {
  max_steps = max_steps ?? 32;
  threshold = threshold ?? 1e-3;

  let best_value: number | undefined = undefined;
  let best_result: T | undefined = undefined;
  let is_found_upper = false;

  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    const v_pivot = is_found_upper ? (v_lower+v_upper)/2.0 : v_upper*2;
    const result = func(v_pivot);
    if (best_result === undefined || (Math.abs(result.error) < Math.abs(best_result.error))) {
      best_result = result;
      best_value = v_pivot;
    }
    if (Math.abs(result.error) < threshold) break;
    if (result.error > 0) {
      is_found_upper = true;
      v_upper = v_pivot;
    } else {
      v_lower = v_pivot;
    }
  }

  if (best_value === undefined || best_result === undefined) {
    throw Error("Failed to find any best value and result");
  }
  return { best_value, best_result };
}
