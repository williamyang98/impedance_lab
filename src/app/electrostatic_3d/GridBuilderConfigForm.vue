<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { type GridBuilderConfig, axes } from "./grid_builder.ts";
import { TriangleAlert } from "@lucide/vue";
import { NumberField, integer_validator, float_validator } from "../../utility/form_validation.ts";

const props = defineProps<{
  config: GridBuilderConfig,
}>();

// modify this and validate in realtime to update
const config = computed(() => props.config);

function create_fields(config: GridBuilderConfig) {
  const fields = [
    new NumberField(config, "minimum_grid_resolution", "Minimum grid resolution", 1e-4, undefined, undefined, float_validator),
    new NumberField(config, "padding_size_multiplier", "Padding ratio", 1, 20, undefined, float_validator),
  ];

  const axis_fields = [];
  for (const axis of axes) {
    const parent = config.mesh[axis];
    axis_fields.push(new NumberField(parent, "max_ratio", `Maximum ${axis} ratio`, 0.1, 2.0, 0.1, float_validator));
    axis_fields.push(new NumberField(parent, "min_subdivisions", `Minimum ${axis} subdivisions`, 1, 20, 1, integer_validator));
  }
  return [...fields, ...axis_fields];
}

const fields = ref(create_fields(config.value));
watch(config, (new_config) => {
  fields.value = create_fields(new_config);
});

function on_submit(event: Event) {
  event.preventDefault();
}

</script>

<template>
<form class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full" @submit="on_submit">
  <fieldset class="fieldset" v-for="field of fields" :key="field.key">
    <legend class="fieldset-legend">{{ field.name }}</legend>
    <input
      class="w-full input" :class="`${field.error !== undefined ? 'input-error' : ''}`"
      type="number" :min="field.min" :max="field.max" :step="field.step"
      v-model.number="field.value"
    />
    <div class="text-error text-xs flex flex-row py-1 w-full" v-if="field.error">
      <TriangleAlert class="size-[1rem] mr-1"/>
      <span>{{ field.error }}</span>
    </div>
  </fieldset>
</form>
</template>
