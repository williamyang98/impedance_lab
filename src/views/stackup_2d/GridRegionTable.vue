<script setup lang="ts">
import { defineProps } from "vue";
import { type GridRegion } from "../../engine/mesher.ts";

const _props = defineProps<{
  grid_regions: GridRegion[],
}>();

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
    <tr v-for="(grid, index) in grid_regions" :key="index">
      <td class="font-medium">{{ index }}</td>
      <template v-if="grid.type == 'asymmetric'">
        <td class="text-nowrap">[{{ grid.a0.toPrecision(2) }}, {{ grid.a1.toPrecision(2) }}]</td>
        <td class="text-nowrap">[{{ grid.n0 }}, {{ grid.n1 }}]</td>
        <td class="text-nowrap">[{{ grid.r0.toFixed(2) }}, {{ grid.r1.toFixed(2) }}]</td>
        <td class="text-nowrap">{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</td>
      </template>
      <template v-if="grid.type == 'symmetric'">
        <td class="text-nowrap">{{ grid.a.toPrecision(2) }}</td>
        <td class="text-nowrap">{{ grid.n }}</td>
        <td class="text-nowrap">{{ grid.r.toFixed(2) }}</td>
        <td class="text-nowrap">{{ Math.abs(1-grid.r).toPrecision(2) }}</td>
      </template>
      <template v-if="grid.type == 'linear'">
        <td class="text-nowrap">{{ grid.a.toPrecision(2) }}</td>
        <td class="text-nowrap">{{ grid.n }}</td>
        <td class="text-nowrap">1</td>
        <td class="text-nowrap">0</td>
      </template>
    </tr>
  </tbody>
</table>
</template>
