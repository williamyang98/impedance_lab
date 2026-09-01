<script setup lang="ts">
import { ref, useTemplateRef, watch, computed, toRaw } from "vue";
import { type CrossSection3D, get_cross_section_axes, type Vec3 } from "../../utility/dim_types.ts";
import { type MeshLines } from "./mesh_lines.ts";
import TabsView from "../TabsView.vue";
import MeshSegmentsTable from "./MeshSegmentsTable.vue";
import Chart from "chart.js/auto";

const props = defineProps<{
  mesh: Vec3<MeshLines>,
}>();

const canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");

const chart = ref<Chart | undefined>(undefined);
const is_padded = ref<boolean>(true);
const cross_section = ref<CrossSection3D>("xy");
const selected_axis = computed(() => get_cross_section_axes(cross_section.value));

function create_chart() {
  const canvas = canvas_elem.value;
  if (canvas === null) return;
  const mesh = props.mesh;

  // rescale from normalised to actual sizes
  const [a0, a1] = selected_axis.value;

  const scale_0 = mesh[a0].scale;
  const scale_1 = mesh[a1].scale;
  const region_lines_0 = mesh[a0].region_lines.map(v => v/scale_0);
  const region_lines_1 = mesh[a1].region_lines.map(v => v/scale_1);

  const grid_lines_0 = mesh[a0].grid_lines.map(v => v/scale_0);
  const grid_lines_1 = mesh[a1].grid_lines.map(v => v/scale_1);

  const get_boundary = (unpadded: number, padded: number | undefined, is_padded: boolean): number => {
    if (padded !== undefined && is_padded) return padded;
    return unpadded;
  }
  const min_0 = get_boundary(mesh[a0].unpadded_boundary.min, mesh[a0].padded_boundary.min, true);
  const max_0 = get_boundary(mesh[a0].unpadded_boundary.max, mesh[a0].padded_boundary.max, true);
  const min_1 = get_boundary(mesh[a1].unpadded_boundary.min, mesh[a1].padded_boundary.min, true);
  const max_1 = get_boundary(mesh[a1].unpadded_boundary.max, mesh[a1].padded_boundary.max, true);

  const flip_0 = mesh[a0].flip || false;
  const flip_1 = mesh[a1].flip || false;

  const show_padding = is_padded.value;
  const show_min_0 = get_boundary(mesh[a0].unpadded_boundary.min, mesh[a0].padded_boundary.min, show_padding);
  const show_max_0 = get_boundary(mesh[a0].unpadded_boundary.max, mesh[a0].padded_boundary.max, show_padding);
  const show_min_1 = get_boundary(mesh[a1].unpadded_boundary.min, mesh[a1].padded_boundary.min, show_padding);
  const show_max_1 = get_boundary(mesh[a1].unpadded_boundary.max, mesh[a1].padded_boundary.max, show_padding);

  const region_line_colour = "rgba(255,0,0,1.0)";
  const grid_line_colour = "rgba(0,186,254,1.0)";

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
            borderColor: region_line_colour,
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
            borderColor: region_line_colour,
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
            borderColor: grid_line_colour,
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
            borderColor: grid_line_colour,
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
          reverse: flip_0,
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
          reverse: flip_1,
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
const mesh = computed(() => props.mesh);
watch(mesh, () => { create_chart(); });

// toggle padding
watch(is_padded, (show_padding) => {
  const old_chart = toRaw(chart.value);
  if (old_chart === undefined) return;
  const scales = old_chart.options.scales;
  if (scales === undefined) return;
  if (scales.x === undefined) return;
  if (scales.y === undefined) return;
  const mesh = props.mesh;
  const get_boundary = (unpadded: number, padded: number | undefined): number => {
    if (padded !== undefined && show_padding) return padded;
    return unpadded;
  }

  const [a0, a1] = selected_axis.value;
  const min_0 = get_boundary(mesh[a0].unpadded_boundary.min, mesh[a0].padded_boundary.min);
  const max_0 = get_boundary(mesh[a0].unpadded_boundary.max, mesh[a0].padded_boundary.max);
  const min_1 = get_boundary(mesh[a1].unpadded_boundary.min, mesh[a1].padded_boundary.min);
  const max_1 = get_boundary(mesh[a1].unpadded_boundary.max, mesh[a1].padded_boundary.max);
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
          <MeshSegmentsTable class="bg-base-100 rounded-none" :segments="mesh.x.mesh_segments" :scale="mesh.x.scale"/>
        </template>
        <template #h-1>y</template>
        <template #b-1>
          <MeshSegmentsTable class="bg-base-100 rounded-none" :segments="mesh.y.mesh_segments" :scale="mesh.y.scale"/>
        </template>
        <template #h-2>z</template>
        <template #b-2>
          <MeshSegmentsTable class="bg-base-100 rounded-none" :segments="mesh.z.mesh_segments" :scale="mesh.z.scale"/>
        </template>
      </TabsView>
    </div>
  </div>
</div>
</template>
