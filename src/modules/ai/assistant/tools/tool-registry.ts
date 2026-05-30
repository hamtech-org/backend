export type AiToolHandler = 'executor' | 'pipeline_client';

export type AiToolArgDef = {
  name: string;
  type: string;
  required?: boolean;
};

export type AiAssistantToolDef = {
  name: string;
  handler: AiToolHandler;
  requiresConfirmation?: boolean;
  args: AiToolArgDef[];
  descriptionVi: string;
  descriptionEn: string;
};

import { isSecondaryModelConfigured } from '../../shared/llm/bedrock-models.js';

export type AiToolPolicyHint = {
  id: string;
  match: (message: string) => boolean;
  instructionVi: string;
  instructionEn: string;
  requiredTool?: string;
};

export const AI_ASSISTANT_TOOLS: AiAssistantToolDef[] = [
  {
    name: 'search_messages',
    handler: 'executor',
    args: [{ name: 'query', type: 'string', required: true }],
    descriptionVi: 'tìm tin nhắn trong các hội thoại của user',
    descriptionEn: 'search messages in user conversations',
  },
  {
    name: 'search_users',
    handler: 'executor',
    requiresConfirmation: true,
    args: [{ name: 'query', type: 'string', required: true }],
    descriptionVi: 'tìm người dùng bằng tên, email',
    descriptionEn: 'search users by name or email',
  },
  {
    name: 'search_users_contacts',
    handler: 'executor',
    requiresConfirmation: true,
    args: [{ name: 'query', type: 'string', required: true }],
    descriptionVi: 'tìm người dùng chỉ bằng email hoặc số điện thoại',
    descriptionEn: 'search users by email or phone only',
  },
  {
    name: 'search_groups',
    handler: 'executor',
    args: [{ name: 'query', type: 'string', required: true }],
    descriptionVi: 'tìm nhóm chat (không phải cộng đồng)',
    descriptionEn: 'search chat groups (not communities)',
  },
  {
    name: 'search_communities',
    handler: 'executor',
    args: [
      { name: 'query', type: 'string', required: true },
      { name: 'category', type: 'string' },
    ],
    descriptionVi:
      'tìm/gợi ý cộng đồng (không phải nhóm chat); category: general|technology|sports|music|education|gaming|lifestyle',
    descriptionEn: 'search/suggest communities; optional category filter',
  },
  {
    name: 'suggest_create_poll',
    handler: 'executor',
    args: [
      { name: 'conversationId', type: 'string' },
      { name: 'question', type: 'string' },
      { name: 'options', type: 'string[]' },
    ],
    descriptionVi: 'mở form tạo bình chọn trên client',
    descriptionEn: 'open create-poll form on client',
  },
  {
    name: 'invoke_secondary_model',
    handler: 'executor',
    args: [
      { name: 'prompt', type: 'string', required: true },
      { name: 'modelId', type: 'string' },
    ],
    descriptionVi: 'gọi model phụ (nếu cấu hình)',
    descriptionEn: 'invoke secondary model if configured',
  },
  {
    name: 'suggest_open_direct_chat',
    handler: 'pipeline_client',
    args: [{ name: 'otherUserId', type: 'string', required: true }],
    descriptionVi: 'mở chat 1-1 (client)',
    descriptionEn: 'open direct chat (client)',
  },
  {
    name: 'open_search',
    handler: 'pipeline_client',
    args: [
      { name: 'tab', type: 'string' },
      { name: 'query', type: 'string', required: true },
    ],
    descriptionVi: 'mở màn tìm kiếm trên client',
    descriptionEn: 'open search screen on client',
  },
  {
    name: 'suggest_open_search',
    handler: 'pipeline_client',
    args: [
      { name: 'tab', type: 'string' },
      { name: 'query', type: 'string', required: true },
    ],
    descriptionVi: 'alias mở màn tìm kiếm trên client',
    descriptionEn: 'alias for open search on client',
  },
];

export const KNOWN_TOOL_NAMES = new Set(AI_ASSISTANT_TOOLS.map((t) => t.name));

const TOOL_BY_NAME = new Map(AI_ASSISTANT_TOOLS.map((t) => [t.name, t]));

