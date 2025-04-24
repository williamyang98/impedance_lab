<script lang="ts">
import { defineComponent } from "vue";
import { type GridDisplayMode, type FieldDisplayMode, Renderer } from "./renderer.ts";
import { GpuGrid } from "../../engine/fdtd_3d.ts";

interface ComponentData {
  gpu_grid?: GpuGrid;
  canvas_context?: GPUCanvasContext;
  gpu_renderer: Renderer;
  copy_z: number;
  scale: number;
  axis_mode: GridDisplayMode,
  axis_mode_options: GridDisplayMode[],
  field_mode: FieldDisplayMode,
  field_mode_options: FieldDisplayMode[],
}

export default defineComponent({
  inject: ["gpu_device", "gpu_adapter"],
  data(): ComponentData {
    const gpu_renderer = new Renderer(this.gpu_adapter, this.gpu_device);
    return {
      gpu_grid: undefined,
      gpu_renderer,
      copy_z: 0,
      scale: 0,
      axis_mode: "x",
      axis_mode_options: ["x", "y", "z", "mag"],
      field_mode: "e_field",
      field_mode_options: ["e_field", "h_field"],
    }
  },
  computed: {
    max_z(): number {
      if (this.gpu_grid === undefined) return 0;
      return this.gpu_grid.size[0]-1;
    },
  },
  methods: {
    set_grid(gpu_grid: GpuGrid) {
      this.gpu_grid = gpu_grid;
      this.copy_z = Math.min(Math.max(this.copy_z, 0), this.gpu_grid.size[0]-1);
    },
    set_copy_z(copy_z: number) {
      this.copy_z = copy_z;
    },
    upload_slice(command_encoder: GPUCommandEncoder) {
      if (this.gpu_grid === undefined) return;
      this.copy_z = Math.min(Math.max(this.copy_z, 0), this.gpu_grid.size[0]-1);
      this.gpu_renderer.upload_slice(command_encoder, this.gpu_grid, this.copy_z, this.field_mode);
    },
    update_display(command_encoder: GPUCommandEncoder) {
      if (this.canvas_context === undefined) {
        throw Error(`Tried to update display when gpu canvas context failed to be initialised`);
      }
      const get_scale_offset = (mode: FieldDisplayMode): number => {
        switch (mode) {
        case "e_field": return 0;
        case "h_field": return 2;
        }
      };
      const scale_offset = get_scale_offset(this.field_mode);
      const scale = 10**(this.scale+scale_offset);
      this.gpu_renderer.update_display(command_encoder, this.canvas_context, scale, this.axis_mode);
    },
  },
  watch: {
    async copy_z(_new_value, _old_value) {
      const command_encoder = this.gpu_device.createCommandEncoder();
      this.upload_slice(command_encoder);
      this.update_display(command_encoder);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    },
    async field_mode(_new_value, _old_value) {
      const command_encoder = this.gpu_device.createCommandEncoder();
      this.upload_slice(command_encoder);
      this.update_display(command_encoder);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    },
    async scale(_new_value, _old_value) {
      const command_encoder = this.gpu_device.createCommandEncoder();
      this.update_display(command_encoder);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    },
    async axis_mode(_new_value, _old_value) {
      const command_encoder = this.gpu_device.createCommandEncoder();
      this.update_display(command_encoder);
      this.gpu_device.queue.submit([command_encoder.finish()]);
      await this.gpu_device.queue.onSubmittedWorkDone();
    },
  },
  mounted() {
    const canvas = this.$refs.gpu_canvas as HTMLCanvasElement;
    const canvas_context: GPUCanvasContext | null = canvas.getContext("webgpu");
    if (canvas_context === null) {
      throw Error("Failed to get webgpu context from canvas");
    }
    this.canvas_context = canvas_context;
  },
})
</script>

<template>
  <canvas ref="gpu_canvas" class="w-[100%]"></canvas>
  <div>
    <label for="slice">Z: {{ copy_z }}</label><br>
    <input id="slice" type="range" v-model.number="copy_z" min="0" :max="max_z" step="1"/><br>
    <label for="scale">Scale: {{ scale }}</label><br>
    <input id="scale" type="range" v-model.number="scale" min="-4" max="4" step="0.1"/><br>
    <label for="axis">Axis: </label>
    <select id="axis" v-model="axis_mode">
      <option v-for="axis in axis_mode_options" :key="axis" :value="axis">
        {{ axis }}
      </option>
    </select><br>
    <label for="field">Field: </label>
    <select id="axis" v-model="field_mode">
      <option v-for="field in field_mode_options" :key="field" :value="field">
        {{ field }}
      </option>
    </select>
  </div>
</template>

<style scoped>
</style>
