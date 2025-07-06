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

  let x_min = x.reduce((a,b) => Math.min(a,b), Infinity);
  let x_max = x.reduce((a,b) => Math.max(a,b), -Infinity);
  let y_min = y.reduce((a,b) => Math.min(a,b), Infinity);
  let y_max = y.reduce((a,b) => Math.max(a,b), -Infinity);

  // avoid zero size plot
  if (x_min === x_max) {
    x_min -= 0.5;
    x_max += 0.5;
  }
  if (y_min === y_max) {
    y_min -= 0.5;
    y_max += 0.5;
  }

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
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "linear",
          min: x_min,
          max: x_max,
          title: {
            display: true,
            text: props.results.parameter_label,
            font: {
              weight: "bold",
              size: 14,
            },
          },
        },
        y: {
          type: "linear",
          min: y_min,
          max: y_max,
          title: {
            display: true,
            text: "Impedance (Ω)",
            font: {
              weight: "bold",
              size: 14,
            },
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: `Search Curve (${props.results.parameter_label})`,
          font: {
            size: 16,
          },
        },
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
<div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 w-full h-full">
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <div class="relative w-full h-full bg-white">
        <canvas ref="grid-canvas"></canvas>
      </div>
    </div>
  </div>
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <div class="w-full h-full overflow-y-auto">
        <table class="w-full table table-compact table-pin-rows">
          <thead>
            <tr>
              <th>Step</th>
              <th>{{ results.parameter_label }}</th>
              <th>Z0 (Ω)</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(result, index) in results.results" :key="index"
              :class="`${result == results.best_result ? 'bg-success' : ''}`"
            >
              <td class="font-medium">{{ result.iteration }}</td>
              <td>{{ result.value.toPrecision(3) }}</td>
              <td>{{ result.impedance.toPrecision(3) }}</td>
              <td>{{ result.error.toPrecision(3) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
</template>
