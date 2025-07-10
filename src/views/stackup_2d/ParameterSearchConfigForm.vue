<script setup lang="ts">
import { defineProps, computed, ref, watch } from 'vue';
import { type ParameterSearchConfig } from './search.ts';
import { TriangleAlert } from "lucide-vue-next";
import { NumberField, integer_validator, float_validator } from "../../utility/form_validation.ts";

const props = defineProps<{
  config: ParameterSearchConfig,
}>();

// modify this and validate in realtime to update
const config = computed(() => props.config);

function create_fields(config: ParameterSearchConfig) {
  return [
    new NumberField(config, "max_steps", "Maximum steps", 1, 128, 1, integer_validator),
    new NumberField(config, "impedance_tolerance", "Impedance tolerance", 0.001, undefined, 0.01, float_validator),
    new NumberField(config, "search_precision", "Search precision", 0.00001, undefined, 0.0001, float_validator),
  ];
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
