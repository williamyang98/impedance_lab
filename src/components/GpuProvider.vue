<script lang="ts">
import { defineComponent, computed } from "vue";

type LoadState = "loading" | "failed" | "finished";
interface ProviderData {
  state: LoadState;
  adapter?: GPUAdapter;
  device?: GPUDevice;
  error_message?: string;
}

export default defineComponent({
  data(): ProviderData {
    return {
      state: "loading",
      adapter: undefined,
      device: undefined,
      error_message: undefined,
    }
  },
  provide() {
    return {
      gpu_adapter: computed(() => this.adapter),
      gpu_device: computed(() => this.device),
    }
  },
  methods: {
    async create_gpu_instance() {
      if (!navigator.gpu) {
        this.error_message = "WebGPU not available in this browser";
        this.state = "failed";
        return;
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        this.error_message = "Couldn't request WebGPU adapter";
        this.state = "failed";
        return;
      }

      const device = await adapter.requestDevice();
      this.adapter = adapter;
      this.device = device;
      this.state = "finished";
    },
  },
  mounted() {
    void this.create_gpu_instance();
  },
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
