<script lang="ts">
import { defineComponent } from "vue";
import { App2d } from "../app/app_2d.ts";

interface ComponentData {
  value: number;
  app: App2d;
}

export default defineComponent({
  data(): ComponentData {
    return {
      value: 0,
      app: new App2d(),
    };
  },
  methods: {
    increment() {
      this.value++;
    },
    run() {
      this.app.run();
      const canvas = this.$refs.field_canvas as HTMLCanvasElement;
      this.app.render(canvas);
    },
    reset() {
      this.app.reset();
    },
  },
  async mounted() {
    await App2d.init();
    this.run();
  },
  beforeUnmount() {

  },
});
</script>

<template>
  <div>
    <h1>About</h1>
    <div>Value: {{  value }}</div>
    <button @click="increment()">Increment</button>
    <button @click="run()">Run</button>
    <br>
    <div><canvas ref="field_canvas" style="width: 400px; height: 200px"></canvas></div>
  </div>
</template>

<style>
</style>
