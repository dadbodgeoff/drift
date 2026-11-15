const express = require('express');
const auth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const userController = require('../controllers/user.controller');

const router = express.Router();

router
  .route('/')
  .post(auth('manageUsers'), validate({ body: {} }), userController.createUser)
  .get(auth('getUsers'), userController.getUsers);

router.get('/health', (req, res) => res.send('ok'));

module.exports = router;
