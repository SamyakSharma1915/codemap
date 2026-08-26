export class UserController {
  static async list(req, res) {
    const users = await UserModel.findAll();
    res.json(users);
  }

  static async create(req, res) {
    const user = await UserModel.create(req.body);
    res.json(user);
  }
}
