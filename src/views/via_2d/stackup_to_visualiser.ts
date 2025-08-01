import {
  Stackup,
  // type Stackup, type Parameter,
  type Orientation, type Position,
  type SurfaceLayer,
  // type ReferencePlane,
} from "./stackup.ts";
import type {
  Visualiser, Viewport,
  HorizontalDimensionLine, VerticalDimensionLine,
  RectangleShape,
  // PolygonShape, PolygonPoint,
  TextLabel,
  // IconLabel,
  Entity,
} from "../visualiser_2d/visualiser.ts";
import { colours, stroke, font } from "../visualiser_2d/pcb_defaults.ts";

const sizes = {
  plane_height: 15,
  etch_factor: 0.35,
  barrel_diameter: 88,
  barrel_copper_thickness: 15,
  pad_diameter: 135,
  antipad_diameter: 170,
  dielectric_height: 35,
  soldermask_height: 17,
  stackup_width: 250,
};

export interface ViaPadEntity extends RectangleShape {
  parent: StackupVisualiser;
  is_ghost: boolean;
}

export interface ReferencePlaneEntity extends RectangleShape {
  parent: StackupVisualiser;
  is_ghost: boolean;
}

interface StackupBounds {
  x_left: number;
  x_right: number;
  y_top: number;
  y_bottom: number;
}

class DynamicBound {
  min: number = Infinity;
  max: number = -Infinity;
  push(value: number) {
    this.min = Math.min(value, this.min);
    this.max = Math.max(value, this.max);
  }
}

export class StackupVisualiser implements Visualiser {
  stackup: Stackup;
  is_editing: boolean
  reference_planes: ReferencePlaneEntity[] = [];
  reference_plane_groups = new Map<string, ReferencePlaneEntity[]>();
  via_pads: ViaPadEntity[] = [];
  via_pad_groups = new Map<string, ViaPadEntity[]>();
  via_barrel: RectangleShape[] = [];
  dielectric_layers: RectangleShape[] = [];
  soldermask_layers: RectangleShape[] = [];
  epsilon_labels: TextLabel[] = [];
  height_labels: VerticalDimensionLine[] = [];
  diameter_labels: HorizontalDimensionLine[] = [];
  stackup_bounds: StackupBounds;

  height_label: {
    x_text: number;
    x_line: number;
    x_extension: number;
    x_antipad: number;
    x_pad: number;
    x_dielectric: number;
  };

  diameter_label = {
    y_barrel: new DynamicBound(),
    y_pad: new DynamicBound(),
    y_antipad: new DynamicBound(),
  };

  constructor(stackup: Stackup, is_editing: boolean) {
    this.is_editing = is_editing;
    this.stackup = stackup;
    {
      // height label x positioning
      const x_right = -sizes.stackup_width/2;
      const x_left_offset = 25;
      this.height_label = {
        x_extension: x_right-x_left_offset,
        x_line: x_right-5,
        x_text: x_right-x_left_offset+2,
        x_pad: -sizes.pad_diameter/2,
        x_antipad: -sizes.stackup_width/2,
        x_dielectric: -sizes.stackup_width/2,
      };
    }
    this.stackup_bounds = this.create_visualiser();
    this.create_diameter_labels();
    this.create_barrel_epsilon_label();
    this.readjust_height_labels_x();
  }

