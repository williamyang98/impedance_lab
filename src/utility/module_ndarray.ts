import { Ndarray } from "./ndarray.ts";
import {
  type IModuleBuffer,
  Uint8ModuleBuffer,
  Int8ModuleBuffer,
  Uint16ModuleBuffer,
  Int16ModuleBuffer,
  Uint32ModuleBuffer,
  Int32ModuleBuffer,
  Float32ModuleBuffer,
  Float64ModuleBuffer,
} from "../wasm/index.ts";

export interface ModuleNdarray extends IModuleBuffer {
  readonly shape: number[];
  get ndarray(): Ndarray;
}

export class Uint8ModuleNdarray extends Uint8ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Int8ModuleNdarray extends Int8ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Uint16ModuleNdarray extends Uint16ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Int16ModuleNdarray extends Int16ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Uint32ModuleNdarray extends Uint32ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Int32ModuleNdarray extends Int32ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Float32ModuleNdarray extends Float32ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Float64ModuleNdarray extends Float64ModuleBuffer implements ModuleNdarray {
  readonly shape: number[];

  constructor(shape: number[]) {
    const length = shape.reduce((a,b) => a*b, 1);
    super(length);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}
