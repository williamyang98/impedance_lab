import { convert_distance } from "../../utility/unit_types";
import { type SizeParameter, Stackup as Stackup2D } from "../via_2d/stackup";

export class Stackup extends Stackup2D {
  is_differential: boolean = true;
  differential_spacing: SizeParameter;
  total_stitching_vias: number = 4;

  constructor() {
    super();
    this.differential_spacing = this.create_differential_spacing();
    this.parameters.size.push(this.differential_spacing);
  }

  create_differential_spacing(): SizeParameter {
    const spacing = {
      parent: this,
      type: "size" as const,
      value: 0.5, unit: "mm" as const,
      get min(): number {
        let min_spacing = this.parent.minimum_feature_size;
        const push_diameter = (param: SizeParameter) => {
          if (param.value !== undefined) {
            const value = convert_distance(param.value, param.unit, this.unit);
            min_spacing = Math.max(min_spacing, value);
          }
        };
        push_diameter(this.parent.barrel.diameter);
        for (const layer of this.parent.layers) {
          switch (layer.type) {
            case "surface": {
              if (layer.plane.has_pad) push_diameter(layer.plane.Dpad);
              break;
            }
            case "inner": {
              if (layer.planes.top.has_pad) push_diameter(layer.planes.top.Dpad);
              if (layer.planes.bottom.has_pad) push_diameter(layer.planes.bottom.Dpad);
              break;
            }
          }
        }
        return min_spacing;
      },
    };
    return spacing;
  }
}