  create_visualiser(): StackupBounds {
    let y_offset = 0;
    const y_stackup_top = y_offset;

    for (let i = 0; i < this.stackup.layers.length; i++) {
      const layer = this.stackup.layers[i];
      switch (layer.type) {
        case "surface": {
          // dielectric
          const y_top = y_offset;
          {
            let height = 0;
            if (layer.plane.has_copper || this.is_editing) height += sizes.plane_height;
            if (layer.has_soldermask || this.is_editing) {
              height += sizes.soldermask_height;
            }
            this.create_soldermask_layer(y_top, height, layer);
            y_offset += height;
          }
          const y_bottom = y_offset;
          const orientation: Orientation = layer.orientation;
          // via pad and reference planes
          const y_plane = orientation === "bottom" ? y_bottom-sizes.plane_height : y_top;
          if (layer.plane.has_copper || this.is_editing) {
            this.diameter_label.y_barrel.push(y_plane);
            this.diameter_label.y_barrel.push(y_plane+sizes.plane_height);
          }
          if (layer.plane.has_copper && layer.copper_thickness.label !== undefined) {
            const x_copper = (layer.plane.Dantipad !== undefined || this.is_editing) ? this.height_label.x_antipad : this.height_label.x_pad;
            const x_dielectric = this.height_label.x_dielectric;
            const x_top = orientation === "bottom" ? x_copper : x_dielectric;
            const x_bottom = orientation === "bottom" ? x_dielectric : x_copper;
            this.create_height_label(y_plane, sizes.plane_height, x_top, x_bottom, layer.copper_thickness.label);
          }
          this.create_via_pad(y_plane, layer.plane.Dpad !== undefined, i, orientation);
          this.create_reference_plane(y_plane, layer.plane.Dantipad !== undefined, i, orientation);
          break;
        }
        case "inner": {
          // dielectric
          const y_top = y_offset;
          let dielectric_colour = colours.dielectric_core;
          {
            if (layer.planes.top.has_copper || this.is_editing) {
              if (layer.planes.top.has_copper && layer.planes.copper_thickness.label !== undefined) {
                const x_top = this.height_label.x_dielectric;
                const x_bottom = (layer.planes.top.Dantipad !== undefined || this.is_editing) ? this.height_label.x_antipad : this.height_label.x_pad;
                this.create_height_label(y_offset, sizes.plane_height, x_top, x_bottom, layer.planes.copper_thickness.label);
              }
              y_offset += sizes.plane_height;
            }
            if (layer.height.label !== undefined) {
              const x = this.height_label.x_dielectric;
              this.create_height_label(y_offset, sizes.dielectric_height, x, x, layer.height.label);
            }
            y_offset += sizes.dielectric_height;
            if (layer.planes.bottom.has_copper || this.is_editing) {
              if (layer.planes.bottom.has_copper && layer.planes.copper_thickness.label !== undefined) {
                const x_top = (layer.planes.bottom.Dantipad !== undefined || this.is_editing) ? this.height_label.x_antipad : this.height_label.x_pad;
                const x_bottom = this.height_label.x_dielectric;
                this.create_height_label(y_offset, sizes.plane_height, x_top, x_bottom, layer.planes.copper_thickness.label);
              }
              y_offset += sizes.plane_height;
            }
            if (layer.planes.bottom.has_copper || layer.planes.top.has_copper) {
              dielectric_colour = colours.dielectric_prepreg;
            }
          }
          const y_bottom = y_offset;
          {
            const height = y_bottom-y_top;
            this.create_dielectric_layer(y_top, height, dielectric_colour);
            if (layer.epsilon.label !== undefined) {
              this.create_epsilon_label(y_top+height/2, layer.epsilon.label);
            }
          }
          // via pads
          {
            const y_via = y_top;
            const orientation: Orientation = "top";
            this.create_via_pad(y_via, layer.planes.top.Dpad !== undefined, i, orientation);
            this.create_reference_plane(y_via, layer.planes.top.Dantipad !== undefined, i, orientation);
          }
          {
            const y_via = y_bottom-sizes.plane_height;
            const orientation: Orientation = "bottom";
            this.create_via_pad(y_via, layer.planes.bottom.Dpad !== undefined, i, orientation);
            this.create_reference_plane(y_via, layer.planes.bottom.Dantipad !== undefined, i, orientation);
          }
          {
            // drill hole goes through entire stackup and will be plated with copper
            // TODO: handle backdrilling
            this.diameter_label.y_barrel.push(y_top);
            this.diameter_label.y_barrel.push(y_bottom);
          }
          break;
        }
      }
    }
    const y_stackup_bottom = y_offset;

    // via barrel
    {
      const Douter = sizes.barrel_diameter;
      const Dinner = Douter-sizes.barrel_copper_thickness*2;
      const create_entity = (x_left: number, x_right: number): RectangleShape => {
        return {
          type: "rectangle_shape",
          x_left,
          x_right,
          y_top: this.diameter_label.y_barrel.min,
          y_bottom: this.diameter_label.y_barrel.max,
          fill_colour: colours.copper,
          // stroke_colour: stroke.outline_colour,
          // stroke_width: stroke.outline_width,
        }
      };
      this.via_barrel.push(
        create_entity(-Douter/2, -Dinner/2),
        create_entity(Dinner/2, Douter/2),
      );
    }
    // via dielectric
    {
      const Dbarrel = sizes.barrel_diameter;
      this.dielectric_layers.push({
        type: "rectangle_shape",
        x_left: -Dbarrel/2,
        x_right: Dbarrel/2,
        y_top: this.diameter_label.y_barrel.min,
        y_bottom: this.diameter_label.y_barrel.max,
        fill_colour: colours.dielectric_barrel,
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
      });
    }

    return {
      x_left: -sizes.stackup_width/2,
      x_right: sizes.stackup_width/2,
      y_top: y_stackup_top,
      y_bottom: y_stackup_bottom,
    }
  }

