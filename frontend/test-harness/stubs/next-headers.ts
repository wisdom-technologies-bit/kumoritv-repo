// Test double for `next/headers` in route-handler tests: an in-memory cookie jar.

export type RecordedCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

const jar: RecordedCookie[] = [];

export function __cookies() {
  return jar;
}

export function __resetCookies() {
  jar.length = 0;
}

type SetArgs = { name: string; value: string; [key: string]: unknown };

export function cookies() {
  return {
    set(nameOrOptions: string | SetArgs, value?: string, options?: Record<string, unknown>) {
      if (typeof nameOrOptions === "object") {
        const { name, value: cookieValue, ...rest } = nameOrOptions;
        jar.push({ name, value: String(cookieValue), options: rest });

        return;
      }

      jar.push({ name: nameOrOptions, value: String(value ?? ""), options: options ?? {} });
    },
    get(name: string) {
      const found = jar.find((cookie) => cookie.name === name);

      return found ? { name: found.name, value: found.value } : undefined;
    },
    getAll() {
      return jar.map(({ name, value }) => ({ name, value }));
    },
    delete(name: string) {
      const index = jar.findIndex((cookie) => cookie.name === name);

      if (index >= 0) jar.splice(index, 1);
    },
    has(name: string) {
      return jar.some((cookie) => cookie.name === name);
    },
  };
}

export default { cookies };
