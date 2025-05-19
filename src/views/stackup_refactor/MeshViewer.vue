<script setup lang="ts">
import { defineProps, ref, useTemplateRef, watch, computed } from "vue";
import { RegionGrid } from "../../engine/grid_2d.ts";
import Chart from "chart.js/auto";

const props = defineProps<{
  region_grid: RegionGrid,
}>();

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);

function create_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const grid = props.region_grid;
  if (grid === undefined) return;

  const x_min = 0;
  const x_max = grid.x_region_lines[grid.x_region_lines.length-1];
  const y_min = 0;
  const y_max = grid.y_region_lines[grid.y_region_lines.length-1];

  chart.value?.destroy();
  chart.value = new Chart(grid_canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
        grid.x_grid_lines.map((x) => {
          return {
            data: [
              { x, y: y_min, },
              { x, y: y_max, },
            ],
            borderColor: "rgba(0,0,255,0.3)",
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        grid.y_grid_lines.map((y) => {
          return {
            data: [
              { x: x_min, y },
              { x: x_max, y },
            ],
            borderColor: "rgba(0,0,255,0.3)",
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        grid.x_region_lines.map((x) => {
          return {
            data: [
              { x, y: y_min, },
              { x, y: y_max, },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        grid.y_region_lines.map((y) => {
          return {
            data: [
              { x: x_min, y },
              { x: x_max, y },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
      ),
    },
    options: {
      animation: false,
      scales: {
        x: {
          type: "linear",
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

const region_grid = computed(() => props.region_grid);
watch(region_grid, () => {
  create_chart();
});
</script>

<template>
  <canvas ref="grid-canvas" :class="$attrs.class"></canvas>
</template>
