import { WasmModule } from "./index.ts";

type StackTrace = string;

export class ReferenceBlock {
  readonly type: "reference_block";
  readonly module: WasmModule;
  count: number;
  children: Set<ManagedObject>;
  stack_trace?: StackTrace;

  constructor(module: WasmModule, parent: ManagedObject) {
    this.type = "reference_block";
    this.module = module;
    this.count = 1;
    this.children = new Set();
    if (import.meta.env.DEV) {
      this.stack_trace = new Error().stack;
    }
    this.module.register_object(parent, this);
  }

  add_children(parent: ManagedObject) {
    const fields = Object.values(parent);
    for (const field of fields) {
      // check if field is a ManagedObject
      if (field === null || field === undefined) continue;
      if (typeof field !== "object") continue;
      const reference_block = field.reference_block;
      if (reference_block === null || reference_block === undefined) continue;
      if (typeof reference_block !== "object") continue;
      if (reference_block.type !== "reference_block") continue;
      this.children.add(field as ManagedObject);
    }
  }

  clone() {
    this.count += 1;
  }

  delete(parent: ManagedObject): boolean {
    if (this.count <= 0) {
      console.error(`Attempted to double free with ref_count=${this.count}`);
      return true;
    }
    this.count -= 1;
    if (this.count > 0) return false;
    this.module.unregister_object(parent);
    return true;
  }

  is_deleted(): boolean {
    return this.count <= 0;
  }
}

export interface ManagedObject {
  get module(): WasmModule;
  get reference_block(): ReferenceBlock;
  clone(): this;
  delete(): boolean;
  is_deleted(): boolean;
}
