<script lang="ts" setup>
import ComputeBenchmarkView from './ComputeBenchmarkView.vue';
import MemoryBandwidthBenchmarkView from "./MemoryBandwidthBenchmarkView.vue";
import GPUSupportLimitsTable from './LimitsTable.vue';
import GPUFeaturesList from './FeaturesList.vue';
import { useId } from "vue";

const uid = {
  tab: useId(),
};

</script>

<template>
<div class="tabs tabs-box w-full">
  <input type="radio" :name="uid.tab" class="tab" aria-label="Benchmarks" checked/>
  <div class="tab-content overflow-auto p-1">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
      <ComputeBenchmarkView/>
      <MemoryBandwidthBenchmarkView/>
    </div>
  </div>
  <input type="radio" :name="uid.tab" class="tab" aria-label="Limits"/>
  <div class="tab-content overflow-auto p-1">
    <GPUSupportLimitsTable/>
  </div>
  <input type="radio" :name="uid.tab" class="tab" aria-label="Features"/>
  <div class="tab-content overflow-auto p-1">
    <GPUFeaturesList/>
  </div>
</div>
</template>