  create_dielectric_layer(y: number, height: number, colour: string) {
    this.dielectric_layers.push({
      type: "rectangle_shape",
      x_left: -sizes.stackup_width/2,
      x_right: sizes.stackup_width/2,
      y_top: y,
      y_bottom: y+height,
      fill_colour: colour,
      stroke_colour: stroke.outline_colour,
      stroke_width: stroke.outline_width,
    });
  }

  create_soldermask_layer(y: number, height: number, layer: SurfaceLayer) {
    if (!layer.has_soldermask && !this.is_editing) return;
    const colour = layer.has_soldermask ? colours.dielectric_soldermask : colours.dielectric_soldermask_selectable;
    const is_hoverable = !layer.has_soldermask && this.is_editing;
    let on_click = undefined;
    if (this.is_editing) {
      on_click = () => { layer.has_soldermask = !layer.has_soldermask; };
    }

    this.dielectric_layers.push({
      type: "rectangle_shape",
      x_left: -sizes.stackup_width/2,
      x_right: sizes.stackup_width/2,
      y_top: y,
      y_bottom: y+height,
      fill_colour: colour,
      stroke_colour: stroke.outline_colour,
      stroke_width: stroke.outline_width,
      on_hover(is_hover: boolean) {
        if (is_hoverable) {
          this.fill_colour =  is_hover ? colours.dielectric_soldermask : colours.dielectric_soldermask_selectable;
        }
      },
      on_click,
    });

    if (layer.has_soldermask) {
      let y_label = undefined;
      if (this.is_editing || layer.plane.has_copper) {
        // avoid being ontop of ghost and real pads
        if (layer.orientation === "bottom") {
          y_label = y+sizes.soldermask_height/2;
        } else {
          y_label = y+height-sizes.soldermask_height/2;
        }
      } else {
        // centre to dielectric if empty
        y_label = y + height/2;
      }
      if (layer.soldermask_epsilon.label !== undefined) {
        this.create_epsilon_label(y_label, layer.soldermask_epsilon.label);
      }
      if (layer.soldermask_height.label !== undefined) {
        this.create_height_label(
          y_label-sizes.soldermask_height/2, sizes.soldermask_height,
          this.height_label.x_dielectric, this.height_label.x_dielectric,
          layer.soldermask_height.label,
        );
      }
    }
  }

  create_via_pad(y: number, exists: boolean, layer_index: number, orientation: Orientation) {
    if (!exists && !this.is_editing) return;

    const group_id = `${layer_index}_${orientation}`;
    const layer = this.stackup.layers[layer_index];
    const position: Position = { layer_id: layer.id, orientation };

    let on_click = undefined;
    let is_hoverable = false;
    let is_visible = exists;
    if (this.is_editing && exists && this.stackup.can_remove_via_pad(position)) {
      on_click = () => { this.stackup.remove_via_pad(position); };
    }
    if (this.is_editing && !exists && this.stackup.can_add_via_pad(position)) {
      on_click = () => { this.stackup.add_via_pad(position); };
      is_hoverable = true;
      is_visible = true;
    }

    if (!is_visible) return;

    const height = sizes.plane_height;
    const Dpad = sizes.pad_diameter;
    const Dbarrel = sizes.barrel_diameter;

    const create_entity = (x_left: number, x_right: number): ViaPadEntity => {
      return {
        type: "rectangle_shape",
        parent: this,
        is_ghost: !exists,
        x_left,
        x_right,
        y_top: y,
        y_bottom: y+height,
        get fill_colour() {
          return this.is_ghost ? colours.copper_selectable : colours.copper;
        },
        on_hover(is_hover: boolean) {
          if (is_hoverable) this.parent.on_via_hover(group_id, is_hover);
        },
        on_click,
        stroke_colour: exists ? undefined : stroke.outline_colour,
        stroke_width: exists ? undefined : stroke.outline_width,
      };
    };
    const entities = [
      create_entity(-Dpad/2, -Dbarrel/2),
      create_entity(Dbarrel/2, Dpad/2),
    ];
    this.via_pads.push(...entities);
    if (is_hoverable) this.register_via_group(group_id, entities);

    this.diameter_label.y_pad.push(y);
    this.diameter_label.y_pad.push(y+height);
  }

