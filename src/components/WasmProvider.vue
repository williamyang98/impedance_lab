<script setup lang="ts">
import { ref, onMounted, computed, provide } from "vue";
import init_wasm_module, { type MainModule } from "../wasm/build/lu_solver.js";

type LoadState = "loading" | "failed" | "finished";
const state = ref<LoadState>("loading");
const error_message = ref<string>();

const module = ref<MainModule>();

provide("wasm_module", computed(() => module.value));

async function init() {
  try {
    const new_module = await init_wasm_module();
    module.value = new_module;
    state.value = "finished";
  } catch (error) {
    if (error instanceof Error) {
      error_message.value = error.message;
    } else {
      error_message.value = String(error);
    }
    state.value = "failed";
  }
}

onMounted(async () => {
  await init();
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
