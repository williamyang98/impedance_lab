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

import {
  type AsymmetricGeometricGrid,
  generate_asymmetric_geometric_grid_from_regions,
  generate_asymmetric_geometric_grid,
} from "../engine/mesher.ts";
import Chart from "chart.js/auto";
import { Viewer2D } from "../components/viewer_2d";
import { RegionGrid } from "../engine/grid_2d.ts";

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

const x_regions = [0.1334, 0.15, 0.1334];
const y_regions = [0.1, 0.05, 0.1];
normalise_regions(x_regions, y_regions);
const region_grid = new RegionGrid({
  x_regions,
  y_regions,
  y_pad_height: 2,
});

region_grid.v_force_region([0,0],[1,5]).fill((0<<16) | 0xFFFF);
region_grid.v_force_region([4,0],[5,5]).fill((0<<16) | 0xFFFF);
region_grid.v_force_region([2,1],[3,2]).fill((1<<16) | 0xFFFF);
region_grid.v_force_region([2,3],[3,4]).fill((2<<16) | 0xFFFF);
region_grid.grid.v_table.set([0], 0);
region_grid.grid.v_table.set([1], 1);
region_grid.grid.v_table.set([2], -1);
region_grid.grid.bake();

function run() {
  const energy_threshold = 1e-4;
  region_grid.grid.run(energy_threshold);
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

onMounted(() => {
  run();
  update_chart();
  void update_grid_viewer();
});
</script>

<template>
  <div class="grid grid-flow-row grid-cols-5 gap-2">
    <Card>
      <CardHeader><CardTitle>Grid</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell class="font-medium">Total cells</TableCell>
              <TableCell>{{ region_grid.grid.v_field.data.length }}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="font-medium">Total columns</TableCell>
              <TableCell>{{ region_grid.grid.dx.shape[0] }}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="font-medium">Total rows</TableCell>
              <TableCell>{{ region_grid.grid.dy.shape[0] }}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="font-medium">Width</TableCell>
              <TableCell>{{ region_grid.grid.width.toFixed(2) }}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="font-medium">Height</TableCell>
              <TableCell>{{ region_grid.grid.height.toFixed(2) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <Card class="col-span-2">
      <CardHeader><CardTitle>x-grid</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Index</TableHead>
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
              <TableCell>{{ index }}</TableCell>
              <TableCell>{{ grid.a0.toPrecision(3) }}</TableCell>
              <TableCell>{{ grid.a1.toPrecision(3) }}</TableCell>
              <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(3) }}</TableCell>
              <TableCell>{{ grid.n0 + grid.n1 }}</TableCell>
              <TableCell>{{ grid.r0.toFixed(3) }}</TableCell>
              <TableCell>{{ grid.r1.toFixed(3) }}</TableCell>
              <TableCell>{{ grid.n0 }}</TableCell>
              <TableCell>{{ grid.n1 }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <Card class="col-span-2">
      <CardHeader><CardTitle>y-grid</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Index</TableHead>
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
              <TableCell>{{ index }}</TableCell>
              <TableCell>{{ grid.a0.toPrecision(3) }}</TableCell>
              <TableCell>{{ grid.a1.toPrecision(3) }}</TableCell>
              <TableCell>{{ Math.max(Math.abs(1-grid.r0), Math.abs(1-grid.r1)).toPrecision(3) }}</TableCell>
              <TableCell>{{ grid.n0 + grid.n1 }}</TableCell>
              <TableCell>{{ grid.r0.toFixed(3) }}</TableCell>
              <TableCell>{{ grid.r1.toFixed(3) }}</TableCell>
              <TableCell>{{ grid.n0 }}</TableCell>
              <TableCell>{{ grid.n1 }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <Card class="col-span-5">
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
