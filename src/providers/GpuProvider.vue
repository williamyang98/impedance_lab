<script setup lang="ts">
import { computed, ref, provide, onMounted } from "vue";

type LoadState = "loading" | "failed" | "finished";
const state = ref<LoadState>("loading");
const adapter = ref<GPUAdapter>();
const device = ref<GPUDevice>();
const error_message = ref<string>();

provide("gpu_adapter", computed(() => adapter.value));
provide("gpu_device", computed(() => device.value));

async function create_gpu_instance() {
  if (!navigator.gpu) {
    error_message.value = "WebGPU not available in this browser";
    state.value = "failed";
    return;
  }

  const requested_adapter = await navigator.gpu.requestAdapter();
  if (!requested_adapter) {
    error_message.value = "Couldn't request WebGPU adapter";
    state.value = "failed";
    return;
  }

  const requested_device = await requested_adapter.requestDevice();
  adapter.value = requested_adapter;
  device.value = requested_device;
  state.value = "finished";
}

onMounted(async () => {
  await create_gpu_instance();
});
</script>

<template>
  <slot v-if="state == 'finished'"/>
  <div v-if="state == 'failed'" class="w-screen h-screen flex items-center justify-center bg-red-950">
    <div class="p-4 rounded-sm shadow bg-white">
      <h2>Failed to initialise WebGPU device</h2>
      <p>{{ error_message }}</p>
    </div>
  </div>
</template>
