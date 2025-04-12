<script lang="ts">
import { defineComponent } from "vue";
import {
  SimulationSetup, GpuFdtdEngine,
  create_simulation_setup,
} from "../app/app.ts";

interface ComponentData {
  setup: SimulationSetup;
  curr_step: number;
  total_steps: number;
  time_taken: number;
  total_cells: number;
  gpu_engine?: GpuFdtdEngine;
  loop_timer_id?: number;
  ms_start?: number;
}

export default defineComponent({
  data(): ComponentData {
    let setup = create_simulation_setup();
    return {
      setup,
      curr_step: 0,
      time_taken: 0,
      total_cells: setup.grid.total_cells,
      max_timesteps: 8192,
      gpu_engine: null,
      loop_timer_id: null,
      ms_start: null,
    }
  },
  computed: {
    step_rate(): number {
      return this.curr_step / Math.max(this.time_taken, 1e-6);
    },
    cell_rate(): number {
      return (this.curr_step*this.total_cells) / Math.max(this.time_taken, 1e-6);
    },
    is_running(): bool {
      return this.loop_timer_id !== null;
    },
  },
  methods: {
    on_update(curr_step: number, total_steps: number, time_taken: number, total_cells: number) {
      this.curr_step = curr_step;
      this.time_taken = time_taken;
      this.total_cells = total_cells;
    },
    update_progress() {
      let ms_end = performance.now();
      let ms_elapsed = ms_end-this.ms_start;
      this.time_taken = ms_elapsed*1e-3;
    },
    async simulation_loop() {
      let update_stride = 16; // avoid overhead of setTimeout
      for (let i = 0; i < update_stride; i++) {
        if (this.curr_step >= this.max_timesteps) {
          this.loop_timer_id = null;
          return;
        }
        this.gpu_engine.step_fdtd(this.curr_step);
        if (this.curr_step % 128 == 0) {
          await this.gpu_engine.update_display();
          this.update_progress();
        }
        this.curr_step++;
        if (this.curr_step >= this.max_timesteps) {
          this.update_progress();
        }
      }
      if (this.loop_timer_id === null) return;
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    start_loop() {
      if (this.gpu_engine === null) return;
      this.stop_loop();
      this.ms_start = performance.now();
      this.curr_step = 0;
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    resume_loop() {
      if (this.gpu_engine === null) return;
      this.stop_loop();
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    stop_loop() {
      if (this.loop_timer_id !== null) {
        clearTimeout(this.loop_timer_id);
        this.loop_timer_id = null;
      }
    },
  },
  async mounted() {
    let canvas = this.$refs.gpu_canvas;
    let canvas_context: GPUCanvasContext = canvas.getContext("webgpu");
    if (!navigator.gpu) {
      throw Error("WebGPU not supported.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw Error("Couldn't request WebGPU adapter.");
    }
    const device = await adapter.requestDevice();
    this.gpu_engine = new GpuFdtdEngine(canvas_context, adapter, device, this.setup);
    this.start_loop();
  },
  beforeUnmount() {
    this.stop_loop();
  },
})
</script>

<template>
  <main>
    <h1>Home</h1>
    <div>
      <canvas ref="gpu_canvas" style="width: 512px; height: 256px;"></canvas>
      <br>
      <div style="width: 512px; height: 1.5rem; background-color: #222222">
        <div
          :style="{ width: `${(curr_step/max_timesteps*100).toFixed(2)}%` }"
          style="height: 100%; background-color: #00FF00; text-align: center"
        >
          {{ curr_step }}/{{ max_timesteps }}
        </div>
      </div>
      <br>
      <div>
        <button @click="start_loop()" :disabled="is_running">Start</button>
        <button @click="resume_loop()" :disabled="is_running">Resume</button>
        <button @click="stop_loop()" :disabled="!is_running">Stop</button>
      </div>
      <br>
      <div>
        <table>
          <tbody>
            <tr><td>Total steps</td><td>{{ curr_step }}/{{ max_timesteps }}</td></tr>
            <tr><td>Time taken</td><td>{{ `${time_taken.toFixed(2)} s` }}</td></tr>
            <tr><td>Step rate</td><td>{{ `${step_rate.toFixed(2)} steps/s` }}</td></tr>
            <tr><td>Cell rate</td><td>{{ `${(cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>
</template>

<style scope>
table, th, td {
  border: 1px solid;
}
table {
  border-collapse: collapse;
}
th, td {
  padding: 0.25rem;
}
</style>
