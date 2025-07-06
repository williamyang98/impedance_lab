<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { providers } from "../../providers/providers.ts";
import { SearchIcon } from "lucide-vue-next";
import fuzzysort from "fuzzysort";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;

type LimitField = keyof GPUSupportedLimits;
const all_limit_fields: LimitField[] = [
  "maxBindGroups",
  "maxBindGroupsPlusVertexBuffers",
  "maxBindingsPerBindGroup",
  "maxBufferSize",
  "maxColorAttachmentBytesPerSample",
  "maxColorAttachments",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupStorageSize",
  "maxComputeWorkgroupsPerDimension",
  "maxDynamicStorageBuffersPerPipelineLayout",
  "maxDynamicUniformBuffersPerPipelineLayout",
  "maxInterStageShaderVariables",
  "maxSampledTexturesPerShaderStage",
  "maxSamplersPerShaderStage",
  "maxStorageBufferBindingSize",
  "maxStorageBuffersInFragmentStage",
  "maxStorageBuffersInVertexStage",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesInFragmentStage",
  "maxStorageTexturesInVertexStage",
  "maxStorageTexturesPerShaderStage",
  "maxTextureArrayLayers",
  "maxTextureDimension1D",
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxUniformBufferBindingSize",
  "maxUniformBuffersPerShaderStage",
  "maxVertexAttributes",
  "maxVertexBufferArrayStride",
  "maxVertexBuffers",
  "minStorageBufferOffsetAlignment",
  "minUniformBufferOffsetAlignment",
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
<div class="flex flex-col w-full h-full bg-base-100 gap-y-1 p-2">
  <label class="input w-full">
    <SearchIcon class="size-[1.25rem]"/>
    <input type="search" placeholder="Search" v-model="search_string"/>
  </label>
  <div class="overflow-y-auto h-full w-full">
    <table class="table table-compact table-pin-rows w-full">
      <thead>
        <tr>
          <th class="w-full">Property</th>
          <th>Adapter</th>
          <th>Device</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in limit_fields" :key="field">
          <td class="break-all">{{ field }}</td>
          <td class="text-nowrap">{{ gpu_adapter.limits[field] ?? 'N/A' }}</td>
          <td class="text-nowrap">{{ gpu_device.limits[field] ?? 'N/A' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
</template>
