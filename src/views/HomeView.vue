<script lang="ts">
import { defineComponent } from "vue";
import {
  type SimulationSetup, type GridDisplayMode, type FieldDisplayMode, GpuFdtdEngine,
  create_simulation_setup,
} from "../app/app.ts";

interface ComponentData {
  setup: SimulationSetup;
  curr_step: number;
  max_timesteps: number;
  time_taken: number;
  total_cells: number;
  gpu_engine?: GpuFdtdEngine;
  loop_timer_id?: number;
  ms_start?: number;
  display_rate: number;
  display_slice: number;
  display_scale: number;
  display_axis: GridDisplayMode,
  display_axis_options: GridDisplayMode[],
  display_field: FieldDisplayMode,
  display_field_options: FieldDisplayMode[],
}

export default defineComponent({
  data(): ComponentData {
    const setup = create_simulation_setup();
    return {
      setup,
      curr_step: 0,
      time_taken: 0,
      total_cells: setup.grid.total_cells,
      max_timesteps: 8192,
      gpu_engine: undefined,
      loop_timer_id: undefined,
      ms_start: undefined,
      display_rate: 128,
      display_scale: 0,
      display_slice: Math.floor(setup.grid.size[0]/2),
      display_axis: "x",
      display_axis_options: ["x", "y", "z", "mag"],
      display_field: "e_field",
      display_field_options: ["e_field", "h_field"],
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
        this.gpu_engine?.step_fdtd(this.curr_step);
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
      this.gpu_engine?.reset();
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
      const get_scale_offset = (mode: FieldDisplayMode): number => {
        switch (mode) {
        case "e_field": return 0;
        case "h_field": return 2;
        }
      };
      const scale_offset = get_scale_offset(this.display_field);
      const scale = 10**(this.display_scale+scale_offset);
      this.gpu_engine?.update_display(this.display_slice, scale, this.display_field, this.display_axis);
      await this.gpu_engine?.wait_finished();
    },
  },
  watch: {
    async display_scale(_new_value, _old_value) {
      await this.refresh_display();
    },
    async display_slice(_new_value, _old_value) {
      await this.refresh_display();
    },
    async display_axis(_new_value, _old_value) {
      await this.refresh_display();
    },
    async display_field(_new_value, _old_value) {
      await this.refresh_display();
    },
  },
  mounted() {
    const mount = async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw Error("Couldn't request WebGPU adapter.");
      }
      const device = await adapter.requestDevice();

      const canvas = this.$refs.gpu_canvas as HTMLCanvasElement;
      const canvas_context: GPUCanvasContext | null = canvas.getContext("webgpu");
      if (canvas_context === null) {
        throw Error("Failed to get webgpu context from canvas");
      }
      if (!navigator.gpu) {
        throw Error("WebGPU not supported.");
      }

      this.gpu_engine = new GpuFdtdEngine(canvas_context, adapter, device, this.setup);
      this.start_loop();
    };
    void mount();
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
      <canvas ref="gpu_canvas" class="w-[100%]"></canvas>
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
      <div>
        <label for="slice">Slice: {{ display_slice }}</label><br>
        <input id="slice" type="range" v-model.number="display_slice" min="0" :max="setup.grid.size[0]-1" step="1"/><br>
        <label for="scale">Scale: {{ display_scale }}</label><br>
        <input id="scale" type="range" v-model.number="display_scale" min="-4" max="4" step="0.1"/><br>
        <label for="axis">Axis: </label>
        <select id="axis" v-model="display_axis">
          <option v-for="axis in display_axis_options" :key="axis" :value="axis">
            {{ axis }}
          </option>
        </select><br>
        <label for="field">Field: </label>
        <select id="axis" v-model="display_field">
          <option v-for="field in display_field_options" :key="field" :value="field">
            {{ field }}
          </option>
        </select>
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
