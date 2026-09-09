import { GpuFont } from "./gpu_font.ts";
import { GlyphCoords } from "./glyph_coords.ts";
import { type Vec2 } from "../../utility/dim_types.ts";

export class Printer {
  device: GPUDevice;
  font: GpuFont;
  glyph_coords: GlyphCoords;
  cursor: Vec2<number>;
  is_dirty: boolean;

  constructor(font: GpuFont) {
    this.device = font.device;
    this.font = font;
    this.glyph_coords = new GlyphCoords(this.device);
    this.cursor = {
      x: 0,
      y: 0,
    };
    this.is_dirty = false;
  }

  reset() {
    this.glyph_coords.clear();
    this.cursor = { x: 0, y: 0 };
  }

  print(line: string, font_size?: number) {
    font_size = font_size ?? 12.0;
    const line_height = this.font.font.layout.metrics.lineHeight*font_size;
    for (const char of line) {
      if (char === "\n") {
        this.cursor.y += line_height;
        this.cursor.x = 0;
        this.is_dirty = true;
        continue;
      }
      const info = this.font.glyph_table.get(char);
      if (info === undefined) continue;
      const glyph = info.glyph;
      const { x, y } = this.cursor;
      const advance = info.glyph.advance*font_size;
      if (info.glyph_index !== undefined && glyph.planeBounds !== undefined) {
        const bounds = glyph.planeBounds;
        const x_min = x+bounds.left*font_size;
        const x_max = x+bounds.right*font_size;
        const y_min = y+line_height-bounds.top*font_size; // flip vertical component of bounding box
        const y_max = y+line_height-bounds.bottom*font_size;
        const width = x_max-x_min;
        const height = y_max-y_min;
        this.glyph_coords.push({
          screen: {
            x: x_min,
            y: y_min,
            width,
            height,
          },
          glyph_index: info.glyph_index,
        });
        this.is_dirty = true;
      }
      this.cursor.x = x+advance;
    }
  }

  finish() {
    if (!this.is_dirty) {
      console.warn("Tried to finish off printer which wasn't used");
      return;
    }
    this.glyph_coords.write_to_gpu();
    this.is_dirty = false;
  }
}
