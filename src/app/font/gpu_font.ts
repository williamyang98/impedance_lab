import * as cstruct from "../../utility/cstruct.ts";
import { type Font, type Glyph } from "./msdf.ts";

export interface GlyphInfo {
  glyph: Glyph;
  glyph_index?: number;
}

const GlyphCoordSchema = cstruct.struct({
  x: cstruct.primitive("f32"),
  y: cstruct.primitive("f32"),
  width: cstruct.primitive("f32"),
  height: cstruct.primitive("f32"),
});
type GlyphCoord = cstruct.InferOutput<typeof GlyphCoordSchema>;
const GlyphCoordLayout = GlyphCoordSchema.layout();
const sizeof_glyph_coord = GlyphCoordLayout.size_bytes;
const GlyphCoordArraySchema = cstruct.dynamic_array(GlyphCoordSchema);
const GlyphCoordArrayLayout = GlyphCoordArraySchema.layout();

export class GpuFont {
  device: GPUDevice;
  font: Font;
  atlas: GPUTexture;
  atlas_view: GPUTextureView;
  glyph_coords: GPUBuffer;
  glyph_table: Map<string, GlyphInfo>;

  constructor(font: Font, device: GPUDevice) {
    const cpu_data = font.image_data.data;
    const { height, width } = font.image_data;
    const total_pixels = height*width;
    const bytes_per_elem = cpu_data.BYTES_PER_ELEMENT;
    const EXPECTED_BYTES_PER_ELEM = 1;
    if (bytes_per_elem !== EXPECTED_BYTES_PER_ELEM) {
      throw Error(`Expected ${EXPECTED_BYTES_PER_ELEM} bytes per element in atlas but got ${bytes_per_elem} bytes`);
    }
    const byte_length = cpu_data.byteLength;
    const total_elements = byte_length / bytes_per_elem;
    const total_channels = total_elements/total_pixels;
    const EXPECTED_TOTAL_CHANNELS = 4;
    if (total_channels !== EXPECTED_TOTAL_CHANNELS) {
      throw Error(`Expected ${EXPECTED_TOTAL_CHANNELS} channels in atlas but got ${total_channels} channels`);
    }

    // texture atlas
    const atlas = device.createTexture({
      dimension: "2d",
      format: "rgba8unorm", // linear space not srgb
      mipLevelCount: 1,
      sampleCount: 1,
      size: [width, height, 1],
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    device.queue.writeTexture(
      { texture: atlas },
      cpu_data.buffer,
      { bytesPerRow: width*bytes_per_elem*total_channels },
      { width, height },
    );

    // glyph table
    const glyph_table = new Map<string, GlyphInfo>();
    const glyph_coords: GlyphCoord[] = [];
    for (const glyph of font.layout.glyphs) {
      const char = String.fromCharCode(glyph.unicode);
      const info: GlyphInfo = {
        glyph,
      };
      glyph_table.set(char, info);
      const atlas_bounds = glyph.atlasBounds;
      if (atlas_bounds === undefined) continue;
      const coords: GlyphCoord = {
        x: atlas_bounds.left/width,
        y: 1.0 - atlas_bounds.top/height, // flip vertically
        width: (atlas_bounds.right-atlas_bounds.left)/width,
        height: (atlas_bounds.top-atlas_bounds.bottom)/height,
      };
      const glyph_index = glyph_coords.length;
      glyph_coords.push(coords);
      info.glyph_index = glyph_index;
    }

    // glyph coords gpu buffer
    const cpu_glyph_coords_buffer = new ArrayBuffer(glyph_coords.length*sizeof_glyph_coord);
    const cpu_glyph_coords_view = GlyphCoordArrayLayout.array_buffer(cpu_glyph_coords_buffer).view;
    for (let i = 0; i < glyph_coords.length; i++) {
      const coord = glyph_coords[i];
      const view = cpu_glyph_coords_view.get(i);
      if (view === undefined) {
        throw Error(`Coord index out of range in buffer view index=${i}`);
      }
      view.x = coord.x;
      view.y = coord.y;
      view.width = coord.width;
      view.height = coord.height;
    }
    const gpu_glyph_coords = device.createBuffer({
      size: cpu_glyph_coords_buffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gpu_glyph_coords, 0, cpu_glyph_coords_buffer, 0, cpu_glyph_coords_buffer.byteLength);

    this.device = device;
    this.font = font;
    this.atlas = atlas;
    this.atlas_view = atlas.createView({ dimension: "2d", format: "rgba8unorm" });
    this.glyph_table = glyph_table;
    this.glyph_coords = gpu_glyph_coords;
  }
}
