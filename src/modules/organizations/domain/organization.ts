export const OrganizationType = { Agency: 'agency', Advertiser: 'advertiser' } as const;
export type OrganizationType = (typeof OrganizationType)[keyof typeof OrganizationType];

export type Organization = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly type: OrganizationType;
  readonly managerAccountId: string | null;
  readonly businessManagerId: string | null;
  readonly developerTokenRef: string | null;
  readonly createdAt: Date;
};

export type NewOrganization = {
  readonly name: string;
  readonly type: OrganizationType;
  readonly managerAccountId: string | null;
  readonly businessManagerId: string | null;
  readonly developerTokenRef: string | null;
};

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export type ReadinessGap = 'sem_conexao' | 'sem_conta';

export function connectionReadiness(counts: {
  readonly connections: number;
  readonly linkedAccounts: number;
}): readonly ReadinessGap[] {
  if (counts.connections === 0) return ['sem_conexao'];
  if (counts.linkedAccounts === 0) return ['sem_conta'];
  return [];
}

export function isReadyToCollect(counts: {
  readonly connections: number;
  readonly linkedAccounts: number;
}): boolean {
  return connectionReadiness(counts).length === 0;
}
