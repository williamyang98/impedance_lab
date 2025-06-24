import { type Parameter, type Stackup } from "./stackup.ts";
import { create_layout_from_stackup, type StackupLayout } from "./layout.ts";
import { StackupGrid } from "./grid.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { type ManagedObject } from "../../wasm/index.ts";
import { Globals } from "../../global.ts";

function run_parameter_search<T extends { error: number }>(
  func: (value: number) => T,
  v_initial?: number, v_min?: number, v_max?: number,
): T {
  const max_steps = 16;
  const error_threshold = 1e-1; // impedance should just be within 0.1 ohms
  const value_threshold = 1e-3; // precision of parameter search

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


export class SearchResult implements ManagedObject {
  readonly module = Globals.wasm_module;
  _is_deleted: boolean = false;
  readonly value: number;
  readonly impedance: number;
  readonly iteration: number;
  readonly error: number;
  readonly layout: StackupLayout;
  readonly stackup_grid: StackupGrid;
  readonly measurement: Measurement;

  constructor(
    value: number,
    impedance: number,
    iteration: number,
    error: number,
    layout: StackupLayout,
    stackup_grid: StackupGrid,
    measurement: Measurement,
  ) {
    this.value = value;
    this.impedance = impedance;
    this.iteration = iteration;
    this.error = error;
    this.layout = layout;
    this.stackup_grid = stackup_grid;
    this.measurement = measurement;
    this.module.register_parent_and_children(this, this.stackup_grid);
  }

  delete(): boolean {
    if (this._is_deleted) return false;
    this._is_deleted = true;
    this.module.unregister_parent_and_children(this);
    return true;
  }

  is_deleted(): boolean {
    return this._is_deleted;
  }
}

export class SearchResults implements ManagedObject {
  readonly module = Globals.wasm_module;
  _is_deleted: boolean = false;

  readonly parameter_label: string;
  readonly target_impedance: number;
  readonly stackup: Stackup;
  readonly best_result: SearchResult;
  readonly results: SearchResult[];

  constructor(
    parameter_label: string,
    target_impedance: number,
    stackup: Stackup,
    best_result: SearchResult,
    results: SearchResult[],
  ) {
    this.parameter_label = parameter_label;
    this.target_impedance = target_impedance;
    this.stackup = stackup;
    this.best_result = best_result;
    this.results = results;
    this.module.register_parent_and_children(this, ...this.results);
  }

  delete(): boolean {
    if (this._is_deleted) return false;
    this._is_deleted = true;
    this.module.unregister_parent_and_children(this);
    return true;
  }

  is_deleted(): boolean {
    return this._is_deleted;
  }
}

export function search_parameters(
  target_impedance: number,
  stackup: Stackup, params: Parameter[],
  get_parameter: (param: Parameter) => number,
  profiler?: Profiler,
  minimum_grid_resolution?: number,
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
  const search_function = (value: number): SearchResult => {
    for (const param of params) {
      param.value = value;
    }

    const curr_iter = results.length;
    const metadata: Partial<Record<string, string>> = {
      iteration: `${curr_iter}`,
    };
    profiler?.begin(`search_${curr_iter}`, undefined, metadata);

    profiler?.begin("create_layout", "Create layout from transmission line stackup");
    const layout = create_layout_from_stackup(stackup, get_parameter, profiler);
    profiler?.end();

    profiler?.begin("create_grid", "Create simulation grid from layout");
    const stackup_grid = new StackupGrid(layout, get_parameter, profiler, minimum_grid_resolution);
    profiler?.end();

    profiler?.begin("run", "Perform impedance measurements", {
      "Total Columns": `${stackup_grid.grid.width}`,
      "Total Rows": `${stackup_grid.grid.height}`,
      "Total Cells": `${stackup_grid.grid.width*stackup_grid.grid.height}`,
    });
    const measurement = perform_measurement(stackup_grid, profiler);
    profiler?.end();

    profiler?.end();

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
      layout,
      stackup_grid,
      measurement,
    );
    results.push(result);
    return result;
  };

  const min_value = params
    .map(param => param.min ?? 0)
    .reduce((a,b) => Math.min(a,b), Infinity);
  let max_value: number | undefined = undefined;
  for (const param of params) {
    if (param.max !== undefined) {
      if (max_value === undefined) {
        max_value = param.max;
      } else {
        max_value = Math.max(param.max, max_value);
      }
    }
  }
  profiler?.begin("run_binary_search");
  const initial_value = ref_param.value;
  const best_result = run_parameter_search(
    search_function,
    initial_value,
    min_value, max_value,
  );
  profiler?.end();

  return new SearchResults(
    parameter_label,
    target_impedance,
    stackup,
    best_result,
    results,
  );
}
