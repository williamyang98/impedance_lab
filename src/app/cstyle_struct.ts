export type StructFieldType =
  "s8" | "u8" |
  "s16" | "u16" |
  "s32" | "u32" |
  "f32" | "f64";

interface FieldAccessor {
  size: number;
  getter: (view: DataView, offset: number) => number;
  setter: (view: DataView, offset: number, value: number) => void;
}

const get_field_accessor = (dtype: StructFieldType): FieldAccessor => {
  switch (dtype) {
  case "s8":  return {
    size: 1,
    getter: (view, offset) => view.getInt8(offset),
    setter: (view, offset, value) => view.setInt8(offset, value),
  };
  case "u8":  return {
    size: 1,
    getter: (view, offset) => view.getUint8(offset),
    setter: (view, offset, value) => view.setUint8(offset, value),
  };
  case "s16": return {
    size: 2,
    getter: (view, offset) => view.getInt16(offset, true),
    setter: (view, offset, value) => view.setInt16(offset, value, true),
  };
  case "u16": return {
    size: 2,
    getter: (view, offset) => view.getUint16(offset, true),
    setter: (view, offset, value) => view.setUint16(offset, value, true),
  };
  case "s32": return {
    size: 4,
    getter: (view, offset) => view.getInt32(offset, true),
    setter: (view, offset, value) => view.setInt32(offset, value, true),
  };
  case "u32": return {
    size: 4,
    getter: (view, offset) => view.getUint32(offset, true),
    setter: (view, offset, value) => view.setUint32(offset, value, true),
  };
  case "f32": return {
    size: 4,
    getter: (view, offset) => view.getFloat32(offset, true),
    setter: (view, offset, value) => view.setFloat32(offset, value, true),
  };
  case "f64": return {
    size: 8,
    getter: (view, offset) => view.getFloat64(offset, true),
    setter: (view, offset, value) => view.setFloat64(offset, value, true),
  };
  }
}

interface StructViewField {
  offset: number,
  getter: (view: DataView, offset: number) => number;
  setter: (view: DataView, offset: number, value: number) => void;
}

export class StructView<T extends Record<string, StructFieldType>> {
  buffer: ArrayBuffer;
  private view: DataView;
  private views: Record<keyof T, StructViewField>;

  constructor(fields: T) {
    // compute field offsets
    let offset = 0;
    const views: Partial<Record<keyof T, StructViewField>> = {};
    for (const name in fields) {
      const type: StructFieldType = fields[name];
      const accessor = get_field_accessor(type)
      const view = {
        offset,
        getter: accessor.getter,
        setter: accessor.setter,
      };
      views[name] = view;
      offset += accessor.size;
    }
    const total_bytes = offset;
    this.buffer = new ArrayBuffer(total_bytes);
    this.view = new DataView(this.buffer);
    this.views = views as Record<keyof T, StructViewField>;
  }

  get<K extends keyof T>(key: K): number {
    const view = this.views[key];
    return view.getter(this.view, view.offset);
  }

  set<K extends keyof T>(key: K, value: number) {
    const view = this.views[key];
    return view.setter(this.view, view.offset, value);
  }
}
