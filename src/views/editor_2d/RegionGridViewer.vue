<script setup lang="ts">
import { defineProps, useId, ref, useTemplateRef, watch, computed } from "vue";
import { RegionGrid } from "../../engine/grid_2d.ts";
import Chart from "chart.js/auto";

const props = defineProps<{
  region_grid: RegionGrid,
}>();

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);

const id_tab = useId();

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
<div class="tabs tabs-lift">
  <input type="radio" :name="id_tab" class="tab" aria-label="x grid" checked/>
  <div class="tab-content bg-base-100 border-base-300">
    <div class="overflow-y-auto">
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
          <tr v-for="(grid, index) in region_grid.x_grid_regions" :key="index">
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
    </div>
  </div>
  <input type="radio" :name="id_tab" class="tab" aria-label="y grid"/>
  <div class="tab-content bg-base-100 border-base-300">
    <div class="overflow-y-auto">
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
          <tr v-for="(grid, index) in region_grid.y_grid_regions" :key="index">
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
    </div>
  </div>
  <input type="radio" :name="id_tab" class="tab" aria-label="Grid" checked/>
  <div class="tab-content bg-base-100 border-base-300">
    <div class="m-2">
      <canvas ref="grid-canvas" class="w-[100%] max-h-[300px]"></canvas>
    </div>
  </div>
</div>

</template>
