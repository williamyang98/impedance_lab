<script setup lang="ts">
import { type Stackup, type Parameter } from "./stackup.ts";
import { defineProps, computed } from "vue";

const props = defineProps<{
  stackup: Stackup,
}>();

type Form = ({ name: string, params: Set<Parameter> })[];

const form = computed<Form>(() => {
  const stackup = props.stackup;

  const layer_params = new Set<Parameter>();
  const trace_params = new Set<Parameter>();
  const separation_params = new Set<Parameter>();

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
    separation_params.add(spacing.width);
  }

  for (const layer of stackup.layers) {
    const T = layer.type;
    if (T == "unmasked" || T == "prepreg" || T == "soldermask") {
      trace_params.add(layer.trace_taper);
      trace_params.add(layer.trace_height);
    }
  }

  return [
    { name: "Layers", params: layer_params, },
    { name: "Traces", params: trace_params, },
    { name: "Separations", params: separation_params, },
  ];
});

const valid_form = computed(() => {
  return form.value.filter(column => column.params.size > 0);
})

</script>

<template>
<div class="grid gap-x-2" :class="`grid-cols-${valid_form.length}`">
  <div v-for="({name, params}, col_index) in valid_form" :key="col_index">
    <h2 class="font-medium mb-2">{{ name }}</h2>
    <div class="grid grid-cols-[auto_auto] w-fit gap-x-2 gap-y-1">
      <template v-for="(param, index) in params" :key="index">
        <label class="label">{{  param.name }}</label>
        <input
          class="input input-sm"
          type="number"
          :min="param.min" :max="param.max" v-model.number="param.value"
          :placeholder="param.description"
        />
      </template>
    </div>
  </div>
</div>
</template>