  register_via_group(id: string, entities: ViaPadEntity[]) {
    let group = this.via_pad_groups.get(id);
    if (group === undefined) {
      group = [];
      this.via_pad_groups.set(id, group);
    }
    group.push(...entities);
  }

  on_via_hover(group_tag: string, is_hover: boolean) {
    const pads = this.via_pad_groups.get(group_tag);
    if (pads === undefined) return;
    for (const pad of pads) {
      pad.is_ghost = !is_hover;
    }
  }

  create_reference_plane(y: number, exists: boolean, layer_index: number, orientation: Orientation) {
    if (!exists && !this.is_editing) return;

    const group_id = `${layer_index}_${orientation}`;
    const layer = this.stackup.layers[layer_index];
    const position: Position = { layer_id: layer.id, orientation };

    let on_click = undefined;
    let is_hoverable = false;
    let is_visible = exists;
    if (this.is_editing && exists && this.stackup.can_remove_reference_plane(position)) {
      on_click = () => { this.stackup.remove_reference_plane(position); };
    }
    if (this.is_editing && !exists && this.stackup.can_add_reference_plane(position)) {
      on_click = () => { this.stackup.add_reference_plane(position); };
      is_hoverable = true;
      is_visible = true;
    }

    if (!is_visible) return;

    const Dantipad = sizes.antipad_diameter;
    const height = sizes.plane_height;

    const create_entity = (x_left: number, x_right: number): ReferencePlaneEntity => {
      return {
        type: "rectangle_shape",
        parent: this,
        is_ghost: !exists,
        x_left,
        x_right,
        y_top: y,
        y_bottom: y+height,
        get fill_colour() {
          return this.is_ghost ? colours.copper_selectable : colours.copper;
        },
        on_hover(is_hover: boolean) {
          if (is_hoverable) this.parent.on_plane_hover(group_id, is_hover);
        },
        on_click,
        stroke_colour: stroke.outline_colour,
        stroke_width: stroke.outline_width,
      }
    };

    const entities = [
      create_entity(-sizes.stackup_width/2, -Dantipad/2),
      create_entity(Dantipad/2, sizes.stackup_width/2),
    ];

    this.reference_planes.push(...entities);
    if (is_hoverable) this.register_reference_plane_group(group_id, entities);

    this.diameter_label.y_antipad.push(y);
    this.diameter_label.y_antipad.push(y+height);
  };

  create_diameter_labels() {
    if (this.stackup.barrel.diameter.label !== undefined && this.stackup.barrel.copper_thickness.label !== undefined) {
      const label = `${this.stackup.barrel.diameter.label}-2${this.stackup.barrel.copper_thickness.label}`;
      this.create_diameter_label(sizes.barrel_diameter-2*sizes.barrel_copper_thickness, label, this.diameter_label.y_barrel.max);
    }
    if (this.stackup.barrel.diameter.label !== undefined) {
      this.create_diameter_label(sizes.barrel_diameter, this.stackup.barrel.diameter.label, this.diameter_label.y_barrel.max);
    }
    if (Number.isFinite(this.diameter_label.y_pad.max)) {
      this.create_diameter_label(sizes.pad_diameter, "DPn", this.diameter_label.y_pad.max);
    }
    if (Number.isFinite(this.diameter_label.y_antipad.max)) {
      this.create_diameter_label(sizes.antipad_diameter, "DAn", this.diameter_label.y_antipad.max);
    }
  }

