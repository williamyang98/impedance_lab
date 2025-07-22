import { Editor } from "./editor.ts";
import {
  // type Stackup, type Parameter,
  type Orientation, type Position,
  // type ReferencePlane,
  Rules,
} from "./stackup.ts";
import type {
  Visualiser, Viewport,
  // HorizontalDimensionLine, VerticalDimensionLine,
  RectangleShape,
  // PolygonShape, PolygonPoint,
  // TextLabel, IconLabel,
  Entity,
} from "../visualiser_2d/visualiser.ts";

const sizes = {
  plane_height: 10,
  etch_factor: 0.35,
  barrel_diameter: 50,
  barrel_copper_thickness: 10,
  pad_diameter: 100,
  antipad_diameter: 125,
  dielectric_height: 30,
  soldermask_height: 10,
  stackup_width: 190,
};

const colours = {
  copper: "#eacc2d",
  copper_selectable: "#eacc2d66",
  dielectric_soldermask: "#00aa00",
  dielectric_soldermask_selectable: "#00aa0044",
  dielectric_prepreg: "#55cc33",
  dielectric_core: "#88ed44",
  dielectric_barrel: "#b4f38fff",
};

// const font = {
//   glyph_height: 0.75,
//   size: 9,
//   colour: "#000000",
//   weight: 500,
// };

