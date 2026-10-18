/**
 * Undo history of one document in Studio: every tool applied adds a state,
 * undo and redo move between them. The file as it was opened is kept apart
 * so "back to the original" works even after old steps were dropped.
 */

export interface HistoryStep {
  label: string;
  bytes: Uint8Array;
}

export const MAX_STEPS = 20;

export class EditHistory {
  readonly original: Uint8Array;
  /** states[0] is the base: the original, or the oldest state still kept. */
  private states: HistoryStep[];
  private index = 0;
  private saved: Uint8Array;

  constructor(
    original: Uint8Array,
    private readonly maxSteps = MAX_STEPS
  ) {
    this.original = original;
    this.states = [{ label: '', bytes: original }];
    this.saved = original;
  }

  get current(): Uint8Array {
    return this.states[this.index].bytes;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  /** Differs from what was last saved (or opened). */
  get dirty(): boolean {
    return this.current !== this.saved;
  }

  /** Labels of the steps applied so far, oldest first (undone ones left out). */
  get steps(): string[] {
    return this.states.slice(1, this.index + 1).map((step) => step.label);
  }

  /** Labels of the steps that redo would bring back, next one first. */
  get undone(): string[] {
    return this.states.slice(this.index + 1).map((step) => step.label);
  }

  push(label: string, bytes: Uint8Array): void {
    this.states = this.states.slice(0, this.index + 1);
    this.states.push({ label, bytes });
    // Too many: the oldest step becomes the base, which undo stops at.
    while (this.states.length - 1 > this.maxSteps) this.states.shift();
    this.index = this.states.length - 1;
  }

  undo(): Uint8Array | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.current;
  }

  redo(): Uint8Array | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.current;
  }

  /** Back to the file as it was opened, as one more step that undo reverts. */
  revert(label: string): Uint8Array | null {
    if (this.current === this.original) return null;
    this.push(label, this.original);
    return this.current;
  }

  markSaved(bytes: Uint8Array = this.current): void {
    this.saved = bytes;
  }
}
