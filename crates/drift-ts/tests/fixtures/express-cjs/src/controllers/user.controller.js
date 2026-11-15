const { userService } = require('../services');
const catchAsync = require('../utils/catchAsync');

const createUser = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).send(user);
});

exports.getUsers = async (req, res) => {
  const users = await require('../services/user.service').getUsers();
  res.send(users);
};

module.exports.createUser = createUser;
