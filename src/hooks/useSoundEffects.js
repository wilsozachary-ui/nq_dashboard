/**
 * useSoundEffects — scaffold for future audio feedback.
 *
 * Audio is intentionally NOT implemented yet.  When ready, replace the
 * no-op function bodies with Web Audio API calls or an audio library.
 *
 * Usage:
 *   const { tradeReceivedSound, pnlPositiveSound, pnlNegativeSound } = useSoundEffects();
 *
 *   // Call at the appropriate moment:
 *   tradeReceivedSound();   // when a WebSocket trade event arrives
 *   pnlPositiveSound();     // when daily / session P&L crosses into positive
 *   pnlNegativeSound();     // when daily / session P&L crosses into negative
 */

import { useCallback } from 'react';

export function useSoundEffects() {
  // Scaffold — replace bodies with real audio calls when ready.
  const tradeReceivedSound = useCallback(() => {
    // e.g. audioCtx.playBuffer('tick');
  }, []);

  const pnlPositiveSound = useCallback(() => {
    // e.g. audioCtx.playBuffer('chime_up');
  }, []);

  const pnlNegativeSound = useCallback(() => {
    // e.g. audioCtx.playBuffer('chime_down');
  }, []);

  return { tradeReceivedSound, pnlPositiveSound, pnlNegativeSound };
}
