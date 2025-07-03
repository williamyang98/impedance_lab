<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { providers } from "../../providers/providers.ts";
import { SearchIcon } from "lucide-vue-next";
import fuzzysort from "fuzzysort";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;

const is_device = ref(true);
const gpu_limits = computed<GPUSupportedLimits>(() => is_device.value ? gpu_device.limits : gpu_adapter.limits);

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


</script>

<template>
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
              <td>{{ field }}</td><td>{{ gpu_limits[field] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
</template>
