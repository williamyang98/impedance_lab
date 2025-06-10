<script setup lang="ts">
import { type TransmissionLineMeasurement } from "./measurement";
import { defineProps } from "vue";

const _props = defineProps<{
  measurement: TransmissionLineMeasurement,
}>();

</script>

<template>
<table class="table w-full">
  <tbody>
    <template v-if="measurement.type == 'single'">
      <tr><td class="label">Type</td><td>Single Ended</td></tr>
      <tr><td class="label">Masked Impedance</td><td>{{ measurement.masked.impedance.Z0.toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Unmasked Impedance</td><td>{{ measurement.unmasked.impedance.Z0.toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Propagation Delay</td><td>{{ (measurement.unmasked.impedance.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
      <tr><td class="label">Inductance</td><td>{{ (measurement.unmasked.impedance.Lh*1e9/1e2).toPrecision(3) }} nH/cm</td></tr>
      <tr><td class="label">Capacitance</td><td>{{ (measurement.unmasked.impedance.Cih*1e12/1e2).toPrecision(3) }} pF/cm</td></tr>
    </template>
    <template v-if="measurement.type == 'differential'">
      <tr><td class="label">Type</td><td>Differential</td></tr>
      <tr><td class="label">Diff Masked Impedance</td><td>{{ measurement.odd_masked.impedance.Z0.toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Diff Unmasked Impedance</td><td>{{ measurement.odd_unmasked.impedance.Z0.toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Coupling Coefficient</td><td>{{ (measurement.coupling_factor*100).toPrecision(3) }} %</td></tr>
      <tr><td class="label">Odd Mode Impedance</td><td>{{ (measurement.odd_masked.impedance.Z0/2).toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Even Mode Impedance</td><td>{{ (measurement.even_masked.impedance.Z0/2).toPrecision(3) }} Ω</td></tr>
      <tr><td class="label">Even Mode Propagation Delay</td><td>{{ (measurement.even_masked.impedance.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
      <tr><td class="label">Odd Mode Propagation Delay</td><td>{{ (measurement.odd_masked.impedance.propagation_delay*1e12/1e2).toPrecision(3) }} ps/cm</td></tr>
    </template>
  </tbody>
</table>
</template>
