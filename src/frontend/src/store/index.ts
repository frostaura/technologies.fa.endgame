import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { useDispatch, useSelector } from "react-redux";
import { api } from "./api";
import { runsSlice } from "./runsSlice";
import { storeMode, uiSlice } from "./uiSlice";

export function makeStore() {
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer, runs: runsSlice.reducer, ui: uiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
  // Refetch on window focus and on reconnect, so a tab left open does not show stale state.
  setupListeners(store.dispatch);
  // The mode toggle is remembered across visits.
  let mode = store.getState().ui.mode;
  store.subscribe(() => {
    const next = store.getState().ui.mode;
    if (next !== mode) {
      mode = next;
      storeMode(next);
    }
  });
  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
