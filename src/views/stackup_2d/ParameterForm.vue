<script setup lang="ts">
import { defineProps, defineEmits, computed, watch } from "vue";
import { TriangleAlert, SearchIcon, InfoIcon } from "lucide-vue-next";
import {
  type Stackup,
  type Parameter, type SizeParameter, type EtchFactorParameter, type EpsilonParameter,
  type BroadsidePair,
} from "./stackup.ts";
import { providers } from "../../providers/providers.ts";

const user_data = providers.user_data;

const props = defineProps<{
  stackup: Stackup,
}>();

const stackup = computed(() => props.stackup);

const emits = defineEmits<{
  search: [parameters: Parameter[]],
  submit: [],
}>();

interface FormFields {
  name: string;
  description: string;
  parameters: Parameter[];
  has_group_search: boolean;
}

function get_total_searchable_parameters(params: Parameter[]): number {
  let total = 0;
  for (const param of params) {
    if (param.impedance_correlation !== undefined) {
      total += 1;
    }
  }
  return total;
}

class Form {
  soldermask_height_params = new Array<SizeParameter>();
  layer_dielectric_height_params = new Array<SizeParameter>();
  layer_dielectric_epsilon_params = new Array<EpsilonParameter>();
  layer_trace_height_params = new Array<SizeParameter>();
  layer_etch_factor_params = new Array<EtchFactorParameter>();
  trace_width_params = new Array<SizeParameter>();
  spacing_params = new Array<SizeParameter>();
  stackup: Stackup;

  constructor(stackup: Stackup) {
    this.stackup = stackup;

    for (const layer of stackup.layers) {
      switch (layer.type) {
        case "surface": {
          if (layer.has_soldermask) {
            this.soldermask_height_params.push(layer.soldermask_height);
            this.layer_dielectric_epsilon_params.push(layer.epsilon);
          }
          if (layer.has_traces) {
            this.layer_etch_factor_params.push(layer.etch_factor);
            this.layer_trace_height_params.push(layer.trace_height);
          }
          break;
        }
        case "inner": {
          this.layer_dielectric_height_params.push(layer.dielectric_height);
          this.layer_dielectric_epsilon_params.push(layer.epsilon);
          if (layer.has_traces.top || layer.has_traces.bottom) {
            this.layer_etch_factor_params.push(layer.etch_factor);
            this.layer_trace_height_params.push(layer.trace_height);
          }
          break;
        }
      }
    }

    const trace_width_params = new Set<SizeParameter>();
    const spacing_params = new Set<SizeParameter>();
    const push_trace_width = (width: SizeParameter) => {
      if (!trace_width_params.has(width)) return;
      this.trace_width_params.push(width);
    };
    const push_spacing = (spacing: SizeParameter) => {
      if (!spacing_params.has(spacing)) return;
      this.spacing_params.push(spacing);
    };

    switch (stackup.type) {
      case "colinear": {
        const layout = stackup.trace_layout;
        for (const trace of layout.traces) {
          trace_width_params.add(trace.width);
        }
        for (const spacing of layout.spacings) {
          spacing_params.add(spacing.width);
        }
        push_trace_width(stackup.trace_width);
        push_trace_width(stackup.coplanar_width);
        push_spacing(stackup.trace_spacing.width);
        push_spacing(stackup.coplanar_spacing.width);
        break;
      }
      case "broadside": {
        const layout = stackup.trace_layout;
        const add_params = (pair: BroadsidePair) => {
          const pair_layout = layout[pair];
          for (const trace of pair_layout.traces) {
            trace_width_params.add(trace.width);
          }
          for (const spacing of pair_layout.spacings) {
            spacing_params.add(spacing.width);
          }
        }
        add_params("left");
        add_params("right");
        push_trace_width(stackup.trace_width);
        push_trace_width(stackup.coplanar_width);
        push_spacing(stackup.trace_spacing.width);
        push_spacing(stackup.coplanar_spacing.width);
        this.spacing_params.push(stackup.broadside_spacing);
        break;
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
    const create_form_fields = (name: string, description: string, parameters: Parameter[]) => {
      if (parameters.length <= 0) return;
      const field: FormFields = {
        name,
        description,
        parameters,
        has_group_search: get_total_searchable_parameters(parameters) > 1,
      };
      row.push(field);
    };

    create_form_fields(
      `Soldermask Height (${this.soldermask_height_params.at(0)?.unit})`,
      "Height of soldermask",
      this.soldermask_height_params,
    );
    create_form_fields(
      `Inner Layer Height (${this.layer_dielectric_height_params.at(0)?.unit})`,
      "Height of inner stackup layer",
      this.layer_dielectric_height_params,
    );
    create_form_fields(
      "Dielectric Constant",
      "Relative permittivity of layer dielectric",
      this.layer_dielectric_epsilon_params,
    );
    create_form_fields(
      "Etch Factor",
      "Ratio of copper height that is etched away from both sides of a signal trace (dWi=2*EFi*Ti)",
      this.layer_etch_factor_params,
    );
    push_row();

    create_form_fields(
      `Trace Width (${this.trace_width_params.at(0)?.unit})`,
      "Width of transmission line trace",
      this.trace_width_params,
    );
    create_form_fields(
      `Spacing (${this.spacing_params.at(0)?.unit})`,
      "Separation between transmission line traces",
      this.spacing_params,
    );
    create_form_fields(
      `Trace Height (${this.layer_trace_height_params.at(0)?.unit})`,
      "Height of copper layer",
      this.layer_trace_height_params,
    );
    push_row();

    return column;
  }
}

function get_input_class(param: Parameter): string {
  if (param.error !== undefined) {
    return "input-error";
  }
  if (param.is_changed()) {
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

const form = computed(() => new Form(stackup.value));
const fields = computed(() => form.value.get_layout());
watch(() => user_data.value.size_unit, (unit) => {
  stackup.value.size_unit = unit;
}, { immediate: true });
watch(() => user_data.value.copper_thickness_unit, (unit) => {
  stackup.value.copper_thickness_unit = unit;
}, { immediate: true });

</script>

<template>
<form class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2" @submit="on_submit">
  <!--Select units-->
  <fieldset class="fieldset text-sm">
    <legend class="fieldset-legend">Size Unit</legend>
    <select class="select w-full" v-model="user_data.size_unit" required>
      <option v-for="unit in user_data.size_unit_options" :value="unit" :key="unit">
        {{ unit }}
      </option>
    </select>
  </fieldset>
  <fieldset class="fieldset text-sm">
    <legend class="fieldset-legend">Copper Pour Unit</legend>
    <select class="select w-full" v-model="user_data.copper_thickness_unit" required>
      <option v-for="unit in user_data.copper_thickness_unit_options" :value="unit" :key="unit">
        {{ unit }}
      </option>
    </select>
  </fieldset>
  <!--Set values-->
  <div
    v-for="(col, col_index) in fields" :key="col_index"
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
            @click="(ev) => on_search(ev, row.parameters)"
            type="button"
          >
            <SearchIcon class="h-[1rem] w-[1rem]"/>
          </button>
        </template>
      </div>
      <div class="grid grid-cols-[2rem_auto] w-full gap-x-2 gap-y-1">
        <template v-for="(param, param_index) in row.parameters" :key="param_index">
          <div class="h-full flex flex-col justify-center">
            <label :for="param.label" class="label">{{  param.label }}</label>
          </div>
          <div class="flex flex-row join" :class="param.label === undefined ? 'col-span-2' : ''">
            <input
              :id="param.label"
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
