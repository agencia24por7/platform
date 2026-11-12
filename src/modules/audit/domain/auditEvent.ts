export const ActorType = {
  User: 'user',
  Agent: 'agent',
  Worker: 'worker',
  System: 'system',
  Invite: 'invite',
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export type AuditEvent = {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly requestId?: string;
  readonly sourceIp?: string | null;
  readonly metadata?: Record<string, unknown>;
};

export type AuditEntry = AuditEvent & { readonly id: string; readonly occurredAt: Date };
