export const MAX_HISTORY_MESSAGE_CHARS = 1200;
export const MAX_HISTORY_TRANSCRIPT_CHARS = 16000;
export const MAX_RAG_CHUNK_CHARS = 900;
export const SENSITIVE_PLACEHOLDER = '[Nội dung nhạy cảm đã được chặn]';

export type AiAssistantStage =
  | 'init'
  | 'persist_user_message'
  | 'await_user_confirmation'
  | 'embedding_query'
  | 'rag_search'
  | 'load_history'
  | 'model_reasoning'
  | 'tool_execution'
  | 'model_finalize'
  | 'persist_assistant_message'
  | 'embedding_reply'
  | 'completed';
