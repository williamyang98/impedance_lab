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

function is_array_like(obj: StructFieldType | StructFieldType[]): obj is StructFieldType[] {
  return typeof obj !== 'string';
}

export type FieldKey<T,V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

export class StructView<T extends Record<string, StructFieldType | StructFieldType[]>> {
  buffer: ArrayBuffer;
  private view: DataView;
  private views: Record<keyof T, StructViewField | StructViewField[]>;

  constructor(fields: T) {

    // compute field offsets
    let offset = 0;
    const views: Partial<typeof this.views> = {};
    for (const name in fields) {
      const field = fields[name];
      if (typeof(field) === "string") {
        const type: StructFieldType = field;
        const accessor = get_field_accessor(type)
        const view = {
          offset,
          getter: accessor.getter,
          setter: accessor.setter,
        };
        views[name] = view;
        offset += accessor.size;
      } else if (is_array_like(field)) {
        const types: StructFieldType[] = field;
        const view_arr: StructViewField[] = [];
        for (const type of types) {
          const accessor = get_field_accessor(type)
          const view = {
            offset,
            getter: accessor.getter,
            setter: accessor.setter,
          }
          offset += accessor.size;
          view_arr.push(view);
        }
        views[name] = view_arr;
      }
    }
    const total_bytes = offset;
    this.buffer = new ArrayBuffer(total_bytes);
    this.view = new DataView(this.buffer);
    this.views = views as Record<keyof T, StructViewField>;
  }

  get<K extends FieldKey<T, StructFieldType>>(key: K): number {
    const view = this.views[key] as StructViewField;
    return view.getter(this.view, view.offset);
  }

  set<K extends FieldKey<T, StructFieldType>>(key: K, value: number) {
    const view = this.views[key] as StructViewField;
    view.setter(this.view, view.offset, value);
  }

  get_array<K extends FieldKey<T, ArrayLike<StructFieldType>>>(key: K): number[] {
    const views = this.views[key] as StructViewField[];
    return views.map(view => view.getter(this.view, view.offset));
  }

  set_array<K extends FieldKey<T, ArrayLike<StructFieldType>>>(key: K, values: number[]) {
    const views = this.views[key] as StructViewField[];
    if (views.length !== values.length) {
      throw Error(`Mismatching number of elements view=${views.length}, values=${values.length}`);
    }
    const N = views.length;
    for (let i = 0; i < N; i++) {
      const view = views[i];
      const value = values[i];
      view.setter(this.view, view.offset, value);
    }
  }
}
