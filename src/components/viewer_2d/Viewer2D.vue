<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
</script>

<script lang="ts">
import { defineComponent } from "vue";
import { Renderer } from "./renderer.ts";
import { Grid } from "../../engine/electrostatic_2d.ts";

type FieldAxis = "x" | "y" | "mag" | "vec" | "energy";
function field_axis_to_id(axis: FieldAxis): number {
  switch (axis) {
  case "x": return 0;
  case "y": return 1;
  case "mag": return 2;
  case "vec": return 3;
  case "energy": return 4;
  }
}

interface ComponentData {
  grid_renderer: Renderer;
  display_axis: FieldAxis;
  display_scale: number;
}

export default defineComponent({
  inject: ["gpu_device", "gpu_adapter"],
  // https://stackoverflow.com/a/68841834
  // we are using defineExpose which requires us to specify exposed fields/methods
  // this is because we have a <script setup> tag for this component which prevents auto-exposing
  expose: ["upload_grid", "refresh_canvas"],
  data(): ComponentData {
    const grid_renderer = new Renderer(this.gpu_adapter, this.gpu_device);
    return {
      grid_renderer,
      display_axis: "vec",
      display_scale: 1.0,
    };
  },
  methods: {
    upload_grid(grid: Grid) {
      this.grid_renderer.upload_grid(grid);
    },
    async refresh_canvas() {
      const canvas = this.$refs.field_canvas as (HTMLCanvasElement | null);
      if (canvas === null) return;
      const axis = field_axis_to_id(this.display_axis);
      this.grid_renderer.update_canvas(canvas, this.display_scale, axis);
      await this.grid_renderer.wait_finished();
    },
  },
  mounted() {
  },
  watch: {
    display_axis(_new_value, _old_value) {
      void this.refresh_canvas();
    },
    display_scale(_new_value, _old_value) {
      void this.refresh_canvas();
    },
  },
});
</script>

<template>
  <form class="grid grid-cols-4 gap-x-3">
    <Label for="display_scale">Display scale</Label>
    <Input id="display_scale" type="number" v-model.number="display_scale" min="0" max="10" step="0.1"/>
    <Label for="display_axis">Axis</Label>
    <Select id="display_axis" v-model="display_axis">
      <SelectTrigger class="w-auto">
        <SelectValue/>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="'x'">Ex</SelectItem>
        <SelectItem :value="'y'">Ey</SelectItem>
        <SelectItem :value="'mag'">Magnitude</SelectItem>
        <SelectItem :value="'vec'">Vector</SelectItem>
        <SelectItem :value="'energy'">Energy</SelectItem>
      </SelectContent>
    </Select>
  </form>
  <canvas ref="field_canvas" class="grid-view w-[100%] h-[100%] pt-2"></canvas>
</template>

<style scoped>
canvas.grid-view {
  image-rendering: pixelated;
}
</style>
