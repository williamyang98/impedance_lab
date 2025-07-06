<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { providers } from "../../providers/providers.ts";
import { SearchIcon } from "lucide-vue-next";
import fuzzysort from "fuzzysort";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;

const all_features: GPUFeatureName[] = [
  "bgra8unorm-storage",
  "clip-distances",
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "dual-source-blending",
  "float32-blendable",
  "float32-filterable",
  "indirect-first-instance",
  "rg11b10ufloat-renderable",
  "shader-f16",
  "subgroups",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "timestamp-query",
]

interface PreparedFeature {
  feature: GPUFeatureName;
  prepared: Fuzzysort.Prepared;
}

const prepared_features: PreparedFeature[] = all_features.map((feature) => {
  return {
    feature,
    prepared: fuzzysort.prepare(feature),
  }
});

interface SearchResult {
  feature: GPUFeatureName;
  result: Fuzzysort.Result;
}
const search_results = ref<SearchResult[] | undefined>(undefined);

function perform_search(search_string: string | undefined) {
  if (search_string === undefined || search_string.length === 0) {
    search_results.value = undefined;
    return;
  }

  const results: SearchResult[] = [];
  for (const { feature, prepared } of prepared_features) {
    const result = fuzzysort.single(search_string, prepared)
    if (result === null) continue;
    results.push({
      feature,
      result,
    });
  }
  search_results.value = results;
}

const search_string = ref<string | undefined>(undefined);
const search_features = computed<GPUFeatureName[]>(() => {
  if (search_results.value !== undefined) {
    return search_results.value.map(result => result.feature);
  }
  return all_features;
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
  <div class="overflow-y-auto w-full h-full">
    <table class="table table-compact table-pin-rows w-full">
      <thead>
        <tr>
          <th class="w-full">Feature</th>
          <th class="w-fit">Adapter</th>
          <th class="w-fit">Device</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="feature in search_features" :key="feature">
          <td>{{ feature }}</td>
          <td class="text-center"><input type="checkbox" :checked="gpu_adapter.features.has(feature)" disabled/></td>
          <td class="text-center"><input type="checkbox" :checked="gpu_device.features.has(feature)" disabled/></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
</template>
