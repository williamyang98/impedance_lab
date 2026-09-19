export interface GPUTimestamp {
  start_ns: bigint;
  end_ns: bigint;
  elapsed_ns: bigint;
}

export class GPUTimer {
  device: GPUDevice;
  query_set: GPUQuerySet;
  query_buffer: GPUBuffer;
  query_buffer_readback: GPUBuffer;
  length: number;

  constructor(device: GPUDevice, length: number) {
    const sizeof_u64 = 8;
    this.length = length;
    this.device = device;
    this.query_set = this.device.createQuerySet({
      type: "timestamp",
      count: 2*length,
    });
    this.query_buffer = this.device.createBuffer({
      label: "query_resolve_buffer",
      size: sizeof_u64*this.query_set.count,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    // NOTE: the reason why we need this additional readback buffer is because MAP_READ can only be used with COPY_DST
    this.query_buffer_readback = this.device.createBuffer({
      label: "query_resolve_buffer_map",
      size: this.query_buffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  get_timestamp_writes(index: number): GPUComputePassTimestampWrites {
    if (index < 0 || index >= this.length) {
      throw Error(`Timestamp index ${index} is out of bounds of length ${this.length}`);
    }
    return {
      querySet: this.query_set,
      beginningOfPassWriteIndex: 2*index,
      endOfPassWriteIndex: 2*index+1,
    }
  }

  enqueue_read(command_encoder: GPUCommandEncoder) {
    command_encoder.resolveQuerySet(this.query_set, 0, 2*this.length, this.query_buffer, 0);
    command_encoder.copyBufferToBuffer(this.query_buffer, this.query_buffer_readback, this.query_buffer.size);
  }

  async read_timestamps() {
    const buffer = this.query_buffer_readback;
    await buffer.mapAsync(GPUMapMode.READ, 0, buffer.size);
    const data = new BigUint64Array(buffer.getMappedRange(0, buffer.size).slice(0));
    buffer.unmap();

    const timestamps: GPUTimestamp[] = [];
    for (let i = 0; i < this.length; i++) {
      const start_ns = data[2*i];
      const end_ns = data[2*i+1];
      const elapsed_ns = end_ns-start_ns;
      timestamps.push({
        start_ns,
        end_ns,
        elapsed_ns,
      });
    }
    return timestamps;
  }

  destroy() {
    this.query_set.destroy();
    this.query_buffer.destroy();
    this.query_buffer_readback.destroy();
  }
}
