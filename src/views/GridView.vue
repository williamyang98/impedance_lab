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
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

import { NdarrayView } from "../utility/ndarray.ts";
import {
  type AsymmetricGeometricGrid,
  generate_asymmetric_geometric_grid_from_regions,
  generate_asymmetric_geometric_grid,
} from "../engine/mesher.ts";
import Chart from "chart.js/auto";
import { Viewer2D } from "../components/viewer_2d";
import { RegionGrid } from "../engine/grid_2d.ts";
import { type RunResult, type ImpedanceResult } from "../engine/electrostatic_2d.ts";

import { ref, useTemplateRef, onMounted } from "vue";

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const viewer_2d_elem = useTemplateRef<typeof Viewer2D>("viewer-2d");
const chart = ref<Chart | undefined>(undefined);

function normalise_regions(x_regions: number[], y_regions: number[]) {
  const x_region_min = x_regions.reduce((a,b) => Math.min(a,b), Infinity);
  const y_region_min = y_regions.reduce((a,b) => Math.min(a,b), Infinity);
  const region_min = Math.min(x_region_min, y_region_min);
  for (let i = 0; i < x_regions.length; i++) {
    x_regions[i] /= region_min;
  }
  for (let i = 0; i < y_regions.length; i++) {
    y_regions[i] /= region_min;
  }
}

function create_slope(
  region_grid: RegionGrid, start: [number, number], end: [number, number],
  voltage_index: number,
  sdf: (x_norm: number, y_norm: number) => number,
) {
  const v_force = region_grid.v_force_region(start, end);
  const dx_arr = region_grid.dx_region(start[1], end[1]);
  const dy_arr = region_grid.dy_region(start[0], end[0]);
  const width = region_grid.x_regions.slice(start[1], end[1]).reduce((a,b) => a+b, 0);
  const height = region_grid.y_regions.slice(start[0], end[0]).reduce((a,b) => a+b, 0);

  const [Ny, Nx] = v_force.shape;

  // 4x MSAA
  const My = 2;
  const Mx = 2;

  let y_offset = 0;
  for (let y = 0; y < Ny; y++) {
    let dy = dy_arr.get([y]);
    let x_offset = 0;
    for (let x = 0; x < Nx; x++) {
      let dx = dx_arr.get([x]);
      let i = [y,x];
      // perform multisampling
      let total_samples = 0;
      let total_beta = 0;
      for (let mx = 0; mx < Mx; mx++) {
        for (let my = 0; my < My; my++) {
          const ex = (mx+0.5)/Mx;
          const ey = (my+0.5)/My;
          let x_norm = (x_offset+dx*ex)/width;
          let y_norm = (y_offset+dy*ey)/height;
          total_beta += sdf(x_norm, y_norm);
          total_samples++;
        }
      }
      let beta_multisample = total_beta/total_samples;
      let beta = Math.floor(0xFFFF*beta_multisample);
      v_force.set(i, (voltage_index << 16) | beta);

      x_offset += dx;
    }
    y_offset += dy;
  }
}

const sdf_slope_top_left = (x: number, y: number) => (y > x) ? 1.0 : 0.0;
const sdf_slope_top_right = (x: number, y: number) => (y > 1-x) ? 1.0 : 0.0;
const sdf_slope_bottom_left = (x: number, y: number) => (y < 1-x) ? 1.0 : 0.0;
const sdf_slope_bottom_right = (x: number, y: number) => (y < x) ? 1.0 : 0.0;

