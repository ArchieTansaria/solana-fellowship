export interface RpcErrorPayload {
  code: number;
  message: string;
}

export class RpcError extends Error {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function asRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) {
    return error;
  }

  if (error instanceof Error) {
    return new RpcError(-32003, error.message);
  }

  return new RpcError(-32003, 'Transaction failed');
}
