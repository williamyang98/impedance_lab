<script setup lang="ts">
import { ref } from "vue";
import {
  Builder, type SignalType, type LayerType,
  layer_types,
} from "./stackup.ts";
import { default as CrossSection } from "./CrossSection.vue";

function layer_type_to_string(type: LayerType): string {
  switch (type) {
  case "air": return "Unmasked";
  case "soldermask": return "Soldermask";
  case "copper": return "Copper";
  case "dielectric": return "Dielectric";
  }
}

const builder = ref(new Builder());
function handle_layer_type_change(layer_index: number, ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const type = target.value as LayerType;
  builder.value.set_layer_type(layer_index, type);
}

function handle_signal_type_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const type = target.value as SignalType;
  if (builder.value.signal.type == type) return;
  builder.value.set_signal_type(type);
}

function handle_signal_has_coplanar_ground_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const has_coplanar_ground = target.value == 'false';
  builder.value.set_signal_has_coplanar_ground(has_coplanar_ground);
}

</script>

<template>
<div class="grid grid-cols-2 gap-x-2 w-fit mb-2">
  <label for="signal_type" class="font-medium">Signal type</label>
  <select id="signal_type" :value="builder.signal.type" @change="ev => handle_signal_type_change(ev)">
    <option :value="'single'">Single Ended</option>
    <option :value="'coplanar_pair'">Coplanar Pair</option>
    <option :value="'broadside_pair'" v-if="builder.get_broadside_pair_possible_locations().length >= 2">Broadside Pair</option>
  </select>
  <template v-if="builder.signal.type != 'broadside_pair'">
    <label for="has_coplanar_ground" class="font-medium">Coplanar ground</label>
    <input
      type="checkbox"
      :true-value="true" :false-value="false"
      :value="builder.signal.has_coplanar_ground"
      @change="ev => handle_signal_has_coplanar_ground_change(ev)"/>
  </template>
</div>

<table class="min-w-[10rem]">
  <tbody>
    <tr v-if="builder.can_add_above()">
      <td colspan=3><div class="add-button col-span-3" @click="builder.add_layer(0)"></div></td>
    </tr>
    <template v-for="(layer, index) in builder.layers" :key="layer.id">
      <tr>
        <td class="flex flex-row px-1">
          <b>L{{ index+1 }}:</b>
          <select :value="layer.type" @change="ev => handle_layer_type_change(index, ev)" class="w-full">
            <template v-for="type in layer_types" :key="type">
              <option v-if="builder.is_valid_layer_type(index, type)" :value="type">
                {{ layer_type_to_string(type) }}
              </option>
            </template>
          </select>
        </td>
        <td>
          <CrossSection :builder="builder" :layer="layer" :index="index"></CrossSection>
        </td>
        <td class="px-1">
          <button @click="builder.remove_layer(index)" :disabled="!builder.can_remove_layer(index)">x</button>
        </td>
      </tr>
      <tr v-if="builder.can_add_layer_below(index)">
        <td colspan=3><div class="add-button col-span-3" @click="builder.add_layer(index+1)"></div></td>
      </tr>
    </template>
  </tbody>
</table>

<div class="grid grid-cols-[auto_auto_auto] gap-x-2 w-fit">

</div>
</template>

<style scoped>

button {
  background-color: whitesmoke;
  border: 1px solid black;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
  user-select: none;
}

button[disabled] {
  opacity: 0.2;
}

.add-button {
  height: 0.35rem;
  width: 100%;
  background-color: #99999977;
  cursor: cell;
  padding: none;
  user-select: none;
  margin-top: 1px;
  margin-bottom: 1px;
}

.add-button:hover {
  background-color: #0000bb77;
}
</style>
