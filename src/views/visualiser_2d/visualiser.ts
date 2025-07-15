import { type FunctionalComponent } from "vue";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface Text {
  data: string;
  size: number;
  weight: number;
  colour: string;
}

export interface Icon {
  component: FunctionalComponent;
  colour: string;
  width: number;
  height: number;
}

// NOTE: (x,y) coordinates follow the SVG convention where x is left to right, y is top to bottom

export interface HorizontalDimensionLine {
  readonly type: "horizontal_dimension_line";
  x_left: number;
  x_right: number;
  y_line: number;
  text: Text;
  y_text?: number;
  text_horizontal_align: HorizontalAlign;
  text_vertical_align: VerticalAlign;
  colour: string;
  line_width: number;
  arrow_size: number;
  left_extension_line?: {
    y_top: number;
    y_bottom: number;
    line_width?: number;
    line_style?: number[];
  },
  right_extension_line?: {
    y_top: number;
    y_bottom: number;
    line_width?: number;
    line_style?: number[];
  },
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface VerticalDimensionLine {
  readonly type: "vertical_dimension_line";
  y_top: number;
  y_bottom: number;
  x_line: number;
  text: Text;
  x_text?: number;
  text_horizontal_align: HorizontalAlign;
  text_vertical_align: VerticalAlign;
  colour: string;
  line_width: number;
  arrow_size: number;
  top_extension_line?: {
    x_left: number;
    x_right: number;
    line_width?: number;
    line_style?: number[];
  },
  bottom_extension_line?: {
    x_left: number;
    x_right: number;
    line_width?: number;
    line_style?: number[];
  },
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface RectangleShape {
  readonly type: "rectangle_shape";
  x_left: number;
  x_right: number;
  y_top: number;
  y_bottom: number;
  fill_colour?: string;
  stroke_colour?: string;
  stroke_width?: number;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface PolygonShape {
  readonly type: "polygon_shape";
  points: PolygonPoint[];
  fill_colour?: string;
  stroke_colour?: string;
  stroke_width?: number;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface EllipseShape {
  readonly type: "ellipse_shape";
  x: number;
  y: number;
  radius_x: number;
  radius_y: number;
  fill_colour?: string;
  stroke_colour?: string;
  stroke_width?: number;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface CircleShape {
  readonly type: "circle_shape";
  x: number;
  y: number;
  radius: number;
  fill_colour?: string;
  stroke_colour?: string;
  stroke_width?: number;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface TextLabel {
  readonly type: "text_label";
  x: number;
  y: number;
  text: Text;
  horizontal_align: HorizontalAlign;
  vertical_align: VerticalAlign;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export interface IconLabel {
  readonly type: "icon_label";
  x: number;
  y: number;
  icon: Icon;
  horizontal_align: HorizontalAlign;
  vertical_align: VerticalAlign;
  on_click?: () => void;
  on_hover?: (is_hover: boolean) => void;
}

export type Entity =
  HorizontalDimensionLine | VerticalDimensionLine |
  RectangleShape | PolygonShape | EllipseShape | CircleShape |
  TextLabel | IconLabel;

export interface Viewport {
  x_left: number;
  x_right: number;
  y_top: number;
  y_bottom: number;
}

export interface Visualiser {
  _viewport: Viewport;
  entities: Entity[];
}
