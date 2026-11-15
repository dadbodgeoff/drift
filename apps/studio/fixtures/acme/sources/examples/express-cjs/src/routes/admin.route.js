const { Router } = require('express');
const auth = require('../middlewares/auth');
const userController = require('../controllers/user.controller');

const router = Router();
router.use(auth('admin'));
router.delete('/users/:id', userController.createUser);

module.exports = router;
