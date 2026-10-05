import { genericAdapter } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import type { AdapterContext, PlatformAdapter } from './types';

/** Platform adapters register here; generic is always the fallback. */
export const ADAPTERS: PlatformAdapter[] = [greenhouseAdapter, leverAdapter, genericAdapter];

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