export const EXECUTOR_TOOL_NAMES = new Set(
  AI_ASSISTANT_TOOLS.filter((t) => t.handler === 'executor').map((t) => t.name),
);

export function getToolDef(name: string): AiAssistantToolDef | undefined {
  return TOOL_BY_NAME.get(name);
}

export function requiresToolConfirmation(toolName: string): boolean {
  return Boolean(getToolDef(toolName)?.requiresConfirmation);
}

function formatArgsDoc(args: AiToolArgDef[]): string {
  if (args.length === 0) return '{}';
  const parts = args.map((a) => {
    const suffix = a.required ? '' : '?';
    return `"${a.name}"${suffix}: ${a.type}`;
  });
  return `{ ${parts.join(', ')} }`;
}

export function buildToolDoc(locale: 'vi' | 'en'): string {
  const header = locale === 'vi' ? 'Công cụ (toolCalls, tối đa 5):' : 'Tools (toolCalls, max 5):';
  const lines = AI_ASSISTANT_TOOLS.filter((t) => {
    if (t.handler !== 'executor' && t.name !== 'suggest_open_direct_chat') return false;
    if (t.name === 'invoke_secondary_model' && !isSecondaryModelConfigured()) return false;
    return true;
  }).map((tool) => {
    const desc = locale === 'vi' ? tool.descriptionVi : tool.descriptionEn;
    return `- ${tool.name}: ${formatArgsDoc(tool.args)} — ${desc}`;
  });
  return [header, ...lines].join('\n');
}

const AI_TOOL_POLICIES: AiToolPolicyHint[] = [
  {
    id: 'force_message_search',
    match: (message: string) => {
      const normalized = message.trim().toLowerCase();
      return (
        /\b(search|find)\b.*\b(message|messages|chat|conversation)\b/.test(normalized) ||
        /(tìm|tim|kiếm|kiem|lục|luc|tra).{0,30}(tin nhắn|tin nhan|message|chat|hội thoại|hoi thoai)/.test(
          normalized,
        ) ||
        /(tin nhắn|tin nhan).{0,30}(về|ve|liên quan|lien quan|có nội dung|co noi dung)/.test(
          normalized,
        )
      );
    },
    requiredTool: 'search_messages',
    instructionVi:
      'Yêu cầu hiện tại là tìm tin nhắn: PHẢI gọi tool search_messages; không được trả lời chỉ dựa trên lịch sử/RAG.',
    instructionEn:
      'The current request is a message search: you MUST call search_messages; do not answer only from history/RAG.',
  },
  {
    id: 'force_community_suggest',
    match: (message: string) => {
      const normalized = message.trim().toLowerCase();
      return (
        /(gợi ý|goi y|đề xuất|de xuat|tìm|tim|kiếm|kiem|tham gia|tham gia).{0,40}(cộng đồng|cong dong|community)/.test(
          normalized,
        ) ||
        /(cộng đồng|cong dong|community).{0,40}(phù hợp|phu hop|nên|nen|gợi ý|goi y)/.test(
          normalized,
        )
      );
    },
    requiredTool: 'search_communities',
    instructionVi:
      'Yêu cầu gợi ý/tìm cộng đồng: PHẢI gọi search_communities. Nếu user không nêu TÊN cộng đồng cụ thể, dùng query "*" (không bịa tên tiếng Anh như "Tech Enthusiasts"). Chỉ thêm category khi user nêu chủ đề (công nghệ, thể thao...).',
    instructionEn:
      'Community suggestion: MUST call search_communities. If no specific community name, use query "*" (do not invent English names). Add category only when the user mentions a topic.',
  },
];

export function getActivePolicyHints(message: string, locale: 'vi' | 'en'): string[] {
  return AI_TOOL_POLICIES.filter((p) => p.match(message)).map((p) =>
    locale === 'vi' ? p.instructionVi : p.instructionEn,
  );
}

export function getRequiredToolForMessage(message: string): string | undefined {
  return AI_TOOL_POLICIES.find((p) => p.match(message) && p.requiredTool)?.requiredTool;
}
