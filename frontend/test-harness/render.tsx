// Shared helpers for the component tests: real React rendering into jsdom,
// a tiny redux store, and DOM interaction helpers (act-wrapped).
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { configureStore } from "@reduxjs/toolkit";
import showLoginModal from "@/app/lib/redux/features/loginModal";

const reactWithAct = React as unknown as { act: (callback: () => Promise<void> | void) => Promise<void> };

export async function flush() {
  await reactWithAct.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export type RenderedTree = {
  container: HTMLElement;
  unmount: () => Promise<void>;
};

export async function render(ui: React.ReactElement): Promise<RenderedTree> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await reactWithAct.act(async () => {
    root.render(ui);
  });
  await flush();

  return {
    container,
    unmount: async () => {
      await reactWithAct.act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** A store with only the login-modal slice, plus a list of dispatched actions. */
export function makeTestStore() {
  const actions: string[] = [];
  const store = configureStore({
    reducer: { ShowLoginModal: showLoginModal },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(() => (next) => (action) => {
        actions.push((action as { type: string }).type);
        return next(action);
      }),
  });

  return { store, actions };
}

export async function click(element: Element | null) {
  if (!element) throw new Error("cannot click a missing element");
  await reactWithAct.act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

export async function typeInto(element: HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error("cannot type into a missing element");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  await reactWithAct.act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

export async function submit(form: HTMLFormElement | null) {
  if (!form) throw new Error("cannot submit a missing form");
  await reactWithAct.act(async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

export function text(container: HTMLElement) {
  return container.textContent ?? "";
}
