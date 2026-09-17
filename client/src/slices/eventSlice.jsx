import { createSlice } from '@reduxjs/toolkit'

const initialState = {
    navMenuOpen: false,
}

const eventSlice = createSlice({
    name: 'event',
    initialState,
    reducers: {
        toggleNavMenu: (state) => {
            state.navMenuOpen = !state.navMenuOpen
        },
        closeNavMenu: (state) => {
            state.navMenuOpen = false
        },
    },
})

export default eventSlice.reducer
export const {
    toggleNavMenu,
    closeNavMenu,
} = eventSlice.actions
