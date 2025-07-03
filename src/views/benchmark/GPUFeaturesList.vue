<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { providers } from "../../providers/providers.ts";
import { SearchIcon } from "lucide-vue-next";
import fuzzysort from "fuzzysort";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;

const all_features: GPUFeatureName[] = [
  "depth-clip-control",
  "depth32float-stencil8",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "timestamp-query",
  "indirect-first-instance",
  "shader-f16",
  "rg11b10ufloat-renderable",
  "bgra8unorm-storage",
  "float32-filterable",
  "float32-blendable",
  "clip-distances",
  "dual-source-blending",
  "subgroups",
  "core-features-and-limits",
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
<div class="card card-border bg-base-100">
  <div class="card-body p-3">
    <div class="card-title">GPU Features</div>
    <div class="flex flex-col">
      <label class="input w-full">
        <SearchIcon class="w-[1.25rem] h-[1.25rem]"/>
        <input type="search" placeholder="Search" v-model="search_string"/>
      </label>
      <div class="max-h-[75vh] overflow-y-auto w-full">
        <ul class="list bg-base-100">
          <li
            v-for="feature in search_features" :key="feature"
            class="list-row py-2 flex flex-row gap-x-2"
          >
            <input type="checkbox" :checked="gpu_adapter.features.has(feature)" disabled/>
            <input type="checkbox" :checked="gpu_device.features.has(feature)" disabled/>
            <span>{{ feature }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</div>
</template>
