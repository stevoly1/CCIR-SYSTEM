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
    withdrawComplaintSchema,
    complaintListQuerySchema,
} = require('../validators/complaintValidator');
const { emptyQuerySchema, idParamsSchema } = require('../validators/commonValidator');
const {
    createComplaint,
    getAllComplaints,
    getSingleComplaint,
    updateComplaint,
    updateComplaintStatus,
    assignComplaint,
    withdrawComplaint,
    deleteComplaint,
} = require('../controllers/complaintController');

ComplaintRouter.route('/')
    .get(authentication, validate({ query: complaintListQuerySchema }), getAllComplaints)
    .post(authentication, validate({ body: createComplaintSchema, query: emptyQuerySchema }), createComplaint);

ComplaintRouter.route('/:id')
    .get(authentication, validate({ params: idParamsSchema, query: emptyQuerySchema }), getSingleComplaint)
    .patch(authentication, validate({ params: idParamsSchema, body: updateComplaintSchema, query: emptyQuerySchema }), updateComplaint)
    .delete(authentication, validate({ params: idParamsSchema, query: emptyQuerySchema }), deleteComplaint);

ComplaintRouter.route('/:id/status')
    .patch(authentication, restrictTo('admin', 'agency'), validate({ params: idParamsSchema, body: updateStatusSchema, query: emptyQuerySchema }), updateComplaintStatus);

ComplaintRouter.route('/:id/assign')
    .patch(authentication, restrictTo('admin'), validate({ params: idParamsSchema, body: assignComplaintSchema, query: emptyQuerySchema }), assignComplaint);

ComplaintRouter.route('/:id/withdraw')
    .post(authentication, validate({ params: idParamsSchema, body: withdrawComplaintSchema, query: emptyQuerySchema }), withdrawComplaint);

module.exports = ComplaintRouter;