const stroke = {
  outline_colour: "#00000040",
  outline_width: 0.5,
  arm_colour: "#000000",
  arm_width: 0.5,
  arm_stroke_style: [2,2],
  line_colour: "#000000",
  line_width: 0.5,
  arrow_size: 4,
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

export class StackupVisualiser implements Visualiser {
  editor: Editor;
  is_editing: boolean
  reference_planes: ReferencePlaneEntity[] = [];
  reference_plane_groups = new Map<string, ReferencePlaneEntity[]>();
  via_pads: ViaPadEntity[] = [];
  via_pad_groups = new Map<string, ViaPadEntity[]>();
  via_barrel: RectangleShape[] = [];
  dielectric_layers: RectangleShape[] = [];
  soldermask_layers: RectangleShape[] = [];
  stackup_bounds: StackupBounds;

  constructor(editor: Editor, is_editing: boolean) {
    this.is_editing = is_editing;
    this.editor = editor;
    this.stackup_bounds = this.create_visualiser();
  }

  create_visualiser(): StackupBounds {
    const stackup = this.editor.stackup;

    let y_offset = 0;
    const y_stackup_top = y_offset;
    let y_copper_top = Infinity;
    let y_copper_bottom = -Infinity;
    const push_y_copper = (y: number) => {
      y_copper_top = Math.min(y_copper_top, y);
      y_copper_bottom = Math.max(y_copper_bottom, y);
    };

    for (let i = 0; i < stackup.layers.length; i++) {
      const layer = stackup.layers[i];
      switch (layer.type) {
        case "surface": {
          // dielectric
          const y_top = y_offset;
          {
            let height = 0;
            if (Rules.plane_has_copper(layer.plane) || this.is_editing) height += sizes.plane_height;
            if (layer.soldermask || this.is_editing) {
              height += sizes.soldermask_height;
            }
            this.create_soldermask_layer(y_top, height, layer.soldermask !== undefined, i);
            y_offset += height;
          }
          const y_bottom = y_offset;
          const is_bottom = i === 0;
          const orientation: Orientation = is_bottom ? "bottom" : "top";
          // via pad and reference planes
          const y_plane = is_bottom ? y_bottom-sizes.plane_height : y_top;
          push_y_copper(y_plane);
          push_y_copper(y_plane+sizes.plane_height);
          this.create_via_pad(y_plane, layer.plane.Dpad !== undefined, i, orientation);
          this.create_reference_plane(y_plane, layer.plane.Dantipad !== undefined, i, orientation);
          break;
        }
        case "inner": {
          // dielectric
          const y_top = y_offset;
          {
            let height = sizes.dielectric_height;
            let colour = colours.dielectric_core;
            if (Rules.plane_has_copper(layer.planes.top) || this.is_editing) {
              height += sizes.plane_height;
              colour = colours.dielectric_prepreg;
            }
            if (Rules.plane_has_copper(layer.planes.bottom) || this.is_editing) {
              height += sizes.plane_height;
              colour = colours.dielectric_prepreg;
            }
            this.create_dielectric_layer(y_top, height, colour);
            y_offset += height;
          }
          const y_bottom = y_offset;
          // via pads
          {
            const y_via = y_top;
            const orientation: Orientation = "top";
            this.create_via_pad(y_via, layer.planes.top.Dpad !== undefined, i, orientation);
            this.create_reference_plane(y_via, layer.planes.top.Dantipad !== undefined, i, orientation);
            push_y_copper(y_via);
            push_y_copper(y_via+sizes.plane_height);
          }
          {
            const y_via = y_bottom-sizes.plane_height;
            const orientation: Orientation = "bottom";
            this.create_via_pad(y_via, layer.planes.bottom.Dpad !== undefined, i, orientation);
            this.create_reference_plane(y_via, layer.planes.bottom.Dantipad !== undefined, i, orientation);
            push_y_copper(y_via);
            push_y_copper(y_via+sizes.plane_height);
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
          y_top: y_copper_top,
          y_bottom: y_copper_bottom,
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
        y_top: y_copper_top,
        y_bottom: y_copper_bottom,
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

  create_soldermask_layer(y: number, height: number, exists: boolean, layer_index: number) {
    if (!exists && !this.is_editing) return;
    const colour = exists ? colours.dielectric_soldermask : colours.dielectric_soldermask_selectable;
    const is_hoverable = !exists && this.is_editing;
    let on_click = undefined;
    if (this.is_editing) {
      if (exists) {
        on_click = () => this.editor.remove_soldermask(layer_index);
      } else {
        on_click = () => this.editor.add_soldermask(layer_index);
      }
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
  }

  create_via_pad(y: number, exists: boolean, layer_index: number, orientation: Orientation) {
    const group_id = `${layer_index}_${orientation}`;
    const layer = this.editor.stackup.layers[layer_index];
    const position: Position = { layer_id: layer.id, orientation };
    const is_ghost = !exists;

    let on_click = undefined;
    let is_hoverable = false;
    let is_visible = exists;
    if (this.is_editing && exists && this.editor.can_remove_via_pad(position)) {
      on_click = () => this.editor.remove_via_pad(position);
    }
    if (this.is_editing && !exists && this.editor.can_add_via_pad(position)) {
      on_click = () => this.editor.add_via_pad(position);
      is_hoverable = true;
      is_visible = true;
    }

    const height = sizes.plane_height;
    const Dpad = sizes.pad_diameter;
    const Dbarrel = sizes.barrel_diameter;

    const create_entity = (x_left: number, x_right: number): ViaPadEntity => {
      return {
        type: "rectangle_shape",
        parent: this,
        is_ghost,
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
    const entities = is_visible ? [
      create_entity(-Dpad/2, -Dbarrel/2),
      create_entity(Dbarrel/2, Dpad/2),
    ] : [];
    this.via_pads.push(...entities);
    if (is_hoverable) this.register_via_group(group_id, entities);
  }

  register_via_group(id: string, entities: ViaPadEntity[]) {
    let group = this.via_pad_groups.get(id);
    if (group === undefined) {
      group = [];
      this.via_pad_groups.set(id, group);
    }
    group?.push(...entities);
  }

  on_via_hover(group_tag: string, is_hover: boolean) {
    const pads = this.via_pad_groups.get(group_tag);
    if (pads === undefined) return;
    for (const pad of pads) {
      pad.is_ghost = !is_hover;
    }
  }

  create_reference_plane(y: number, exists: boolean, layer_index: number, orientation: Orientation) {
    const group_id = `${layer_index}_${orientation}`;
    const layer = this.editor.stackup.layers[layer_index];
    const position: Position = { layer_id: layer.id, orientation };
    const is_ghost = !exists;

    let on_click = undefined;
    let is_hoverable = false;
    let is_visible = exists;
    if (this.is_editing && exists && this.editor.can_remove_reference_plane(position)) {
      on_click = () => this.editor.remove_reference_plane(position);
    }
    if (this.is_editing && !exists && this.editor.can_add_reference_plane(position)) {
      on_click = () => this.editor.add_reference_plane(position);
      is_hoverable = true;
      is_visible = true;
    }

    const Dantipad = sizes.antipad_diameter;
    const height = sizes.plane_height;

    const create_entity = (x_left: number, x_right: number): ReferencePlaneEntity => {
      return {
        type: "rectangle_shape",
        parent: this,
        is_ghost,
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

    const entities = is_visible ? [
      create_entity(-sizes.stackup_width/2, -Dantipad/2),
      create_entity(Dantipad/2, sizes.stackup_width/2),
    ] : [];

    this.reference_planes.push(...entities);
    if (is_hoverable) this.register_reference_plane_group(group_id, entities);
  };

  register_reference_plane_group(id: string, entities: ReferencePlaneEntity[]) {
    let group = this.reference_plane_groups.get(id);
    if (group === undefined) {
      group = [];
      this.reference_plane_groups.set(id, group);
    }
    group?.push(...entities);
  }

  on_plane_hover(group_tag: string, is_hover: boolean) {
    const planes = this.reference_plane_groups.get(group_tag);
    if (planes === undefined) return;
    for (const plane of planes) {
      plane.is_ghost = !is_hover;
    }
  }

  get viewport(): Viewport {
    const padding = 0.5;
    return {
      x_left: this.stackup_bounds.x_left-padding,
      x_right: this.stackup_bounds.x_right+padding,
      y_top: this.stackup_bounds.y_top-padding,
      y_bottom: this.stackup_bounds.y_bottom+padding,
    }
  }

  get entities(): Entity[] {
    return [
      ...this.dielectric_layers,
      ...this.soldermask_layers,
      ...this.reference_planes,
      ...this.via_pads,
      ...this.via_barrel,
    ];
  }
}
