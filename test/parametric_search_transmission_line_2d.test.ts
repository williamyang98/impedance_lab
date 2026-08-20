import { assert, expect, describe, test } from "vitest";
import { WasmModule } from "../src/wasm";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { Profiler } from "../src/utility/profiler.ts";
import { TestStorage } from "./test_storage.ts";
import { search_parameters } from "../src/views/stackup_2d/search.ts";
import { ToastManager } from "../src/providers/toast/toast.ts";
import { ColinearStackup, BroadsideStackup } from "../src/views/stackup_2d/stackup.ts";

async function run_colinear_parametric_search(target_impedance: number) {
  const wasm_module = await WasmModule.init();
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();
  const toast = new ToastManager();

  const stackup = new ColinearStackup();
  stackup.selected_layout = "single";
  const L0 = stackup.create_surface_layer("bottom");
  const L1 = stackup.create_inner_layer();
  stackup.layers = [L0, L1];
  stackup.regenerate_layer_id_to_index();
  stackup.move_trace({ layer_id: L0.id, orientation: L0.orientation });
  L0.has_soldermask = true;
  assert(L1.add_plane.bottom !== undefined);
  L1.add_plane.bottom();

  const parameters = [stackup.trace_width];
  const search_results = await search_parameters(
    wasm_module,
    target_impedance,
    stackup,
    parameters,
    user_data.grid_builder_config_2d,
    user_data.parameter_search_config,
    profiler,
    toast,
  );

  const best_result = search_results.best_result;
  assert(best_result.measurement.type === "single");
  expect(best_result.impedance).closeTo(target_impedance, 1);
  assert.isFinite(best_result.value);

  search_results.best_stackup_grid.delete();
  expect(wasm_module.heap_objects.size).toBe(0);
}

describe("colinear", () => {
  const impedances: number[] = [20, 30, 40, 50, 60, 70, 80, 90];
  for (const impedance of impedances) {
    const label = `Z0=${impedance}Ω`;
    test(label, async () => { await run_colinear_parametric_search(impedance); });
  }
});

async function run_broadside_parametric_search(target_impedance: number) {
  const wasm_module = await WasmModule.init();
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();
  const toast = new ToastManager();

  const stackup = new BroadsideStackup();
  stackup.selected_layout = "pair";
  const L0 = stackup.create_surface_layer("bottom");
  const L1 = stackup.create_inner_layer();
  const L2 = stackup.create_surface_layer("top");
  stackup.layers = [L0,L1,L2];
  stackup.regenerate_layer_id_to_index();
  stackup.move_trace({ layer_id: L0.id, orientation: L0.orientation }, "left");
  stackup.move_trace({ layer_id: L2.id, orientation: L2.orientation }, "right");
  stackup.trace_width.value = 0.35;
  stackup.trace_width.unit = "mm";
  stackup.broadside_spacing.value = 0.05;
  stackup.broadside_spacing.unit = "mm";

  L0.has_soldermask = true;
  L1.dielectric_height.value = 0.025;
  L1.dielectric_height.unit = "mm";
  L2.has_soldermask = true;

  const parameters = [stackup.broadside_spacing];
  const search_results = await search_parameters(
    wasm_module,
    target_impedance,
    stackup,
    parameters,
    user_data.grid_builder_config_2d,
    user_data.parameter_search_config,
    profiler,
    toast,
  );

  const best_result = search_results.best_result;
  assert(best_result.measurement.type === "differential");
  expect(best_result.impedance).closeTo(target_impedance, 1);
  assert.isFinite(best_result.value);

  search_results.best_stackup_grid.delete();
  expect(wasm_module.heap_objects.size).toBe(0);
}

describe("broadside", () => {
  const impedances: number[] = [20, 30, 40, 50, 60, 70, 80, 90];
  for (const impedance of impedances) {
    const label = `Z0=${impedance}Ω`;
    test(label, async () => { await run_broadside_parametric_search(impedance); });
  }
});
