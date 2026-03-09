import type { Request, Response } from 'express';
import { asRpcError, type RpcErrorPayload, RpcError } from './errors';
import { handleRpcMethod } from './handlers';

export type JsonRpcId = string | number | null;

export interface RpcRequest {
  jsonrpc: string;
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export function validateRpcRequest(body: unknown): RpcRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RpcError(-32600, 'Invalid request');
  }

  const req = body as Partial<RpcRequest>;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string' || !('id' in req)) {
    throw new RpcError(-32600, 'Invalid request');
  }

  return {
    jsonrpc: req.jsonrpc,
    id: req.id as JsonRpcId,
    method: req.method,
    params: req.params,
  };
}

export function sendRpcResult(res: Response, id: JsonRpcId, result: unknown): void {
  res.status(200).json({ jsonrpc: '2.0', id, result });
}

export function sendRpcError(res: Response, id: JsonRpcId, error: RpcErrorPayload): void {
  res.status(200).json({ jsonrpc: '2.0', id, error });
}

export function routeRpcRequest(req: Request, res: Response): void {
  let id: JsonRpcId = null;

  try {
    const rpcRequest = validateRpcRequest(req.body);
    id = rpcRequest.id;
    const result = handleRpcMethod(rpcRequest.method, rpcRequest.params);
    sendRpcResult(res, id, result);
  } catch (error) {
    const rpcError = asRpcError(error);

    const code =
      rpcError.code === -32601 ||
      rpcError.code === -32600 ||
      rpcError.code === -32602 ||
      rpcError.code === -32003
        ? rpcError.code
        : -32003;

    sendRpcError(res, id, {
      code,
      message: rpcError.message,
    });
  }
}

export function rpcErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: () => void,
): void {
  if (error instanceof SyntaxError) {
    sendRpcError(res, null, {
      code: -32600,
      message: 'Invalid request',
    });
    return;
  }

  const rpcError = asRpcError(error);
  sendRpcError(res, null, {
    code: rpcError.code,
    message: rpcError.message,
  });
}
