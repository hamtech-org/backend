import type { AiToolCall } from './execute-tools.js';
import { inferCommunitySearchArgs, normalizeCommunityToolCall } from './community-search-args.js';
import { getRequiredToolForMessage } from './tool-registry.js';

function normalizeModelToolCalls(toolCalls: unknown[]): AiToolCall[] {
  return toolCalls
    .map((t) => ({
      name: String((t as { name?: unknown }).name ?? ''),
      args: (typeof (t as { args?: unknown }).args === 'object' && (t as { args?: unknown }).args
        ? ((t as { args: object }).args as Record<string, unknown>)
        : {}) as Record<string, unknown>,
    }))
    .filter((t) => t.name.length > 0);
}

function buildRequiredToolCall(message: string, toolName: string): AiToolCall | undefined {
  if (toolName === 'search_communities') {
    return { name: toolName, args: inferCommunitySearchArgs(message) };
  }
  if (toolName === 'search_messages') {
    return { name: toolName, args: { query: message } };
  }
  return undefined;
}

function normalizeRequiredToolCall(message: string, call: AiToolCall): AiToolCall {
  if (call.name === 'search_communities') {
    return normalizeCommunityToolCall(message, call);
  }
  if (call.name === 'search_messages') {
    const query = typeof call.args.query === 'string' ? call.args.query.trim() : '';
    return query ? call : { ...call, args: { ...call.args, query: message } };
  }
  return call;
}

export function planAiToolCalls(message: string, toolCalls: unknown[]): AiToolCall[] {
  const planned = normalizeModelToolCalls(toolCalls);
  const requiredTool = getRequiredToolForMessage(message);
  if (!requiredTool) return planned;

  const existingIndex = planned.findIndex((t) => t.name === requiredTool);
  if (existingIndex >= 0) {
    planned[existingIndex] = normalizeRequiredToolCall(message, planned[existingIndex]);
    return planned;
  }

  const requiredCall = buildRequiredToolCall(message, requiredTool);
  return requiredCall ? [...planned, requiredCall] : planned;
}
