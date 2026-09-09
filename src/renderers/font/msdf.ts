export interface Layout {
  atlas: Atlas;
  metrics: Metrics;
  glyphs: Glyph[];
  kerning: Kerning[];
}

export interface Atlas {
  type: string;
  distanceRange: number;
  distanceRangeMiddle: number;
  size: number;
  width: number;
  height: number;
  yOrigin: string;
}

export interface Metrics {
  emSize: number;
  lineHeight: number;
  ascender: number;
  descender: number;
  underlineY: number;
  underlineThickness: number;
}

export interface Glyph {
  unicode: number;
  advance: number;
  planeBounds?: Bounds;
  atlasBounds?: Bounds;
}

export interface Bounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export type Kerning = unknown;

export async function decode_png_to_image_data(url: string): Promise<ImageData> {
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw Error("Failed to create offscreen 2d canvas when loading png image");
  }
  context.drawImage(bitmap, 0, 0);
  const image_data = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return image_data;
}

export interface Font {
  layout: Layout;
  image_data: ImageData;
}
