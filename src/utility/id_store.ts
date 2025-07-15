export interface IdStore {
  own(id?: number): number;
}

export class ArenaIdStore {
  occupied: Set<number> = new Set();
  curr_head: number = 0;

  forward_head() {
    while (this.occupied.has(this.curr_head)) {
      this.curr_head += 1;
    }
  }

  borrow(): number {
    return this.curr_head;
  }

  own(id?: number): number {
    if (id !== undefined) {
      this.occupied.add(id);
      this.forward_head();
      return id;
    }
    this.occupied.add(this.curr_head);
    id = this.curr_head;
    this.curr_head += 1; // skip redundant check
    this.forward_head();
    return id;
  }

  free(id: number): boolean {
    if (!this.occupied.has(id)) return false;
    this.occupied.delete(id);
    this.curr_head = Math.min(this.curr_head, id);
    return true;
  }
}

export class BumpIdStore {
  curr_head: number = 0;

  own(id?: number): number {
    if (id !== undefined) {
      this.curr_head = Math.max(id, this.curr_head);
      return id;
    }
    id = this.curr_head;
    this.curr_head += 1;
    return id;
  }
}
