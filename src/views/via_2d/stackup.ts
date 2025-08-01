import { ArenaIdStore } from "../../utility/id_store";
import { convert_distance, type DistanceUnit } from "../../utility/unit_types";
import { WeakRefArray } from "../../utility/weakref_array";

// types of parameters
export interface FormParameter {
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  value?: number;
  old_value?: number;
  error?: string;
  impedance_correlation?: "positive" | "negative";
}

export interface SizeParameter extends FormParameter {
  type: "size";
  old_unit?: DistanceUnit;
  unit: DistanceUnit;
}

export interface EpsilonParameter extends FormParameter {
  type: "epsilon";
}

export interface EtchFactorParameter extends FormParameter {
  // W-W0 = dW0 = 2*T*etch_factor
  type: "etch_factor";
  taper_suffix?: string;
}

export type Parameter = SizeParameter | EpsilonParameter | EtchFactorParameter;

export interface ViaBarrel {
  diameter: SizeParameter;
  copper_thickness: SizeParameter;
  epsilon: EpsilonParameter;
}

export interface ReferencePlane {
  Dpad: SizeParameter;
  Dantipad: SizeParameter;
  has_pad: boolean;
  has_plane: boolean;
  get has_copper(): boolean;
}

export type LayerId = number;
export type Orientation = "top" | "bottom";
export interface Position {
  layer_id: LayerId;
  orientation: Orientation;
}

export interface SurfaceLayer {
  readonly type: "surface";
  id: LayerId;
  soldermask_height: SizeParameter;
  soldermask_epsilon: EpsilonParameter;
  copper_thickness: SizeParameter;
  plane: ReferencePlane;
  has_soldermask: boolean;
  get orientation(): Orientation;
}

export interface InnerLayer {
  readonly type: "inner";
  id: LayerId;
  height: SizeParameter;
  epsilon: EpsilonParameter;
  planes: {
    copper_thickness: SizeParameter;
    top: ReferencePlane;
    bottom: ReferencePlane;
  };
}

export type Layer = SurfaceLayer | InnerLayer;
export type LayerType = "surface" | "inner";

class SizeParameters extends WeakRefArray<SizeParameter> {
  _unit: DistanceUnit;

  constructor(default_unit: DistanceUnit) {
    super();
    this._unit = default_unit;
  }

  override push(size: SizeParameter) {
    this.convert(size);
    super.push(size);
  }

  set unit(unit: DistanceUnit) {
    this._unit = unit;
    this.compact();
    for (const size of this.deref()) {
      this.convert(size);
    }
  }

  convert(size: SizeParameter) {
    if (size.value === undefined) return;
    const new_value = convert_distance(size.value, size.unit, this._unit);
    size.value = new_value;
    size.unit = this._unit;
  }
}

export class Stackup {
  layers: Layer[] = [];
  barrel: ViaBarrel;
  layer_id_store = new ArenaIdStore();
  id_to_index = new Map<LayerId, number>();
  minimum_feature_size: number = 1e-5;

  // allow for global changes to size and copper thickness units
  parameters = {
    size: new SizeParameters("mm"),
    copper_thickness: new SizeParameters("oz"),
  };

  constructor() {
    this.barrel = this.create_via_barrel();
  }

  set size_unit(unit: DistanceUnit) {
    this.parameters.size.unit = unit;
  }

  set copper_thickness_unit(unit: DistanceUnit) {
    this.parameters.copper_thickness.unit = unit;
  }

