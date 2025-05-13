<script setup lang="ts">
import { computed, ref } from "vue";
import { Editor } from "./editor.ts";
import {
  type LayerTemplate,
  layer_templates, layer_descriptor_to_template, layer_template_to_descriptor,
} from "./layer_templates.ts";
import { type TraceLayoutType, trace_layout_types } from "./stackup.ts";
import { StackupViewer } from "./index.ts";
import {
  get_viewer_layout_from_editor,
} from "./stackup_to_viewer_layout.ts";
import {
  get_stackup_parameters_from_stackup,
  get_annotation_config_from_stackup_parameters,
} from "./stackup_parameters.ts";

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
const stackup_parameters = computed(() => {
  return get_stackup_parameters_from_stackup(editor.value);
});
const viewer_layout = computed(() => {
  const annotation_config = get_annotation_config_from_stackup_parameters(editor.value, stackup_parameters.value);
  return get_viewer_layout_from_editor(editor.value, annotation_config);
});

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

</script>

<template>
<h1 class="text-2xl">Stackup Editor</h1>
<div class="flex flex-row gap-x-2">
  <div>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Signal type / Coplanar ground</legend>
      <div class="flex flex-row gap-x-1 items-center">
        <select id="signal_type" v-model="trace_layout_type" class="select select-sm">
          <template v-for="type in trace_layout_types" :key="type">
            <option :value="type" v-if="editor.can_change_trace_layout(type)">{{ trace_layout_type_to_string(type) }}</option>
          </template>
        </select>
        <div>
          <input
            class="checkbox"
            type="checkbox"
            :true-value="true" :false-value="false"
            v-model.number="editor.trace_layout.has_coplanar_ground"
          />
        </div>
      </div>
    </fieldset>
    <div class="bg-base-100 border-base-300 border-sm border-1">
      <template v-if="editor.can_add_above()">
        <div class="add-button" @click="editor.add_layer(0)"></div>
      </template>
      <template v-for="(layer, index) in layers" :key="layer.descriptor.id">
        <div class="flex flex-row px-1 py-1 items-center">
          <b>L{{ index+1 }}:</b>
          <select v-model="layer.template.value" class="w-full min-w-[7rem]">
            <template v-for="template in layer_templates" :key="template">
              <option v-if="layer.can_set_template(template)" :value="template">
                {{ layer_template_to_string(template) }}
              </option>
            </template>
          </select>
          <button class="btn btn-xs btn-outline btn-error ml-1" @click="editor.remove_layer(index)" :disabled="!editor.can_remove_layer(index)">x</button>
        </div>
        <template v-if="editor.can_add_layer_below(index)">
          <div class="add-button" @click="editor.add_layer(index+1)"></div>
        </template>
      </template>
    </div>
  </div>
  <div class="min-w-[25rem] min-h-[5rem] max-w-[100%] max-h-[75vh] overflow-auto">
    <StackupViewer :viewer_layout="viewer_layout"></StackupViewer>
  </div>
</div>

<br>

<h1 class="text-2xl">Parameters</h1>
<form>
  <div class="flex flex-row">
    <table class="table table-xs w-fit">
      <tbody>
        <template v-for="(params, i) in stackup_parameters.layer_parameters" :key="i">
          <template v-for="(param, j) in [params.epsilon, params.height, params.trace_height]" :key="j">
            <template v-if="param">
              <tr>
                <td><label :for="param.label" class="font-medium">{{ param.label }}</label></td>
                <td>
                  <input
                    type="number" class="input validator" step="0.1" required
                    :id="param.label" :placeholder="param.label"
                    v-model.number="param.value" :min="param.min" :max="param.max"
                  />
                </td>
              </tr>
            </template>
          </template>
        </template>
      </tbody>
    </table>
    <table class="table table-xs w-fit h-fit">
      <tbody>
        <template
          v-for="(param, i) in [
            stackup_parameters.trace_parameters.signal_width,
            stackup_parameters.trace_parameters.signal_separation,
            stackup_parameters.trace_parameters.coplanar_width,
            stackup_parameters.trace_parameters.coplanar_separation,
          ]"
          :key="i"
        >
          <template v-if="param">
            <tr>
              <td><label :for="param.label" class="font-medium">{{ param.label }}</label></td>
              <td>
                <input
                  type="number" class="input validator" step="0.1" required
                  :id="param.label" :placeholder="param.label"
                  v-model.number="param.value" :min="param.min" :max="param.max"
                />
              </td>
            </tr>
          </template>
        </template>
        <template v-for="(params, i) in stackup_parameters.layer_parameters" :key="i">
          <template v-for="(param, j) in [params.trace_taper]" :key="j">
            <template v-if="param">
              <tr>
                <td><label :for="param.label" class="font-medium">{{ param.label }}</label></td>
                <td>
                  <input
                    type="number" class="input validator" step="0.1" required
                    :id="param.label" :placeholder="param.label"
                    v-model.number="param.value" :min="param.min" :max="param.max"
                  />
                </td>
              </tr>
            </template>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</form>
</template>

<style scoped>
.add-button {
  height: 0.35rem;
  width: 100%;
  background-color: #99999977;
  cursor: cell;
  padding: none;
  user-select: none;
  margin-top: 0px;
  margin-bottom: 0px;
}

.add-button:hover {
  background-color: #0000bb77;
}
</style>
