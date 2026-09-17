import { describe, expect, it } from 'vitest';
import { rowStates, searchSelection } from '../src/ui/interaction.js';
import type { RowState } from '../src/ui/interaction.js';

describe('result row states', () => {
  const ids = ['explore-repo', 'explain-selection', 'implement-ticket'];
  const current = (states: RowState[]): boolean[] => states.map(state => state.current);
  const cursor = (states: RowState[]): boolean[] => states.map(state => state.cursor);

  it('marks the loaded prompt, not the keyboard cursor, as current', () => {
    // Clicking the third row while the cursor sat at 0 previously left the
    // highlight on the first row while the third one filled below it.
    const states = rowStates(ids, 0, 'implement-ticket');
    expect(current(states)).toEqual([false, false, true]);
    expect(cursor(states)).toEqual([true, false, false]);
  });

  it('shows both states on one row when they coincide', () => {
    expect(rowStates(ids, 1, 'explain-selection')[1]).toEqual({ current: true, cursor: true });
  });

  it('marks nothing current before a prompt is loaded', () => {
    expect(current(rowStates(ids, 0, null))).toEqual([false, false, false]);
  });

  it('marks nothing current when the loaded prompt is filtered out of the results', () => {
    expect(current(rowStates(['explore-repo'], 0, 'implement-ticket'))).toEqual([false]);
  });

  it('keeps the cursor inside the result range', () => {
    expect(searchSelection(0, 'ArrowUp', 3)).toBe(0);
    expect(searchSelection(2, 'ArrowDown', 3)).toBe(2);
    expect(searchSelection(0, 'ArrowDown', 3)).toBe(1);
    expect(searchSelection(0, 'ArrowDown', 0)).toBe(-1);
  });
});
