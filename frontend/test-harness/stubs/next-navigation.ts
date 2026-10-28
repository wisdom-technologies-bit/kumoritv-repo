// Test double for `next/navigation`. The real hooks need Next's app-router
// context, which does not exist under `node --test` ("invariant expected app
// router to be mounted"), so client components that read the current URL get the
// values a test puts on `globalThis.__searchTestNavigation` and every navigation
// is recorded instead of performed.

export type TestNavigationState = {
  pathname?: string;
  search?: string;
  pushed?: string[];
};

type NavigationBag = { __searchTestNavigation?: TestNavigationState };

function state(): Required<TestNavigationState> {
  const bag = globalThis as unknown as NavigationBag;
  const navigation = (bag.__searchTestNavigation ??= {});

  navigation.pathname ??= "/";
  navigation.search ??= "";
  navigation.pushed ??= [];

  return navigation as Required<TestNavigationState>;
}

export function usePathname(): string {
  return state().pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(state().search);
}

export function useParams(): Record<string, string> {
  return {};
}

export function useRouter() {
  return {
    push(url: string) {
      state().pushed.push(url);
      state().search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    },
    replace(url: string) {
      state().pushed.push(url);
      state().search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    },
    prefetch() {},
    back() {},
    forward() {},
    refresh() {},
  };
}

export function notFound(): never {
  throw new Error("notFound() called in a test render");
}

export function redirect(url: string): never {
  throw new Error(`redirect(${url}) called in a test render`);
}

export default { usePathname, useRouter, useSearchParams, useParams, notFound, redirect };
