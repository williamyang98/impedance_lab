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
        this.error_message = "WebGPU not supported";
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
  <div v-if="state == 'failed'">
    {{ error_message }}
  </div>
</template>
