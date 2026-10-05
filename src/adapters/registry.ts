import { genericAdapter } from './generic';
import type { AdapterContext, PlatformAdapter } from './types';

/** Platform adapters register here as they are added; generic is always the fallback. */
export const ADAPTERS: PlatformAdapter[] = [genericAdapter];

export function pickAdapter(ctx: AdapterContext, adapters: PlatformAdapter[] = ADAPTERS): PlatformAdapter {
  let best = genericAdapter;
  let bestScore = -1;
  for (const a of adapters) {
    const s = a.detect(ctx);
    if (s > bestScore) {
      best = a;
      bestScore = s;
    }
  }
  return best;
}
