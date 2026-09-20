import { assert, describe, expect, test, afterAll } from "vitest";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { TestStorage } from "./test_storage.ts";
import { ComputeBenchmark } from "../src/app/benchmark/compute_benchmark.ts";
import * as webgpu from "webgpu";

const is_runner = import.meta.env.CI;
let gpu: GPU | undefined = undefined;

async function request_gpu_device() {
  if (gpu === undefined) {
    Object.assign(globalThis, webgpu.globals);
    gpu = webgpu.create([]);
  }

  const requested_adapter = await gpu.requestAdapter({
    featureLevel: "core",
    powerPreference: "high-performance",
  });
  assert.isNotNull(requested_adapter);
  assert.isTrue(requested_adapter.features.has("core-features-and-limits"));
  const desired_features: GPUFeatureName[] = ["shader-f16", "timestamp-query", "float32-filterable"];
  const requested_features = desired_features.filter((feature) => {
    return requested_adapter.features.has(feature);
  });
  const gpu_device = await requested_adapter.requestDevice({
    requiredFeatures: requested_features,
  });
  return gpu_device;
}

describe.skipIf(is_runner)("compute_benchmarks", async () => {
  if (is_runner) return;

  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const gpu_device = await request_gpu_device();
  const benchmark = new ComputeBenchmark(gpu_device);
  const config = user_data.compute_benchmark_config;

  afterAll(() => {
    gpu_device.destroy();
  });

  const results = benchmark.get_supported_benchmarks();
  for (const result of results) {
    const label = `compute-${result.type}`;
    test.skipIf(!result.is_supported)(label, async () => {
      await benchmark.run_benchmark(result, config);
      assert.isDefined(result.iop_rate);
      assert.isDefined(result.total_steps);
      assert.isUndefined(result.error);
      expect(result.iop_rate).greaterThan(0);
      expect(result.total_steps).greaterThan(0);
    });
  }
});
