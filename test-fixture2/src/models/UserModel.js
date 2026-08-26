import { format } from '../utils/format.js';

export class UserModel {
  constructor(data) {
    this.data = data;
  }

  static async findAll() {
    return [];
  }

  static async create(body) {
    return new UserModel(body);
  }

  toJSON() {
    return format(this.data);
  }
}
