import type {
  IAiSuggestRequest,
  IAiSuggestResponse,
  IAiChatbotRequest,
  IAiChatbotResponse,
  IAiSentimentResult,
  IAiGeneratePostRequest,
  IAiGeneratePostResponse,
  IAiSuggestReplyContextRequest,
  IAiSuggestReplyContextResponse,
  IAiGroupSummaryRequest,
  IAiGroupSummaryResponse,
  IAiAssistantRequest,
  IAiAssistantResponse,
} from './ai.types.js';
import { suggestService } from './content/suggest.service.js';
import { contentStubsService } from './content/stubs.service.js';
import { groupSummaryService } from './group-summary/group-summary.service.js';
import { assistantService } from './assistant/assistant.service.js';

export { generateText } from './shared/llm/generate-text.js';
export type { AiGenerateTextOptions, AiGenerateTextResult } from './shared/llm/generate-text.js';

export const aiService = {
  suggestContent: (request: IAiSuggestRequest) => suggestService.suggestContent(request),
  suggestReplyFromContext: (request: IAiSuggestReplyContextRequest) =>
    suggestService.suggestReplyFromContext(request),
  summarizeGroupMessages: (request: IAiGroupSummaryRequest & { userId: string }) =>
    groupSummaryService.summarizeGroupMessages(request),
  chatbot: (request: IAiChatbotRequest) => contentStubsService.chatbot(request),
  analyzeSentiment: (text: string) => contentStubsService.analyzeSentiment(text),
  generatePost: (request: IAiGeneratePostRequest) => contentStubsService.generatePost(request),
  aiAssistant: (request: IAiAssistantRequest) => assistantService.run(request),
};