  create_diameter_label(diameter: number, label: string, y_feature: number) {
    const extension_size = 5;
    const label_spacing = font.size*font.glyph_height*2;
    const y_offset = (this.diameter_labels.length+1) * label_spacing;

    const line = {
      type: "horizontal_dimension_line" as const,
      parent: this,
      x_left: -diameter/2,
      x_right: diameter/2,
      get y_line(): number {
        return this.parent.stackup_bounds.y_bottom + y_offset;
      },
      text: {
        data: label,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      text_vertical_align: "middle" as const,
      text_horizontal_align: "center" as const,
      left_extension_line: {
        parent: this,
        y_top: y_feature,
        get y_bottom(): number {
          return this.parent.stackup_bounds.y_bottom + y_offset + extension_size;
        },
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
      right_extension_line: {
        parent: this,
        y_top: y_feature,
        get y_bottom(): number {
          return this.parent.stackup_bounds.y_bottom + y_offset + extension_size;
        },
        line_style: stroke.arm_stroke_style,
        line_width: stroke.arm_width,
      },
    };
    this.diameter_labels.push(line);
  }

  create_epsilon_label(y: number, label: string) {
    const epsilon_label = {
      type: "text_label" as const,
      parent: this,
      horizontal_align: "left" as const,
      vertical_align: "middle" as const,
      y,
      x: -sizes.stackup_width/2 + 5,
      text: {
        data: label,
        size: font.size,
        weight: font.weight,
        colour: font.colour,
      },
    };
    this.epsilon_labels.push(epsilon_label);
  }

  create_barrel_epsilon_label() {
    const label = this.stackup.barrel.epsilon.label;
    const y_barrel = this.diameter_label.y_barrel;
    const y = (y_barrel.max+y_barrel.min)/2;

    if (label === undefined) return;
    const epsilon_label = {
      type: "text_label" as const,
      parent: this,
      horizontal_align: "center" as const,
      vertical_align: "middle" as const,
      y,
      x: 0,
      text: {
        data: label,
        size: font.size,
        weight: font.weight,
        colour: font.colour,
      },
    };
    this.epsilon_labels.push(epsilon_label);
  }

  create_height_label(y_offset: number, height: number, x_top: number, x_bottom: number, text: string) {
    const label = {
      type: "vertical_dimension_line" as const,
      parent: this,
      y_top: y_offset,
      y_bottom: y_offset+height,
      get x_line() { return this.parent.height_label.x_line; },
      text: {
        data: text,
        colour: font.colour,
        weight: font.weight,
        size: font.size,
      },
      get x_text() { return this.parent.height_label.x_text; },
      text_horizontal_align: "left" as const,
      text_vertical_align: "middle" as const,
      colour: stroke.line_colour,
      line_width: stroke.line_width,
      arrow_size: stroke.arrow_size,
      top_extension_line: {
        parent: this,
        get x_left() { return this.parent.height_label.x_extension; },
        x_right: x_top,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
      bottom_extension_line: {
        parent: this,
        get x_left() { return this.parent.height_label.x_extension; },
        x_right: x_bottom,
        line_width: stroke.arm_width,
        line_style: stroke.arm_stroke_style,
      },
    };
    this.height_labels.push(label);
  }

  register_reference_plane_group(id: string, entities: ReferencePlaneEntity[]) {
    let group = this.reference_plane_groups.get(id);
    if (group === undefined) {
      group = [];
      this.reference_plane_groups.set(id, group);
    }
    group.push(...entities);
  }

  on_plane_hover(group_tag: string, is_hover: boolean) {
    const planes = this.reference_plane_groups.get(group_tag);
    if (planes === undefined) return;
    for (const plane of planes) {
      plane.is_ghost = !is_hover;
    }
  }

  readjust_height_labels_x() {
    if (this.height_labels.length === 0) {
      this.height_label.x_extension = -sizes.stackup_width/2;
      return;
    }
    let max_text_width = 0;
    for (const label of this.height_labels) {
      const text = label.text.data;
      const text_width = text.length*font.size*font.glyph_width;
      max_text_width = Math.max(text_width, max_text_width);
    }
    const min_right_padding = 5;
    const min_left_padding = 3;
    this.height_label.x_extension = -sizes.stackup_width/2-min_right_padding-max_text_width-min_left_padding;
    this.height_label.x_text = this.height_label.x_extension+min_left_padding;
  }

  get viewport(): Viewport {
    let y_bottom = this.stackup_bounds.y_bottom;
    if (this.diameter_labels.length > 0) {
      const label = this.diameter_labels[this.diameter_labels.length-1];
      const font_height = font.size*font.glyph_height;
      y_bottom = label.y_line + font_height;
    }

    const padding = 0.5;
    return {
      x_left: this.height_label.x_extension-padding,
      x_right: this.stackup_bounds.x_right+padding,
      y_top: this.stackup_bounds.y_top-padding,
      y_bottom: y_bottom+padding,
    }
  }

  get entities(): Entity[] {
    return [
      ...this.dielectric_layers,
      ...this.soldermask_layers,
      ...this.reference_planes,
      ...this.via_pads,
      ...this.via_barrel,
      ...this.epsilon_labels,
      ...this.height_labels,
      ...this.diameter_labels,
    ];
  }
}
