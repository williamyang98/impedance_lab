import { type Parameter, type Stackup } from "./stackup.ts";
import { create_layout_from_stackup, type StackupLayout } from "./layout.ts";
import { StackupGrid } from "./grid.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { run_binary_search } from "../../utility/search.ts";
import { type ManagedObject } from "../../wasm/index.ts";
import { Globals } from "../../global.ts";

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
    const stackup_grid = new StackupGrid(layout, get_parameter, profiler);
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
  const initial_value = ref_param.value;
  const max_steps = 16;
  const error_threshold = 1e-1; // impedance should just be within 0.1 ohms
  const value_threshold = 1e-3; // precision of parameter search

  profiler?.begin("run_binary_search");
  const binary_search_results = run_binary_search(
    search_function,
    initial_value,
    min_value, max_value,
    max_steps,
    error_threshold, value_threshold,
  );
  profiler?.end();

  return new SearchResults(
    parameter_label,
    target_impedance,
    stackup,
    binary_search_results.best_result,
    results,
  );
}
