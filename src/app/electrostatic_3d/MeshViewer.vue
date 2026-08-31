<script setup lang="ts">
import { ref, useTemplateRef, watch, computed, toRaw } from "vue";
import { GridBuilder } from "./grid_builder.ts";
import Chart from "chart.js/auto";

const props = defineProps<{
  builder: GridBuilder,
}>();

const canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);
const is_padded = ref<boolean>(true);

function create_chart() {
  const canvas = canvas_elem.value;
  if (canvas === null) return;
  const builder = props.builder;

  // rescale from normalised to actual sizes
  const x_scale = builder.grid_lines_builder.x.scale;
  const y_scale = builder.grid_lines_builder.y.scale;

  const x_grid_lines = builder.grid_lines_builder.x.lines.map(x => x/x_scale);
  const y_grid_lines = builder.grid_lines_builder.y.lines.map(y => y/y_scale);

  const get_boundary = (unpadded: number, padded: number | undefined, is_padded: boolean): number => {
    if (padded !== undefined && is_padded) return padded;
    return unpadded;
  }
  const x_min = get_boundary(builder.unpadded_boundary.x.min, builder.padded_boundary.x.min, true);
  const x_max = get_boundary(builder.unpadded_boundary.x.max, builder.padded_boundary.x.max, true);
  const y_min = get_boundary(builder.unpadded_boundary.y.min, builder.padded_boundary.y.min, true);
  const y_max = get_boundary(builder.unpadded_boundary.y.max, builder.padded_boundary.y.max, true);

  const show_padding = is_padded.value;
  const show_x_min = get_boundary(builder.unpadded_boundary.x.min, builder.padded_boundary.x.min, show_padding);
  const show_x_max = get_boundary(builder.unpadded_boundary.x.max, builder.padded_boundary.x.max, show_padding);
  const show_y_min = get_boundary(builder.unpadded_boundary.y.min, builder.padded_boundary.y.min, show_padding);
  const show_y_max = get_boundary(builder.unpadded_boundary.y.max, builder.padded_boundary.y.max, show_padding);

  chart.value?.destroy();
  chart.value = new Chart(canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
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
          min: show_x_min,
          max: show_x_max,
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
          min: show_y_min,
          max: show_y_max,
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

watch(canvas_elem, () => {
  create_chart();
})

const builder = computed(() => props.builder);
watch(builder, () => {
  create_chart();
});

// toggle padding
watch(is_padded, (show_padding) => {
  const old_chart = toRaw(chart.value);
  if (old_chart === undefined) return;
  const scales = old_chart.options.scales;
  if (scales === undefined) return;
  if (scales.x === undefined) return;
  if (scales.y === undefined) return;
  const builder = props.builder;
  const get_boundary = (unpadded: number, padded: number | undefined): number => {
    if (padded !== undefined && show_padding) return padded;
    return unpadded;
  }

  const x_min = get_boundary(builder.unpadded_boundary.x.min, builder.padded_boundary.x.min);
  const x_max = get_boundary(builder.unpadded_boundary.x.max, builder.padded_boundary.x.max);
  const y_min = get_boundary(builder.unpadded_boundary.y.min, builder.padded_boundary.y.min);
  const y_max = get_boundary(builder.unpadded_boundary.y.max, builder.padded_boundary.y.max);
  scales.x.min = x_min;
  scales.x.max = x_max;
  scales.y.min = y_min;
  scales.y.max = y_max;
  old_chart.update();
});

</script>

<template>
<div class="card card-border bg-base-100 w-full h-full">
  <div class="card-body p-3">
    <div class="w-fit flex flex-row gap-x-2 z-1 absolute m-1" data-theme="light">
      <input class="checkbox checkbox-sm" type="checkbox" v-model="is_padded"/>
      <span class="label">Show Padding</span>
    </div>
    <div class="relative w-full h-full bg-white rounded">
      <canvas ref="grid-canvas"></canvas>
    </div>
  </div>
</div>
</template>

