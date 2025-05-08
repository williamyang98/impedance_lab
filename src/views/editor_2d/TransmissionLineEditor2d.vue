<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Editor, type SignalType, type LayerType, type SignalTrace, type TraceAlignment,
  layer_types,
} from "./editor.ts";

import { StackupViewer } from "./index.ts";
import { type LayoutInfo, type LayoutElement, type LayerInfo, type TraceInfo } from "./layout.ts";

function layer_type_to_string(type: LayerType): string {
  switch (type) {
  case "air": return "Unmasked";
  case "soldermask": return "Soldermask";
  case "copper": return "Copper";
  case "dielectric": return "Dielectric";
  }
}

const editor = ref(new Editor());
function handle_layer_type_change(layer_index: number, ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const type = target.value as LayerType;
  editor.value.set_layer_type(layer_index, type);
}

function handle_signal_type_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const type = target.value as SignalType;
  if (editor.value.signal.type == type) return;
  editor.value.set_signal_type(type);
}

function handle_signal_has_coplanar_ground_change(ev: Event) {
  ev.preventDefault();
  const target = ev.target as (HTMLSelectElement | null);
  if (target === null) return;
  const has_coplanar_ground = target.value == 'false';
  editor.value.set_signal_has_coplanar_ground(has_coplanar_ground);
}

function get_layout_elements(signal: SignalTrace): LayoutElement[] {
  let elements: LayoutElement[] = [];
  let has_coplanar_ground: boolean = false;
  switch (signal.type) {
    case "coplanar_pair": {
      elements = [
        { type: "trace", trace: "signal" },
        { type: "spacing", separation: "signal" },
        { type: "trace", trace: "signal" },
      ];
      has_coplanar_ground = signal.has_coplanar_ground;
      break;
    }
    case "single": {
      elements = [
        { type: "trace", trace: "signal" },
      ];
      has_coplanar_ground = signal.has_coplanar_ground;
      break;
    }
    case "broadside_pair": {
      elements = [
        { type: "trace", trace: "signal" },
        { type: "spacing", separation: "signal" },
        { type: "trace", trace: "signal" },
      ];
      break;
    }
  }
  if (has_coplanar_ground) {
    elements = [
      { type: "trace", trace: "ground" },
      { type: "spacing", separation: "ground" },
        ...elements,
      { type: "spacing", separation: "ground" },
      { type: "trace", trace: "ground" },
    ]
  }
  return elements;
}

function create_layout_info_from_editor(e: Editor): LayoutInfo {
  const signal = e.signal;
  const layout_elements = get_layout_elements(signal);

  const total_traces = layout_elements.filter(e => e.type == "trace").length;
  const is_broadside = signal.type == "broadside_pair";
  const is_signal_present = (row_index: number, column_index: number, alignment: TraceAlignment): boolean => {
    if (is_broadside) {
      const is_left = column_index < total_traces/2;
      return e.is_broadside_signal_in_layer(row_index, alignment, is_left);
    } else {
      return e.is_signal_in_layer(row_index, alignment);
    }
  };

  const can_place_signal_here = (row_index: number, column_index: number, alignment: TraceAlignment): boolean => {
    return e.is_valid_signal_alignment(row_index, alignment);
  };

  const place_signal_here = (row_index: number, column_index: number, alignment: TraceAlignment) => {
    if (is_broadside) {
      const is_left = column_index < total_traces/2;
      e.move_broadside_signal(row_index, alignment, is_left);
    } else {
      e.move_single_layer_signal(row_index, alignment);
    }
  };

  const total_layers = e.layers.length;
  const layer_infos: LayerInfo[] = [];
  const column_indices = [];
  for (let i = 0; i < total_traces; i++) {
    column_indices.push(i);
  }

  const create_trace = (row_index: number, column_index: number, alignment: TraceAlignment): TraceInfo => {
    if (is_signal_present(row_index, column_index, alignment)) {
      return { type: "solid" };
    }
    if (can_place_signal_here(row_index, column_index, alignment)) {
      return {
        type: "selectable",
        on_click: () => place_signal_here(row_index, column_index, alignment),
      }
    }
    return null;
  };

  for (let i = 0; i < total_layers; i++) {
    const layer = e.layers[i];
    switch (layer.type) {
      case "copper": {
        layer_infos.push({ type: "copper" });
        break;
      }
      case "air": // @fallthrough
      case "soldermask": {
        const alignment: TraceAlignment = (i == 0) ? "bottom" : "top";
        const has_soldermask = layer.type == "soldermask";
        layer_infos.push({
          type: "surface",
          has_soldermask,
          alignment,
          traces: column_indices.map(j => create_trace(i, j, alignment)),
        })
        break;
      }
      case "dielectric": {
        layer_infos.push({
          type: "inner",
          traces: {
            top: column_indices.map(j => create_trace(i, j, "top")),
            bottom: column_indices.map(j => create_trace(i, j, "bottom")),
          }
        });
        break;
      }
    }
  }

  return {
    elements: layout_elements,
    layers: layer_infos,
  };
}

const layout_info = computed<LayoutInfo>(() => create_layout_info_from_editor(editor.value));

</script>

<template>

<div class="grid grid-cols-2 gap-x-2 w-fit mb-2">
  <label for="signal_type" class="font-medium">Signal type</label>
  <select id="signal_type" :value="editor.signal.type" @change="ev => handle_signal_type_change(ev)">
    <option :value="'single'">Single Ended</option>
    <option :value="'coplanar_pair'">Coplanar Pair</option>
    <option :value="'broadside_pair'" v-if="editor.get_broadside_pair_possible_locations().length >= 2">Broadside Pair</option>
  </select>
  <template v-if="editor.signal.type != 'broadside_pair'">
    <label for="has_coplanar_ground" class="font-medium">Coplanar ground</label>
    <input
      type="checkbox"
      :true-value="true" :false-value="false"
      :value="editor.signal.has_coplanar_ground"
      @change="ev => handle_signal_has_coplanar_ground_change(ev)"/>
  </template>
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
          <select :value="layer.type" @change="ev => handle_layer_type_change(index, ev)" class="w-full">
            <template v-for="type in layer_types" :key="type">
              <option v-if="editor.is_valid_layer_type(index, type)" :value="type">
                {{ layer_type_to_string(type) }}
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
