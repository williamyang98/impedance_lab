import type { UserData } from "../../providers/user_data/user_data";
import { ArenaIdStore } from "../../utility/id_store";
import { StackupParameters } from "./parameters";
import {
  type InnerLayer, type LayerType, type Stackup, type SurfaceLayer,
  type Position,
} from "./stackup"

export type StackupTemplate = (editor: Editor) => Stackup;

export class Editor {
  stackup: Stackup;
  user_data: UserData;
  parameters: StackupParameters;
  layer_ids = new ArenaIdStore();

  constructor(user_data: UserData, template: StackupTemplate) {
    this.user_data = user_data;
    this.parameters = new StackupParameters(this.user_data);
    this.stackup = template(this);
    this.regenerate_id_to_index();
  }

  can_add_via_pad(_position: Position): boolean {
    return true;
  }

  add_via_pad(position: Position) {
    const layer_index = this.parameters.get_index(position.layer_id);
    const layer = this.stackup.layers[layer_index];
    const Dpad = this.parameters.via_pad_diameter.get(position);

    switch (layer.type) {
      case "surface": {
        layer.plane.Dpad = Dpad;
        break;
      }
      case "inner": {
        switch (position.orientation) {
          case "top": {
            layer.planes.top.Dpad = Dpad;
            break;
          }
          case "bottom": {
            layer.planes.bottom.Dpad = Dpad;
            break;
          }
        }
        break;
      }
    }
  }

  can_add_reference_plane(_position: Position): boolean {
    return true;
  }

  add_reference_plane(position: Position) {
    const layer_index = this.parameters.get_index(position.layer_id);
    const layer = this.stackup.layers[layer_index];
    const Dantipad = this.parameters.plane_antipad_diameter.get(position);

    switch (layer.type) {
      case "surface": {
        layer.plane.Dantipad = Dantipad;
        break;
      }
      case "inner": {
        switch (position.orientation) {
          case "top": {
            layer.planes.top.Dantipad = Dantipad;
            break;
          }
          case "bottom": {
            layer.planes.bottom.Dantipad = Dantipad;
            break;
          }
        }
        break;
      }
    }
  }

  can_remove_via_pad(_position: Position): boolean {
    return true;
  }

  remove_via_pad(position: Position) {
    const layer_index = this.parameters.get_index(position.layer_id);
    const layer = this.stackup.layers[layer_index];
    switch (layer.type) {
      case "surface": {
        layer.plane.Dpad = undefined;
        break;
      }
      case "inner": {
        switch (position.orientation) {
          case "top": {
            layer.planes.top.Dpad = undefined;
            break;
          }
          case "bottom": {
            layer.planes.bottom.Dpad = undefined;
            break;
          }
        }
        break;
      }
    }
    this.parameters.via_pad_diameter.delete(position);
  }

  can_remove_reference_plane(_position: Position): boolean {
    return true;
  }

  remove_reference_plane(position: Position) {
    const layer_index = this.parameters.get_index(position.layer_id);
    const layer = this.stackup.layers[layer_index];
    switch (layer.type) {
      case "surface": {
        layer.plane.Dantipad = undefined;
        break;
      }
      case "inner": {
        switch (position.orientation) {
          case "top": {
            layer.planes.top.Dantipad = undefined;
            break;
          }
          case "bottom": {
            layer.planes.bottom.Dantipad = undefined;
            break;
          }
        }
        break;
      }
    }
    this.parameters.plane_antipad_diameter.delete(position);
  }

  add_soldermask(layer_index: number) {
    const layer = this.stackup.layers[layer_index];
    if (layer.type !== "surface") return;
    layer.soldermask = {
      height: this.parameters.soldermask_height.get(layer.id),
      epsilon: this.parameters.dielectric_epsilon.get(layer.id),
    };
  }

  remove_soldermask(layer_index: number) {
    const layer = this.stackup.layers[layer_index];
    if (layer.type !== "surface") return;
    layer.soldermask = undefined;
    this.parameters.soldermask_height.delete(layer.id);
    this.parameters.dielectric_epsilon.delete(layer.id);
  }

  remove_layer(layer_index: number) {
    if (layer_index < 0 || layer_index >= this.stackup.layers.length) return;
    const layer_id = this.stackup.layers[layer_index].id;
    this.stackup.layers.splice(layer_index, 1);
    this.parameters.delete_layer_id(layer_id);
    this.regenerate_id_to_index();
  }

  create_inner_layer(): InnerLayer {
    const id = this.layer_ids.own();
    return {
      type: "inner",
      id,
      height: this.parameters.dielectric_height.get(id),
      epsilon: this.parameters.dielectric_epsilon.get(id),
      planes: {
        copper_thickness: this.parameters.dielectric_copper_height.get(id),
        top: {},
        bottom: {},
      },
    }
  }

  create_surface_layer(): SurfaceLayer {
    const id = this.layer_ids.own();
    return {
      type: "surface",
      id,
      soldermask: {
        height: this.parameters.soldermask_height.get(id),
        epsilon: this.parameters.dielectric_epsilon.get(id),
      },
      plane: {
        copper_thickness: this.parameters.dielectric_copper_height.get(id),
      },
    }
  }

  can_remove_layer(layer_index: number): boolean {
    if (this.stackup.layers.length <= 1) return false;
    // avoid deleting the last inner layer
    const total_inner_layers = this.stackup.layers.filter(layer => layer.type === "inner").length;
    const layer = this.stackup.layers[layer_index];
    if (total_inner_layers <= 1 && layer.type === "inner") return false;
    return true;
  }

  can_add_before_layer(layer_index: number): boolean {
    const layer = this.stackup.layers[layer_index];
    if (layer.type === "surface" && layer_index === 0) return false;
    return true;
  }

  add_before_layer(layer_index: number) {
    const layer = this.create_inner_layer();
    this.stackup.layers.splice(layer_index, 0, layer);
    this.regenerate_id_to_index();
  }

  can_append_layer(): boolean {
    const N = this.stackup.layers.length;
    const layer = this.stackup.layers[N-1];
    if (layer.type === "surface") return false;
    return true;
  }

  append_layer() {
    const layer = this.create_inner_layer();
    this.stackup.layers.push(layer);
    this.regenerate_id_to_index();
  }

  get_layer_types(layer_index: number): LayerType[] {
    const N = this.stackup.layers.length;
    if (layer_index === 0 || layer_index === (N-1)) {
      return ["inner", "surface"];
    }
    return ["inner"];
  }

  set_layer_type(layer_index: number, type: LayerType) {
    const old_layer = this.stackup.layers[layer_index];
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
    this.stackup.layers.splice(layer_index, 0, layer);
    this.regenerate_id_to_index();
  }

  regenerate_id_to_index() {
    this.parameters.id_to_index.clear();
    for (let i = 0; i < this.stackup.layers.length; i++) {
      const layer = this.stackup.layers[i];
      this.parameters.id_to_index.set(layer.id, i);
    }
  }
}
