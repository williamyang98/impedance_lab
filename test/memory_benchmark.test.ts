import { assert, expect, test, afterAll } from "vitest";
import { UserData } from "../src/providers/user_data/user_data.ts";
import { TestStorage } from "./test_storage.ts";
import { MemoryBandwidthBenchmark, type MemoryBandwidthBenchmarkResult } from "../src/app/benchmark/memory_bandwidth_benchmark.ts";
import * as webgpu from "webgpu";

const is_runner = import.meta.env.CI;
let gpu: GPU | undefined = undefined;

async function request_gpu_device() {
  if (gpu === undefined) {
    Object.assign(globalThis, webgpu.globals);
    gpu = webgpu.create([]);
  }
  const requested_adapter = await gpu.requestAdapter();
  assert.isNotNull(requested_adapter);
  const desired_features: GPUFeatureName[] = ["shader-f16", "timestamp-query", "float32-filterable"];
  const requested_features = desired_features.filter((feature) => {
    return requested_adapter.features.has(feature);
  });
  const gpu_device = await requested_adapter.requestDevice({
    requiredFeatures: requested_features,
  });
  return gpu_device;
}

test.skipIf(is_runner)("memory_benchmark", async () => {
  const storage = new TestStorage();
  const user_data = new UserData(storage);
  const gpu_device = await request_gpu_device();
  const benchmark = new MemoryBandwidthBenchmark(gpu_device);
  const config = user_data.memory_bandwidth_benchmark_config;
  afterAll(() => {
    gpu_device.destroy();
  });

  expect(benchmark.buffer_size).greaterThan(0);

  const result: MemoryBandwidthBenchmarkResult = {};
  await benchmark.run_benchmark(result, config);
  assert.isDefined(result.bandwidth);
  assert.isDefined(result.total_steps);
  assert.isUndefined(result.error);
  expect(result.bandwidth).greaterThan(0);
  expect(result.total_steps).greaterThan(0);
});

