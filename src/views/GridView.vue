<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  // TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card,
  // CardHeader,
  // CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

import Chart from "chart.js/auto";
import { Viewer2D } from "../components/viewer_2d";
import {
  DifferentialCoplanarCompositeMicrostrip,
  DifferentialMicrostrip,
  SingleEndedMicrostrip,
} from "../app/transmission_line_2d.ts";
import { type RunResult, type ImpedanceResult } from "../engine/electrostatic_2d.ts";

import { ref, useTemplateRef, onMounted, watch } from "vue";

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
    <Card class="gap-3 col-span-2">
      <CardContent>
        <Tabs default-value="impedance" class="w-[100%]" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="impedance">Impedance</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          </TabsList>
          <TabsContent value="impedance" v-if="impedance_result">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell class="font-medium">Z0</TableCell>
                  <TableCell>{{ `${impedance_result.Z0.toFixed(2)} Ω` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Cih</TableCell>
                  <TableCell>{{ `${(impedance_result.Cih*1e12/100).toFixed(2)} pF/cm` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Lh</TableCell>
                  <TableCell>{{ `${(impedance_result.Lh*1e9/100).toFixed(2)} nH/cm` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Speed</TableCell>
                  <TableCell>{{ `${(impedance_result.propagation_speed/3e8*100).toFixed(2)}%` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Delay</TableCell>
                  <TableCell>{{ `${(impedance_result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="simulation" v-if="run_result">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell class="font-medium">Total steps</TableCell>
                  <TableCell>{{ run_result.total_steps }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Time taken</TableCell>
                  <TableCell>{{ `${(run_result.time_taken*1e3).toFixed(2)} ms` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Step rate</TableCell>
                  <TableCell>{{ `${run_result.step_rate.toFixed(2)} steps/s` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Cell rate</TableCell>
                  <TableCell>{{ `${(run_result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Total cells</TableCell>
                  <TableCell>{{ run_result.total_cells }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Total columns</TableCell>
                  <TableCell>{{ region_grid.grid.dx.shape[0] }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Total rows</TableCell>
                  <TableCell>{{ region_grid.grid.dy.shape[0] }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter class="flex justify-end mt-auto">
        <Button @click="run()" :disabled="is_running">Run</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3 col-span-3">
      <CardContent>
        <Tabs default-value="x-grid" class="w-full" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="x-grid">x grid</TabsTrigger>
            <TabsTrigger value="y-grid">y grid</TabsTrigger>
          </TabsList>
          <TabsContent value="x-grid">
            <div class="max-h-65 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>a</TableHead>
                    <TableHead>n</TableHead>
                    <TableHead>r</TableHead>
                    <TableHead>|1-r|</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="({ type, grid }, index) in region_grid.x_grid_regions" :key="index">
                    <TableCell class="font-medium">{{ index }}</TableCell>
                    <template v-if="type == 'asymmetric'">
                      <TableCell>[{{ grid.a0.toPrecision(2) }}, {{ grid.a1.toPrecision(2) }}]</TableCell>
                      <TableCell>[{{ grid.n0 }}, {{ grid.n1 }}]</TableCell>
                      <TableCell>[{{ grid.r0.toFixed(2) }}, {{ grid.r1.toFixed(2) }}]</TableCell>
                      <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</TableCell>
                    </template>
                    <template v-if="type == 'symmetric'">
                      <TableCell>{{ grid.a.toPrecision(2) }}</TableCell>
                      <TableCell>{{ grid.n.toPrecision(2) }}</TableCell>
                      <TableCell>{{ grid.r.toFixed(2) }}</TableCell>
                      <TableCell>{{ Math.abs(1-grid.r).toPrecision(2) }}</TableCell>
                    </template>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="y-grid">
            <div class="max-h-65 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>a</TableHead>
                    <TableHead>n</TableHead>
                    <TableHead>r</TableHead>
                    <TableHead>|1-r|</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="({ type, grid }, index) in region_grid.y_grid_regions" :key="index">
                    <TableCell class="font-medium">{{ index }}</TableCell>
                    <template v-if="type == 'asymmetric'">
                      <TableCell>[{{ grid.a0.toPrecision(2) }}, {{ grid.a1.toPrecision(2) }}]</TableCell>
                      <TableCell>[{{ grid.n0 }}, {{ grid.n1 }}]</TableCell>
                      <TableCell>[{{ grid.r0.toFixed(2) }}, {{ grid.r1.toFixed(2) }}]</TableCell>
                      <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</TableCell>
                    </template>
                    <template v-if="type == 'symmetric'">
                      <TableCell>{{ grid.a.toPrecision(2) }}</TableCell>
                      <TableCell>{{ grid.n.toPrecision(2) }}</TableCell>
                      <TableCell>{{ grid.r.toFixed(2) }}</TableCell>
                      <TableCell>{{ Math.abs(1-grid.r).toPrecision(2) }}</TableCell>
                    </template>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
    <Card class="gap-3 col-span-5">
      <CardContent>
        <Tabs default-value="viewer" class="w-full" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="viewer">Viewer</TabsTrigger>
          </TabsList>
          <TabsContent value="grid">
            <canvas ref="grid-canvas" class="w-[100%] max-h-[300px]"></canvas>
          </TabsContent>
          <TabsContent value="viewer">
            <Viewer2D ref="viewer-2d"></Viewer2D>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
</style>
