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
    }
  | {
      kind: 'group_member_left';
      member: GroupSystemPerson;
    }
  | {
      kind: 'group_owner_transferred';
      actor: GroupSystemPerson;
      successor: GroupSystemPerson;
    }
  | {
      kind: 'group_owner_assigned';
      successor: GroupSystemPerson;
    }
  | {
      kind: 'group_admin_promoted';
      actor: GroupSystemPerson;
      target: GroupSystemPerson;
    }
  | {
      kind: 'group_admin_demoted';
      actor: GroupSystemPerson;
      target: GroupSystemPerson;
      selfDemote?: boolean;
    }
  | {
      kind: 'group_profile_updated';
      actor: GroupSystemPerson;
      previousName?: string;
      newName?: string;
      nameChanged?: boolean;
      avatarChanged?: boolean;
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

export function buildGroupMemberLeftContent(member: GroupSystemPerson): string {
  const payload: GroupSystemPayload = {
    kind: 'group_member_left',
    member,
  };
  return JSON.stringify(payload);
}

export function buildGroupOwnerTransferredContent(
  actor: GroupSystemPerson,
  successor: GroupSystemPerson,
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_owner_transferred',
    actor,
    successor,
  };
  return JSON.stringify(payload);
}

export function buildGroupOwnerAssignedContent(successor: GroupSystemPerson): string {
  const payload: GroupSystemPayload = {
    kind: 'group_owner_assigned',
    successor,
  };
  return JSON.stringify(payload);
}

export function buildGroupAdminPromotedContent(
  actor: GroupSystemPerson,
  target: GroupSystemPerson,
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_admin_promoted',
    actor,
    target,
  };
  return JSON.stringify(payload);
}

export function buildGroupAdminDemotedContent(
  actor: GroupSystemPerson,
  target: GroupSystemPerson,
  selfDemote = false,
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_admin_demoted',
    actor,
    target,
    ...(selfDemote ? { selfDemote: true } : {}),
  };
  return JSON.stringify(payload);
}

export function buildGroupProfileUpdatedContent(
  actor: GroupSystemPerson,
  opts: {
    previousName?: string;
    newName?: string;
    nameChanged: boolean;
    avatarChanged: boolean;
  },
): string {
  const payload: GroupSystemPayload = {
    kind: 'group_profile_updated',
    actor,
    ...(opts.previousName ? { previousName: opts.previousName } : {}),
    ...(opts.newName ? { newName: opts.newName } : {}),
    nameChanged: opts.nameChanged,
    avatarChanged: opts.avatarChanged,
  };
  return JSON.stringify(payload);
}