  create_via_barrel(): ViaBarrel {
    const diameter = {
      parent: this,
      type: "size" as const,
      label: "DB",
      value: 0.15, unit: "mm" as const,
      description: "Via barrel diameter",
      get min(): number | undefined {
        const thickness = this.parent.barrel.copper_thickness;
        if (thickness.value === undefined) return 0;
        const min_radius = convert_distance(thickness.value, thickness.unit, this.unit);
        return min_radius*2;
      },
      get max(): number | undefined {
        let min_diameter = Infinity;
        const read_diameter = (size?: SizeParameter) => {
          if (size?.value === undefined) return;
          const diameter = convert_distance(size.value, size.unit, this.unit);
          min_diameter = Math.min(min_diameter, diameter);
        };
        for (const layer of this.parent.layers) {
          switch (layer.type) {
            case "surface": {
              read_diameter(layer.plane.Dpad);
              read_diameter(layer.plane.Dantipad);
              break;
            }
            case "inner": {
              read_diameter(layer.planes.top.Dpad);
              read_diameter(layer.planes.top.Dantipad);
              read_diameter(layer.planes.bottom.Dpad);
              read_diameter(layer.planes.bottom.Dantipad);
              break;
            }
          }
        }
        if (min_diameter === Infinity) return undefined;
        return min_diameter;
      },
      impedance_correlation: "negative" as const,
    };

    const copper_thickness = {
      parent: this,
      label: "TB",
      type: "size" as const,
      value: 0.5, unit: "oz" as const,
      description: "Via barrel copper plating thickness",
      min: 0,
      get max(): number | undefined {
        const param = this.parent.barrel.diameter;
        if (param.value === undefined) return undefined;
        const diameter = convert_distance(param.value, param.unit, this.unit);
        return diameter/2;
      },
      // TODO: based on approximate inductance models where hollow wires have less ac inductance than solid wires
      //       this seems counterinuitive, is this actually correct???
      impedance_correlation: "positive" as const,
    };

    const epsilon = {
      type: "epsilon" as const,
      label: "ERB",
      description: "Barrel filling dielectric constant",
      min: 1,
      value: 3.1,
      impedance_correlation: "negative" as const,
    };

    this.parameters.size.push(diameter);
    this.parameters.copper_thickness.push(copper_thickness);

    return {
      diameter,
      copper_thickness,
      epsilon,
    }
  }

  create_epsilon_parameter(layer_id: LayerId, value: number): EpsilonParameter {
    const epsilon = {
      parent: this,
      type: "epsilon" as const,
      value,
      min: 1,
      get label() { return `ER${this.parent.get_layer_index(layer_id)}`; },
      description: "Soldermask height",
      impedance_correlation: "negative" as const,
    }
    return epsilon;
  }

  create_copper_thickness(layer_id: LayerId, value: number, unit: DistanceUnit): SizeParameter {
    const thickness = {
      parent: this,
      type: "size" as const,
      value, unit,
      get min() { return this.parent.minimum_feature_size; },
      get label() { return `T${this.parent.get_layer_index(layer_id)}`; },
      description: "Copper thickness",
      // Z0=sqrt(L/C) and it seems inductance increases faster than capacitance
      impedance_correlation: "positive" as const,
    }
    this.parameters.copper_thickness.push(thickness);
    return thickness;
  }

  // create reference planes with shared pad/antipad parameters
  create_reference_planes(layer_id: LayerId, count: number): ReferencePlane[] {
    const planes: ReferencePlane[] = [];
    for (let i = 0; i < count; i++) {
      planes.push({
        Dantipad: {} as SizeParameter,
        Dpad: {} as SizeParameter,
        has_pad: false,
        has_plane: false,
        get has_copper() {
          return this.has_pad || this.has_plane;
        },
      });
    }

    const Dpad = {
      parent: this,
      planes,
      type: "size" as const,
      value: 0.25, unit: "mm" as const,
      get label() { return `DP${this.parent.get_layer_index(layer_id)}`; },
      get min(): number | undefined {
        const Dbarrel = this.parent.barrel.diameter;
        if (Dbarrel.value === undefined) return undefined;
        return convert_distance(Dbarrel.value, Dbarrel.unit, this.unit);
      },
      get max(): number | undefined {
        const plane = this.planes.find(plane => plane.has_plane);
        if (plane === undefined) return undefined;
        const Dantipad = plane.Dantipad;
        if (Dantipad.value === undefined) return undefined;
        return convert_distance(Dantipad.value, Dantipad.unit, this.unit);
      },
      impedance_correlation: "negative" as const,
    };

    const Dantipad = {
      parent: this,
      planes,
      type: "size" as const,
      value: 0.35, unit: "mm" as const,
      get label() { return `DA${this.parent.get_layer_index(layer_id)}`; },
      description: "Antipad diameter",
      get min(): number {
        const plane = this.planes.find(plane => plane.has_pad);
        if (plane === undefined) return 0;
        const Dpad = plane.Dpad;
        if (Dpad.value === undefined) return 0;
        return convert_distance(Dpad.value, Dpad.unit, this.unit);
      },
      impedance_correlation: "positive" as const,
    };

    this.parameters.size.push(Dpad);
    this.parameters.size.push(Dantipad);
    for (const plane of planes) {
      plane.Dantipad = Dantipad;
      plane.Dpad = Dpad;
    }
    return planes;
  }

