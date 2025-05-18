<script setup lang="ts">
import { type Stackup, type Parameter } from "./stackup.ts";
import { defineProps, computed } from "vue";

const props = defineProps<{
  stackup: Stackup,
}>();

interface Form {
  layer_params: Set<Parameter>;
  trace_params: Set<Parameter>;
}

const form = computed<Form>(() => {
  const stackup = props.stackup;

  const layer_params = new Set<Parameter>();
  const trace_params = new Set<Parameter>();

  for (const layer of stackup.layers) {
    const T = layer.type;
    if (T == "core" || T == "prepreg" || T == "soldermask") {
      layer_params.add(layer.height);
      layer_params.add(layer.epsilon);
    }
  }

  for (const trace of stackup.conductors.filter(conductor => conductor.type == "trace")) {
    trace_params.add(trace.width);
  }

  for (const spacing of stackup.spacings) {
    trace_params.add(spacing.width);
  }

  for (const layer of stackup.layers) {
    const T = layer.type;
    if (T == "unmasked" || T == "prepreg" || T == "soldermask") {
      trace_params.add(layer.trace_taper);
      trace_params.add(layer.trace_height);
    }
  }

  return {
    layer_params: layer_params,
    trace_params: trace_params,
  };
});

</script>

<template>
<div class="flex flex-row gap-x-4">
  <form>
    <h2 class="text-xl mb-2">Layers</h2>
    <div class="grid grid-cols-[auto_auto] w-fit gap-x-2 gap-y-1">
      <template v-for="(param, index) in form.layer_params" :key="index">
        <label class="label">{{  param.name }}</label>
        <input class="input input-sm" type="number" :min="param.min" :max="param.max" v-model.number="param.value"/>
      </template>
    </div>
  </form>
  <form>
    <h2 class="text-xl mb-2">Traces</h2>
    <div class="grid grid-cols-[auto_auto] w-fit gap-x-2 gap-y-1">
      <template v-for="(param, index) in form.trace_params" :key="index">
        <label class="label">{{  param.name }}</label>
        <input class="input input-sm" type="number" :min="param.min" :max="param.max" v-model.number="param.value"/>
      </template>
    </div>
  </form>
</div>
</template>
