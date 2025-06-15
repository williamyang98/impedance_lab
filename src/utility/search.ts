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
  v_initial?: number, v_min?: number, v_max?: number,
  max_steps?: number, error_threshold?: number, value_threshold?: number,
): BinarySearchResult<T> {
  v_min = v_min ?? 0; // unless specified default search to [0,Infinity)
  if (v_max && v_max < v_min) {
    throw Error(`Maximum search value ${v_max} is less than minimum search value ${v_min}`);
  }

  // determine initial search value
  if (v_initial === undefined) {
    if (v_max !== undefined) {
      v_initial = (v_max+v_min)/2.0;
    } else {
      v_initial = v_min+1;
    }
  } else {
    if (v_max !== undefined && v_initial > v_max) {
      console.warn(`Decreasing initial search value ${v_initial} to maximum search value ${v_max}`);
      v_initial = v_max;
    } else if (v_initial < v_min) {
      console.warn(`Increasing initial search value ${v_initial} to minimum search value ${v_max}`);
      v_initial = v_min;
    }
  }

  // avoid upper bound search stall since 0 value cannot be doubled
  if (v_initial == 0.0) {
    if (v_max === undefined) {
      v_initial = 1.0;
    } else {
      v_initial = (v_max+v_min)/2.0;
    }
    console.warn(`Initial value was 0 and will be replaced with a non-zero finite value ${v_initial}`);
  }

  max_steps = max_steps ?? 32;
  error_threshold = error_threshold ?? 1e-3;
  value_threshold = value_threshold ?? 1e-3;

  let v_lower: number = v_min;
  let v_upper: number | undefined = v_max;
  let v_unbounded_search = v_initial; // used if v_upper is unknown

  let best_value: number | undefined = undefined;
  let best_result: T | undefined = undefined;

  for (let curr_step = 0; curr_step < max_steps; curr_step++) {
    // determine search value
    let v_search: number | undefined;
    if (curr_step == 0) {
      v_search = v_initial;
    } else if (v_upper == undefined) {
      v_search = v_unbounded_search;
    } else {
      v_search = (v_lower+v_upper)/2.0;
    }
    const result = func(v_search);
    if (best_result === undefined || (Math.abs(result.error) < Math.abs(best_result.error))) {
      best_result = result;
      best_value = v_search;
    }
    if (Math.abs(result.error) < error_threshold) break;
    if (v_upper && (Math.abs(v_lower-v_upper) < value_threshold)) break;
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

  if (best_value === undefined || best_result === undefined) {
    throw Error("Failed to find any best value and result");
  }
  return { best_value, best_result };
}
