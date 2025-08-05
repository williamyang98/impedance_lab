import { type Parameter, type Stackup } from "./stackup.ts";
import { StackupGrid } from "./stackup_to_grid.ts";
import { type GridBuilderConfig } from "../../app/electrostatic_2d/grid_builder.ts";
import { type ImpedanceResult, calculate_via_impedance } from "./impedance.ts";
import { ToastManager } from "../../providers/toast/toast.ts";
import { WasmModule } from "../../wasm/index.ts";
import { Profiler } from "../../utility/profiler.ts";
import { run_parameter_search, type ParameterSearchConfig } from "../parameter_search/search.ts";

export class SearchResult {
  value: number;
  impedance: ImpedanceResult;
  iteration: number;
  error: number;

  constructor(
    value: number,
    impedance: ImpedanceResult,
    iteration: number,
    error: number,
  ) {
    this.value = value;
    this.impedance = impedance;
    this.iteration = iteration;
    this.error = error;
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

export async function search_parameters(
  module: WasmModule,
  target_impedance: number,
  stackup: Stackup, params: Parameter[],
  grid_builder_config: GridBuilderConfig,
  search_config: ParameterSearchConfig,
  profiler: Profiler,
  toast: ToastManager,
): Promise<SearchResults> {
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
    .map(param => param.label)
    .filter(name => name !== undefined)
    .join(",");

  const results: SearchResult[] = [];
  let best_result = undefined as (SearchResult | undefined);
  let best_stackup_grid = undefined as (StackupGrid | undefined);

  // eslint-disable-next-line @typescript-eslint/require-await
  const search_function = async (value: number): Promise<SearchResult> => {
    for (const param of params) {
      param.value = value;
    }

    const curr_iter = results.length;
    const metadata: Partial<Record<string, string>> = {
      iteration: `${curr_iter}`,
    };
    profiler.begin(`search_${curr_iter}`, undefined, metadata);

    profiler.begin("create_grid", "Create simulation grid from layout");
    const stackup_grid = new StackupGrid(module, stackup, grid_builder_config, profiler);
    profiler.end();

    profiler.begin("calculate_impedance", "Perform impedance measurements", {
      "Total Columns": `${stackup_grid.grid.width}`,
      "Total Rows": `${stackup_grid.grid.height}`,
      "Total Cells": `${stackup_grid.grid.width*stackup_grid.grid.height}`,
    });
    const measurement = calculate_via_impedance(stackup_grid, profiler);
    profiler.end();

    profiler.end();

    const actual_impedance = measurement.Z0;
    const error_impedance = target_impedance-actual_impedance;
    const error = impedance_correlation == "positive" ? -error_impedance : error_impedance;

    metadata.name = parameter_label;
    metadata.value = value.toPrecision(3);
    metadata.target_impedance = target_impedance.toPrecision(3);
    metadata.actual_impedance = actual_impedance.toPrecision(3);
    metadata.error_impedance = error_impedance.toPrecision(3);
    metadata.error = error.toPrecision(3);

    const result = new SearchResult(
      value,
      measurement,
      curr_iter,
      error,
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
    await run_parameter_search(
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