function create_differential_microstrip(): RegionGrid {
  const params = {
    signal_taper: 0.15,
    signal_width: 0.05,
    signal_height: 0.15,
    signal_separation: 0.25,
    plane_bottom: 0.4,
    plane_top: 0.15,
    epsilon_bottom: 4.1,
    epsilon_top: 4.5,
  };

  const x_regions = [
    params.signal_taper, params.signal_width, params.signal_taper,
    params.signal_separation,
    params.signal_taper, params.signal_width, params.signal_taper,
  ];
  const y_regions = [params.plane_bottom, params.signal_height, params.plane_top];
  normalise_regions(x_regions, y_regions);
  const region_grid = new RegionGrid({
    x_regions,
    y_regions,
    y_pad_height: 2,
    x_min_subdivisions: 10,
    y_min_subdivisions: 10,
  });
  const grid = region_grid.grid;

  // ground planes
  region_grid.v_force_region([0,0],[1,9]).fill((0<<16) | 0xFFFF);
  region_grid.v_force_region([4,0],[5,9]).fill((0<<16) | 0xFFFF);
  // positive trace
  create_slope(region_grid, [2,1], [3,2], 1, sdf_slope_bottom_right);
  region_grid.v_force_region([2,2],[3,3]).fill((1<<16) | 0xFFFF);
  create_slope(region_grid, [2,3], [3,4], 1, sdf_slope_bottom_left);
  // negative trace
  create_slope(region_grid, [2,5], [3,6], 2, sdf_slope_bottom_right);
  region_grid.v_force_region([2,6],[3,7]).fill((2<<16) | 0xFFFF);
  create_slope(region_grid, [2,7], [3,8], 2, sdf_slope_bottom_left);
  // dielectric
  region_grid.epsilon_k_region([1,0],[2,9]).fill(params.epsilon_bottom);
  region_grid.epsilon_k_region([2,0],[4,9]).fill(params.epsilon_top);
  return region_grid;
};

function create_differential_coplanar_composite_microstrip(): RegionGrid {
  const params = {
    signal_width: 0.2,
    signal_separation: 0.2,
    coplanar_separation: 0.2,
    coplanar_width: 0.25,
    trace_taper: 0.05,
    trace_height: 0.035,
    plane_height_1a: 0.15,
    plane_epsilon_1a: 4.1,
    plane_height_1b: 0.1,
    plane_epsilon_1b: 7.0,
    plane_height_2a: 0.1,
    plane_epsilon_2a: 3.5,
    plane_height_2b: 0.15,
    plane_epsilon_2b: 4.2,
  };

  const x_regions = [
    params.coplanar_width-params.trace_taper, params.trace_taper/2,
    params.coplanar_separation,
    params.trace_taper/2, params.signal_width-params.trace_taper, params.trace_taper/2,
    params.signal_separation,
    params.trace_taper/2, params.signal_width-params.trace_taper, params.trace_taper/2,
    params.coplanar_separation,
    params.trace_taper/2, params.coplanar_width-params.trace_taper,
  ];
  const y_regions = [
    params.plane_height_1a,
    params.plane_height_1b,
    params.trace_height,
    params.plane_height_2a,
    params.plane_height_2b,
  ];
  normalise_regions(x_regions, y_regions);
  const taper_ratio = params.trace_taper/Math.max(params.coplanar_width, params.signal_width);
  const x_min_subdivisions = (taper_ratio > 0.1) ? 10 : 5;
  const region_grid = new RegionGrid({
    x_regions,
    y_regions,
    y_pad_height: 2,
    x_min_subdivisions,
    y_min_subdivisions: 10,
  });
  const grid = region_grid.grid;

  const Nx = region_grid.x_regions.length;
  const Ny = region_grid.y_regions.length;
  if (Nx != 15 || Ny != 7) {
    throw Error(`Expected region grid to have a shape of (7,15) but got (${Ny},${Nx})`);
  }
  //   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
  // 0 x x x x x x x x x x x x x x x
  // 1 o o o o o o o o o o o o o o o
  // 2 o o o o o o o o o o o o o o o
  // 3 o x x o + + + o - - - o x x o
  // 4 o o o o o o o o o o o o o o o
  // 5 o o o o o o o o o o o o o o o
  // 6 x x x x x x x x x x x x x x x

  // ground planes
  region_grid.v_force_region([0,0],[1,Nx]).fill((0<<16) | 0xFFFF);
  region_grid.v_force_region([Ny-1,0],[Ny,Nx]).fill((0<<16) | 0xFFFF);
  function create_trace(x_start: number, voltage_index: number, mask?: number) {
    mask = mask ?? 0b111;
    let x_offset = x_start;
    if ((mask & 0b100) == 0b100) {
      create_slope(region_grid, [3,x_offset], [4,x_offset+1], voltage_index, sdf_slope_bottom_right);
      x_offset++;
    }
    if ((mask & 0b010) == 0b010) {
      region_grid.v_force_region([3,x_offset], [4,x_offset+1]).fill((voltage_index << 16) | 0xFFFF);
      x_offset++;
    }
    if ((mask & 0b001) == 0b001) {
      create_slope(region_grid, [3,x_offset], [4,x_offset+1], voltage_index, sdf_slope_bottom_left);
      x_offset++;
    }
  }
  create_trace(1, 0, 0b011);  // coplanar trace left
  create_trace(4, 1, 0b111);  // positive trace
  create_trace(8, 2, 0b111);  // negative trace
  create_trace(12, 0, 0b110); // coplanar trace right
  // dielectric
  region_grid.epsilon_k_region([1,0],[2,Nx]).fill(params.plane_epsilon_1a);
  region_grid.epsilon_k_region([2,0],[3,Nx]).fill(params.plane_epsilon_1b);
  region_grid.epsilon_k_region([3,0],[5,Nx]).fill(params.plane_epsilon_2a);
  region_grid.epsilon_k_region([5,0],[6,Nx]).fill(params.plane_epsilon_2b);
  return region_grid;
};

