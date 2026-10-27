import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, render, submit, text } from "../../../../test-harness/render";
import UserLoginModal from "..";

type Globals = { __commentsTestClient?: unknown; __commentsTestAuth?: unknown };
const globals = globalThis as unknown as Globals;

function setGuest() {
  globals.__commentsTestAuth = {
    user: null,
    profile: null,
    isAnonymous: false,
    loading: false,
    signOut: async () => {},
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("the login modal offers Google, Anonymously and Anilist, plus the advice line", async () => {
  process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID = "test-client-id";
  setGuest();
  globals.__commentsTestClient = { auth: {}, from: () => ({}) };

  const tree = await render(<UserLoginModal nextPath="/media/21" />);
  const { container } = tree;

  assert.ok(container.querySelector('button[title="Google"]'), "Google button");
  assert.ok(container.querySelector('button[title="Anonymously"]'), "Anonymously button");
  const anilistButton = container.querySelector('button[title="Anilist"]');
  assert.ok(anilistButton, "Anilist button");
  assert.match(text(container), /Use\s*Anilist\s*for better experience/);

  // the icons for all three are rendered inside their buttons
  assert.equal(container.querySelectorAll('button[title="Google"] svg, button[title="Google"] [data-icon]').length, 1);
  assert.equal(container.querySelectorAll('button[title="Anilist"] svg, button[title="Anilist"] [data-icon]').length, 1);

  await tree.unmount();
});

test("clicking Anilist goes to the AniList token endpoint with the client id", async () => {
  process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID = "test-client-id";
  setGuest();
  globals.__commentsTestClient = { auth: {}, from: () => ({}) };

  const fakeLocation = window.location as unknown as { href: string };
  fakeLocation.href = "http://localhost:3000/";

  const tree = await render(<UserLoginModal nextPath="/media/21" />);
  await click(tree.container.querySelector('button[title="Anilist"]'));

  assert.equal(
    fakeLocation.href,
    "https://anilist.co/api/v2/oauth/authorize?client_id=test-client-id&response_type=token",
  );

  await tree.unmount();
});

test("the signup username field is back to the 1-15 characters rule", async () => {
  setGuest();
  globals.__commentsTestClient = { auth: {}, from: () => ({}) };

  const tree = await render(<UserLoginModal nextPath="/" />);
  const { container } = tree;

  await click(container.querySelector("button[id*=create_account_button]"));

  const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement | null;
  assert.ok(usernameInput, "signup username field is rendered");
  assert.equal(usernameInput!.getAttribute("pattern"), "^.{1,15}$");
  assert.equal(usernameInput!.getAttribute("title"), "The limit is 15 characters.");
  assert.equal(usernameInput!.getAttribute("maxlength"), "15");
  assert.equal(usernameInput!.getAttribute("minlength"), "1");

  // the server-side check refuses anything longer than 15 characters
  setInputValue(usernameInput!, "thisusernameiswaytoolong");
  setInputValue(container.querySelector('input[name="email"]') as HTMLInputElement, "someone@example.com");
  setInputValue(container.querySelector('input[name="password"]') as HTMLInputElement, "password123");
  setInputValue(container.querySelector('input[name="confirm_password"]') as HTMLInputElement, "password123");

  // Browsers expose controls as `form.<name>`; jsdom does not, so mirror it here.
  const form = container.querySelector("form") as HTMLFormElement;
  for (const name of ["username", "email", "password", "confirm_password"]) {
    Object.defineProperty(form, name, {
      value: form.querySelector(`[name="${name}"]`),
      configurable: true,
    });
  }

  await submit(form);
  assert.match(text(container), /The limit is 15 characters\./);

  await tree.unmount();
});
