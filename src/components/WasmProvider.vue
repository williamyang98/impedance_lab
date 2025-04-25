<script lang="ts">
import { defineComponent } from "vue";
import init_wasm_module from "../wasm/pkg/fdtd_core.js";

type LoadState = "loading" | "failed" | "finished";
interface ProviderData {
  state: LoadState;
  error_message?: string;
}

export default defineComponent({
  data(): ProviderData {
    return {
      state: "loading",
      error_message: undefined,
    }
  },
  methods: {
    async init() {
      try {
        await init_wasm_module();
        this.state = "finished";
      } catch (error) {
        if (error instanceof Error) {
          this.error_message = error.message;
        } else {
          this.error_message = String(error);
        }
        this.state = "failed";
      }
    },
  },
  mounted() {
    void this.init();
  },
});
</script>

<template>
  <slot v-if="state == 'finished'"/>
  <div v-if="state == 'failed'" class="w-screen h-screen flex items-center justify-center bg-red-950">
    <div class="p-4 rounded-sm shadow bg-white">
      <h2>Failed to initialise web assembly module</h2>
      <p>{{ error_message }}</p>
    </div>
  </div>
</template>
