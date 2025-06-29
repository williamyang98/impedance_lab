<script setup lang="ts">
import { ref, provide, onMounted } from "vue";

type LoadState = "loading" | "failed" | "finished";
const state = ref<LoadState>("loading");
const adapter = ref<GPUAdapter | undefined>(undefined);
const device = ref<GPUDevice | undefined>(undefined);
const error_message = ref<string>();

provide("gpu_adapter", adapter);
provide("gpu_device", device);

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
  try {
    await create_gpu_instance();
  } catch (error) {
    error_message.value = String(error);
    state.value = "failed";
  }
});
</script>

<template>
  <slot v-if="state == 'finished'"/>
  <div v-if="state == 'failed'" class="w-screen h-screen flex items-center justify-center bg-error">
    <div class="card card-border bg-base-100">
      <div class="card-body p-3">
        <div class="card-title">Failed to initialise WebGPU device</div>
        <p>{{ error_message }}</p>
      </div>
    </div>
  </div>
</template>
