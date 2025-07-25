import { ColinearStackup, BroadsideStackup } from "./stackup";

export type LayerTemplateType = "microstrip" | "stripline";
export const layer_template_types: LayerTemplateType[] = ["microstrip", "stripline"];

export function create_colinear_stackup(layer_type: LayerTemplateType): ColinearStackup {
  const stackup = new ColinearStackup();
  switch (layer_type) {
    case "microstrip": {
      const L0 = stackup.create_surface_layer("bottom");
      const L1 = stackup.create_inner_layer();
      stackup.layers = [L0,L1];
      stackup.regenerate_layer_id_to_index();
      stackup.move_trace({ layer_id: L0.id, orientation: L0.orientation });
      L0.has_soldermask = true;
      L1.add_plane.bottom?.();
      break;
    }
    case "stripline": {
      const L0 = stackup.create_inner_layer();
      const L1 = stackup.create_inner_layer();
      stackup.layers = [L0,L1];
      stackup.regenerate_layer_id_to_index();
      stackup.move_trace({ layer_id: L0.id, orientation: "bottom" });
      L0.add_plane.top?.();
      L1.add_plane.bottom?.();
      break;
    };
  }

  stackup.selected_layout = "single";
  return stackup;
}

export function create_broadside_stackup(layer_type: LayerTemplateType): BroadsideStackup {
  const stackup = new BroadsideStackup();
  switch (layer_type) {
    case "microstrip": {
      const L0 = stackup.create_surface_layer("bottom");
      const L1 = stackup.create_inner_layer();
      const L2 = stackup.create_surface_layer("top");
      stackup.layers = [L0,L1,L2];
      stackup.regenerate_layer_id_to_index();

      stackup.move_trace({ layer_id: L0.id, orientation: L0.orientation }, "left");
      stackup.move_trace({ layer_id: L2.id, orientation: L2.orientation }, "right");
      L0.has_soldermask = true;
      L2.has_soldermask = true;
      break;
    }
    case "stripline": {
      const L0 = stackup.create_inner_layer();
      const L1 = stackup.create_inner_layer();
      const L2 = stackup.create_inner_layer();
      stackup.layers = [L0,L1,L2];
      stackup.regenerate_layer_id_to_index();

      stackup.move_trace({ layer_id: L0.id, orientation: "bottom" }, "left");
      stackup.move_trace({ layer_id: L2.id, orientation: "top" }, "right");
      L0.add_plane.top?.();
      L2.add_plane.bottom?.();
      break;
    };
  }

  stackup.selected_layout = "pair";
  return stackup;
}
