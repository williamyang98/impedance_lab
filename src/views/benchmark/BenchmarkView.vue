<script lang="ts" setup>
import FlopBenchmarkView from './FlopBenchmarkView.vue';
import GPUSupportLimitsTable from './GPUSupportLimitsTable.vue';
import GPUFeaturesList from './GPUFeaturesList.vue';
</script>

<template>
<div class="grid grid-cols-3 gap-x-2">
  <FlopBenchmarkView/>
  <GPUSupportLimitsTable/>
  <GPUFeaturesList/>
</div>
</template>
