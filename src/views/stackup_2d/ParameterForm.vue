<script setup lang="ts">
import { defineProps, defineEmits, computed } from "vue";
import { TriangleAlert, SearchIcon, InfoIcon } from "lucide-vue-next";
import {
  type Stackup,
  type Parameter, type SizeParameter, type EtchFactorParameter, type EpsilonParameter,
  type LayerId,
} from "./stackup.ts";
import { StackupEditor } from "./editor.ts";

const props = defineProps<{
  editor: StackupEditor,
}>();

const emits = defineEmits<{
  search: [parameters: Parameter[]],
  submit: [],
}>();

interface FormFields {
  name: string;
  description: string;
  parameters: Set<Parameter>;
  has_group_search: boolean;
}

function set_to_array<T>(set: Set<T>): T[] {
  return Array.from(set.values());
}

function get_total_searchable_parameters(params: Set<Parameter>): number {
  let total = 0;
  for (const param of params) {
    if (param.impedance_correlation !== undefined) {
      total += 1;
    }
  }
  return total;
}

class Form {
  soldermask_height_params = new Set<SizeParameter>();
  layer_dielectric_height_params = new Set<SizeParameter>();
  layer_dielectric_epsilon_params = new Set<EpsilonParameter>();
  layer_trace_height_params = new Set<SizeParameter>();
  layer_etch_factor_params = new Set<EtchFactorParameter>();
  trace_width_params = new Set<SizeParameter>();
  spacing_params = new Set<SizeParameter>();
  editor: StackupEditor;
  stackup: Stackup;

  constructor(editor: StackupEditor) {
    this.editor = editor;
    const stackup = editor.get_simulation_stackup();
    this.stackup = stackup;

    for (const trace of stackup.conductors.filter(conductor => conductor.type == "trace")) {
      this.trace_width_params.add(trace.width);
    }

    for (const spacing of stackup.spacings) {
      this.spacing_params.add(spacing.width);
    }

    // hide certain parameters base on presence or absence of trace or plane conductor
    const layers_with_traces: Set<LayerId> = new Set();
    const layers_with_plane: Set<LayerId> = new Set();
    for (const conductor of stackup.conductors) {
      switch (conductor.type) {
        case "trace": {
          layers_with_traces.add(conductor.position.layer_id);
          break;
        }
        case "plane": {
          layers_with_plane.add(conductor.position.layer_id);
          break;
        }
      }
    }

    for (const layer of stackup.layers) {
      switch (layer.type) {
        case "unmasked": break;
        case "core": // @fallthrough
        case "prepreg": {
          this.layer_dielectric_height_params.add(layer.height);
          this.layer_dielectric_epsilon_params.add(layer.epsilon);
          break;
        }
        case "soldermask": {
          if (!layers_with_plane.has(layer.id)) {
            this.soldermask_height_params.add(layer.height);
            this.layer_dielectric_epsilon_params.add(layer.epsilon);
          }
          break;
        }
      }
    }

    for (const layer of stackup.layers) {
      switch (layer.type) {
        case "core": break;
        case "prepreg": {
          this.layer_trace_height_params.add(layer.trace_height);
          if (layers_with_traces.has(layer.id)) {
            this.layer_etch_factor_params.add(layer.etch_factor);
          }
          break;
        }
        case "unmasked": // @fallthrough
        case "soldermask": {
          if (layers_with_traces.has(layer.id)) {
            this.layer_etch_factor_params.add(layer.etch_factor);
            this.layer_trace_height_params.add(layer.trace_height);
          }
          break;
        }
      }
    }
  }

  get_layout(): FormFields[][] {
    const parameters = this.editor.parameters;

    const column: FormFields[][] = [];
    let row: FormFields[] = [];
    const push_row = () => {
      column.push(row);
      row = [];
    };
    const create_form_fields = (name: string, description: string, parameters: Set<Parameter>) => {
      if (parameters.size <= 0) return;
      const field: FormFields = {
        name,
        description,
        parameters,
        has_group_search: get_total_searchable_parameters(parameters) > 1,
      };
      row.push(field);
    };

    create_form_fields(
      `Soldermask Height (${parameters.size_unit})`,
      "Height of soldermask",
      this.soldermask_height_params,
    );
    create_form_fields(
      `Inner Layer Height (${parameters.size_unit})`,
      "Height of inner stackup layer",
      this.layer_dielectric_height_params,
    );
    create_form_fields(
      "Dielectric Constant",
      "Relative permittivity of layer dielectric",
      this.layer_dielectric_epsilon_params,
    );
    push_row();

    create_form_fields(
      `Trace Width (${parameters.size_unit})`,
      "Width of transmission line trace",
      this.trace_width_params,
    );
    create_form_fields(
      `Spacing (${parameters.size_unit})`,
      "Separation between transmission line traces",
      this.spacing_params,
    );
    create_form_fields(
      `Trace Height (${parameters.copper_thickness_unit})`,
      "Height of copper layer",
      this.layer_trace_height_params,
    );
    create_form_fields(
      "Etch Factor",
      "Ratio of copper height that is etched away from both sides of a signal trace (dWi=2*EFi*Ti)",
      this.layer_etch_factor_params,
    );
    push_row();

    return column;
  }
}

