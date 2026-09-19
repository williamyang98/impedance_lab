<script lang="ts" setup>
import { ref } from "vue";
import { providers } from "../../providers/providers.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { NumberField, integer_validator } from "../../utility/form_validation.ts";
import { TriangleAlert } from "@lucide/vue";
import { ComputeBenchmark } from "../../app/benchmark/compute_benchmark.ts";

const gpu_device = providers.gpu_device.value;
const user_data = providers.user_data.value;
const toasts = providers.toast_manager.value;
const benchmark = new ComputeBenchmark(gpu_device);
const benchmark_results = ref(benchmark.get_supported_benchmarks());
const is_running = ref<boolean>(false);
const gpu_features = gpu_device.features as ReadonlySet<GPUFeatureName>;

const config = user_data.compute_benchmark_config;
const config_form = ref([
  new NumberField(config, "total_compute_units", "Compute Units", 1, 1024, 1, integer_validator),
  new NumberField(config, "work_multiplier", "Work Multiplier", 1, 1024, 1, integer_validator),
  new NumberField(config, "total_warmup_steps", "Warmup Steps", 1, 1024, 1, integer_validator),
  new NumberField(config, "total_warm_steps", "Warmed Steps", 1, 1024, 1, integer_validator),
]);

async function run_benchmarks() {
  if (is_running.value) return;
  try {
    is_running.value = true;
    for (const result of benchmark_results.value) {
      await benchmark.run_benchmark(result, config);
    }
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
    <div class="card-title">Compute Throughput</div>
    <div class="w-full">
      <div v-if="gpu_features.has('timestamp-query')" class="flex flex-col gap-x-1">
        <table class="table table-compact w-full">
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
