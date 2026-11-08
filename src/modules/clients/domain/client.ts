export const BusinessModel = { Leads: 'leads', Ecommerce: 'ecommerce' } as const;
export type BusinessModel = (typeof BusinessModel)[keyof typeof BusinessModel];

export type Client = {
  readonly id: string;
  readonly organizationId: string;
  readonly parentClientId: string | null;
  readonly name: string;
  readonly segment: string | null;
  readonly businessModel: BusinessModel;
  readonly status: 'active' | 'paused' | 'archived';
  readonly createdAt: Date;
};

export type NewClient = {
  readonly organizationId: string;
  readonly parentClientId: string | null;
  readonly name: string;
  readonly segment: string | null;
  readonly businessModel: BusinessModel;
};

export type ClientWithAccounts = Client & { readonly accountCount: number };
