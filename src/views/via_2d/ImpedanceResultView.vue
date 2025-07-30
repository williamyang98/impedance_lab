<script setup lang="ts">
import { defineProps } from "vue";
import { type ImpedanceResult } from "./impedance.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";

const _props = defineProps<{
  result: ImpedanceResult,
}>();

</script>

<template>
<table class="table table-compact" :class="$attrs.class">
  <col class="w-fit">
  <tbody>
    <tr>
      <td class="font-medium">Z0</td>
      <td>{{ with_standard_suffix(result.Z0, "Ω", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">Capacitance</td>
      <td>{{ with_standard_suffix(result.Cih, "F", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">Inductance</td>
      <td>{{ with_standard_suffix(result.Lh, "H", 4) }}</td>
    </tr>
    <!-- <tr>
      <td class="font-medium">Energy homogenous</td>
      <td>{{ with_standard_suffix(result.energy_homogenous, "J", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">Energy inhomogenous</td>
      <td>{{ with_standard_suffix(result.energy_inhomogenous, "J", 4) }}</td>
    </tr> -->
    <tr>
      <td class="font-medium">Propagation Delay</td>
      <td>{{ with_standard_suffix(result.propagation_delay, "s", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">Resonant Frequency</td>
      <td>{{ with_standard_suffix(result.resonant_frequency, "Hz", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">DC Resistance</td>
      <td>{{ with_standard_suffix(result.dc_resistance, "Ω", 4) }}</td>
    </tr>
    <tr>
      <td class="font-medium">Effective Er</td>
      <td>{{ result.effective_er.toFixed(3) }}</td>
    </tr>
  </tbody>
</table>
</template>
