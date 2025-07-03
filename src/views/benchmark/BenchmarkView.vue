<script lang="ts" setup>
import FlopBenchmarkView from './FlopBenchmarkView.vue';
import GPUSupportLimitsTable from './GPUSupportLimitsTable.vue';
</script>

<template>
<div class="grid grid-cols-2 gap-x-2">
  <FlopBenchmarkView/>
  <GPUSupportLimitsTable/>
</div>
</template>
