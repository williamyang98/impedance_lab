export class TestStorage implements Storage {
  #store = new Map();

  get length(): number {
    return this.#store.size;
  }

  clear() {
    this.#store.clear();
  }

  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key) : null;
  }

  key(index: number): string | null {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.#store.delete(key);
  }

  setItem(key: string, value: string) {
    this.#store.set(key, value);
  }
}
