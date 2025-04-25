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
  type AsymmetricGeometricGrid,
  generate_asymmetric_geometric_grid_from_regions,
  generate_asymmetric_geometric_grid,
} from "../engine/mesher.ts";
import Chart from "chart.js/auto";

import { ref, useTemplateRef, onMounted } from "vue";

const grid_canvas_elem = useTemplateRef<HTMLCanvasElement>("grid-canvas");
const chart = ref<Chart | undefined>(undefined);
let x_inner_lines: number[] = [];
let x_outer_lines: number[] = [];
let y_inner_lines: number[] = [];
let y_outer_lines: number[] = [];
const x_grids = ref<AsymmetricGeometricGrid[]>([]);
const y_grids = ref<AsymmetricGeometricGrid[]>([]);

function get_grid_lines_from_deltas(deltas: number[]): number[] {
  let x = 0;
  const x_grid: number[] = [x];
  for (const dx of deltas) {
    x += dx;
    x_grid.push(x);
  }
  return x_grid;
}

function update_chart() {
  const grid_canvas = grid_canvas_elem.value;
  if (grid_canvas === null) return;

  const x_min = 0;
  const x_max = x_outer_lines[x_outer_lines.length-1];
  const y_min = 0;
  const y_max = y_outer_lines[y_outer_lines.length-1];

  chart.value?.destroy();
  chart.value = new Chart(grid_canvas, {
    type: "line",
    data: {
      datasets: Array.prototype.concat(
        x_inner_lines.map((x) => {
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
        y_inner_lines.map((y) => {
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
        x_outer_lines.map((x) => {
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
        y_outer_lines.map((y) => {
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

function run() {
  const min_subdivisions = 5;

  const x_regions = [1, 0.1334, 0.15, 0.1334, 1];
  const y_regions = [0.2, 0.0994, 0.0152, 0.45, 0.2];

  x_grids.value = generate_asymmetric_geometric_grid_from_regions(x_regions, min_subdivisions);
  y_grids.value = generate_asymmetric_geometric_grid_from_regions(y_regions, min_subdivisions);

  const x_deltas = x_grids.value.map(config => generate_asymmetric_geometric_grid(config));
  x_inner_lines = get_grid_lines_from_deltas(Array.prototype.concat(...x_deltas));
  x_outer_lines = get_grid_lines_from_deltas(x_regions);

  const y_deltas = y_grids.value.map(config => generate_asymmetric_geometric_grid(config));
  y_inner_lines = get_grid_lines_from_deltas(Array.prototype.concat(...y_deltas));
  y_outer_lines = get_grid_lines_from_deltas(y_regions);

  update_chart();
}

onMounted(() => {
  run();
});
</script>

<template>
  <Button @click="run()">Run</Button>
  <h2>x grid</h2>
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
      <TableRow v-for="(grid, index) in x_grids" :key="index">
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
      <TableRow>
        <TableCell/>
        <TableCell/>
        <TableCell/>
        <TableCell></TableCell>
        <TableCell>{{ x_grids.reduce((a,b) => a+b.n0+b.n1, 0) }}</TableCell>
        <TableCell/>
        <TableCell/>
        <TableCell/>
        <TableCell/>
      </TableRow>
    </TableBody>
  </Table>
  <h2>y grid</h2>
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
      <TableRow v-for="(grid, index) in y_grids" :key="index">
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
      <TableRow>
        <TableCell/>
        <TableCell/>
        <TableCell/>
        <TableCell></TableCell>
        <TableCell>{{ y_grids.reduce((a,b) => a+b.n0+b.n1, 0) }}</TableCell>
        <TableCell/>
        <TableCell/>
        <TableCell/>
        <TableCell/>
      </TableRow>
    </TableBody>
  </Table>
  <canvas ref="grid-canvas" class="w-[100%] max-h-[300px]"></canvas>
</template>

<style scoped>
</style>
