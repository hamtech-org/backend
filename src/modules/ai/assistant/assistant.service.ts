import type { IAiAssistantRequest, IAiAssistantResponse } from '../shared/types/assistant.types.js';
import { runAiAssistantPipeline } from './pipeline/run-assistant.pipeline.js';

export const assistantService = {
  run: async (request: IAiAssistantRequest): Promise<IAiAssistantResponse> => {
    return runAiAssistantPipeline(request);
  },
};
