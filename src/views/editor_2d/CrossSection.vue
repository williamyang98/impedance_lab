<script setup lang="ts">
import { defineProps } from "vue";
import {
  Builder, type Layer,
  trace_alignments,
} from "./stackup.ts";

const _props = defineProps<{
  builder: Builder,
  layer: Layer,
  index: number,
}>();

// const signal = computed(() => props.builder.signal);

</script>

<template>
<div v-if="builder.signal.type == 'single'" class="grid grid-cols-1 gap-y-2 signal-widget">
  <template v-for="alignment in trace_alignments" :key="alignment">
    <div
      v-if="builder.is_signal_in_layer(index, alignment)"
      class="w-full h-full bg-yellow-600 border-1 border-slate-900"
      :alignment="alignment"
    ></div>
    <div v-else class="move-signal w-full h-full">
      <div v-if="builder.is_valid_signal_alignment(index, alignment)"
        class="w-full h-full bg-yellow-200 border-1 border-slate-900"
        :alignment="alignment"
        @click="builder.move_single_layer_signal(index, alignment)"
      ></div>
    </div>
  </template>
</div>
<div v-else-if="builder.signal.type == 'coplanar_pair'" class="grid grid-cols-1 gap-y-2 signal-widget">
  <template v-for="alignment in trace_alignments" :key="alignment">
    <div v-if="builder.is_signal_in_layer(index, alignment)" class="grid grid-cols-2 gap-x-2">
      <div class="w-full h-full bg-yellow-600 border-1 border-slate-900" :alignment="alignment"></div>
      <div class="w-full h-full bg-yellow-600 border-1 border-slate-900" :alignment="alignment"></div>
    </div>
    <div v-else class="move-signal grid grid-cols-2 gap-x-2">
      <template v-if="builder.is_valid_signal_alignment(index, alignment)">
        <div
          class="w-full h-full bg-yellow-200 border-1 border-slate-900"
          :alignment="alignment"
          @click="builder.move_single_layer_signal(index, alignment)"
        ></div>
        <div
          class="w-full h-full bg-yellow-200 border-1 border-slate-900"
          :alignment="alignment"
          @click="builder.move_single_layer_signal(index, alignment)"
        ></div>
      </template>
    </div>
  </template>
</div>
<div v-else-if="builder.signal.type == 'broadside_pair'" class="grid grid-cols-2 gap-x-2 gap-y-2 signal-widget">
  <template v-for="alignment in trace_alignments" :key="alignment">
    <div
      v-if="builder.is_broadside_signal_in_layer(index, alignment, true)"
      class="w-full h-full bg-yellow-600 border-1 border-slate-900"
      :alignment="alignment"
    ></div>
    <div v-else class="move-signal w-full h-full">
      <div v-if="builder.is_valid_signal_alignment(index, alignment)"
        class="w-full h-full bg-yellow-200 border-1 border-slate-900"
        :alignment="alignment"
        @click="builder.move_broadside_signal(index, alignment, true)"
      ></div>
    </div>
    <div
      v-if="builder.is_broadside_signal_in_layer(index, alignment, false)"
      class="w-full h-full bg-yellow-600 border-1 border-slate-900"
      :alignment="alignment"
    ></div>
    <div v-else class="move-signal w-full h-full">
      <div v-if="builder.is_valid_signal_alignment(index, alignment)"
        class="w-full h-full bg-yellow-200 border-1 border-slate-900"
        :alignment="alignment"
        @click="builder.move_broadside_signal(index, alignment, false)"
      ></div>
    </div>
  </template>
</div>
</template>

<style scoped>
.hover-rect:hover {
  fill: red;
  cursor: pointer;
}

.move-signal div {
  opacity: 0.2;
  user-select: none;
}

.move-signal:hover div {
  opacity: 1.0;
  user-select: none;
  cursor: pointer;
}

.signal-widget {
  height: 100%;
  min-height: 2rem;
  padding-left: 1rem;
  padding-right: 1rem;
}

div[alignment='top'] {
  /* clip-path: polygon(0% 0%, 100% 0%, 90% 100%, 10% 100%); */
  border-radius: 0px 0px 30px 30px;
}

div[alignment='bottom'] {
  /* clip-path: polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%); */
  border-radius: 30px 30px 0px 0px;
}
</style>
