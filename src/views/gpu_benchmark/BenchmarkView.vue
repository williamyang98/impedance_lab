<script lang="ts" setup>
import ComputeBenchmarkView from './ComputeBenchmarkView.vue';
import MemoryBandwidthBenchmarkView from "./MemoryBandwidthBenchmarkView.vue";
import GPUSupportLimitsTable from './LimitsTable.vue';
import GPUFeaturesList from './FeaturesList.vue';
import TabsView from "../../utility/TabsView.vue";

</script>

<template>
<TabsView>
  <template #h-0>Benchmarks</template>
  <template #b-0>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <ComputeBenchmarkView/>
      <MemoryBandwidthBenchmarkView/>
    </div>
  </template>
  <template #h-1>Limits</template>
  <template #b-1>
    <GPUSupportLimitsTable/>
  </template>
  <template #h-2>Features</template>
  <template #b-2>
    <GPUFeaturesList/>
  </template>
</TabsView>
</template>
