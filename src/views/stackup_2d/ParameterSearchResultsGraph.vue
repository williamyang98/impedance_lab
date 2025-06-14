<script setup lang="ts">
import { defineProps, ref, useTemplateRef, watch, computed } from "vue";
import { type SearchResults } from "./search.ts";
import Chart from "chart.js/auto";

const props = defineProps<{
  results: SearchResults,
}>();

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);

function create_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const search = props.results;
  if (search === undefined) return;

  const results = search.results.slice().sort((a,b) => a.value - b.value);

  const x = results.map(result => result.value);
  const y = results.map(result => result.impedance);

  const x_min = x.reduce((a,b) => Math.min(a,b), Infinity);
  const x_max = x.reduce((a,b) => Math.max(a,b), -Infinity);
  const y_min = y.reduce((a,b) => Math.min(a,b), Infinity);
  const y_max = y.reduce((a,b) => Math.max(a,b), -Infinity);

  const markers = results.map(result => {
    return {
      x: result.value,
      y: result.impedance,
    };
  })

  chart.value?.destroy();
  chart.value = new Chart(grid_canvas, {
    type: "line",
    data: {
      datasets: [
        {
          data: markers,
        }
      ],
    },
    options: {
      animation: false,
      scales: {
        x: {
          type: "linear",
          min: x_min,
          max: x_max,
        },
        y: {
          type: "linear",
          min: y_min,
          max: y_max,
        },
      },
      plugins: {
        legend: {
          display: false,
        }
      },
    },
  });
}

watch(grid_canvas_elem, () => {
  create_chart();
})

const results = computed(() => props.results);
watch(results, () => {
  create_chart();
});
</script>

<template>
  <canvas ref="grid-canvas" :class="$attrs.class"></canvas>
</template>
