import { configureStore } from '@reduxjs/toolkit'
import eventSlice from '../slices/eventSlice'
import authSlice from '../slices/authSlice'
import complaintSlice from '../slices/complaintSlice'
import categorySlice from '../slices/categorySlice'

export const store = configureStore({
    reducer: {
        event: eventSlice,
        auth: authSlice,
        complaints: complaintSlice,
        categories: categorySlice,
    },
})
