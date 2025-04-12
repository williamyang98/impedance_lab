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
    }
  },
  async mounted() {

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
  </div>
</template>

<style>
</style>
