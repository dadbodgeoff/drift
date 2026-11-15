export interface CreateInput {
  workspaceId: string;
  dryRun?: boolean;
}

export class Service {
  create(input: CreateInput) {
    return input;
  }

  static build(cfg: { region: string; zone?: string }) {
    return cfg;
  }
}
