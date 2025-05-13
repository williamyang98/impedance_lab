<script setup lang="ts">
import { defineProps, computed } from "vue";
import { type StackupParameters, type Parameter } from "./stackup_parameters.ts";

const props = defineProps<{
  params: StackupParameters,
}>();

const layer_params = computed(() => {
  const dielectric_params: Parameter[] = [];
  for (const params of props.params.layer_parameters) {
    if (params.epsilon) dielectric_params.push(params.epsilon);
    if (params.height) dielectric_params.push(params.height);
    if (params.trace_height) dielectric_params.push(params.trace_height);
  }
  return dielectric_params;
});

const trace_params = computed(() => {
  const trace_params: Parameter[] = [];
  {
    const params = props.params.trace_parameters;
  if (params.signal_width) trace_params.push(params.signal_width);
  if (params.signal_separation) trace_params.push(params.signal_separation);
  if (params.coplanar_width) trace_params.push(params.coplanar_width);
  if (params.coplanar_separation) trace_params.push(params.coplanar_separation);
  }
  for (const params of props.params.layer_parameters) {
    if (params.trace_taper) trace_params.push(params.trace_taper);
  }
  return trace_params;
});

</script>

<template>
<form>
  <div class="flex flex-row gap-x-1">
    <table class="table table-xs w-fit h-fit border-1 border-sm border-base-300">
      <thead>
        <tr>
          <th colspan=2>Layers</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(param, i) in layer_params" :key="i">
          <tr>
            <td><label :for="param.label" class="font-medium">{{ param.label }}</label></td>
            <td>
              <input
                type="number" class="input validator" step="0.1" required
                :id="param.label" :placeholder="param.label"
                v-model.number="param.value" :min="param.min" :max="param.max"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <table class="table table-xs w-fit h-fit border-1 border-sm border-base-300">
      <thead>
        <tr>
          <th colspan=2>Traces</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(param, i) in trace_params" :key="i">
          <tr>
            <td><label :for="param.label" class="font-medium">{{ param.label }}</label></td>
            <td>
              <input
                type="number" class="input validator" step="0.1" required
                :id="param.label" :placeholder="param.label"
                v-model.number="param.value" :min="param.min" :max="param.max"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</form>
</template>
