const express = require('express');
const ComplaintRouter = express.Router();
const { authentication } = require('../middleware/auth');
const restrictTo = require('../middleware/restrictTo');
const validate = require('../middleware/validate');
const {
    createComplaintSchema,
    updateComplaintSchema,
    updateStatusSchema,
    assignComplaintSchema,
} = require('../validators/complaintValidator');
const {
    createComplaint,
    getAllComplaints,
    getSingleComplaint,
    updateComplaint,
    updateComplaintStatus,
    assignComplaint,
    deleteComplaint,
} = require('../controllers/complaintController');

ComplaintRouter.route('/')
    .get(authentication, getAllComplaints)
    .post(authentication, validate(createComplaintSchema), createComplaint);

ComplaintRouter.route('/:id')
    .get(authentication, getSingleComplaint)
    .patch(authentication, validate(updateComplaintSchema), updateComplaint)
    .delete(authentication, deleteComplaint);

ComplaintRouter.route('/:id/status')
    .patch(authentication, restrictTo('admin', 'agency'), validate(updateStatusSchema), updateComplaintStatus);

ComplaintRouter.route('/:id/assign')
    .patch(authentication, restrictTo('admin'), validate(assignComplaintSchema), assignComplaint);

module.exports = ComplaintRouter;
