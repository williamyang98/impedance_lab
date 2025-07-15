<script setup lang="ts">
import { defineProps, computed } from "vue";
import { type Measurement } from "./measurement";
import type { StackupParameters } from "./parameters";
import { type DistanceUnit, convert_distance } from "../../utility/unit_types.ts";
import { with_standard_suffix } from "../../utility/standard_suffix";

const props = defineProps<{
  measurement: Measurement,
  parameters: StackupParameters,
}>();

function get_distance_unit(unit: DistanceUnit): DistanceUnit {
  switch (unit) {
    case "m": return "cm";
    case "cm": return "cm";
    case "mm": return "cm";
    case "um": return "cm";
    case "inch": return "inch";
    case "mil": return "inch";
    case "thou": return "inch";
    case "oz": return "inch";
  }
}

const display_precision: number = 4;

const distance_unit = computed<DistanceUnit>(() => {
  const parameters = props.parameters;
  return get_distance_unit(parameters.size_unit);
});

function format_distributed_value(value: number, unit: string): string {
  const distributed_distance = convert_distance(1, "m", distance_unit.value);
  const distributed_value = value/distributed_distance;
  return with_standard_suffix(distributed_value, `${unit}/${distance_unit.value}`, display_precision);
}

</script>

<template>
<table class="table table-compact w-full">
  <tbody>
    <template v-if="measurement.type == 'single'">
      <tr><td class="font-medium">Type</td><td>Single Ended</td></tr>
      <tr>
        <td class="font-medium">
          {{ `${(measurement.unmasked ? 'Masked ' : '') + 'Impedance'}` }}
        </td>
        <td>{{ measurement.masked.Z0.toPrecision(display_precision) }} Ω</td>
      </tr>
      <tr v-if="measurement.unmasked">
        <td class="font-medium">Unmasked Impedance</td>
        <td>{{ measurement.unmasked.Z0.toPrecision(display_precision) }} Ω</td>
      </tr>
      <tr><td class="font-medium">Propagation Delay</td><td>{{ format_distributed_value(measurement.masked.propagation_delay, "s") }}</td></tr>
      <tr><td class="font-medium">Inductance</td><td>{{ format_distributed_value(measurement.masked.Lh, "H") }}</td></tr>
      <tr><td class="font-medium">Capacitance</td><td>{{ format_distributed_value(measurement.masked.Cih, "F") }}</td></tr>
      <tr><td class="font-medium">Effective Dielectric Constant</td><td>{{ (measurement.effective_er).toFixed(display_precision) }}</td></tr>
    </template>
    <template v-if="measurement.type == 'differential'">
      <tr><td class="font-medium">Type</td><td>Differential</td></tr>
      <tr>
        <td class="font-medium">
          {{ `${(measurement.odd_unmasked ? 'Masked ' : '') + 'Diff Impedance'}` }}
        </td>
        <td>{{ measurement.odd_masked.Z0.toPrecision(display_precision) }} Ω</td>
      </tr>
      <tr v-if="measurement.odd_unmasked">
        <td class="font-medium">Unmasked Diff Impedance</td>
        <td>{{ measurement.odd_unmasked.Z0.toPrecision(display_precision) }} Ω</td>
      </tr>
      <tr><td class="font-medium">Coupling Coefficient</td><td>{{ (measurement.coupling_factor*100).toPrecision(display_precision) }} %</td></tr>
      <tr><td class="font-medium">Odd Mode Impedance</td><td>{{ (measurement.odd_masked.Z0/2).toPrecision(display_precision) }} Ω</td></tr>
      <tr><td class="font-medium">Even Mode Impedance</td><td>{{ (measurement.even_masked.Z0/2).toPrecision(display_precision) }} Ω</td></tr>
      <tr><td class="font-medium">Odd Mode Propagation Delay</td><td>{{ format_distributed_value(measurement.odd_masked.propagation_delay, "s") }}</td></tr>
      <tr><td class="font-medium">Even Mode Propagation Delay</td><td>{{ format_distributed_value(measurement.even_masked.propagation_delay, "s") }}</td></tr>
      <tr><td class="font-medium">Odd Mode Inductance</td><td>{{ format_distributed_value(measurement.odd_masked.Lh, "H") }}</td></tr>
      <tr><td class="font-medium">Odd Mode Capacitance</td><td>{{ format_distributed_value(measurement.odd_masked.Cih, "F") }}</td></tr>
      <tr><td class="font-medium">Effective Dielectric Constant</td><td>{{ (measurement.effective_er).toFixed(display_precision) }}</td></tr>
    </template>
  </tbody>
</table>
</template>
