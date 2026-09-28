import * as cstruct from "../../utility/cstruct.ts";

const GlyphCoordSchema = cstruct.struct({
  screen: cstruct.struct({
    x: cstruct.primitive("f32"),
    y: cstruct.primitive("f32"),
    width: cstruct.primitive("f32"),
    height: cstruct.primitive("f32"),
  }),
  glyph_index: cstruct.primitive("u32"),
});

const GlyphCoordLayout = GlyphCoordSchema.layout();
const sizeof_coord = GlyphCoordLayout.size_bytes;

export type GlyphCoord = cstruct.InferOutput<typeof GlyphCoordSchema>;

const GlyphCoordArraySchema = cstruct.dynamic_array(GlyphCoordSchema);
const GlyphCoordArrayLayout = GlyphCoordArraySchema.layout();

class Buffer {
  cpu: ArrayBuffer;
  gpu: GPUBuffer;
  device: GPUDevice;

  constructor(device: GPUDevice, size: number) {
    this.device = device;
    this.cpu = new ArrayBuffer(size);
    this.gpu = device.createBuffer({
      size: size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  }

  get size(): number {
    return this.cpu.byteLength;
  }

  destroy() {
    this.gpu.destroy();
  }

  array_view() {
    const coords_buffer = GlyphCoordArrayLayout.array_buffer(this.cpu);
    return coords_buffer.view;
  }

  write_to_gpu(size?: number) {
    size = size ?? this.cpu.byteLength;
    this.device.queue.writeBuffer(this.gpu, 0, this.cpu, 0, size);
  }
}

export class GlyphCoords {
  device: GPUDevice;
  coords: GlyphCoord[];
  buffer?: Buffer;

  constructor(device: GPUDevice) {
    this.device = device;
    this.coords = [];
    this.buffer = undefined;
  }

  get length(): number {
    return this.coords.length;
  }

  get byte_length(): number {
    return this.length*sizeof_coord;
  }

  clear() {
    this.coords.length = 0;
  }

  push(coord: GlyphCoord) {
    this.coords.push(coord);
  }

  resize_gpu_buffer_to_fit_cpu(): asserts this is this & { buffer: Buffer } {
    const min_size_bytes = this.coords.length*sizeof_coord;
    if (this.buffer === undefined) {
      this.buffer = new Buffer(this.device, min_size_bytes);
    } else if (this.buffer.size < min_size_bytes) {
      let new_size_bytes = this.buffer.size;
      while (new_size_bytes < min_size_bytes) {
        new_size_bytes *= 2;
      }
      this.buffer.destroy();
      this.buffer = new Buffer(this.device, new_size_bytes);
    }
  }

  write_to_gpu() {
    if (this.coords.length === 0) return;
    this.resize_gpu_buffer_to_fit_cpu();

    const coord_array_view = this.buffer.array_view();
    for (let i = 0; i < this.coords.length; i++) {
      const coord = this.coords[i];
      const view = coord_array_view.get(i);
      if (view === undefined) {
        throw Error(`Coord index out of range in buffer view index=${i}`);
      }
      view.screen.x = coord.screen.x;
      view.screen.y = coord.screen.y;
      view.screen.width = coord.screen.width;
      view.screen.height = coord.screen.height;
      view.glyph_index = coord.glyph_index;
    }
    const total_bytes = this.coords.length*sizeof_coord;
    this.buffer.write_to_gpu(total_bytes);
  }
}
