<script setup lang="ts">
import { computed, ref } from "vue";
import { Editor } from "./editor.ts";
import {
  type LayerTemplate,
  layer_templates, layer_descriptor_to_template, layer_template_to_descriptor,
} from "./layer_templates.ts";
import { type TraceLayoutType, signal_types } from "./stackup.ts";
import { StackupViewer } from "./index.ts";
import { get_layout_info_from_editor } from "./editor_to_viewer_layout.ts";

function layer_template_to_string(template: LayerTemplate): string {
  switch (template) {
    case "core": return "Core";
    case "prepreg": return "Prepeg";
    case "copper": return "Copper";
    case "soldermask": return "Soldermask";
    case "unmasked": return "Unmasked";
  }
}

function trace_layout_type_to_string(type: TraceLayoutType): string {
  switch (type) {
    case "single_ended": return "Single ended";
    case "coplanar_pair": return "Coplanar pair";
    case "broadside_pair": return "Broadside pair";
  }
}

const editor = ref(new Editor());
const layout_info = computed(() => get_layout_info_from_editor(editor.value));

function handle_layer_type_change(layer_index: number, ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const template = target.value as LayerTemplate;
  const descriptor = layer_template_to_descriptor(layer_index, template);
  editor.value.change_layer_type(layer_index, descriptor);
}

function handle_signal_type_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const type = target.value as TraceLayoutType;
  if (editor.value.trace_layout.type == type) return;
  editor.value.change_trace_layout_type(type);
}

function handle_signal_has_coplanar_ground_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const has_coplanar_ground = target.value == 'false';
  const layout = editor.value.trace_layout;
  layout.has_coplanar_ground = has_coplanar_ground;
}

</script>

<template>

<div class="grid grid-cols-2 gap-x-2 w-fit mb-2">
  <label for="signal_type" class="font-medium">Signal type</label>
  <select id="signal_type" :value="editor.trace_layout.type" @change="ev => handle_signal_type_change(ev)">
    <template v-for="type in signal_types" :key="type">
      <option :value="type" v-if="editor.can_change_trace_layout(type)">{{ trace_layout_type_to_string(type) }}</option>
    </template>
  </select>
  <label for="has_coplanar_ground" class="font-medium">Coplanar ground</label>
  <input
    type="checkbox"
    :true-value="true" :false-value="false"
    :value="editor.trace_layout.has_coplanar_ground"
    @change="ev => handle_signal_has_coplanar_ground_change(ev)"/>
</div>

<table>
  <tbody>
    <tr v-if="editor.can_add_above()">
      <td colspan=2><div class="add-button col-span-3" @click="editor.add_layer(0)"></div></td>
    </tr>
    <template v-for="(layer, index) in editor.layers" :key="layer.id">
      <tr>
        <td class="flex flex-row px-1">
          <b>L{{ index+1 }}:</b>
          <select :value="layer_descriptor_to_template(layer)" @change="ev => handle_layer_type_change(index, ev)" class="w-full">
            <template v-for="template in layer_templates" :key="template">
              <option v-if="editor.can_change_layer_type(index, layer_template_to_descriptor(index, template))" :value="template">
                {{ layer_template_to_string(template) }}
              </option>
            </template>
          </select>
        </td>
        <td class="px-1">
          <button @click="editor.remove_layer(index)" :disabled="!editor.can_remove_layer(index)">x</button>
        </td>
      </tr>
      <tr v-if="editor.can_add_layer_below(index)">
        <td colspan=2><div class="add-button col-span-3" @click="editor.add_layer(index+1)"></div></td>
      </tr>
    </template>
  </tbody>
</table>

<div class="min-w-[15rem] min-h-[5rem] max-w-[50%] max-h-[50vh] overflow-auto">
  <StackupViewer :layout_info="layout_info"></StackupViewer>
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
