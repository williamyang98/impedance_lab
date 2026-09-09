<script setup lang="ts">
import { ref, provide, onMounted } from "vue";
import { type Font } from "../renderers/font/msdf";
import { load_font } from "../renderers/font/roboto_regular_msdf";

type LoadState = "loading" | "failed" | "finished";
const state = ref<LoadState>("loading");
const error_message = ref<string>();
const font = ref<Font | undefined>(undefined);

provide("msdf_font", font);

async function init() {
  try {
    font.value = await load_font();
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
      <h2>Failed to load msdf font module</h2>
      <p>{{ error_message }}</p>
    </div>
  </div>
</template>

