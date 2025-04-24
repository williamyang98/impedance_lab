<script setup lang="ts">
import { Viewer3D } from "../components/viewer_3d";
</script>

<script lang="ts">
import { defineComponent } from "vue";
import { create_simulation_setup } from "../app/app_3d.ts";
import { SimulationSetup, GpuGrid, GpuEngine } from "../engine/fdtd_3d.ts";

interface ComponentData {
  setup: SimulationSetup;
  gpu_grid: GpuGrid;
  gpu_engine: GpuEngine;

  curr_step: number;
  max_timesteps: number;
  time_taken: number;
  total_cells: number;
  loop_timer_id?: number;
  ms_start?: number;
  display_rate: number;
}

export default defineComponent({
  inject: ["gpu_device", "gpu_adapter"],
  data(): ComponentData {
    const setup = create_simulation_setup();
    const gpu_grid = new GpuGrid(this.gpu_adapter, this.gpu_device, setup);
    const gpu_engine = new GpuEngine(this.gpu_adapter, this.gpu_device);
    return {
      setup,
      gpu_grid,
      gpu_engine,
      curr_step: 0,
      time_taken: 0,
      total_cells: setup.grid.total_cells,
      max_timesteps: 8192,
      loop_timer_id: undefined,
      ms_start: undefined,
      display_rate: 128,
    }
  },
  computed: {
    step_rate(): number {
      return this.curr_step / Math.max(this.time_taken, 1e-6);
    },
    cell_rate(): number {
      return (this.curr_step*this.total_cells) / Math.max(this.time_taken, 1e-6);
    },
    is_running(): boolean {
      return this.loop_timer_id !== undefined;
    },
  },
  methods: {
    update_progress() {
      this.ms_start = this.ms_start ?? performance.now();
      const ms_end = performance.now();
      const ms_elapsed = ms_end-this.ms_start;
      this.time_taken = ms_elapsed*1e-3;
    },
    async simulation_loop() {
      const update_stride = 16; // avoid overhead of setTimeout
      for (let i = 0; i < update_stride; i++) {
        if (this.curr_step >= this.max_timesteps) {
          this.loop_timer_id = undefined;
          return;
        }
        this.gpu_engine.step_fdtd(this.gpu_grid, this.curr_step);
        if (this.curr_step % this.display_rate == 0) {
          await this.refresh_display();
          this.update_progress();
        }
        this.curr_step++;
        if (this.curr_step >= this.max_timesteps) {
          this.update_progress();
        }
      }
      if (this.loop_timer_id === undefined) return;
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    start_loop() {
      this.stop_loop();
      this.ms_start = performance.now();
      this.curr_step = 0;
      this.gpu_grid.reset();
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    resume_loop() {
      this.stop_loop();
      this.loop_timer_id = setTimeout(async () => await this.simulation_loop(), 0);
    },
    async tick_loop() {
      if (this.curr_step >= this.max_timesteps) return;
      this.stop_loop();
      this.gpu_engine?.step_fdtd(this.curr_step);
      this.curr_step++;
      await this.refresh_display();
      this.update_progress();
    },
    stop_loop() {
      if (this.loop_timer_id !== undefined) {
        clearTimeout(this.loop_timer_id);
        this.loop_timer_id = undefined;
      }
    },
    async refresh_display() {
      const viewer_3d = this.$refs.viewer_3d as typeof Viewer3D;
      viewer_3d.set_grid(this.gpu_grid);

      const command_encoder = this.gpu_device.createCommandEncoder();
      viewer_3d.upload_slice(command_encoder);
      viewer_3d.update_display(command_encoder);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    },
  },
  mounted() {
    const viewer_3d = this.$refs.viewer_3d as typeof Viewer3D;
    viewer_3d.set_grid(this.gpu_grid);
    viewer_3d.set_copy_z(Math.round(this.gpu_grid.size[0]/2));
    this.start_loop();
  },
  beforeUnmount() {
    this.stop_loop();
  },
})
</script>

<template>
  <div>
    <div class="max-h-[25%]">
      <Viewer3D ref="viewer_3d"></Viewer3D>
    </div>
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
      <button @click="start_loop()" :disabled="is_running">Restart</button>
      <button @click="resume_loop()" v-if="!is_running">Resume</button>
      <button @click="stop_loop()" v-if="is_running">Pause</button>
      <button @click="tick_loop()" :disabled="is_running">Tick</button>
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
</template>

<style scoped>
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
