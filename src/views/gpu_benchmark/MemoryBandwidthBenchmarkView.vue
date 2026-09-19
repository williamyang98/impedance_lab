<script lang="ts" setup>
import { ref } from "vue";
import { providers } from "../../providers/providers.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { NumberField, integer_validator } from "../../utility/form_validation.ts";
import { TriangleAlert } from "@lucide/vue";
import { MemoryBandwidthBenchmark, type MemoryBandwidthBenchmarkResult } from "../../app/benchmark/memory_bandwidth_benchmark.ts";

const gpu_device = providers.gpu_device.value;
const user_data = providers.user_data.value;
const toasts = providers.toast_manager.value;
const gpu_features = gpu_device.features as ReadonlySet<GPUFeatureName>;
const is_running = ref<boolean>(false);
const benchmark = new MemoryBandwidthBenchmark(gpu_device);
const config = user_data.memory_bandwidth_benchmark_config;
const config_form = ref([
  new NumberField(config, "total_transfers", "Total Transfers", 1, 1024, 1, integer_validator),
]);
const benchmark_result = ref<MemoryBandwidthBenchmarkResult>({});

async function run_benchmark() {
  try {
    is_running.value = true;
    await benchmark.run_benchmark(benchmark_result.value, config);
  } catch (error) {
    toasts.error(String(error));
  } finally {
    is_running.value = false;
  }
}
</script>

<template>
<div class="card card-border bg-base-100">
  <div class="card-body p-3">
    <div class="card-title">Memory Bandwidth</div>
    <div v-if="gpu_features.has('timestamp-query')" class="flex flex-col gap-x-1">
      <table class="table table-compact">
        <colgroup>
          <col class="w-fit">
          <col class="w-full">
        </colgroup>
        <tbody>
          <tr v-for="field of config_form" :key="field.key">
            <td class="font-medium text-nowrap">{{ field.name }}</td>
            <td>
              <input
                class="input w-full" :class="`${field.error ? 'input-error' : ''}`"
                type="number" v-model.number="field.value"
                :min="field.min" :max="field.max" :step="field.step"
              />
              <div class="text-error text-xs flex flex-row py-1 w-full" v-if="field.error">
                <TriangleAlert class="size-[1rem] mr-1"/>
                <span>{{ field.error }}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td class="font-medium text-nowrap">Buffer size</td>
            <td>{{ with_standard_suffix(benchmark.buffer_size, "B", 3) }}</td>
          </tr>
          <tr>
            <td class="font-medium text-nowrap">Memory bandwidth</td>
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
