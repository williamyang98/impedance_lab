export interface GlyphCoord {
  screen: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  glyph_index: number;
}

const sizeof_f32 = 4;
const sizeof_u32 = 4;
const sizeof_coord = sizeof_f32*4 + sizeof_u32;

export class GlyphCoords {
  device: GPUDevice;
  cpu: GlyphCoord[];
  gpu?: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;
    this.cpu = [];
  }

  get length(): number {
    return this.cpu.length;
  }

  get byte_length(): number {
    return this.length*sizeof_coord;
  }

  clear() {
    this.cpu.length = 0;
  }

  push(coord: GlyphCoord) {
    this.cpu.push(coord);
  }

  write_to_gpu() {
    if (this.cpu.length === 0) return;

    const min_size_bytes = this.cpu.length*sizeof_coord;
    if (this.gpu === undefined) {
      this.gpu = this.device.createBuffer({
        size: min_size_bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
    } else if (this.gpu.size < min_size_bytes) {
      let new_size_bytes = this.gpu.size;
      while (new_size_bytes < min_size_bytes) {
        new_size_bytes *= 2;
      }
      this.gpu.destroy();
      this.gpu = this.device.createBuffer({
        size: new_size_bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
    }

    const buffer: Uint8Array<ArrayBuffer> = new Uint8Array(min_size_bytes);
    {
      let byte_offset = 0;
      const is_little_endian = true;
      const view = new DataView(buffer.buffer);
      const push_f32 = (value: number) => {
        view.setFloat32(byte_offset, value, is_little_endian);
        byte_offset += sizeof_f32;
      };
      const push_u32 = (value: number) => {
        view.setUint32(byte_offset, value, is_little_endian);
        byte_offset += sizeof_u32;
      };
      for (const coord of this.cpu) {
        push_f32(coord.screen.x);
        push_f32(coord.screen.y);
        push_f32(coord.screen.width);
        push_f32(coord.screen.height);
        push_u32(coord.glyph_index);
      }
    }

    this.device.queue.writeBuffer(this.gpu, 0, buffer.buffer, 0, buffer.byteLength);
  }
}
