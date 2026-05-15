export type GroupSystemPerson = {
  userId: string;
  name: string;
};

export type GroupSystemPayload =
  | {
      kind: 'group_member_invited';
      actor: GroupSystemPerson;
      targets: GroupSystemPerson[];
    }
  | {
      kind: 'group_member_joined';
      member: GroupSystemPerson;
    }
  | {
      kind: 'group_member_removed';
      actor: GroupSystemPerson;
      targets: GroupSystemPerson[];
    };

export function buildGroupMemberInvitedContent(
  actor: GroupSystemPerson,
  targets: GroupSystemPerson[],
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_member_invited',
    actor,
    targets,
  };
  return JSON.stringify(payload);
}

export function buildGroupMemberJoinedContent(member: GroupSystemPerson): string {
  const payload: GroupSystemPayload = {
    kind: 'group_member_joined',
    member,
  };
  return JSON.stringify(payload);
}

export function buildGroupMemberRemovedContent(
  actor: GroupSystemPerson,
  target: GroupSystemPerson,
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_member_removed',
    actor,
    targets: [target],
  };
  return JSON.stringify(payload);
}
