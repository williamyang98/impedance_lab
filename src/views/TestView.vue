<script setup lang="ts">

import { GridLines } from "../engine/grid_2d.ts";

const params = {
  x_padding: 0.2,
  signal_width: 0.6,
  signal_taper: 0.2,
  y_padding: 0.4,
  signal_height: 0.1,
  solder_mask_height: 0.15,
  dielectric_height: 0.4,
};

const x_grid = new GridLines();

let x_offset = 0;
const ix_start = x_grid.push(x_offset);
x_offset += params.x_padding;

const x_signal_left = x_offset;
const ix_signal_left = x_grid.push(x_signal_left);
x_offset += params.signal_width;

const x_signal_right = x_offset;
const ix_signal_right = x_grid.push(x_signal_right);
x_offset += params.x_padding;

const ix_end = x_grid.push(x_offset);


const x_signal_taper_left = x_signal_left + params.signal_taper/2;
const ix_signal_taper_left = x_grid.push(x_signal_taper_left);

const x_signal_taper_right = x_signal_right - params.signal_taper/2;
const ix_signal_taper_right = x_grid.push(x_signal_taper_right);

class Feature {
  name: string;
  slice: [number, number];
  grid_lines: GridLines;

  constructor(grid_lines: GridLines, name: string, slice: [number, number]) {
    this.grid_lines = grid_lines;
    this.name = name;
    this.slice = slice;
  }

  get_indices(): [number, number] {
    const [id_start, id_end] = this.slice;
    const index_start = this.grid_lines.get_index(id_start);
    const index_end = this.grid_lines.get_index(id_end);
    return [index_start, index_end];
  }

  get_width(): number {
    const [id_start, id_end] = this.slice;
    const line_start = this.grid_lines.get_line(id_start);
    const line_end = this.grid_lines.get_line(id_end);
    return line_end-line_start;
  }

  get_lines(): [number, number] {
    const [id_start, id_end] = this.slice;
    const line_start = this.grid_lines.get_line(id_start);
    const line_end = this.grid_lines.get_line(id_end);
    return [line_start, line_end];
  }
}

const x_features: Feature[] = [
  new Feature(x_grid, "pad_left", [ix_start, ix_signal_left]),
  new Feature(x_grid, "taper_left", [ix_signal_left, ix_signal_taper_left]),
  new Feature(x_grid, "signal_mid", [ix_signal_taper_left, ix_signal_taper_right]),
  new Feature(x_grid, "taper_right", [ix_signal_taper_right, ix_signal_right]),
  new Feature(x_grid, "pad_right", [ix_signal_right, ix_end]),
];

const y_grid = new GridLines();

let y_offset = 0;
const iy_start = y_grid.push(y_offset);
y_offset += params.y_padding;

//const y_solder_mask_top = y_offset;
const iy_solder_mask_top = y_grid.push(y_offset);
y_offset += params.solder_mask_height;

const iy_trace = y_grid.push(y_offset);
y_offset += params.signal_height;

const y_dielectric = y_offset;
const iy_dielectric = y_grid.push(y_offset);
y_offset += params.dielectric_height;

const iy_end = y_grid.push(y_offset);

const y_solder_mask_bottom = y_dielectric - params.solder_mask_height;
const iy_solder_mask_bottom = y_grid.push(y_solder_mask_bottom);

const y_features: Feature[] = [
  new Feature(y_grid, "pad_top", [iy_start, iy_solder_mask_top]),
  new Feature(y_grid, "solder_mask_top", [iy_solder_mask_top, iy_trace]),
  new Feature(y_grid, "trace", [iy_trace, iy_dielectric]),
  new Feature(y_grid, "solder_mask_bottom", [iy_solder_mask_bottom, iy_dielectric]),
  new Feature(y_grid, "dielectric", [iy_dielectric, iy_end]),
];

x_grid.sort();
y_grid.sort();

</script>

<template>
  <h3>x features</h3>
  <table class="feature-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Width</th>
        <th>Slice</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="feature of x_features" :key="feature.name">
        <td>{{ feature.name  }}</td>
        <td>{{ feature.get_width().toFixed(2) }}</td>
        <td>[{{ feature.get_lines().map(x => x.toFixed(2)).join(', ') }}]</td>
      </tr>
    </tbody>
  </table>
  <br>
  <h3>y features</h3>
  <table class="feature-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Width</th>
        <th>Slice</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="feature of y_features" :key="feature.name">
        <td>{{ feature.name  }}</td>
        <td>{{ feature.get_width().toFixed(2) }}</td>
        <td>[{{ feature.get_lines().map(x => x.toFixed(2)).join(', ') }}]</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
table, td, th {
  padding: 0.2rem;
  border: 1px solid;
}
</style>
