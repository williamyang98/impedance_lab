<script setup lang="ts">
import { computed, ref } from "vue";
import { Editor } from "./editor.ts";
import {
  type LayerTemplate,
  layer_templates, layer_descriptor_to_template, layer_template_to_descriptor,
} from "./layer_templates.ts";
import { type TraceLayoutType, type Stackup, trace_layout_types } from "./stackup.ts";
import { StackupViewer } from "./index.ts";
import {
  get_viewer_layout_from_editor,
  get_viewer_layout_from_stackup,
  get_default_annotation_config,
} from "./stackup_to_viewer_layout.ts";

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
const annotation_config = get_default_annotation_config();
const viewer_layout = computed(() => get_viewer_layout_from_editor(editor.value, annotation_config));

const trace_layout_type = computed<TraceLayoutType>({
  get() {
    return editor.value.trace_layout.type;
  },
  set(type) {
    editor.value.change_trace_layout_type(type);
  }
});

const layers = computed(() => editor.value.layers.map((layer, layer_index) => {
  return {
    template: computed<LayerTemplate>({
      get() {
        const layer = editor.value.layers[layer_index];
        return layer_descriptor_to_template(layer);
      },
      set(template) {
        const descriptor = layer_template_to_descriptor(layer_index, template);
        editor.value.change_layer_type(layer_index, descriptor);
      }
    }),
    descriptor: layer,
    can_set_template(template: LayerTemplate): boolean {
      const descriptor = layer_template_to_descriptor(layer_index, template);
      return editor.value.can_change_layer_type(layer_index, descriptor);
    },
  }
}));

function create_basic_stackup(): Stackup {
  const stackup: Stackup = {
    trace_layout: {
      type: "coplanar_pair",
      has_coplanar_ground: true,
      position: {
        layer_id: 0,
        alignment: "bottom",
      },
    },
    layers: [
      {
        id: 0,
        type: "surface",
        trace_alignment: "bottom",
        has_soldermask: true,
      },
      {
        id: 1,
        type: "inner",
        trace_alignments: new Set(["top"]),
      },
      {
        id: 2,
        type: "copper",
      },
    ],
  }

  return stackup;
}

const basic_stackup = create_basic_stackup();
const basic_viewer_layout = get_viewer_layout_from_stackup(basic_stackup, annotation_config);

</script>

<template>
<div class="flex flex-row gap-x-2">
  <div>
    <div class="grid grid-cols-2 gap-x-2 w-fit mb-2">
      <label for="signal_type" class="font-medium">Signal type</label>
      <select id="signal_type" v-model="trace_layout_type">
        <template v-for="type in trace_layout_types" :key="type">
          <option :value="type" v-if="editor.can_change_trace_layout(type)">{{ trace_layout_type_to_string(type) }}</option>
        </template>
      </select>
      <label for="has_coplanar_ground" class="font-medium">Coplanar ground</label>
      <input
        type="checkbox"
        :true-value="true" :false-value="false"
        v-model.number="editor.trace_layout.has_coplanar_ground"
      />
    </div>
    <table>
      <tbody>
        <tr v-if="editor.can_add_above()">
          <td colspan=2><div class="add-button col-span-3" @click="editor.add_layer(0)"></div></td>
        </tr>
        <template v-for="(layer, index) in layers" :key="layer.descriptor.id">
          <tr>
            <td class="flex flex-row px-1">
              <b>L{{ index+1 }}:</b>
              <select v-model="layer.template.value" class="w-full">
                <template v-for="template in layer_templates" :key="template">
                  <option v-if="layer.can_set_template(template)" :value="template">
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
  </div>
  <div class="min-w-[25rem] min-h-[5rem] max-w-[100%] max-h-[75vh] overflow-auto">
    <StackupViewer :viewer_layout="viewer_layout"></StackupViewer>
  </div>
</div>

<div class="max-w-[50%] mt-3">
  <StackupViewer :viewer_layout="basic_viewer_layout"></StackupViewer>
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
