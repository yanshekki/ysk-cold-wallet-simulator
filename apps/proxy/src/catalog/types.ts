export type LedgerLabApi = {
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Uint8Array,
    timeout?: number,
  ): Promise<Uint8Array>;
  sendOk(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Uint8Array,
    note?: string,
  ): Promise<Uint8Array>;
  openApp(name: string, force?: boolean): Promise<void>;
  quitApp(): Promise<void>;
};

export type ProtobufLabApi = {
  call(type: number, payload: Uint8Array): Promise<{ type: number; payload: Uint8Array }>;
};

export type TrezorLabApi = ProtobufLabApi & {
  app(type: number, payload: Uint8Array): Promise<{ type: number; payload: Uint8Array }>;
};

export type LabHostLike = {
  requireLedger(): LedgerLabApi;
  requireOneKey(): ProtobufLabApi;
  requireTrezor(): TrezorLabApi;
};
