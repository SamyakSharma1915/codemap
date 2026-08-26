'use strict';

import express from 'express';
import { routes } from './api/routes.js';

export default class App {
  constructor(port) {
    this.port = port;
    this.server = express();
  }

  async initialize() {
    this.server.use(express.json());
    this.server.use(routes());
    return this;
  }

  listen() {
    this.server.listen(this.port, () => {
      console.log(`listening on ${this.port}`);
    });
  }
}
