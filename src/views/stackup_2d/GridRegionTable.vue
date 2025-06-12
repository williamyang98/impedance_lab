<script setup lang="ts">
import { defineProps, computed } from "vue";
import { RegionToGridMap } from "../../engine/regions.ts";

const props = defineProps<{
  region_to_grid_map: RegionToGridMap,
}>();

const segments = computed(() => {
  return props.region_to_grid_map.region_segments;
});

const scale_factor = computed(() => {
  const scale = props.region_to_grid_map.region_lines_builder.scale;
  return 1.0/scale;
});

function rescale(x: number): number {
  return x * scale_factor.value;
}

</script>

<template>
<table class="table">
  <thead>
    <tr>
      <th></th>
      <th>Type</th>
      <th>a</th>
      <th>n</th>
      <th>r</th>
      <th>A</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="({ type, segment: seg }, index) in segments" :key="index">
      <td class="font-medium">{{ index }}</td>
      <td class="text-nowrap">{{ type }}</td>
      <template v-if="type == 'closed_geometric'">
        <td class="text-nowrap">[{{ rescale(seg.left.a).toPrecision(2) }}, {{ rescale(seg.right.a).toPrecision(2) }}]</td>
        <td class="text-nowrap">[{{ seg.left.n }}, {{ seg.right.n }}]</td>
        <td class="text-nowrap">[{{ seg.left.r.toFixed(2) }}, {{ seg.right.r.toFixed(2) }}]</td>
      </template>
      <template v-if="type == 'open_geometric'">
        <td class="text-nowrap">{{ rescale(seg.a).toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">{{ seg.r.toFixed(2) }}</td>
      </template>
      <template v-if="type == 'linear'">
        <td class="text-nowrap">{{ rescale(seg.a).toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">1</td>
      </template>
      <td class="text-nowrap">{{ rescale(seg.get_size()).toPrecision(3) }}</td>
    </tr>
  </tbody>
</table>
</template>
