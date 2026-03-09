import express, { Request, Response } from 'express';
import { routeRpcRequest, rpcErrorMiddleware } from './rpc/router';

const PORT = 3000;

const app = express();

app.use(express.json({ limit: '2mb' }));

app.post('/', (req: Request, res: Response) => {
  routeRpcRequest(req, res);
});

app.use(rpcErrorMiddleware);

app.listen(PORT, () => {
  console.log(`Mini Solana Validator running on port ${PORT}`);
});
