<script setup lang="ts">
import { defineProps, computed } from "vue";
import { RegionToGridMap } from "../../engine/regions.ts";

const props = defineProps<{
  region_to_grid_map: RegionToGridMap,
}>();

const segments = computed(() => {
  return props.region_to_grid_map.region_segments;
});

</script>

<template>
<table class="table">
  <thead>
    <tr>
      <th></th>
      <th>a</th>
      <th>n</th>
      <th>r</th>
      <th>|1-r|</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="({ type, segment: seg }, index) in segments" :key="index">
      <td class="font-medium">{{ index }}</td>
      <template v-if="type == 'closed_geometric'">
        <td class="text-nowrap">[{{ seg.left.a.toPrecision(2) }}, {{ seg.right.a.toPrecision(2) }}]</td>
        <td class="text-nowrap">[{{ seg.left.n }}, {{ seg.right.n }}]</td>
        <td class="text-nowrap">[{{ seg.left.r.toFixed(2) }}, {{ seg.right.r.toFixed(2) }}]</td>
        <td class="text-nowrap">{{ Math.max(Math.abs(1-seg.left.r), Math.abs(1-seg.right.r)).toPrecision(2) }}</td>
      </template>
      <template v-if="type == 'open_geometric'">
        <td class="text-nowrap">{{ seg.a.toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">{{ seg.r.toFixed(2) }}</td>
        <td class="text-nowrap">{{ Math.abs(1-seg.r).toPrecision(2) }}</td>
      </template>
      <template v-if="type == 'linear'">
        <td class="text-nowrap">{{ seg.a.toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">1</td>
        <td class="text-nowrap">0</td>
      </template>
    </tr>
  </tbody>
</table>
</template>
