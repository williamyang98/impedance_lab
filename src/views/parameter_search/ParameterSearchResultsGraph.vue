<script setup lang="ts">
import { defineProps, ref, useTemplateRef, watch, computed } from "vue";
import Chart from "chart.js/auto";

export interface SearchResult {
  x: number;
  y: number;
  error: number;
}

const props = defineProps<{
  results: SearchResult[],
  title?: string,
  x_label?: string,
  y_label?: string,
  selected_index?: number,
}>();

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);

function create_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const results = props.results
    .filter(result => {
      const value = result.y;
      if (Number.isNaN(value)) return false;
      if (!Number.isFinite(value)) return false;
      return true;
    })
    .sort((a,b) => a.x - b.x);

  const x = results.map(result => result.x);
  const y = results.map(result => result.y);

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
      x: result.x,
      y: result.y,
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
            text: props.x_label,
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
          text: props.title,
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
              <th>{{ x_label }}</th>
              <th>{{ y_label }}</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(result, index) in results" :key="index"
              :class="`${index === selected_index ? 'bg-success' : ''}`"
            >
              <td class="font-medium">{{ index }}</td>
              <td>{{ result.x.toPrecision(3) }}</td>
              <td>{{ result.y.toPrecision(3) }}</td>
              <td>{{ result.error.toPrecision(3) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
</template>
