const express = require('express');
const userRoute = require('./user.route');
const adminRoute = require('./admin.route');

const router = express.Router();
router.use('/users', userRoute);
router.use('/admin', adminRoute);

module.exports = router;
