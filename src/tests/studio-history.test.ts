import { describe, expect, it } from 'vitest';
import { EditHistory } from '../js/desktop/studio/history.js';

const bytes = (n: number) => new Uint8Array([n]);

describe('EditHistory', () => {
  it('starts clean on the original', () => {
    const original = bytes(0);
    const history = new EditHistory(original);
    expect(history.current).toBe(original);
    expect(history.dirty).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.steps).toEqual([]);
  });

  it('undoes and redoes steps in order', () => {
    const history = new EditHistory(bytes(0));
    const a = bytes(1);
    const b = bytes(2);
    history.push('a', a);
    history.push('b', b);
    expect(history.steps).toEqual(['a', 'b']);
    expect(history.undo()).toBe(a);
    expect(history.steps).toEqual(['a']);
    expect(history.undone).toEqual(['b']);
    expect(history.redo()).toBe(b);
    expect(history.redo()).toBeNull();
  });

  it('drops the redo branch when a new step is applied', () => {
    const history = new EditHistory(bytes(0));
    history.push('a', bytes(1));
    history.push('b', bytes(2));
    history.undo();
    history.push('c', bytes(3));
    expect(history.steps).toEqual(['a', 'c']);
    expect(history.canRedo).toBe(false);
  });

  it('is dirty until saved, and dirty again after undoing past the save', () => {
    const original = bytes(0);
    const history = new EditHistory(original);
    history.push('a', bytes(1));
    expect(history.dirty).toBe(true);
    history.markSaved();
    expect(history.dirty).toBe(false);
    history.undo();
    expect(history.current).toBe(original);
    expect(history.dirty).toBe(true);
  });

  it('keeps at most maxSteps, the oldest folding into the base', () => {
    const history = new EditHistory(bytes(0), 3);
    for (let i = 1; i <= 5; i++) history.push(`s${i}`, bytes(i));
    expect(history.steps).toEqual(['s3', 's4', 's5']);
    history.undo();
    history.undo();
    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.current[0]).toBe(2);
  });

  it('reverts to the original as an undoable step', () => {
    const original = bytes(0);
    const history = new EditHistory(original, 2);
    history.push('a', bytes(1));
    history.push('b', bytes(2));
    history.push('c', bytes(3));
    expect(history.revert('back')).toBe(original);
    expect(history.dirty).toBe(false);
    expect(history.undo()?.[0]).toBe(3);
    history.redo();
    expect(history.revert('back')).toBeNull();
  });
});
