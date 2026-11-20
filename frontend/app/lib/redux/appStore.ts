import { makeStore, type AppStore } from "./store";

/**
 * The single store instance, created on first use rather than at module load.
 *
 * The login module used to do `export const userCustomStore = makeStore()` at
 * module scope while this slice imported that same module back. Whichever side
 * the bundle evaluated first saw `undefined` for the UserInfo reducer, the store
 * came up without that key, and every `state.UserInfo.value` selector crashed
 * with "Cannot read properties of undefined (reading 'value')". Creating the
 * store lazily means every module has finished evaluating before the reducers
 * are read.
 */
let store: AppStore | undefined;

export function getAppStore(): AppStore {
  if (!store) store = makeStore();

  return store;
}
