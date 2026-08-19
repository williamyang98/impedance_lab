import { assert, expect, test } from "vitest";
import { WasmModule } from "../src/wasm";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { Profiler } from "../src/utility/profiler.ts";
import { TestStorage } from "./test_storage.ts";
import { Stackup } from "../src/views/via_2d/stackup.ts";
import { StackupGrid } from "../src/views/via_2d/stackup_to_grid.ts";
import { calculate_via_impedance } from "../src/views/via_2d/impedance.ts";

test("barrel", async () => {
  const wasm_module = await WasmModule.init();
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();

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

  const stackup_grid = new StackupGrid(
    wasm_module,
    stackup,
    user_data.grid_builder_config_2d,
    profiler,
  );
  const measurement = calculate_via_impedance(stackup_grid, profiler);

  stackup_grid.delete();
  expect(wasm_module.heap_objects.size).toBe(0);

  // console.log(measurement)
  assert.isFinite(measurement.Z0);
});
