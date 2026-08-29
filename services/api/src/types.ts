export type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    requestId: string;
  };
};
