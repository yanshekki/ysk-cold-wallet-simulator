// Protocol handler interface — implement real logic in each package
// No mocks.

export interface ProtocolHandler {
  readonly brand: string;
  handleIncoming(data: Uint8Array): Promise<Uint8Array | null>;
  getServiceUUID(): string;
}
