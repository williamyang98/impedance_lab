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
      scales: {
        x: {
          type: "linear",
          min: x_min,
          max: x_max,
          title: {
            display: true,
            text: "Value",
          },
        },
        y: {
          type: "linear",
          min: y_min,
          max: y_max,
          title: {
            display: true,
            text: "Impedance (Ω)",
          },
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
<div :class="$attrs.class">
  <div class="grid grid-cols-[auto_auto] gap-x-2 max-h-[100vh]">
    <div class="card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">Parameter Search Points</h2>
        <div class="w-full overflow-auto">
          <table class="w-full table table-sm">
            <thead>
              <tr>
                <th>Iteration</th>
                <th>{{ results.parameter_label }}</th>
                <th>Impedance</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(result, index) in results.results" :key="index"
                :class="`${result == results.best_result ? 'bg-green-200' : ''}`"
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
    <div class="w-full card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">Search Curve ({{ results.parameter_label }})</h2>
        <!--https://www.chartjs.org/docs/latest/configuration/responsive.html#important-note-->
        <!--chart.js plot needs specific requirements-->
        <div class="relative w-full">
          <canvas ref="grid-canvas"></canvas>
        </div>
      </div>
    </div>
  </div>
</div>
</template>
