<script setup lang="ts">
import { type Stackup, type Parameter, type LayerId } from "./stackup.ts";
import { defineProps, computed } from "vue";
import { TriangleAlert } from "lucide-vue-next";

const props = defineProps<{
  stackup: Stackup,
}>();

type Form = ({ name: string, params: Set<Parameter> })[];

const form = computed<Form>(() => {
  const stackup = props.stackup;

  const layer_params = new Set<Parameter>();
  const trace_params = new Set<Parameter>();
  const separation_params = new Set<Parameter>();

  for (const trace of stackup.conductors.filter(conductor => conductor.type == "trace")) {
    trace_params.add(trace.width);
  }

  for (const spacing of stackup.spacings) {
    separation_params.add(spacing.width);
  }

  // hide certain parameters base on presence or absence of trace or plane conductor
  const layers_with_traces: Set<LayerId> = new Set();
  const layers_with_plane: Set<LayerId> = new Set();
  for (const conductor of stackup.conductors) {
    switch (conductor.type) {
      case "trace": {
        layers_with_traces.add(conductor.layer_id);
        break;
      }
      case "plane": {
        layers_with_plane.add(conductor.layer_id);
        break;
      }
    }
  }

  for (const layer of stackup.layers) {
    switch (layer.type) {
      case "unmasked": break;
      case "core": // @fallthrough
      case "prepreg": {
        layer_params.add(layer.height);
        layer_params.add(layer.epsilon);
        break;
      }
      case "soldermask": {
        if (!layers_with_plane.has(layer.id)) {
          layer_params.add(layer.height);
          layer_params.add(layer.epsilon);
        }
        break;
      }
    }
  }

  for (const layer of stackup.layers) {
    switch (layer.type) {
      case "core": break;
      case "prepreg": {
        trace_params.add(layer.trace_height);
        if (layers_with_traces.has(layer.id)) {
          trace_params.add(layer.trace_taper);
        }
        break;
      }
      case "unmasked": // @fallthrough
      case "soldermask": {
        if (layers_with_traces.has(layer.id)) {
          trace_params.add(layer.trace_taper);
          trace_params.add(layer.trace_height);
        }
        break;
      }
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
});

function get_input_class(param: Parameter): string {
  if (param.error !== undefined) return "input-error";
  return "";
}

</script>

<template>
<!--
 @NOTE: We need the actual class string somewhere in the source code for tailwindcss to compile it
 grid-cols-1 grid-cols-2 grid-cols-3
-->
<div :class="`grid grid-cols-${valid_form.length} gap-x-2`">
  <div v-for="({name, params}, col_index) in valid_form" :key="col_index">
    <h2 class="font-medium mb-2">{{ name }}</h2>
    <div class="grid grid-cols-[auto_auto] w-fit gap-x-2 gap-y-1">
      <template v-for="(param, index) in params" :key="index">
        <div class="h-full mt-1">
          <label class="label">{{  param.name }}</label>
        </div>
        <div class="w-full">
          <input
            :class="get_input_class(param)"
            class="input input-sm"
            type="number"
            :min="param.min" :max="param.max" v-model.number="param.value"
            :placeholder="param.description"
          />
          <div v-if="param.error" class="text-error text-xs flex flex-row py-1">
            <TriangleAlert class="h-[1rem] w-[1rem] mr-1"/>
            <span>{{ param.error }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</div>
</template>
