<script setup lang="ts">
import { type Stackup } from "./stackup.ts";
import StackupViewer from "./StackupViewer.vue";

const config = {
  soldermask_height: 17,
  copper_layer_height: 10,
  trace_height: 20,
  trace_taper: 15,
  signal_trace_width: 40,
  ground_trace_width: 50,
  core_height: 40,
  broadside_width_separation: 70,
  signal_width_separation: 20,
  ground_width_separation: 35,
}

const stackup: Stackup = {
  layers: [
    {
      type: "soldermask",
      id: 0,
      trace_height: { name: "T1", placeholder_value: config.trace_height },
      trace_taper: { name: "dW1", placeholder_value: config.trace_taper },
      soldermask_height: { name: "H1", placeholder_value: config.soldermask_height },
      epsilon: {},
      orientation: "down",
    },
    {
      type: "core",
      id: 1,
      height: { name: "H2", placeholder_value: config.core_height },
      epsilon: {},
    },
    {
      type: "prepreg",
      id: 4,
      trace_height: { name: "T3", placeholder_value: config.trace_height },
      trace_taper: { name: "dW3", placeholder_value: config.trace_taper },
      height: { name: "H3", placeholder_value: config.core_height },
      epsilon: {},
    },
    {
      type: "core",
      id: 3,
      height: { name: "H4", placeholder_value: config.core_height },
      epsilon: {},
    },
    {
      type: "unmasked",
      id: 2,
      trace_height: { name: "T5", placeholder_value: config.trace_height },
      trace_taper: { name: "dW5", placeholder_value: config.trace_taper },
      orientation: "up",
    },
  ],
  conductors: [
    {
      type: "trace",
      id: 0,
      layer_id: 0,
      orientation: "down",
      width: { name: "W", placeholder_value: config.signal_trace_width },
    },
    {
      type: "trace",
      id: 1,
      layer_id: 4,
      orientation: "down",
      width: { name: "W", placeholder_value: config.signal_trace_width },
    },
    {
      type: "trace",
      id: 3,
      layer_id: 4,
      orientation: "up",
      width: { name: "CW", placeholder_value: config.ground_trace_width },
    },
    {
      type: "trace",
      id: 4,
      layer_id: 2,
      orientation: "up",
      width: { name: "CW", placeholder_value: config.ground_trace_width },
    },
    // {
    //   type: "plane",
    //   layer_id: 2,
    //   orientation: "up",
    //   height: { placeholder_value: config.copper_layer_height }
    // },
  ],
  spacings: [
    {
      left_trace: {
        id: 0,
        attach: "center",
      },
      right_trace: {
        id: 1,
        attach: "center",
      },
      width: { name: "S", placeholder_value: config.broadside_width_separation },
    },
    {
      left_trace: {
        id: 3,
        attach: "right",
      },
      right_trace: {
        id: 0,
        attach: "left",
      },
      width: { name: "CW", placeholder_value: config.ground_width_separation },
    },
    {
      left_trace: {
        id: 1,
        attach: "right",
      },
      right_trace: {
        id: 4,
        attach: "left",
      },
      width: { name: "CW", placeholder_value: config.ground_width_separation },
    }
  ],
};

</script>

<template>
<div class="w-[30rem]">
  <StackupViewer :stackup="stackup"/>
</div>
</template>

<style scoped>
svg {
  width: 100%;
  display: block;
}

.signal-selectable:hover {
  opacity: 1.0;
}
</style>
