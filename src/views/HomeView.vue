<script setup lang="ts">
</script>

<script lang="ts">
import run_app from "../app/app.ts";
export default {
  data() {
    return {
      curr_step: 0,
      total_steps: 0,
      time_taken: 0,
      total_cells: 0,
    }
  },
  computed: {
    step_rate(): number {
      return this.curr_step / Math.max(this.time_taken, 1e-6);
    },
    cell_rate(): number {
      return (this.curr_step*this.total_cells) / Math.max(this.time_taken, 1e-6);
    }
  },
  methods: {
    on_update(curr_step: number, total_steps: number, time_taken: number, total_cells: number) {
      this.curr_step = curr_step;
      this.total_steps = total_steps;
      this.time_taken = time_taken;
      this.total_cells = total_cells;
    }
  },
  mounted() {
    let canvas = this.$refs.gpu_canvas;
    let canvas_context: GPUCanvasContext = canvas.getContext("webgpu");
    run_app({
      canvas_context,
      on_update: (curr_step: number, total_steps: number, time_taken: number, total_cells: number) => {
        this.on_update(curr_step, total_steps, time_taken, total_cells);
      },
    });
  }
}
</script>

<template>
  <main>
    <h1>Home</h1>
    <div>
      <canvas ref="gpu_canvas" style="width: 512px; height: 256px;"></canvas>
      <br>
      <div style="width: 512px; height: 1.5rem; background-color: #222222">
        <div
          :style="{ width: `${(curr_step/total_steps*100).toFixed(2)}%` }"
          style="height: 100%; background-color: #00FF00; text-align: center"
        >
          {{ curr_step }}/{{ total_steps }}
        </div>
      </div>
      <br>
      <div>
        <table>
          <tr><td>Total steps</td><td>{{ curr_step }}/{{ total_steps }}</td></tr>
          <tr><td>Time taken</td><td>{{ `${time_taken.toFixed(2)} s` }}</td></tr>
          <tr><td>Step rate</td><td>{{ `${step_rate.toFixed(2)} steps/s` }}</td></tr>
          <tr><td>Cell rate</td><td>{{ `${(cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td></tr>
        </table>
      </div>
    </div>
  </main>
</template>

<style scope>
table, th, td {
  border: 1px solid;
}
</style>
