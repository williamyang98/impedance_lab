import { assert, expect, describe, test } from "vitest";
import { WasmModule } from "../src/wasm";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { Profiler } from "../src/utility/profiler.ts";
import { TestStorage } from "./test_storage.ts";
import { type ColinearLayout, type BroadsideLayout, type Stackup } from "../src/views/stackup_2d/stackup.ts";
import {
  create_colinear_stackup, create_broadside_stackup,
  type LayerTemplateType,
} from "../src/views/stackup_2d/stackup_templates.ts";
import { StackupGrid } from "../src/views/stackup_2d/stackup_to_grid.ts";
import { perform_measurement } from "../src/views/stackup_2d/measurement.ts";

type TestArgs =
  { type: "colinear", layer_type: LayerTemplateType, layout: ColinearLayout } |
  { type: "broadside", layer_type: LayerTemplateType, layout: BroadsideLayout };

async function run_test(args: TestArgs) {
  const wasm_module = await WasmModule.init();
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();

  let stackup: Stackup;
  switch (args.type) {
    case "colinear": {
      stackup = create_colinear_stackup(args.layer_type);
      stackup.selected_layout = args.layout;
      break;
    }
    case "broadside": {
      stackup = create_broadside_stackup(args.layer_type);
      stackup.selected_layout = args.layout;
      break;
    }
  }

  const stackup_grid = new StackupGrid(
    wasm_module,
    stackup,
    user_data.grid_builder_config_2d,
    profiler,
  );
  const measurement = perform_measurement(stackup_grid, profiler);

  stackup_grid.delete();
  expect(wasm_module.heap_objects.size).toBe(0);

  // console.log(measurement);
  switch (measurement.type) {
    case "single": {
      assert.isFinite(measurement.masked.Z0);
      if (measurement.unmasked !== undefined) {
        assert.isFinite(measurement.unmasked.Z0);
      }
      break;
    }
    case "differential": {
      assert.isFinite(measurement.odd_masked.Z0);
      assert.isFinite(measurement.even_masked.Z0);
      if (measurement.odd_unmasked !== undefined) {
        assert.isFinite(measurement.odd_masked.Z0);
      }
      break;
    }
  }
}

describe("colinear", () => {
  const layer_types: LayerTemplateType[] = ["microstrip", "stripline"];
  const layouts: ColinearLayout[] = ["single", "differential", "coplanar_single", "coplanar_differential"];
  for (const layer_type of layer_types) {
    for (const layout of layouts) {
      const label = `layer_type=${layer_type}, layout=${layout}`;
      test(label, async () => { await run_test({ type: "colinear", layer_type, layout }); });
    }
  }
});

describe("broadside", () => {
  const layer_types: LayerTemplateType[] = ["microstrip", "stripline"];
  const layouts: BroadsideLayout[] = ["pair", "coplanar_pair", "mirrored_pair", "mirrored_coplanar_pair"];
  for (const layer_type of layer_types) {
    for (const layout of layouts) {
      const label = `layer_type=${layer_type}, layout=${layout}`;
      test(label, async () => { await run_test({ type: "broadside", layer_type, layout }); });
    }
  }
});
