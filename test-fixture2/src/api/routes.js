import { Router } from 'express';
import { UserController } from '../controllers/UserController.js';

export function routes() {
  const r = Router();
  r.get('/users', UserController.list);
  r.post('/users', UserController.create);
  return r;
}
