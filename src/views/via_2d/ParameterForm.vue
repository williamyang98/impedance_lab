<script setup lang="ts">
import { defineProps, defineEmits, computed, watch, toRef } from "vue";
import { TriangleAlert, SearchIcon, InfoIcon } from "lucide-vue-next";
import {
  Stackup,
  type Parameter, type SizeParameter, type EpsilonParameter,
} from "./stackup.ts";
import { providers } from "../../providers/providers.ts";

const user_data = providers.user_data;

const props = defineProps<{
  stackup: Stackup,
}>();
const stackup = toRef(props.stackup);

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
  soldermask_height_params: SizeParameter[] = [];
  dielectric_height_params: SizeParameter[] = [];
  epsilon_params: EpsilonParameter[] = [];
  copper_plane_thickness_params: SizeParameter[] = [];
  via_pad_diameter_params: SizeParameter[] = [];
  plane_antipad_diameter_params: SizeParameter[] = [];
  barrel_diameter: SizeParameter;
  barrel_thickness: SizeParameter;
  barrel_epsilon: EpsilonParameter;

  stackup: Stackup;
  constructor(stackup: Stackup) {
    this.stackup = stackup;

    for (const layer of stackup.layers) {
      switch (layer.type) {
        case "inner": {
          this.dielectric_height_params.push(layer.height);
          this.epsilon_params.push(layer.epsilon);
          if (layer.planes.top.has_copper || layer.planes.bottom.has_copper) {
            this.copper_plane_thickness_params.push(layer.planes.copper_thickness);
          }
          if (layer.planes.top.Dpad !== undefined) {
            this.via_pad_diameter_params.push(layer.planes.top.Dpad);
          }
          if (layer.planes.bottom.Dpad !== undefined) {
            this.via_pad_diameter_params.push(layer.planes.bottom.Dpad);
          }
          if (layer.planes.top.Dantipad !== undefined) {
            this.plane_antipad_diameter_params.push(layer.planes.top.Dantipad);
          }
          if (layer.planes.bottom.Dantipad !== undefined) {
            this.plane_antipad_diameter_params.push(layer.planes.bottom.Dantipad);
          }
          break;
        }
        case "surface": {
          if (layer.soldermask) {
            this.epsilon_params.push(layer.soldermask.epsilon);
            this.soldermask_height_params.push(layer.soldermask.height);
          }
          if (layer.plane.has_copper) {
            this.copper_plane_thickness_params.push(layer.copper_thickness);
          }
          if (layer.plane.Dpad !== undefined) {
            this.via_pad_diameter_params.push(layer.plane.Dpad);
          }
          if (layer.plane.Dantipad !== undefined) {
            this.plane_antipad_diameter_params.push(layer.plane.Dantipad);
          }
          break;
        }
      }
    }
    this.barrel_diameter = stackup.barrel.diameter;
    this.barrel_thickness = stackup.barrel.copper_thickness;
    this.barrel_epsilon = stackup.barrel.epsilon;
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
      `Dielectric Height (${this.dielectric_height_params.at(0)?.unit})`,
      "Height of dielectric",
      this.dielectric_height_params,
    );
    create_form_fields(
      `Copper thickness (${this.copper_plane_thickness_params.at(0)?.unit})`,
      "Height of copper pour",
      this.copper_plane_thickness_params,
    );
    create_form_fields(
      `Dielectric constant`,
      "Dielectric constant of various layers",
      this.epsilon_params,
    );
    push_row();


    create_form_fields(
      `Via pad diameter (${this.via_pad_diameter_params.at(0)?.unit})`,
      "Via pad diameter",
      this.via_pad_diameter_params,
    );
    create_form_fields(
      `Plane antipad diameter (${this.plane_antipad_diameter_params.at(0)?.unit})`,
      "Plane antipad diameter",
      this.plane_antipad_diameter_params,
    );

    create_form_fields(
      `Barrel diameter (${this.barrel_diameter.unit})`,
      "Barrel diameter",
      [this.barrel_diameter],
    );
    create_form_fields(
      `Barrel thickness (${this.barrel_thickness.unit})`,
      "Barrel thickness",
      [this.barrel_thickness],
    );
    create_form_fields(
      "Barrel dielectric constant",
      "Barrel dielectric constant",
      [this.barrel_epsilon],
    );
    push_row();


    return column;
  }
}

const form = computed(() => new Form(props.stackup));

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
            @click="(ev) => on_search(ev, row.parameters)"
            type="button"
          >
            <SearchIcon class="h-[1rem] w-[1rem]"/>
          </button>
        </template>
      </div>
      <div class="grid grid-cols-[1.75rem_auto] w-full gap-x-2 gap-y-1">
        <template v-for="(param, param_index) in row.parameters" :key="param_index">
          <div class="h-full flex flex-col justify-center" v-if="param.label">
            <label :for="param.label" class="label">{{ param.label }}</label>
          </div>
          <div class="flex flex-row join w-full" :class="param.label ? 'col-span-1' : 'col-span-2'">
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
