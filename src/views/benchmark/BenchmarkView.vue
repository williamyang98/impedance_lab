<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { providers } from "../../providers/providers.ts";
import { SearchIcon } from "lucide-vue-next";
import fuzzysort from "fuzzysort";
import { KernelBenchmark, type BenchmarkType } from "../../wgpu_kernels/benchmark";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;
const toast = providers.toast_manager.value;

const is_device = ref(true);
const limits = computed<GPUSupportedLimits>(() => is_device.value ? gpu_device.limits : gpu_adapter.limits);

type LimitField = keyof GPUSupportedLimits;
const all_limit_fields: LimitField[] = [
  "maxTextureDimension1D",
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxTextureArrayLayers",
  "maxBindGroups",
  "maxBindGroupsPlusVertexBuffers",
  "maxBindingsPerBindGroup",
  "maxDynamicUniformBuffersPerPipelineLayout",
  "maxDynamicStorageBuffersPerPipelineLayout",
  "maxSampledTexturesPerShaderStage",
  "maxSamplersPerShaderStage",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesPerShaderStage",
  "maxUniformBuffersPerShaderStage",
  "maxUniformBufferBindingSize",
  "maxStorageBufferBindingSize",
  "minUniformBufferOffsetAlignment",
  "minStorageBufferOffsetAlignment",
  "maxVertexBuffers",
  "maxBufferSize",
  "maxVertexAttributes",
  "maxVertexBufferArrayStride",
  "maxInterStageShaderVariables",
  "maxColorAttachments",
  "maxColorAttachmentBytesPerSample",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupsPerDimension",
  "maxStorageBuffersInVertexStage",
  "maxStorageBuffersInFragmentStage",
  "maxStorageTexturesInVertexStage",
  "maxStorageTexturesInFragmentStage",
];

const prepared_limit_fields = all_limit_fields.map((field) => {
  return {
    field,
    prepared: fuzzysort.prepare(field),
  }
});


interface SearchResult {
  field: LimitField;
  result: Fuzzysort.Result;
}
const search_results = ref<SearchResult[] | undefined>(undefined);

function perform_search(search_string: string | undefined) {
  if (search_string === undefined || search_string.length === 0) {
    search_results.value = undefined;
    return;
  }

  const results: SearchResult[] = [];
  for (const { field, prepared } of prepared_limit_fields) {
    const result = fuzzysort.single(search_string, prepared)
    if (result === null) continue;
    results.push({
      field,
      result,
    });
  }
  search_results.value = results;
}

const search_string = ref<string | undefined>(undefined);
const limit_fields = computed<LimitField[]>(() => {
  if (search_results.value !== undefined) {
    return search_results.value.map(result => result.field);
  }
  return all_limit_fields;
});

watch(search_string, (new_search_string) => {
  perform_search(new_search_string);
});

const kernel = new KernelBenchmark(gpu_device);

interface BenchmarkResult {
  type: BenchmarkType;
  is_supported: boolean;
  base_outer_loops: number;
  curr_step?: number;
  total_steps?: number;
  avg_ms?: number;
  iop_rate?: number;
  iop_unit: string;
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

const query_set = gpu_device.createQuerySet({
  type: "timestamp",
  count: 2,
});
const query_buf = gpu_device.createBuffer({
  label: "query_resolve_buffer",
  size: 8*query_set.count,
  usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
});
const query_buf_map = gpu_device.createBuffer({
  label: "query_resolve_buffer_map",
  size: query_buf.size,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const timestamp_writes: GPUComputePassTimestampWrites = {
  querySet: query_set,
  beginningOfPassWriteIndex: 0,
  endOfPassWriteIndex: 1,
};

async function run_benchmarks() {
  if (is_running.value) return;

  const total_workgroups_per_compute_unit = 2048;
  const total_steps = total_warmup_steps.value + total_warm_steps.value;
  const total_elements = total_compute_units.value*total_workgroups_per_compute_unit*kernel.workgroup_size;
  is_running.value = true;

  for (const result of benchmark_results.value) {
    result.curr_step = 0;
    result.total_steps = total_steps;
    result.iop_rate = undefined;
    result.avg_ms = undefined;
  }

  try {
    for (const result of benchmark_results.value) {
      if (!result.is_supported) continue;

      const type_size_bytes = kernel.get_type_size_bytes(result.type);
      const gpu_A = gpu_device.createBuffer({
        size: total_elements*type_size_bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });

      const total_outer_loops = result.base_outer_loops*work_multiplier.value;

      const samples_ms: number[] = [];
      for (let i = 0; i < total_steps; i++) {
        const command_encoder = gpu_device.createCommandEncoder();
        const compute_pass = command_encoder.beginComputePass({
          timestampWrites: timestamp_writes,
        });
        kernel.create_pass(compute_pass, gpu_A, total_elements, result.type, total_outer_loops);
        compute_pass.end();

        command_encoder.resolveQuerySet(query_set, 0, 2, query_buf, 0);
        command_encoder.copyBufferToBuffer(query_buf, query_buf_map, query_buf.size);
        gpu_device.queue.submit([command_encoder.finish()]);

        await query_buf_map.mapAsync(GPUMapMode.READ, 0, query_buf.size);
        const data = new BigUint64Array(query_buf_map.getMappedRange(0, query_buf_map.size).slice(0));
        query_buf_map.unmap();

        await gpu_device.queue.onSubmittedWorkDone();

        const elapsed_ns = data[1]-data[0]
        const elapsed_ms = Number(elapsed_ns)*1e-6;
        samples_ms.push(elapsed_ms);

        result.curr_step = i+1;
      }
      const warm_samples_ms = samples_ms.slice(total_warmup_steps.value);
      const avg_elapsed_ms = warm_samples_ms.reduce((a,b) => a+b, 0)/warm_samples_ms.length;
      const iops_per_element = total_outer_loops*kernel.iops_per_loop*kernel.inner_loop_count;
      const iop_rate = iops_per_element*total_elements/(avg_elapsed_ms*1e-3);
      result.iop_rate = iop_rate;
      result.avg_ms = avg_elapsed_ms;
    }
  } catch (error) {
    toast.error(`Benchmark failed with: ${String(error)}`);
  }
  is_running.value = false;
}

async function on_submit(ev: Event) {
  ev.preventDefault();
  await run_benchmarks();
}

</script>

<template>
<div class="grid grid-cols-2 gap-x-2">
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <div class="card-title">GPU Limits</div>
      <div class="flex flex-col">
        <div class="flex flex-row gap-x-2 items-center w-full">
          <label class="input w-full">
            <SearchIcon class="w-[1.25rem] h-[1.25rem]"/>
            <input type="search" placeholder="Search" v-model="search_string"/>
          </label>
          <select class="select w-fit" v-model="is_device">
            <option :value="true">Device</option>
            <option :value="false">Adapter</option>
          </select>
        </div>
        <div class="max-h-[75vh] overflow-y-auto w-full">
          <table class="table w-full">
            <thead>
              <tr>
                <th>Property</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in limit_fields" :key="field">
                <td>{{ field }}</td><td>{{ limits[field] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
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
                <span class="font-medium" v-if="!result.is_supported">Not supported</span>
                <progress
                  v-else-if="result.iop_rate === undefined"
                  class="w-full h-[1rem] progress progress-info"
                  :value="(result.curr_step ?? 0) / (result.total_steps ?? 1) * 100"
                  max="100"
                />
                <template v-else>{{ with_standard_suffix(result.iop_rate, result.iop_unit, 3) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
</template>
