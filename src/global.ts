import { WasmModule } from "./wasm";

// Use globalThis to avoid different global being imported: https://stackoverflow.com/a/55396992
// syntax for declaring variable in globalThis: https://stackoverflow.com/a/69429093
declare global {
  // eslint-disable-next-line no-var
  var __wasm_module__: WasmModule | undefined;
}

export class Globals {
  static async init_wasm_module() {
    if (globalThis.__wasm_module__ !== undefined) {
      console.warn("Tried to initialise wasm module again");
    } else {
      globalThis.__wasm_module__ = await WasmModule.init();
    }
  }

  static get wasm_module(): WasmModule {
    if (globalThis.__wasm_module__ === undefined) {
      throw Error(`Wasm module was not initialised yet`);
    }
    return globalThis.__wasm_module__;
  }
}