const form = computed(() => new Form(props.editor));
const parameters = computed(() => props.editor.parameters);

function is_parameter_changed(param: Parameter): boolean {
  switch (param.type) {
    case "epsilon": return param.old_value !== param.value;
    case "etch_factor": return param.old_value !== param.value;
    case "size": {
      if (param.old_value !== param.value) return true;
      if (param.old_unit !== param.unit) return true;
      return false;
    }
  }
}

function get_input_class(param: Parameter): string {
  if (param.error !== undefined) {
    return "input-error";
  }
  if (is_parameter_changed(param)) {
    return "input-warning";
  }
  return "";
}

function on_submit(ev: Event) {
  ev.preventDefault();
  emits("submit");
}

function on_search(ev: MouseEvent, params: Parameter[]) {
  ev.preventDefault();
  emits("search", params);
}

</script>

<template>
<form class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2" @submit="on_submit">
  <!--Select units-->
  <fieldset class="fieldset text-sm">
    <legend class="fieldset-legend">Size Unit</legend>
    <select class="select w-full" v-model="parameters.size_unit" required>
      <option v-for="unit in parameters.size_unit_options" :value="unit" :key="unit">
        {{ unit }}
      </option>
    </select>
  </fieldset>
  <fieldset class="fieldset text-sm">
    <legend class="fieldset-legend">Copper Pour Unit</legend>
    <select class="select w-full" v-model="parameters.copper_thickness_unit" required>
      <option v-for="unit in parameters.copper_thickness_unit_options" :value="unit" :key="unit">
        {{ unit }}
      </option>
    </select>
  </fieldset>
  <!--Set values-->
  <div
    v-for="(col, col_index) in form.get_layout()" :key="col_index"
    class="w-full"
  >
    <div v-for="(row, row_index) in col" :key="row_index" class="mb-4">
      <div class="flex flex-row justify-between mb-2">
        <div class="flex flex-row gap-x-1 items-center mr-1">
          <span class="font-medium">{{ row.name }}</span>
          <div class="tooltip tooltip-bottom" :data-tip="row.description">
            <InfoIcon class="w-[1rem] h-[1rem] cursor-help"/>
          </div>
        </div>
        <template v-if="row.has_group_search">
          <button
            class="btn btn-sm btn-primary px-2"
            @click="(ev) => on_search(ev, set_to_array(row.parameters))"
            type="button"
          >
            <SearchIcon class="h-[1rem] w-[1rem]"/>
          </button>
        </template>
      </div>
      <div class="grid grid-cols-[2rem_auto] w-full gap-x-2 gap-y-1">
        <template v-for="(param, param_index) in row.parameters" :key="param_index">
          <div class="h-full flex flex-col justify-center">
            <label :for="param.name" class="label">{{  param.name }}</label>
          </div>
          <div class="flex flex-row join">
            <input
              :id="param.name"
              :class="get_input_class(param)"
              class="input w-full join-item"
              type="number"
              step="any"
              :min="param.min" :max="param.max" v-model.number="param.value"
              :placeholder="param.description"
              required
            />
            <template v-if="param.impedance_correlation !== undefined">
              <button
                class="btn join-item px-2"
                @click="(ev) => on_search(ev, [param])"
                type="button"
              >
                <SearchIcon class="h-[1rem] w-[1rem]"/>
              </button>
            </template>
          </div>
          <template v-if="param.error">
            <div></div>
            <div class="text-error text-xs flex flex-row py-1 w-full">
              <TriangleAlert class="h-[1rem] w-[1rem] mr-1"/>
              <span>{{ param.error }}</span>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
  <!--Make form submit on enter (https://stackoverflow.com/a/477699)-->
  <input type="submit" hidden/>
</form>

</template>
