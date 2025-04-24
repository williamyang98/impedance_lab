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
        this.error_message = error.toString();
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
  <div v-if="state == 'failed'">
    {{ error_message }}
  </div>
</template>