//const region_grid = create_differential_microstrip();
const region_grid = create_differential_coplanar_composite_microstrip();
const grid = region_grid.grid;
grid.v_table.set([0], 0);
grid.v_table.set([1], 1);
grid.v_table.set([2], -1);
grid.bake();

const is_running = ref<boolean>(false);
const run_result = ref<RunResult | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);

async function run() {
  is_running.value = true;
  await new Promise(resolve => setTimeout(resolve, 0));

  grid.reset();
  const energy_threshold = 1e-3;
  const start_ms = performance.now();
  run_result.value = grid.run(energy_threshold);
  const end_ms = performance.now();
  const elapsed_ms = end_ms-start_ms;
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
                    <TableHead>a0</TableHead>
                    <TableHead>a1</TableHead>
                    <TableHead>error</TableHead>
                    <TableHead>n</TableHead>
                    <TableHead>r0</TableHead>
                    <TableHead>r1</TableHead>
                    <TableHead>n0</TableHead>
                    <TableHead>n1</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(grid, index) in region_grid.x_grids" :key="index">
                    <TableCell class="font-medium">{{ index }}</TableCell>
                    <TableCell>{{ grid.a0.toPrecision(2) }}</TableCell>
                    <TableCell>{{ grid.a1.toPrecision(2) }}</TableCell>
                    <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</TableCell>
                    <TableCell>{{ grid.n0 + grid.n1 }}</TableCell>
                    <TableCell>{{ grid.r0.toFixed(2) }}</TableCell>
                    <TableCell>{{ grid.r1.toFixed(2) }}</TableCell>
                    <TableCell>{{ grid.n0 }}</TableCell>
                    <TableCell>{{ grid.n1 }}</TableCell>
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
                    <TableHead>a0</TableHead>
                    <TableHead>a1</TableHead>
                    <TableHead>error</TableHead>
                    <TableHead>n</TableHead>
                    <TableHead>r0</TableHead>
                    <TableHead>r1</TableHead>
                    <TableHead>n0</TableHead>
                    <TableHead>n1</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(grid, index) in region_grid.y_grids" :key="index">
                    <TableCell class="font-medium">{{ index }}</TableCell>
                    <TableCell>{{ grid.a0.toPrecision(2) }}</TableCell>
                    <TableCell>{{ grid.a1.toPrecision(2) }}</TableCell>
                    <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(2) }}</TableCell>
                    <TableCell>{{ grid.n0 + grid.n1 }}</TableCell>
                    <TableCell>{{ grid.r0.toFixed(2) }}</TableCell>
                    <TableCell>{{ grid.r1.toFixed(2) }}</TableCell>
                    <TableCell>{{ grid.n0 }}</TableCell>
                    <TableCell>{{ grid.n1 }}</TableCell>
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
        <Tabs default-value="grid" class="w-full" :unmount-on-hide="false">
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
