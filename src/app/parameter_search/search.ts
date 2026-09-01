export interface ParameterSearchConfig {
  max_steps: number; // number of search steps
  impedance_tolerance: number; // how much error in search impedance
  search_precision: number; // smallest difference between search points
}

export async function run_parameter_search<T extends { error: number }>(
  config: ParameterSearchConfig,
  func: (value: number) => Promise<T>,
  v_initial?: number, v_min?: number, v_max?: number,
): Promise<T> {
  const max_steps = config.max_steps;
  const error_threshold = config.impedance_tolerance;
  const value_threshold = config.search_precision;

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
      console.warn(`Increasing initial search value ${v_initial} to minimum search value ${v_min}`);
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

  let v_lower: number = v_min;
  let e_lower: number | undefined = undefined;
  let v_upper: number | undefined = v_max;
  let e_upper: number | undefined = undefined;
  let v_unbounded_search = v_initial; // used if v_upper is unknown

  let best_result: T | undefined = undefined;

  // parameter search should include endpoints and initial value
  const v_required_search: number[] = [];
  const epsilon_endpoints = 1e-6; // add some margin so floating point comparisons pass
  if (v_max !== undefined) v_required_search.push(v_max*(1-epsilon_endpoints));
  v_required_search.push(v_min*(1+epsilon_endpoints), v_initial);

  function clamp(value: number, min: number, max: number) {
    return Math.max(Math.min(value, max), min);
  }

  const results = new Map<number, T>();
  let curr_step = 0;
  while (curr_step < max_steps) {
    let v_search: number | undefined;
    // phase 1: endpoints and initial value
    const v_required = v_required_search.pop();
    if (v_required !== undefined) {
      v_search = v_required;
    // phase 2: find upper bound
    } else if (v_upper == undefined) {
      v_search = v_unbounded_search;
    // phase 3: weighted bisection search for faster convergence of naiive binary search
    } else {
      let ratio = 0.5;
      if (e_lower !== undefined && e_upper !== undefined) {
        ratio = e_upper/(e_upper-e_lower);
      }
      // avoid trusting the weights too much since a bad curve can cause convergence to be extremely slow
      const ratio_margin = 0.2;
      ratio = clamp(ratio, ratio_margin, 1-ratio_margin);
      v_search = v_lower*ratio+v_upper*(1-ratio);
    }

    // exit if search range reaches target resolution while narrowing upper and lower bound
    if (
      v_required === undefined &&
      v_upper !== undefined &&
      (Math.abs(v_upper-v_lower) < value_threshold)
    ) {
      break;
    }

    let result = results.get(v_search);
    if (result === undefined) {
      result = await func(v_search);
      curr_step += 1;
      results.set(v_search, result);
    }

    if (best_result === undefined || (Math.abs(result.error) < Math.abs(best_result.error))) {
      best_result = result;
    }
    if (Math.abs(result.error) < error_threshold) break;

    // narrow upper bound
    let is_search_narrowed = false;
    if (result.error > 0) {
      if (v_upper === undefined || e_upper === undefined || v_search < v_upper) {
        v_upper = v_search;
        e_upper = result.error;
        is_search_narrowed = true;
      }
    }
    // narrow lower bound
    if (result.error < 0) {
      if (e_lower === undefined || v_search > v_lower) {
        v_lower = v_search;
        e_lower = result.error;
        is_search_narrowed = true;
      }
    }
    // keep going through required search values
    if (v_required !== undefined) {
      continue;
    }
    // still searching for upper bound
    if (v_upper === undefined) {
      v_unbounded_search = v_search*2;
      continue;
    }
    // search range did not narrow
    if (!is_search_narrowed) {
      console.warn("Exiting parameter search early due to search range not being narrowed");
      break;
    }
  }

  if (best_result === undefined) {
    throw Error("Failed to find any best result");
  }
  return best_result;
}

