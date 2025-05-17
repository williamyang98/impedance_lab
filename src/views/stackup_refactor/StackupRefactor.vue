<script setup lang="ts">
import { type Stackup } from "./stackup.ts";
import StackupViewer from "./StackupViewer.vue";
import { sizes } from "./viewer.ts";

const params = {
  // layer 1
  T1: { name: "T1", placeholder_value: sizes.trace_height },
  dW1: { name: "dW1", placeholder_value: sizes.trace_taper, taper_suffix: '1' },
  H1: { name: "H1", placeholder_value: sizes.soldermask_height },
  ER1: { name: "ER1" },
  // layer 2
  H2: { name: "H2", placeholder_value: sizes.core_height },
  ER2: { name: "ER2" },
  // layer 3
  T3: { name: "T3", placeholder_value: sizes.trace_height },
  H3: { name: "H3", placeholder_value: sizes.core_height },
  dW3: { name: "dW3", placeholder_value: sizes.trace_taper, taper_suffix: '3' },
  ER3: { name: "ER3" },
  // layer 4
  H4: { name: "H4", placeholder_value: sizes.core_height },
  ER4: { name: "ER4" },
  // layer 5
  T5: { name: "T5", placeholder_value: sizes.trace_height },
  H5: { name: "H5", placeholder_value: sizes.core_height },
  dW5: { name: "dW5", placeholder_value: sizes.trace_taper, taper_suffix: '5' },
  // spacing
  W: { name: "W", placeholder_value: sizes.signal_trace_width },
  CW: { name: "CW", placeholder_value: sizes.ground_trace_width },
  S: { name: "S", placeholder_value: sizes.signal_width_separation },
  B: { name: "S", placeholder_value: sizes.broadside_width_separation },
  CS: { name: "CS", placeholder_value: sizes.ground_width_separation },
}

const stackup: Stackup = {
  layers: [
    {
      type: "soldermask",
      id: 0,
      trace_height: params.T1,
      trace_taper: params.dW1,
      soldermask_height: params.H1,
      epsilon: params.ER1,
      orientation: "down",
    },
    {
      type: "core",
      id: 1,
      height: params.H2,
      epsilon: params.ER2,
    },
    {
      type: "prepreg",
      id: 4,
      trace_height: params.T3,
      trace_taper: params.dW3,
      height: params.H3,
      epsilon: params.ER3,
    },
    {
      type: "core",
      id: 3,
      height: params.H4,
      epsilon: params.ER4,
    },
    {
      type: "unmasked",
      id: 2,
      trace_height: params.T5,
      trace_taper: params.dW5,
      orientation: "up",
    },
  ],
  conductors: [
    {
      type: "trace",
      id: 0,
      layer_id: 4,
      orientation: "up",
      width: params.W,
    },
    {
      type: "trace",
      id: 1,
      layer_id: 4,
      orientation: "down",
      width: params.W,
    },
    {
      type: "trace",
      id: 3,
      layer_id: 4,
      orientation: "up",
      width: params.CW,
    },
    {
      type: "trace",
      id: 4,
      layer_id: 2,
      orientation: "up",
      width: params.CW,
    },
    {
      type: "trace",
      id: 5,
      layer_id: 0,
      orientation: "down",
      width: params.W,
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
      width: params.B,
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
      width: params.CS,
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
      width: params.CS,
    },
    {
      left_trace: {
        id: 3,
        attach: "center",
      },
      right_trace: {
        id: 5,
        attach: "left",
      },
      width: params.S,
    },
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
