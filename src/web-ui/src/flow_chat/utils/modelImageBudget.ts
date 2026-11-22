import type { AIModelConfig } from '@/infrastructure/config/types';
import { getEffectiveModelCapabilities, isSelectableTextChatModel } from '@/infrastructure/config/services/modelCategory';

/** Every native image route must accept the draft before automatic selection. */
export function modelSelectionImageLimit(
  models: readonly AIModelConfig[],
  primary?: AIModelConfig | null,
  poolMemberIds?: readonly string[],
): number | undefined {
  const roots = poolMemberIds ? models.filter(model => model.id && poolMemberIds.includes(model.id)) : primary ? [primary] : [];
  const candidateIds = roots.filter(isSelectableTextChatModel).flatMap(model => model.channel_routing?.manual_channel
    ? [model.channel_routing.manual_channel]
    : [model.id, ...(model.channel_routing?.fallback_model_ids ?? [])]);
  // With no selectable primary/pool route no model can match. Skip the full scan: the selector
  // reaches this state whenever no native model is resolved yet (a common render path).
  if (candidateIds.length === 0) return undefined;
  const candidateSet = new Set(candidateIds);
  let minLimit: number | undefined;
  for (const model of models) {
    if (!model.id || !candidateSet.has(model.id)) continue;
    if (!isSelectableTextChatModel(model) || !getEffectiveModelCapabilities(model).includes('image_understanding')) continue;
    const limit = model.max_images_per_request;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) continue;
    minLimit = minLimit === undefined ? limit : Math.min(minLimit, limit);
  }
  return minLimit;
}
