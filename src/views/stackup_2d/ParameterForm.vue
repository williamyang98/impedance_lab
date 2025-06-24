<script setup lang="ts">
import {
  type Stackup,
  type Parameter,
  type LayerId,
} from "./stackup.ts";
import { defineProps, defineEmits, computed } from "vue";
import { TriangleAlert, SearchIcon, InfoIcon } from "lucide-vue-next";

const props = defineProps<{
  stackup: Stackup,
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
  layer_dielectric_height_params = new Set<Parameter>();
  layer_dielectric_epsilon_params = new Set<Parameter>();
  layer_trace_height_params = new Set<Parameter>();
  layer_trace_taper_params = new Set<Parameter>();
  trace_width_params = new Set<Parameter>();
  spacing_params = new Set<Parameter>();

  constructor(stackup: Stackup) {
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
            this.layer_dielectric_height_params.add(layer.height);
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
            this.layer_trace_taper_params.add(layer.trace_taper);
          }
          break;
        }
        case "unmasked": // @fallthrough
        case "soldermask": {
          if (layers_with_traces.has(layer.id)) {
            this.layer_trace_taper_params.add(layer.trace_taper);
            this.layer_trace_height_params.add(layer.trace_height);
          }
          break;
        }
      }
    }
  }

  get_layout(): FormFields[][] {
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
      "Dielectric Height",
      "Height of stackup layer",
      this.layer_dielectric_height_params,
    );
    create_form_fields(
      "Dielectric Constant",
      "Relative permittivity of dielectric in stackup layer",
      this.layer_dielectric_epsilon_params,
    );
    create_form_fields(
      "Trace Height",
      "Height of copper in stackup layer",
      this.layer_trace_height_params,
    );
    push_row();

    create_form_fields(
      "Trace Width",
      "Width of transmission line trace",
      this.trace_width_params,
    );
    create_form_fields(
      "Trace Taper",
      "Taper of trace in a specific stackup layer",
      this.layer_trace_taper_params,
    );
    create_form_fields(
      "Spacing",
      "Separation between transmission line traces",
      this.spacing_params,
    );
    push_row();

    return column;
  }
}

const form = computed(() => new Form(props.stackup));

function get_input_class(param: Parameter): string {
  if (param.error !== undefined) {
    return "input-error";
  }
  if (param.old_value != param.value) {
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
<form :class="`grid grid-cols-2 gap-x-5`" @submit="on_submit">
  <div
    v-for="(col, col_index) in form.get_layout()" :key="col_index"
    class="w-full"
  >
    <div v-for="(row, row_index) in col" :key="row_index" class="mb-4">
      <div class="flex flex-row justify-between mb-2">
        <div class="flex flex-row gap-x-1 items-center">
          <h2 class="font-medium">{{ row.name }}</h2>
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
          <div class="w-full">
            <div class="flex flex-row join">
              <input
                :id="param.name"
                :class="get_input_class(param)"
                class="input join-item"
                type="number"
                step="any"
                :min="param.min" :max="param.max" v-model.number="param.value"
                :placeholder="param.description"
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
            <div v-if="param.error" class="text-error text-xs flex flex-row py-1 w-full">
              <TriangleAlert class="h-[1rem] w-[1rem] mr-1"/>
              <span>{{ param.error }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
  <!--Make form submit on enter (https://stackoverflow.com/a/477699)-->
  <input type="submit" hidden/>
</form>

</template>
