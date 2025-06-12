<script setup lang="ts">
import { type Measurement } from "./measurement";
import { defineProps } from "vue";

const _props = defineProps<{
  measurement: Measurement,
}>();

</script>

<template>
<table class="table w-full">
  <tbody>
    <template v-if="measurement.type == 'single'">
      <tr><td class="font-medium">Type</td><td>Single Ended</td></tr>
      <tr>
        <td class="font-medium">
          {{ `${(measurement.unmasked ? 'Masked ' : '') + 'Impedance'}` }}
        </td>
        <td>{{ measurement.masked.Z0.toPrecision(3) }} Ω</td>
      </tr>
      <tr v-if="measurement.unmasked">
        <td class="font-medium">Unmasked Impedance</td>
        <td>{{ measurement.unmasked.Z0.toPrecision(3) }} Ω</td>
      </tr>
      <tr><td class="font-medium">Propagation Delay</td><td>{{ (measurement.masked.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
      <tr><td class="font-medium">Inductance</td><td>{{ (measurement.masked.Lh*1e9/1e2).toPrecision(3) }} nH/cm</td></tr>
      <tr><td class="font-medium">Capacitance</td><td>{{ (measurement.masked.Cih*1e12/1e2).toPrecision(3) }} pF/cm</td></tr>
    </template>
    <template v-if="measurement.type == 'differential'">
      <tr><td class="font-medium">Type</td><td>Differential</td></tr>
      <tr>
        <td class="font-medium">
          {{ `${(measurement.odd_unmasked ? 'Masked ' : '') + 'Diff Impedance'}` }}
        </td>
        <td>{{ measurement.odd_masked.Z0.toPrecision(3) }} Ω</td>
      </tr>
      <tr v-if="measurement.odd_unmasked">
        <td class="font-medium">Unmasked Diff Impedance</td>
        <td>{{ measurement.odd_unmasked.Z0.toPrecision(3) }} Ω</td>
      </tr>
      <tr><td class="font-medium">Coupling Coefficient</td><td>{{ (measurement.coupling_factor*100).toPrecision(3) }} %</td></tr>
      <tr><td class="font-medium">Odd Mode Impedance</td><td>{{ (measurement.odd_masked.Z0/2).toPrecision(3) }} Ω</td></tr>
      <tr><td class="font-medium">Even Mode Impedance</td><td>{{ (measurement.even_masked.Z0/2).toPrecision(3) }} Ω</td></tr>
      <tr><td class="font-medium">Even Mode Propagation Delay</td><td>{{ (measurement.even_masked.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
      <tr><td class="font-medium">Odd Mode Propagation Delay</td><td>{{ (measurement.odd_masked.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
    </template>
  </tbody>
</table>
</template>
