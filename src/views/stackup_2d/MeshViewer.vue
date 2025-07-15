<script setup lang="ts">
import { defineProps, ref, useTemplateRef, watch, computed } from "vue";
import GridRegionTable from "../../app/mesher/GridRegionTable.vue";
import TabsView from "../../utility/TabsView.vue";
import { StackupGrid } from "./stackup_to_grid.ts";
import Chart from "chart.js/auto";

const props = defineProps<{
  stackup_grid: StackupGrid,
}>();

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);

function create_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const grid = props.stackup_grid;
  if (grid === undefined) return;

  // rescale from normalised to actual sizes
  const x_scale = grid.x_region_to_grid_map.region_lines_builder.scale;
  const y_scale = grid.y_region_to_grid_map.region_lines_builder.scale;

  const x_region_lines = grid.x_region_to_grid_map.region_lines.map(x => x/x_scale);
  const y_region_lines = grid.y_region_to_grid_map.region_lines.map(y => y/y_scale);

  const x_grid_lines = grid.x_region_to_grid_map.grid_lines.map(x => x/x_scale);
  const y_grid_lines = grid.y_region_to_grid_map.grid_lines.map(y => y/y_scale);

  const x_min = 0;
  const x_max = x_grid_lines[x_grid_lines.length-1];
  const y_min = 0;
  const y_max = y_grid_lines[y_grid_lines.length-1];

  chart.value?.destroy();
  chart.value = new Chart(grid_canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
        x_region_lines.map((x) => {
          return {
            data: [
              { x, y: y_min, },
              { x, y: y_max, },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        y_region_lines.map((y) => {
          return {
            data: [
              { x: x_min, y },
              { x: x_max, y },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        x_grid_lines.map((x) => {
          return {
            data: [
              { x, y: y_min, },
              { x, y: y_max, },
            ],
            borderColor: "rgba(0,186,254,1.0)",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        y_grid_lines.map((y) => {
          return {
            data: [
              { x: x_min, y },
              { x: x_max, y },
            ],
            borderColor: "rgba(0,186,254,1.0)",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
      ),
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
            text: "X",
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
          reverse: true,
          title: {
            display: true,
            text: "Y",
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
          text: "Simulation mesh",
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

const stackup_grid = computed(() => props.stackup_grid);
watch(stackup_grid, () => {
  create_chart();
});
</script>

<template>
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-2 w-full">
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <div class="relative w-full h-full bg-white rounded">
        <canvas ref="grid-canvas"></canvas>
      </div>
    </div>
  </div>
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <TabsView>
        <template #h-0>X</template>
        <template #b-0>
          <GridRegionTable class="bg-base-100 rounded-none" :region_to_grid_map="stackup_grid.x_region_to_grid_map"/>
        </template>
        <template #h-1>Y</template>
        <template #b-1>
          <GridRegionTable class="bg-base-100 rounded-none" :region_to_grid_map="stackup_grid.y_region_to_grid_map"/>
        </template>
      </TabsView>
    </div>
  </div>
</div>
</template>