  create_inner_layer(): InnerLayer {
    const layer_id = this.layer_id_store.own();
    const height = {
      parent: this,
      type: "size" as const,
      value: 0.15, unit: "mm" as const,
      get label() { return `H${this.parent.get_layer_index(layer_id)}`; },
      description: "Dielectric height",
      get min() { return this.parent.minimum_feature_size; },
      impedance_correlation: "positive" as const,
    };
    this.parameters.size.push(height);
    const copper_thickness = this.create_copper_thickness(layer_id, 1, "oz");
    const epsilon = this.create_epsilon_parameter(layer_id, 4.1);
    const planes = this.create_reference_planes(layer_id, 2);
    return {
      type: "inner",
      id: layer_id,
      height,
      epsilon,
      planes: {
        copper_thickness,
        top: planes[0],
        bottom: planes[1],
      },
    }
  }

  create_surface_layer(): SurfaceLayer {
    const layer_id = this.layer_id_store.own();
    const plane = this.create_reference_planes(layer_id, 1)[0];
    const soldermask_height = {
      parent: this,
      type: "size" as const,
      value: 0.015, unit: "mm" as const,
      get label() { return `H${this.parent.get_layer_index(layer_id)}`; },
      description: "Soldermask height",
      get min() { return this.parent.minimum_feature_size; },
      impedance_correlation: "negative" as const,
    };
    const soldermask_epsilon = this.create_epsilon_parameter(layer_id, 3.3);
    const layer = {
      type: "surface" as const,
      id: layer_id,
      parent: this,
      soldermask_epsilon,
      soldermask_height,
      has_soldermask: true,
      get orientation(): Orientation {
        const index = this.parent.get_layer_index(this.id);
        return (index === 0) ? "bottom" : "top";
      },
      copper_thickness: this.create_copper_thickness(layer_id, 1, "oz"),
      plane,
    };

    this.parameters.size.push(soldermask_height);
    return layer;
  }

  // operations on layers array are addressed by index
  can_remove_layer(layer_index: number): boolean {
    if (this.layers.length <= 1) return false;
    // avoid deleting the last inner layer
    const total_inner_layers = this.layers.filter(layer => layer.type === "inner").length;
    const layer = this.layers[layer_index];
    if (total_inner_layers <= 1 && layer.type === "inner") return false;
    return true;
  }

  remove_layer(layer_index: number) {
    const layer = this.layers[layer_index];
    this.layers.splice(layer_index, 1);
    this.layer_id_store.free(layer.id);
    this.regenerate_id_to_index();
  }


  can_add_before_layer(layer_index: number): boolean {
    const layer = this.layers[layer_index];
    if (layer.type === "surface" && layer_index === 0) return false;
    return true;
  }

  add_before_layer(layer_index: number) {
    const layer = this.create_inner_layer();
    this.layers.splice(layer_index, 0, layer);
    this.regenerate_id_to_index();
  }

  can_append_layer(): boolean {
    const N = this.layers.length;
    if (N === 0) return true;
    const layer = this.layers[N-1];
    if (layer.type === "surface") return false;
    return true;
  }

  append_layer() {
    const layer = this.create_inner_layer();
    this.layers.push(layer);
    this.regenerate_id_to_index();
  }

  get_layer_types(layer_index: number): LayerType[] {
    const N = this.layers.length;
    if (layer_index === 0 || layer_index === (N-1)) {
      return ["inner", "surface"];
    }
    return ["inner"];
  }

  set_layer_type(layer_index: number, type: LayerType) {
    const old_layer = this.layers[layer_index];
    if (old_layer.type === type) return;
    let layer = undefined;
    switch (type) {
      case "inner": {
        layer = this.create_inner_layer();
        break;
      }
      case "surface": {
        layer = this.create_surface_layer();
        break;
      }
    }
    this.remove_layer(layer_index);
    this.layers.splice(layer_index, 0, layer);
    this.regenerate_id_to_index();
  }

  regenerate_id_to_index() {
    this.id_to_index.clear();
    this.layers.forEach((layer, index) => {
      this.id_to_index.set(layer.id, index);
    });
  }

  get_layer_index(id: LayerId): number {
    const index = this.id_to_index.get(id);
    if (index === undefined) throw Error(`Got invalid layer id ${id}`);
    return index;
  }
}
