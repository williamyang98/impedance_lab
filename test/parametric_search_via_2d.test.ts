import { assert, expect, describe, test } from "vitest";
import { WasmModule } from "../src/wasm";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { Profiler } from "../src/utility/profiler.ts";
import { TestStorage } from "./test_storage.ts";
import { search_parameters } from "../src/views/via_2d/search.ts";
import { ToastManager } from "../src/providers/toast/toast.ts";
import { Stackup } from "../src/views/via_2d/stackup.ts";

async function run_parametric_search(target_impedance: number) {
  const wasm_module = await WasmModule.init();
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();
  const toast = new ToastManager();

  const stackup = new Stackup();
  const L0 = stackup.create_surface_layer();
  const L1 = stackup.create_inner_layer();
  const L2 = stackup.create_inner_layer();
  const L3 = stackup.create_surface_layer();
  stackup.layers.push(L0, L1, L2, L3);
  stackup.regenerate_id_to_index();

  L0.plane.has_pad = true;
  L3.plane.has_pad = true;
  L1.planes.bottom.has_pad = true;
  L1.planes.bottom.has_plane = true;

  const parameters = [L1.planes.bottom.Dantipad];
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
  expect(best_result.impedance.Z0).closeTo(target_impedance, 1);
  assert.isFinite(best_result.value);

  search_results.best_stackup_grid.delete();
  expect(wasm_module.heap_objects.size).toBe(0);
}

describe("barrel", () => {
  const impedances: number[] = [40, 45, 50, 55, 60];
  for (const impedance of impedances) {
    const label = `Z0=${impedance}Ω`;
    test(label, async () => { await run_parametric_search(impedance); });
  }
});
