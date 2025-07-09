<script setup lang="ts">
import { defineProps, ref, computed } from 'vue';
import { type StackupGridConfig } from './grid.ts';
import { TriangleAlert } from "lucide-vue-next";

const props = defineProps<{
  config: StackupGridConfig,
}>();

// modify this and validate in realtime to update
const config = computed(() => props.config);

type Validator = (value: number, min?: number, max?: number) => void;

class ValidatedField {
  readonly name: string;
  readonly key: keyof StackupGridConfig;
  validator?: Validator;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  _value?: number;

  constructor(
    name:string, key: keyof StackupGridConfig,
    min?: number, max?: number, step?: number,
    validator?: Validator,
  ) {
    this.name = name;
    this.key = key;
    this.min = min;
    this.max = max;
    this.step = step;
    this.validator = validator;
    this._value = config.value[this.key];
  }

  set value(value: number) {
    this._value = value;
    try {
      this.validator?.(value, this.min, this.max);
      config.value[this.key] = value;
      this.error = undefined;
    } catch (error) {
      this.error = (error as Error).message;
    }
  }

  get value(): number | undefined {
    return this._value;
  }
}

function integer_validator(value: number, min?: number, max?: number) {
  if (typeof(value) !== 'number') throw Error("Field is required");
  if (Number.isNaN(value)) throw Error("Field is required");
  if (!Number.isInteger(value)) throw Error("Value must be an integer");
  if (min !== undefined && value < min) throw Error(`Value must be greater than or equal to ${min}`);
  if (max !== undefined && value > max) throw Error(`Value must be less than or equal to ${max}`);
};

function float_validator(value: number, min?: number, max?: number) {
  if (typeof(value) !== 'number') throw Error("Field is required");
  if (Number.isNaN(value)) throw Error("Field is required");
  if (min !== undefined && value < min) throw Error(`Value must be greater than or equal to ${min}`);
  if (max !== undefined && value > max) throw Error(`Value must be less than or equal to ${max}`);
}

function create_fields(): ValidatedField[] {
  return [
    new ValidatedField("Minimum grid resolution", "minimum_grid_resolution", 1e-4, undefined, undefined, float_validator),
    new ValidatedField("Padding ratio", "padding_size_multiplier", 1, 20, undefined, float_validator),
    new ValidatedField("Maximum x ratio", "max_x_ratio", 0.1, 2.0, 0.1, float_validator),
    new ValidatedField("Minimum x subdivisions", "min_x_subdivisions", 1, 20, 1, integer_validator),
    new ValidatedField("Maximum y ratio", "max_y_ratio", 0.1, 2.0, 0.1, float_validator),
    new ValidatedField("Minimum y subdivisions", "min_y_subdivisions", 1, 20, 1, integer_validator),
    new ValidatedField("Epsilon resolution", "min_epsilon_resolution", 1e-3, 0.1, undefined, float_validator),
    new ValidatedField("Signal Voltage", "signal_amplitude", 0.1, 10, 0.1, float_validator),
  ];
}

const fields = ref(create_fields());

function on_submit(event: Event) {
  event.preventDefault();
}

</script>

<template>
<div class="text-lg font-bold">2D Mesh Settings</div>
<form class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full" @submit="on_submit">
  <fieldset class="fieldset" v-for="field of fields" :key="field.key">
    <legend class="fieldset-legend">{{ field.name }}</legend>
    <input
      class="w-full input" :class="`${field.error !== undefined ? 'input-error' : ''}`"
      type="number" :min="field.min" :max="field.max" :step="field.step"
      v-model.number="field.value"
    />
    <div class="text-error text-xs flex flex-row py-1 w-full" v-if="field.error">
      <TriangleAlert class="h-[1rem] w-[1rem] mr-1"/>
      <span>{{ field.error }}</span>
    </div>
  </fieldset>
</form>
</template>
