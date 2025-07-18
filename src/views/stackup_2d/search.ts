import { type Parameter, type Stackup } from "./stackup.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { type StackupGridConfig, StackupGrid } from "./grid.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { ToastManager } from "../../providers/toast/toast.ts";
import { WasmModule } from "../../wasm/index.ts";

export interface ParameterSearchConfig {
  max_steps: number; // number of search steps
  impedance_tolerance: number; // how much error in search impedance
  search_precision: number; // smallest difference between search points
}

function run_parameter_search<T extends { error: number }>(
  config: ParameterSearchConfig,
  func: (value: number) => T,
  v_initial?: number, v_min?: number, v_max?: number,
): T {
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
  if (v_max !== undefined) v_required_search.push(v_max);
  v_required_search.push(v_min, v_initial);

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
      result = func(v_search);
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


export class SearchResult {
  value: number;
  impedance: number;
  iteration: number;
  error: number;
  measurement: Measurement;

  constructor(
    value: number,
    impedance: number,
    iteration: number,
    error: number,
    measurement: Measurement,
  ) {
    this.value = value;
    this.impedance = impedance;
    this.iteration = iteration;
    this.error = error;
    this.measurement = measurement;
  }
}

export class SearchResults {
  parameter_label: string;
  target_impedance: number;
  stackup: Stackup;
  results: SearchResult[];
  best_result: SearchResult;
  best_stackup_grid: StackupGrid; // NOTE: caller is expected to call .delete() for this

  constructor(
    parameter_label: string,
    target_impedance: number,
    stackup: Stackup,
    results: SearchResult[],
    best_result: SearchResult,
    best_stackup_grid: StackupGrid,
  ) {
    this.parameter_label = parameter_label;
    this.target_impedance = target_impedance;
    this.stackup = stackup;
    this.results = results;
    this.best_result = best_result;
    this.best_stackup_grid = best_stackup_grid;
  }
}

export function search_parameters(
  module: WasmModule,
  target_impedance: number,
  stackup: Stackup, params: Parameter[],
  get_parameter: (param: Parameter) => number,
  stackup_config: StackupGridConfig,
  search_config: ParameterSearchConfig,
  profiler: Profiler,
  toast: ToastManager,
): SearchResults {
  if (params.length <= 0) {
    throw Error("Got 0 parameters in parametric search");
  }

  const ref_param = params[0];
  const impedance_correlation = ref_param.impedance_correlation;
  if (impedance_correlation === undefined) {
    throw Error("Got first parameter without a known impedance correlation");
  }

  for (const param of params) {
    if (param.impedance_correlation != impedance_correlation) {
      throw Error(`Impedance correlation mismatch between two parameters: ${ref_param.impedance_correlation}, ${param.impedance_correlation}`);
    }
  }

  const parameter_label = params
    .map(param => param.name)
    .filter(name => name !== undefined)
    .join(",");

  const results: SearchResult[] = [];
  let best_result: SearchResult | undefined = undefined;
  let best_stackup_grid: StackupGrid | undefined = undefined;

  const search_function = (value: number): SearchResult => {
    for (const param of params) {
      param.value = value;
    }

    const curr_iter = results.length;
    const metadata: Partial<Record<string, string>> = {
      iteration: `${curr_iter}`,
    };
    profiler.begin(`search_${curr_iter}`, undefined, metadata);

    profiler.begin("create_layout", "Create layout from transmission line stackup");
    const layout = create_layout_from_stackup(stackup, get_parameter, profiler);
    profiler.end();

    profiler.begin("create_grid", "Create simulation grid from layout");
    const stackup_grid = new StackupGrid(module, layout, get_parameter, profiler, stackup_config);
    profiler.end();

    profiler.begin("run", "Perform impedance measurements", {
      "Total Columns": `${stackup_grid.grid.width}`,
      "Total Rows": `${stackup_grid.grid.height}`,
      "Total Cells": `${stackup_grid.grid.width*stackup_grid.grid.height}`,
    });
    const measurement = perform_measurement(stackup_grid, profiler);
    profiler.end();

    profiler.end();

    const actual_impedance = measurement.type == "single" ? measurement.masked.Z0 : measurement.odd_masked.Z0;
    const error_impedance = target_impedance-actual_impedance;
    const error = impedance_correlation == "positive" ? -error_impedance : error_impedance;

    metadata.name = parameter_label;
    metadata.value = `${value.toPrecision(3)}`;
    metadata.target_impedance = `${target_impedance.toPrecision(3)}`;
    metadata.actual_impedance = `${actual_impedance.toPrecision(3)}`;
    metadata.error_impedance = `${error_impedance.toPrecision(3)}`;
    metadata.error = `${error.toPrecision(3)}`;

    const result = new SearchResult(
      value,
      actual_impedance,
      curr_iter,
      error,
      measurement,
    );

    results.push(result);
    if (best_result === undefined || Math.abs(result.error) < Math.abs(best_result.error)) {
      best_result = result;
      best_stackup_grid?.delete(); // avoid leaking memory
      best_stackup_grid = stackup_grid;
    } else {
      stackup_grid.delete(); // avoid leaking memory
    }
    return result;
  };

  // get search range that satisfies all parameters constraints
  let min_value: number | undefined = undefined;
  let max_value: number | undefined = undefined;
  for (const param of params) {
    if (param.max !== undefined && (max_value === undefined || max_value > param.max)) {
      max_value = param.max;
    }
    if (param.min !== undefined && (min_value === undefined || min_value < param.min)) {
      min_value = param.min;
    }
  }

  profiler.begin("run_binary_search");
  const initial_value = ref_param.value;
  try {
    run_parameter_search(
      search_config,
      search_function,
      initial_value,
      min_value, max_value,
    );
  } catch (error) {
    const curr_iter = results.length;
    toast.warning(`Search function failed early at step ${curr_iter+1} with: ${String(error)}`);
  }
  profiler.end();

  if (best_result === undefined || best_stackup_grid === undefined) {
    throw Error("Parameter search failed to generate any results");
  }

  return new SearchResults(
    parameter_label,
    target_impedance,
    stackup,
    results,
    best_result,
    best_stackup_grid,
  );
}
