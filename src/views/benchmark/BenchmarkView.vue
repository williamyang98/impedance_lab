<script lang="ts" setup>
import { useId } from "vue";
import FlopBenchmarkView from './FlopBenchmarkView.vue';
import GPUSupportLimitsTable from './GPUSupportLimitsTable.vue';
import GPUFeaturesList from './GPUFeaturesList.vue';

const uid = {
  tab: useId(),
};

</script>

<template>
<div class="md:hidden tabs tabs-box w-full">
  <input type="radio" :name="uid.tab" class="tab" aria-label="Benchmark" checked/>
  <div class="tab-content overflow-auto">
    <FlopBenchmarkView/>
  </div>
  <input type="radio" :name="uid.tab" class="tab" aria-label="Limits"/>
  <div class="tab-content overflow-auto">
    <GPUSupportLimitsTable/>
  </div>
  <input type="radio" :name="uid.tab" class="tab" aria-label="Features"/>
  <div class="tab-content overflow-auto">
    <GPUFeaturesList/>
  </div>
</div>
<div class="hidden md:grid grid-cols-3 gap-x-2">
  <FlopBenchmarkView/>
  <GPUSupportLimitsTable/>
  <GPUFeaturesList/>
</div>
</template>
