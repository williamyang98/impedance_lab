<script setup lang="ts">
import Chart from "chart.js/auto";
import { Viewer2D } from "../components/viewer_2d";
import {
  DifferentialCoplanarCompositeMicrostrip,
  DifferentialMicrostrip,
  SingleEndedMicrostrip,
} from "../engine/transmission_line_2d.ts";
import { type RunResult, type ImpedanceResult } from "../engine/electrostatic_2d.ts";

import { ref, useTemplateRef, onMounted, watch, useId } from "vue";

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const viewer_2d_elem = useTemplateRef<typeof Viewer2D>("viewer-2d");
const chart = ref<Chart | undefined>(undefined);

let transmission_line = undefined;

if (false) {
  transmission_line = new DifferentialCoplanarCompositeMicrostrip();
  {
    transmission_line.signal_separation.value = 0.2;
    transmission_line.signal_width.value = 0.25;
    transmission_line.coplanar_separation.value = 0.2;
    transmission_line.coplanar_width.value = 0.25;
    transmission_line.trace_taper.value = 0.05;
    transmission_line.trace_height.value = 0.035;
    transmission_line.plane_height_1a.value = 0.1;
    transmission_line.plane_height_1b.value = 0.1;
    transmission_line.plane_height_2a.value = 0.1;
    transmission_line.plane_height_2b.value = 0.1;
    transmission_line.plane_epsilon_1a.value = 4.1;
    transmission_line.plane_epsilon_1b.value = 4.1;
    transmission_line.plane_epsilon_2a.value = 4.1;
    transmission_line.plane_epsilon_2b.value = 4.1;
  }
} else if (false) {
  transmission_line = new DifferentialMicrostrip();
  {
    transmission_line.signal_width.value = 0.25;
    transmission_line.signal_separation.value = 0.15;
    transmission_line.trace_taper.value = 0.05;
    transmission_line.trace_height.value = 0.035;
    transmission_line.plane_height_bottom.value = 0.25;
    transmission_line.plane_height_top.value = 0.25;
    transmission_line.plane_epsilon_bottom.value = 4.1;
    transmission_line.plane_epsilon_top.value = 4.1;
  }
} else {
  transmission_line = new SingleEndedMicrostrip();
  {
    transmission_line.signal_width.value = 0.15;
    transmission_line.trace_taper.value = 0.05;
    transmission_line.trace_height.value = 0.0152;
    transmission_line.plane_height.value = 0.45;
    transmission_line.plane_epsilon.value = 4.1;
  }
}

const region_grid = transmission_line.create_region_grid()!;
const grid = region_grid.grid;
grid.bake();

const is_running = ref<boolean>(false);
const run_result = ref<RunResult | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

async function run() {
  is_running.value = true;
  await sleep(0);

  grid.reset();
  const energy_threshold = 1e-3;
  run_result.value = grid.run(energy_threshold);
  impedance_result.value = grid.calculate_impedance();
  is_running.value = false;
}

