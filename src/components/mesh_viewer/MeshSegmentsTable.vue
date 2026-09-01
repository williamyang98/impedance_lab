<script setup lang="ts">
import { computed } from "vue";
import { type MeshSegment } from "../../app/mesher/mesher.ts";

const props = defineProps<{
  segments: MeshSegment[];
  scale?: number;
}>();

const scale = computed(() => {
  if (props.scale === undefined) return 1.0;
  return 1.0/props.scale;
});

function rescale(x: number): number {
  return x*scale.value;
}

</script>

<template>
<table class="table table-compact table-pin-rows" :class="$attrs.class">
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
    <tr v-for="(seg, index) in segments" :key="index">
      <td class="font-medium">{{ index }}</td>
      <td class="text-nowrap">{{ seg.type }}</td>
      <template v-if="seg.type == 'closed_geometric'">
        <td class="text-nowrap">[{{ rescale(seg.left.a).toPrecision(2) }}, {{ rescale(seg.right.a).toPrecision(2) }}]</td>
        <td class="text-nowrap">[{{ seg.left.n }}, {{ seg.right.n }}]</td>
        <td class="text-nowrap">[{{ seg.left.r.toFixed(2) }}, {{ seg.right.r.toFixed(2) }}]</td>
      </template>
      <template v-if="seg.type == 'open_geometric'">
        <td class="text-nowrap">{{ rescale(seg.a).toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">{{ seg.r.toFixed(2) }}</td>
      </template>
      <template v-if="seg.type == 'linear'">
        <td class="text-nowrap">{{ rescale(seg.a).toPrecision(2) }}</td>
        <td class="text-nowrap">{{ seg.n }}</td>
        <td class="text-nowrap">1</td>
      </template>
      <td class="text-nowrap">{{ rescale(seg.get_size()).toPrecision(3) }}</td>
    </tr>
  </tbody>
</table>
</template>
