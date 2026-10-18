import { describe, expect, it } from 'vitest';
import { COMPLETE_DELAY_MS, completeDialogDue } from '../../../src/ui/complete-screen.ts';

describe('completeDialogDue', () => {
  it('holds the dialog for 900 ms', () => {
    expect(COMPLETE_DELAY_MS).toBe(900);
  });

  it('is never due before the ball has dropped', () => {
    expect(completeDialogDue(null, 0)).toBe(false);
    expect(completeDialogDue(null, 1e9)).toBe(false);
  });

  it('is not due 899 ms after the drop', () => {
    expect(completeDialogDue(1000, 1899)).toBe(false);
  });

  it('is due at 900 ms and stays due afterwards', () => {
    expect(completeDialogDue(1000, 1900)).toBe(true);
    expect(completeDialogDue(1000, 6000)).toBe(true);
  });
});