function update_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const x_min = 0;
  const x_max = region_grid.x_region_lines[region_grid.x_region_lines.length-1];
  const y_min = 0;
  const y_max = region_grid.y_region_lines[region_grid.y_region_lines.length-1];

  chart.value?.destroy();
  chart.value = new Chart(grid_canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
        region_grid.x_grid_lines.map((x) => {
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
        region_grid.y_grid_lines.map((y) => {
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
        region_grid.x_region_lines.map((x) => {
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
        region_grid.y_region_lines.map((y) => {
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

async function update_grid_viewer() {
  const viewer = viewer_2d_elem.value;
  if (viewer === null) return;
  viewer.upload_grid(region_grid.grid);
  await viewer.refresh_canvas();
}

const id_tab_result = useId();
const id_tab_grid = useId();
const id_tab_viewer = useId();

onMounted(async () => {
  await run();
  update_chart();
  await update_grid_viewer();
});

watch(viewer_2d_elem, async (elem) => {
  if (elem === null) return;
  await update_grid_viewer();
});
</script>

<template>
  <div class="grid grid-flow-row grid-cols-5 gap-2">
    <div class="card card-border shadow col-span-2" >
      <div class="card-body">
        <div>
          <div class="tabs tabs-lift">
            <template v-if="impedance_result">
              <input type="radio" :name="id_tab_result" class="tab" aria-label="Impedance" checked/>
              <div class="tab-content bg-base-100 border-base-300">
                <table class="table">
                  <tbody>
                    <tr>
                      <td class="font-medium">Z0</td>
                      <td>{{ `${impedance_result.Z0.toFixed(2)} Ω` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Cih</td>
                      <td>{{ `${(impedance_result.Cih*1e12/100).toFixed(2)} pF/cm` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Lh</td>
                      <td>{{ `${(impedance_result.Lh*1e9/100).toFixed(2)} nH/cm` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Speed</td>
                      <td>{{ `${(impedance_result.propagation_speed/3e8*100).toFixed(2)}%` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Delay</td>
                      <td>{{ `${(impedance_result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <template v-if="run_result">
              <input type="radio" :name="id_tab_result" class="tab" aria-label="Simulation"/>
              <div class="tab-content bg-base-100 border-base-300">
                <table class="table">
                  <tbody>
                    <tr>
                      <td class="font-medium">Total steps</td>
                      <td>{{ run_result.total_steps }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Time taken</td>
                      <td>{{ `${(run_result.time_taken*1e3).toFixed(2)} ms` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Step rate</td>
                      <td>{{ `${run_result.step_rate.toFixed(2)} steps/s` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Cell rate</td>
                      <td>{{ `${(run_result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Total cells</td>
                      <td>{{ run_result.total_cells }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Total columns</td>
                      <td>{{ region_grid.grid.dx.shape[0] }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Total rows</td>
                      <td>{{ region_grid.grid.dy.shape[0] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>
        <div class="card-actions justify-end">
          <button class="btn" @click="run()" :disabled="is_running">Run</button>
        </div>
      </div>
    </div>
    <div class="card card-border shadow col-span-3">
      <div class="card-body inline">
        <div>
          <div class="tabs tabs-lift">
            <input type="radio" :name="id_tab_grid" class="tab" aria-label="x grid" checked/>
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
                    <tr v-for="({ type, grid }, index) in region_grid.x_grid_regions" :key="index">
                      <td class="font-medium">{{ index }}</td>
                      <template v-if="type == 'asymmetric'">
                        <td>[{{ grid.a0.toPrecision(2) }}, {{ grid.a1.toPrecision(2) }}]</td>
                        <td>[{{ grid.n0 }}, {{ grid.n1 }}]</td>
                        <td>[{{ grid.r0.toFixed(2) }}, {{ grid.r1.toFixed(2) }}]</td>
                        <td>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</td>
                      </template>
                      <template v-if="type == 'symmetric'">
                        <td>{{ grid.a.toPrecision(2) }}</td>
                        <td>{{ grid.n.toPrecision(2) }}</td>
                        <td>{{ grid.r.toFixed(2) }}</td>
                        <td>{{ Math.abs(1-grid.r).toPrecision(2) }}</td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <input type="radio" :name="id_tab_grid" class="tab" aria-label="y grid"/>
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
                    <tr v-for="({ type, grid }, index) in region_grid.y_grid_regions" :key="index">
                      <td class="font-medium">{{ index }}</td>
                      <template v-if="type == 'asymmetric'">
                        <td>[{{ grid.a0.toPrecision(2) }}, {{ grid.a1.toPrecision(2) }}]</td>
                        <td>[{{ grid.n0 }}, {{ grid.n1 }}]</td>
                        <td>[{{ grid.r0.toFixed(2) }}, {{ grid.r1.toFixed(2) }}]</td>
                        <td>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</td>
                      </template>
                      <template v-if="type == 'symmetric'">
                        <td>{{ grid.a.toPrecision(2) }}</td>
                        <td>{{ grid.n.toPrecision(2) }}</td>
                        <td>{{ grid.r.toFixed(2) }}</td>
                        <td>{{ Math.abs(1-grid.r).toPrecision(2) }}</td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="card card-border shadow col-span-5">
      <div class="card-body">
        <div>
          <div class="tabs tabs-lift">
            <input type="radio" :name="id_tab_viewer" class="tab" aria-label="Grid" checked/>
            <div class="tab-content bg-base-100 border-base-300">
              <div class="m-2">
                <canvas ref="grid-canvas" class="w-[100%] max-h-[300px]"></canvas>
              </div>
            </div>
            <input type="radio" :name="id_tab_viewer" class="tab" aria-label="Viewer"/>
            <div class="tab-content bg-base-100 border-base-300">
              <Viewer2D ref="viewer-2d"></Viewer2D>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
