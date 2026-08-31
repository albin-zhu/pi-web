import type { SessionContext } from "./types";

export const SESSION_MESSAGE_PAGE_SIZE = 100;
export const SESSION_MESSAGE_PAGE_MAX = 250;

export interface PaginatedSessionContext extends SessionContext {
  totalMessages: number;
  startIndex: number;
  hasMore: boolean;
}

export function parseSessionMessageLimit(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, SESSION_MESSAGE_PAGE_MAX);
}

export function paginateSessionContext(
  context: SessionContext,
  limit: number | null,
  beforeEntryId?: string | null,
): PaginatedSessionContext {
  const totalMessages = context.messages.length;
  if (limit === null || totalMessages === 0) {
    return {
      ...context,
      totalMessages,
      startIndex: 0,
      hasMore: false,
    };
  }

  let endIndex = totalMessages;
  if (beforeEntryId) {
    const cursorIndex = context.entryIds.indexOf(beforeEntryId);
    if (cursorIndex >= 0) endIndex = cursorIndex;
  }
  const startIndex = Math.max(0, endIndex - limit);

  return {
    ...context,
    messages: context.messages.slice(startIndex, endIndex),
    entryIds: context.entryIds.slice(startIndex, endIndex),
    totalMessages,
    startIndex,
    hasMore: startIndex > 0,
  };
}
