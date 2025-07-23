export class WeakRefArray<T extends object> {
  elements = new Array<WeakRef<T>>();

  push(elem: T) {
    this.elements.push(new WeakRef(elem));
  }

  delete(elem: T): boolean {
    const index = this.elements.findIndex(ref => ref.deref() === elem);
    if (index < 0) return false;
    this.elements.splice(index, 1);
    return true;
  }

  deref(): T[] {
    return this.elements
      .map(elem => elem.deref())
      .filter(elem => elem !== undefined);
  }

  compact(): number {
    // move valid references to front of array then truncate
    let j = 0;
    for (let i = 0; i < this.elements.length; i++) {
      const ref = this.elements[i];
      if (ref.deref() === undefined) continue;
      if (i !== j) this.elements[j] = ref;
      j++;
    }
    const total_removed = this.elements.length-j;
    this.elements.length = j;
    return total_removed;
  }
}
