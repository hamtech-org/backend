import { z } from 'zod';

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
}).refine((data) => data.name !== undefined || data.avatar !== undefined, {
  message: 'Phải cung cấp ít nhất một trường để cập nhật (name hoặc avatar)',
});

export const addMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

const memberPermissionsPatch = z
  .object({
    changeNameAvatar: z.boolean().optional(),
    pinMessages: z.boolean().optional(),
    createNotesReminders: z.boolean().optional(),
    createPolls: z.boolean().optional(),
    sendMessages: z.boolean().optional(),
  })
  .strict();

const adminSettingsPatch = z
  .object({
    approvalRequired: z.boolean().optional(),
    highlightLeaderMessages: z.boolean().optional(),
    newMembersReadRecent: z.boolean().optional(),
    allowJoinLink: z.boolean().optional(),
  })
  .strict();

/** PATCH body — có thể chỉ gửi một phần quyền (frontend bật/tắt từng dòng). */
export const updateGroupSettingsSchema = z
  .object({
    memberPermissions: memberPermissionsPatch.optional(),
    adminSettings: adminSettingsPatch.optional(),
    regenerateJoinLink: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.regenerateJoinLink === true ||
      (d.memberPermissions != null && Object.keys(d.memberPermissions).length > 0) ||
      (d.adminSettings != null && Object.keys(d.adminSettings).length > 0),
    { message: 'Thiếu nội dung cập nhật' },
  );
