import { assert, expect, beforeAll, test, onTestFinished } from "vitest";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { Profiler } from "../src/utility/profiler.ts";
import { TestStorage } from "./test_storage.ts";
import { Stackup } from "../src/views/via_3d/stackup.ts";
import { StackupGrid } from "../src/views/via_3d/stackup_to_grid.ts";
import { Executor, type ExecutorControls, calculate_ideal_total_steps } from "../src/views/via_3d/executor.ts";
import * as webgpu from "webgpu";

const is_runner = import.meta.env.CI;
let gpu: GPU;

beforeAll(() => {
  Object.assign(globalThis, webgpu.globals);
  gpu = webgpu.create([]);
});

async function request_gpu_device() {
  const requested_adapter = await gpu.requestAdapter();
  assert.isNotNull(requested_adapter);
  const desired_features: GPUFeatureName[] = ["shader-f16", "timestamp-query", "float32-filterable"];
  const requested_features = desired_features.filter((feature) => {
    return requested_adapter.features.has(feature);
  });
  const gpu_device = await requested_adapter.requestDevice({
    requiredFeatures: requested_features,
  });
  onTestFinished(() => {
    gpu_device.destroy();
  });
  return gpu_device;
}

test.skipIf(is_runner)("barrel", async () => {
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const profiler = new Profiler();

  const gpu_device = await request_gpu_device();

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
    gpu_device, stackup,
    user_data.grid_builder_config_3d,
    profiler,
  );


  const executor_controls: ExecutorControls = {
    total_steps: 2048,
    stride_size: 256,
  };
  const executor = new Executor(gpu_device, executor_controls);
  executor.controls.total_steps = calculate_ideal_total_steps(stackup_grid.size);

  const result = await executor.run(stackup_grid, undefined, profiler);
  assert.isFinite(result.Z0);
  expect(result.Z0).greaterThan(45).lessThan(55);
});
