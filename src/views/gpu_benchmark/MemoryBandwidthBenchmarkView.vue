<script lang="ts" setup>
import { ref } from "vue";
import { providers } from "../../providers/providers.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { GPUTimer } from "./gpu_timer.ts";

const gpu_device = providers.gpu_device.value;
const gpu_features = gpu_device.features as ReadonlySet<GPUFeatureName>;

const is_running = ref<boolean>(false);
const total_transfers = ref<number>(30);
const buffer_size = gpu_device.limits.maxStorageBufferBindingSize;

interface BenchmarkResult {
  curr_step?: number;
  total_steps?: number;
  bandwidth?: number;
  error?: string;
}

const benchmark_result = ref<BenchmarkResult>({});

async function run_benchmark() {
  const gpu_buffer = gpu_device.createBuffer({
    size: buffer_size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const cpu_buffer = gpu_device.createBuffer({
    size: buffer_size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const kernel_timer = new GPUTimer(gpu_device, 2);
  is_running.value = true;

  const total_steps = total_transfers.value;
  benchmark_result.value.curr_step = 0;
  benchmark_result.value.total_steps = total_steps;
  benchmark_result.value.bandwidth = undefined;
  benchmark_result.value.error = undefined;

  try {
    const command_encoder = gpu_device.createCommandEncoder();
    command_encoder.beginComputePass({
      timestampWrites: kernel_timer.get_timestamp_writes(0),
    }).end();
    for (let i = 0; i < total_steps; i++) {
      command_encoder.copyBufferToBuffer(gpu_buffer, cpu_buffer, buffer_size);
      await cpu_buffer.mapAsync(GPUMapMode.READ, 0, buffer_size);
      benchmark_result.value.curr_step = i+1;
      cpu_buffer.unmap();
    }
    command_encoder.beginComputePass({
      timestampWrites: kernel_timer.get_timestamp_writes(1),
    }).end();
    kernel_timer.enqueue_read(command_encoder);
    gpu_device.queue.submit([command_encoder.finish()]);
    await gpu_device.queue.onSubmittedWorkDone();

    const timestamps = await kernel_timer.read_timestamps();
    const elapsed_ns = timestamps[1].start_ns - timestamps[0].end_ns;
    const elapsed = Number(elapsed_ns)*1e-9;

    const bandwidth = (buffer_size*total_steps)/elapsed;
    benchmark_result.value.bandwidth = bandwidth;
  } catch (error) {
    benchmark_result.value.error = String(error);
  } finally {
    is_running.value = false;
    gpu_buffer.destroy();
    cpu_buffer.destroy();
    kernel_timer.destroy();
  }
}
</script>

<template>
<div class="card card-border bg-base-100">
  <div class="card-body p-3">
    <div class="card-title">Memory Bandwidth</div>
    <div v-if="gpu_features.has('timestamp-query')" class="flex flex-col gap-x-1">
      <table class="table table-compact">
        <tbody>
          <tr>
            <td class="font-medium">Total Transfers</td>
            <td><input class="input" type="number" v-model.number="total_transfers" min="1" step="1"/></td>
          </tr>
          <tr>
            <td class="font-medium">Buffer size</td>
            <td>{{ with_standard_suffix(buffer_size, "B", 3) }}</td>
          </tr>
          <tr>
            <td class="font-medium">Memory bandwidth</td>
            <td>
              <template v-if="benchmark_result.error">
                <span class="font-medium text-error">{{ benchmark_result.error }}</span>
              </template>
              <template v-else-if="benchmark_result.bandwidth === undefined">
                <progress
                  class="w-full h-[1rem] progress progress-info"
                  :value="(benchmark_result.curr_step ?? 0) / (benchmark_result.total_steps ?? 1) * 100"
                  max="100"
                />
              </template>
              <template v-else>
                {{ with_standard_suffix(benchmark_result.bandwidth, "B/s", 3) }}
              </template>
            </td>
          </tr>
          <tr>
            <td colspan="2">
              <button type="submit" class="btn w-full" @click="run_benchmark()" :disabled="is_running">Run benchmark</button>
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
</template>
