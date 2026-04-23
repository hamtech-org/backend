import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { pollRepository } from './poll.repository.js';
import type { IMessage } from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

export const pollService = {
  createPoll: async (
    requesterId: string,
    conversationId: string,
    data: any,
  ): Promise<IMessage | null> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const pollId = uuidv4();
    const now = new Date().toISOString();
    const poll = {
      pollId,
      conversationId,
      creatorId: requesterId,
      question: data.question,
      options: data.options.map((opt: string) => ({ text: opt, voters: [] })),
      isMultipleChoice: data.isMultipleChoice || false,
      createdAt: now,
      updatedAt: now,
    };
    await pollRepository.createPoll(poll);

    let systemMessage: IMessage | null = null;
    try {
      let creatorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        creatorName = users[0]?.displayName || creatorName;
      } catch {}

      const payload = {
        kind: 'poll_created',
        poll: { pollId: String(pollId), question: String(data.question ?? '') },
        actor: { userId: requesterId, name: creatorName },
        createdAt: now,
      };

      systemMessage = await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch {
      /* ignore */
    }

    const explicitSource =
      typeof data.sourceMessageId === 'string' && data.sourceMessageId.trim().length > 0
        ? data.sourceMessageId.trim()
        : null;
    const sourceMessageId = systemMessage?.messageId ?? explicitSource ?? null;
    if (sourceMessageId) {
      try {
        await pollRepository.updatePoll(conversationId, pollId, { sourceMessageId });
      } catch {
        /* ignore */
      }
    }

    return systemMessage;
  },

  getPolls: async (conversationId: string): Promise<any[]> => {
    const rows = await pollRepository.getPolls(conversationId);
    const creatorIds = [...new Set(rows.map((p: { creatorId?: string }) => p.creatorId).filter(Boolean))] as string[];
    if (creatorIds.length === 0) return rows;
    const users = await userRepository.findByIds(creatorIds);
    const nameById = new Map(users.map((u) => [u.userId, u.displayName?.trim() || null]));
    return rows.map((p: { creatorId?: string }) => ({
      ...p,
      creatorDisplayName: p.creatorId ? nameById.get(p.creatorId) ?? null : null,
    }));
  },

  votePoll: async (
    userId: string,
    conversationId: string,
    pollId: string,
    optionIndex: number,
  ): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const polls = await pollRepository.getPolls(conversationId);
    const poll = polls.find((p) => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');
    if (!poll.options[optionIndex]) throw new Error('Lựa chọn không hợp lệ');

    const prevVotedIndexes: number[] = [];
    (poll.options ?? []).forEach((opt: any, idx: number) => {
      if (Array.isArray(opt?.voters) && opt.voters.includes(userId)) prevVotedIndexes.push(idx);
    });

    // Single choice: remove previous votes first
    if (!poll.isMultipleChoice) {
      poll.options = (poll.options ?? []).map((opt: any) => ({
        ...opt,
        voters: Array.isArray(opt.voters) ? opt.voters.filter((id: string) => id !== userId) : [],
      }));
    }

    if (!poll.options[optionIndex].voters) poll.options[optionIndex].voters = [];
    if (!poll.options[optionIndex].voters.includes(userId)) {
      poll.options[optionIndex].voters.push(userId);
    }

    await pollRepository.updatePollVotes(conversationId, pollId, poll.options);

    // System message
    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([userId]);
        actorName = users[0]?.displayName || actorName;
      } catch {}

      const optionText = String(poll?.options?.[optionIndex]?.text ?? '').trim();
      const question = String(poll?.question ?? '').trim();
      const changed = !poll.isMultipleChoice && prevVotedIndexes.length > 0 && !prevVotedIndexes.includes(optionIndex);
      const prevOptionText = changed && poll?.options?.[prevVotedIndexes[0]]?.text ? String(poll.options[prevVotedIndexes[0]].text) : '';

      const payload = {
        kind: changed ? 'poll_vote_changed' : 'poll_voted',
        poll: { pollId: String(pollId), question, optionIndex, optionText, prevOptionIndex: changed ? prevVotedIndexes[0] : null, prevOptionText: changed ? String(prevOptionText ?? '') : null },
        actor: { userId, name: actorName },
        createdAt: new Date().toISOString(),
      };

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: userId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }
  },

  unvotePoll: async (
    userId: string,
    conversationId: string,
    pollId: string,
    optionIndex: number,
  ): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const polls = await pollRepository.getPolls(conversationId);
    const poll = polls.find((p) => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');

    if (poll.options[optionIndex] && poll.options[optionIndex].voters) {
      poll.options[optionIndex].voters = poll.options[optionIndex].voters.filter((id: string) => id !== userId);
      await pollRepository.updatePollVotes(conversationId, pollId, poll.options);
    }

    // System message
    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([userId]);
        actorName = users[0]?.displayName || actorName;
      } catch {}

      const payload = {
        kind: 'poll_unvoted',
        poll: { pollId: String(pollId), question: String(poll?.question ?? '').trim(), optionIndex, optionText: String(poll?.options?.[optionIndex]?.text ?? '').trim() },
        actor: { userId, name: actorName },
        createdAt: new Date().toISOString(),
      };

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: userId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }
  },

  addPollOption: async (
    requesterId: string,
    conversationId: string,
    pollId: string,
    text: string,
  ): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const optionText = String(text ?? '').trim();
    if (!optionText) throw new Error('Nội dung lựa chọn không hợp lệ');

    const polls = await pollRepository.getPolls(conversationId);
    const poll = polls.find((p) => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');

    const nextOptions = Array.isArray(poll.options) ? [...poll.options] : [];
    nextOptions.push({ text: optionText, voters: [] });
    await pollRepository.updatePoll(conversationId, pollId, { options: nextOptions });

    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {}

      const payload = {
        kind: 'poll_option_added',
        poll: { pollId: String(pollId), question: String(poll.question ?? ''), optionText },
        actor: { userId: requesterId, name: actorName },
        createdAt: new Date().toISOString(),
      };

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }
  },

  closePoll: async (requesterId: string, conversationId: string, pollId: string): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const polls = await pollRepository.getPolls(conversationId);
    const poll = polls.find((p) => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');

    await pollRepository.updatePoll(conversationId, pollId, { isClosed: true });

    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {}

      const payload = {
        kind: 'poll_closed',
        poll: { pollId: String(pollId), question: String(poll.question ?? '') },
        actor: { userId: requesterId, name: actorName },
        createdAt: new Date().toISOString(),
      };

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }
  },

  deletePoll: async (requesterId: string, conversationId: string, pollId: string): Promise<void> => {
    const polls = await pollRepository.getPolls(conversationId);
    const poll = polls.find((p) => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');
    if (poll.creatorId !== requesterId) throw new ForbiddenError('Chỉ người tạo mới được xóa bình chọn');

    await pollRepository.deletePoll(conversationId, pollId);
  },
};
