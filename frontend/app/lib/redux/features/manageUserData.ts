"use client";
import { createSlice } from "@reduxjs/toolkit";

const initialState: { value: UserAnilist | null } = {
  value:
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("anilist-user") as string) || null
      : null,
};

export const userInfo = createSlice({
  name: "UserInfo",
  initialState,
  reducers: {
    addUserInfo: (state, { payload }) => {
      state.value = payload;
    },
    removeUserInfo: (state) => {
      localStorage.removeItem("anilist-user");

      state.value = null;

      // Loaded lazily on purpose: a static import here made a cycle
      // (login options -> store -> this slice -> login options), and whichever
      // module the bundle evaluated first got `undefined` for this reducer, so
      // the store came up WITHOUT the UserInfo key and every selector crashed
      // with "Cannot read properties of undefined (reading 'value')".
      void import("../../user/anilistUserLoginOptions").then((module) => module.removeCookies());
    },
  },
});

const { addUserInfo } = userInfo.actions;
const { removeUserInfo } = userInfo.actions;

export { addUserInfo };
export { removeUserInfo };

export default userInfo.reducer;
