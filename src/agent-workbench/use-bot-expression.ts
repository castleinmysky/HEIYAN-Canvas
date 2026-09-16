import { useEffect, useRef, useState } from 'react';
import type { BotPose } from './living-state';
import { advanceBotMotion, botExpression, initialBotMotion, BOT_COMPLETION_MS } from './bot-motion';

// Owned by the persistent Dock, not the avatar: moving the Bot into a sidebar
// must not replay success. A restored completed snapshot is not a new completion.
export function useBotExpression(scope: string, pose: BotPose, visible: boolean, eligible = true) {
  const tracker = useRef(initialBotMotion(scope, pose));
  const [expression, setExpression] = useState<BotPose>(pose === 'done' ? 'idle' : pose);
  useEffect(() => {
    const now = Date.now();
    tracker.current = advanceBotMotion(tracker.current, scope, pose, visible, now, eligible);
    setExpression(botExpression(tracker.current, now));
    if (tracker.current.until > now) {
      const timer = window.setTimeout(() => setExpression(botExpression(tracker.current, Date.now())), tracker.current.until - now);
      return () => window.clearTimeout(timer);
    }
  }, [scope, pose, visible, eligible]);
  // Urgent state and real active state are never delayed by the effect/timer.
  return { pose: pose === 'done' ? expression === 'done' ? 'done' : 'idle' : pose,
    completionAt: tracker.current.until ? tracker.current.until - BOT_COMPLETION_MS : 0 } as const;
}

