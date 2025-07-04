<script lang="ts" setup>
import { ref } from "vue";
import { providers } from "../../providers/providers.ts";
import { KernelBenchmark, type BenchmarkType } from "../../wgpu_kernels/benchmark/index.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { GPUTimer } from "./gpu_timer.ts";

const gpu_device = providers.gpu_device.value;
const gpu_features = gpu_device.features as ReadonlySet<GPUFeatureName>;
const kernel = new KernelBenchmark(gpu_device);

interface BenchmarkResult {
  type: BenchmarkType;
  is_supported: boolean;
  base_outer_loops: number;
  curr_step?: number;
  total_steps?: number;
  iop_rate?: number;
  iop_unit: string;
  error?: string;
}

function get_supported_benchmarks(): BenchmarkResult[] {
  const benchmarks: BenchmarkResult[] = [];
  benchmarks.push(
    { type: "f16", base_outer_loops: 4, iop_unit: "Flop/s", is_supported: gpu_features.has("shader-f16") },
    { type: "f32", base_outer_loops: 2, iop_unit: "Flop/s", is_supported: true },
    { type: "u32", base_outer_loops: 1, iop_unit: "Iop/s", is_supported: true },
    { type: "i32", base_outer_loops: 1, iop_unit: "Iop/s", is_supported: true },
  )
  return benchmarks;
}

const benchmark_results = ref<BenchmarkResult[]>(get_supported_benchmarks());

const total_compute_units = ref<number>(12);
const total_warmup_steps = ref<number>(4);
const total_warm_steps = ref<number>(8);
const work_multiplier = ref<number>(2);
const is_running = ref<boolean>(false);


async function run_benchmark(result: BenchmarkResult, total_steps: number, total_elements: number, total_outer_loops: number) {
  const type_size_bytes = kernel.get_type_size_bytes(result.type);
  const gpu_A = gpu_device.createBuffer({
    size: total_elements*type_size_bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const gpu_timer = new GPUTimer(gpu_device, 1);

  try {
    const samples_ns: bigint[] = [];
    for (let i = 0; i < total_steps; i++) {
      const command_encoder = gpu_device.createCommandEncoder();
      const compute_pass = command_encoder.beginComputePass({
        timestampWrites: gpu_timer.get_timestamp_writes(0),
      });
      kernel.create_pass(compute_pass, gpu_A, total_elements, result.type, total_outer_loops);
      compute_pass.end();
      gpu_timer.enqueue_read(command_encoder);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();

      const timestamps = await gpu_timer.read_timestamps();
      const elapsed_ns = timestamps[0].elapsed_ns;
      samples_ns.push(elapsed_ns);
      result.curr_step = i+1;
    }
    return samples_ns;
  } catch (error) {
    throw error;
  } finally {
    gpu_A.destroy();
    gpu_timer.destroy();
  }
}

async function run_benchmarks() {
  if (is_running.value) return;

  const total_workgroups_per_compute_unit = 2048;
  const total_elements = total_compute_units.value*total_workgroups_per_compute_unit*kernel.workgroup_size;
  const total_steps = total_warmup_steps.value + total_warm_steps.value;

  is_running.value = true;

  for (const result of benchmark_results.value) {
    result.curr_step = 0;
    result.total_steps = total_steps;
    result.iop_rate = undefined;
    result.error = undefined;
  }

  for (const result of benchmark_results.value) {
    if (!result.is_supported) continue;

    try {
      const total_outer_loops = result.base_outer_loops*work_multiplier.value;
      const samples_ns = await run_benchmark(result, total_steps, total_elements, total_outer_loops);

      const warm_samples = samples_ns.slice(total_warmup_steps.value).map(ns => Number(ns)*1e-9);
      const avg_elapsed = warm_samples.reduce((a,b) => a+b, 0)/warm_samples.length;

      const iops_per_element = total_outer_loops*kernel.iops_per_loop*kernel.inner_loop_count;
      const iop_rate = iops_per_element*total_elements/avg_elapsed;
      result.iop_rate = iop_rate;
    } catch (error) {
      result.error = String(error);
    }
  }
  is_running.value = false;
}
</script>

<template>
<div class="card card-border bg-base-100">
  <div class="card-body p-3">
    <div class="card-title">Compute Throughput</div>
    <div class="w-full">
      <div v-if="gpu_features.has('timestamp-query')" class="flex flex-col gap-x-1">
        <table class="table table-compact w-full">
          <tbody>
            <tr>
              <td class="font-medium">Compute Units</td>
              <td><input class="input" type="number" v-model.number="total_compute_units" min="1" step="1"/></td>
            </tr>
            <tr>
              <td class="font-medium">Work Multiplier</td>
              <td><input class="input" type="number" v-model.number="work_multiplier" min="1" step="1"/></td>
            </tr>
            <tr>
              <td class="font-medium">Warmup Steps</td>
              <td><input class="input" type="number" v-model.number="total_warmup_steps" min="1" step="1"/></td>
            </tr>
            <tr>
              <td class="font-medium">Warm Steps</td>
              <td><input class="input" type="number" v-model.number="total_warm_steps" min="1" step="1"/></td>
            </tr>
            <tr v-for="result of benchmark_results" :key="result.type">
              <td class="font-medium">{{ result.type }}</td>
              <td>
                <template v-if="!result.is_supported">
                  <span class="font-medium">Not supported</span>
                </template>
                <template v-else-if="result.error">
                  <span class="font-medium text-error">{{ result.error }}</span>
                </template>
                <template v-else-if="result.iop_rate === undefined">
                  <progress
                    class="w-full h-[1rem] progress progress-info"
                    :value="(result.curr_step ?? 0) / (result.total_steps ?? 1) * 100"
                    max="100"
                  />
                </template>
                <template v-else>
                  {{ with_standard_suffix(result.iop_rate, result.iop_unit, 3) }}
                </template>
              </td>
            </tr>
            <tr>
              <td colspan="2">
                <button type="submit" class="btn w-full" @click="run_benchmarks()" :disabled="is_running">Run benchmark</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="w-full text-center py-2">
        <h1 class="text-2xl">GPU profiling not supported</h1>
      </div>
    </div>
  </div>
</div>
</template>
