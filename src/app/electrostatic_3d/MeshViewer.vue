<script setup lang="ts">
import { ref, useTemplateRef, watch, computed, toRaw } from "vue";
import { GridBuilder, type Axis3D } from "./grid_builder.ts";
import RegionTable from "../mesher/RegionTable.vue";
import TabsView from "../../utility/TabsView.vue";
import Chart from "chart.js/auto";

const props = defineProps<{
  builder: GridBuilder,
}>();

const canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");

type CrossSection = "xy" | "xz" | "yz";

const chart = ref<Chart | undefined>(undefined);
const is_padded = ref<boolean>(true);
const cross_section = ref<CrossSection>("xy");
const selected_axis = computed((): [Axis3D, Axis3D] => {
  switch (cross_section.value) {
    case "xy": return ["x", "y"];
    case "xz": return ["x", "z"];
    case "yz": return ["y", "z"];
  }
});

function create_chart() {
  const canvas = canvas_elem.value;
  if (canvas === null) return;
  const builder = props.builder;

  // rescale from normalised to actual sizes
  const [a0, a1] = selected_axis.value;


  const region_scale_0 = builder.region_lines_builder[a0].scale;
  const region_scale_1 = builder.region_lines_builder[a1].scale;
  const region_lines_0 = builder.region_lines_builder[a0].lines.map(v => v/region_scale_0);
  const region_lines_1 = builder.region_lines_builder[a1].lines.map(v => v/region_scale_1);

  const grid_scale_0 = builder.region_to_grid_map[a0].region_lines_builder.scale;
  const grid_scale_1 = builder.region_to_grid_map[a1].region_lines_builder.scale;
  const grid_lines_0 = builder.region_to_grid_map[a0].grid_lines.map(v => v/grid_scale_0);
  const grid_lines_1 = builder.region_to_grid_map[a1].grid_lines.map(v => v/grid_scale_1);

  const get_boundary = (unpadded: number, padded: number | undefined, is_padded: boolean): number => {
    if (padded !== undefined && is_padded) return padded;
    return unpadded;
  }
  const min_0 = get_boundary(builder.unpadded_boundary[a0].min, builder.padded_boundary[a0].min, true);
  const max_0 = get_boundary(builder.unpadded_boundary[a0].max, builder.padded_boundary[a0].max, true);
  const min_1 = get_boundary(builder.unpadded_boundary[a1].min, builder.padded_boundary[a1].min, true);
  const max_1 = get_boundary(builder.unpadded_boundary[a1].max, builder.padded_boundary[a1].max, true);

  const show_padding = is_padded.value;
  const show_min_0 = get_boundary(builder.unpadded_boundary[a0].min, builder.padded_boundary[a0].min, show_padding);
  const show_max_0 = get_boundary(builder.unpadded_boundary[a0].max, builder.padded_boundary[a0].max, show_padding);
  const show_min_1 = get_boundary(builder.unpadded_boundary[a1].min, builder.padded_boundary[a1].min, show_padding);
  const show_max_1 = get_boundary(builder.unpadded_boundary[a1].max, builder.padded_boundary[a1].max, show_padding);

  chart.value?.destroy();
  chart.value = new Chart(canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
        region_lines_0.map((x) => {
          return {
            data: [
              { x, y: min_1, },
              { x, y: max_1, },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        region_lines_1.map((y) => {
          return {
            data: [
              { x: min_0, y },
              { x: max_0, y },
            ],
            borderColor: "rgba(255,0,0,1.0)",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        grid_lines_0.map((x) => {
          return {
            data: [
              { x, y: min_1, },
              { x, y: max_1, },
            ],
            borderColor: "rgba(0,186,254,1.0)",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            showLine: true,
          }
        }),
        grid_lines_1.map((y) => {
          return {
            data: [
              { x: min_0, y },
              { x: max_0, y },
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
          min: show_min_0,
          max: show_max_0,
          title: {
            display: true,
            text: a0,
            font: {
              weight: "bold",
              size: 14,
            },
          },
        },
        y: {
          type: "linear",
          min: show_min_1,
          max: show_max_1,
          reverse: false,
          title: {
            display: true,
            text: a1,
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

watch(canvas_elem, () => { create_chart(); });
watch(selected_axis, () => { create_chart(); });
const builder = computed(() => props.builder);
watch(builder, () => { create_chart(); });

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

  const [a0, a1] = selected_axis.value;
  const min_0 = get_boundary(builder.unpadded_boundary[a0].min, builder.padded_boundary[a0].min);
  const max_0 = get_boundary(builder.unpadded_boundary[a0].max, builder.padded_boundary[a0].max);
  const min_1 = get_boundary(builder.unpadded_boundary[a1].min, builder.padded_boundary[a1].min);
  const max_1 = get_boundary(builder.unpadded_boundary[a1].max, builder.padded_boundary[a1].max);
  scales.x.min = min_0;
  scales.x.max = max_0;
  scales.y.min = min_1;
  scales.y.max = max_1;
  old_chart.update();
});

</script>

<template>
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-2 w-full">
  <div class="card card-border bg-base-100 w-full h-full">
    <div class="card-body p-3">
      <div class="w-fit flex flex-row gap-x-2 z-1 absolute m-1" data-theme="light">
        <div class="label">
          <input class="checkbox checkbox-sm" type="checkbox" v-model="is_padded"/>
          Show Padding
        </div>
        <select class="select select-sm" v-model="cross_section">
          <option :value="'xy'">x-y</option>
          <option :value="'xz'">x-z</option>
          <option :value="'yz'">y-z</option>
        </select>
      </div>
      <div class="relative w-full h-full bg-white rounded">
        <canvas ref="grid-canvas"></canvas>
      </div>
    </div>
  </div>
  <div class="card card-border bg-base-100">
    <div class="card-body p-3">
      <TabsView>
        <template #h-0>x</template>
        <template #b-0>
          <RegionTable class="bg-base-100 rounded-none" :region_to_grid_map="builder.region_to_grid_map.x"/>
        </template>
        <template #h-1>y</template>
        <template #b-1>
          <RegionTable class="bg-base-100 rounded-none" :region_to_grid_map="builder.region_to_grid_map.y"/>
        </template>
        <template #h-2>z</template>
        <template #b-2>
          <RegionTable class="bg-base-100 rounded-none" :region_to_grid_map="builder.region_to_grid_map.z"/>
        </template>
      </TabsView>
    </div>
  </div>
</div>
</template>

