<script lang="ts" setup>
import { ref } from "vue";
import { providers } from "../../providers/providers.ts";
import { KernelBenchmark, type BenchmarkType } from "../../wgpu_kernels/benchmark";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";

const gpu_device = providers.gpu_device.value;
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
  const features = gpu_device.features as ReadonlySet<GPUFeatureName>;
  benchmarks.push(
    { type: "f16", base_outer_loops: 4, iop_unit: "Flop/s", is_supported: features.has("shader-f16") },
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

class KernelTimer {
  device: GPUDevice;
  query_set: GPUQuerySet;
  query_buffer: GPUBuffer;
  query_buffer_readback: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;
    this.query_set = gpu_device.createQuerySet({
      type: "timestamp",
      count: 2,
    });
    this.query_buffer = gpu_device.createBuffer({
      label: "query_resolve_buffer",
      size: 8*this.query_set.count,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    // NOTE: the reason why we need this additional readback buffer is because MAP_READ can only be used with COPY_DST
    this.query_buffer_readback = gpu_device.createBuffer({
      label: "query_resolve_buffer_map",
      size: this.query_buffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  get_timestamp_writes(): GPUComputePassTimestampWrites {
    return {
      querySet: this.query_set,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    }
  }

  enqueue_read(command_encoder: GPUCommandEncoder) {
    command_encoder.resolveQuerySet(this.query_set, 0, 2, this.query_buffer, 0);
    command_encoder.copyBufferToBuffer(this.query_buffer, this.query_buffer_readback, this.query_buffer.size);
  }

  async read_time_elapsed_ns() {
    const buffer = this.query_buffer_readback;
    await buffer.mapAsync(GPUMapMode.READ, 0, buffer.size);
    const data = new BigUint64Array(buffer.getMappedRange(0, buffer.size).slice(0));
    buffer.unmap();
    const elapsed_ns = data[1]-data[0]
    return elapsed_ns;
  }
}

const kernel_timer = new KernelTimer(gpu_device);

async function run_benchmark(result: BenchmarkResult, total_steps: number, total_elements: number, total_outer_loops: number) {
  const type_size_bytes = kernel.get_type_size_bytes(result.type);
  const gpu_A = gpu_device.createBuffer({
    size: total_elements*type_size_bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  try {
    const samples_ns: bigint[] = [];
    for (let i = 0; i < total_steps; i++) {
      const command_encoder = gpu_device.createCommandEncoder();
      const compute_pass = command_encoder.beginComputePass({
        timestampWrites: kernel_timer.get_timestamp_writes(),
      });
      kernel.create_pass(compute_pass, gpu_A, total_elements, result.type, total_outer_loops);
      compute_pass.end();
      kernel_timer.enqueue_read(command_encoder);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();

      const elapsed_ns = await kernel_timer.read_time_elapsed_ns();
      samples_ns.push(elapsed_ns);
      result.curr_step = i+1;
    }
    return samples_ns;
  } catch (error) {
    throw error;
  } finally {
    gpu_A.destroy();
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

async function on_submit(ev: Event) {
  ev.preventDefault();
  await run_benchmarks();
}

</script>

<template>
<div class="card card-border bg-base-100">
  <div class="card-body p-3">
    <div class="card-title">Benchmark</div>
    <div class="flex flex-col gap-x-1">
      <form class="grid grid-cols-2 gap-x-2 gap-y-1" @submit="on_submit">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Compute Units</legend>
          <input class="input" type="number" v-model.number="total_compute_units" min="1" step="1"/>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Work Multiplier</legend>
          <input class="input" type="number" v-model.number="work_multiplier" min="1" step="1"/>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Warmup Steps</legend>
          <input class="input" type="number" v-model.number="total_warmup_steps" min="1" step="1"/>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Warm Steps</legend>
          <input class="input" type="number" v-model.number="total_warm_steps" min="1" step="1"/>
        </fieldset>
        <button type="submit" class="btn w-full col-span-2" @click="run_benchmarks()" :disabled="is_running">Run benchmark</button>
      </form>
      <table class="table w-full">
        <thead>
          <tr>
            <th class="w-fit">Type</th>
            <th class="w-full">Performance</th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
    </div>
  </div>
</div>
</template>
