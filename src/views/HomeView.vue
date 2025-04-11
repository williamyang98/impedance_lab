<script setup lang="ts">
</script>

<script lang="ts">
import run_app from "../app/app.ts";
export default {
  mounted() {
    run_app({
      canvas: this.$refs.gpu_canvas,
      progress_bar: this.$refs.progress_bar,
      progress_info: this.$refs.progress_info,
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
        <div ref="progress_bar" style="width: 50%; height: 100%; background-color: #00FF00; text-align: center">100</div>
      </div>
      <br>
      <div ref="progress_info"></div>
    </div>
  </main>
</template>
