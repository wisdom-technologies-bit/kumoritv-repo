// Prompt 15: Privacy Policy and Terms of Service pages, their footer links and
// the favicon wiring.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../test-harness/render";
import Footer from "@/app/layout/footer";
import PrivacyPolicyPage, { metadata as privacyMetadata } from "@/app/privacy/page";
import TermsOfServicePage, { metadata as termsMetadata } from "@/app/terms/page";
import { LEGAL_LINKS, LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "@/app/lib/legal/content";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const hrefsIn = (container: HTMLElement, selector = "a") =>
  Array.from(container.querySelectorAll(selector)).map((a) => a.getAttribute("href"));

// ------------------------------------------------------------- legal pages

test("the privacy policy covers the sections a real policy needs", async () => {
  const tree = await render(<PrivacyPolicyPage />);

  try {
    const text = tree.container.textContent ?? "";

    for (const heading of [
      "Who we are",
      "Information we collect",
      "Cookies and local storage",
      "Advertising and monetization",
      "Third-party services we rely on",
      "Your rights and choices",
      "Children",
      "Changes to this policy",
      "Contact us",
    ]) {
      assert.match(text, new RegExp(heading), `missing section: ${heading}`);
    }

    // monetization is spelled out, including the opt-out paths
    assert.match(text, /Google AdSense/);
    assert.match(text, /Google Ads Settings/);
    assert.match(text, /aboutads\.info/);
    assert.match(text, /do not sell your personal information/i);
    // GDPR + CCPA rights
    assert.match(text, /GDPR/);
    assert.match(text, /CCPA/);
    // age floor
    assert.match(text, /under 13/);
    // contact route
    assert.match(text, new RegExp(LEGAL_CONTACT_EMAIL.replace(".", "\\.")));
  } finally {
    await tree.unmount();
  }
});

test("the terms of service cover use, content, liability and law", async () => {
  const tree = await render(<TermsOfServicePage />);

  try {
    const text = tree.container.textContent ?? "";

    for (const heading of [
      "Agreement to these terms",
      "Who may use the site",
      "What the service is",
      "Your account",
      "Acceptable use",
      "Comments and content you post",
      "Intellectual property",
      "Copyright and takedown requests",
      "Disclaimer of warranties",
      "Limitation of liability",
      "Governing law and disputes",
      "Contact us",
    ]) {
      assert.match(text, new RegExp(heading), `missing section: ${heading}`);
    }

    assert.match(text, /does not host, upload or store video files/i);
    assert.match(text, /Federal Republic of Nigeria/);
    assert.ok(
      hrefsIn(tree.container).includes("/privacy"),
      "the terms link to the privacy policy",
    );
  } finally {
    await tree.unmount();
  }
});

test("both pages show the same last-updated date and a working table of contents", async () => {
  for (const page of [<PrivacyPolicyPage key="p" />, <TermsOfServicePage key="t" />]) {
    const tree = await render(page);

    try {
      const text = tree.container.textContent ?? "";
      assert.match(text, new RegExp(LEGAL_LAST_UPDATED.replace(/ /g, "\\s")));

      const tocLinks = Array.from(
        tree.container.querySelectorAll('nav[aria-label$="contents"] a'),
      ).map((a) => (a.getAttribute("href") ?? "").slice(1));

      assert.ok(tocLinks.length > 5, "the table of contents lists the sections");
      for (const id of tocLinks) {
        assert.ok(
          tree.container.querySelector(`section[id="${id}"]`),
          `contents link #${id} has no target section`,
        );
      }
    } finally {
      await tree.unmount();
    }
  }
});

test("each page carries its own metadata and canonical URL", () => {
  assert.equal(privacyMetadata.alternates?.canonical, "/privacy");
  assert.equal(termsMetadata.alternates?.canonical, "/terms");
  assert.match(String(privacyMetadata.title), /Privacy Policy/);
  assert.match(String(termsMetadata.title), /Terms of Service/);
  const robots = privacyMetadata.robots as { index?: boolean } | undefined;
  assert.equal(robots?.index, true, "the policy is indexable");
});

// ---------------------------------------------------------------- footer

test("the footer links to both legal pages, on every viewport", async () => {
  const tree = await render(<Footer />);

  try {
    const hrefs = hrefsIn(tree.container);
    const text = tree.container.textContent ?? "";

    for (const link of LEGAL_LINKS) {
      assert.ok(hrefs.includes(link.href), `footer is missing ${link.href}`);
      assert.match(text, new RegExp(link.label));
    }

    assert.ok(
      !hrefs.includes("#"),
      "the old placeholder privacy link is gone",
    );
    assert.ok(
      tree.container.querySelector('nav[aria-label="Legal"]'),
      "the legal links are grouped in a labelled nav",
    );
  } finally {
    await tree.unmount();
  }
});

test("the footer keeps the copyright and the disclaimer, connected to the brand", async () => {
  const tree = await render(<Footer />);

  try {
    const text = tree.container.textContent ?? "";
    const year = new Date().getFullYear();

    assert.match(text, new RegExp(`Copyright © ${year}, KumoriTV\\. All Rights Reserved\\.`));
    assert.match(text, /Disclaimer:/);
    assert.match(text, /does not store any files on its server/i);
    assert.match(text, /non-affiliated third parties/i);
  } finally {
    await tree.unmount();
  }
});

test("the footer hides no legal link on small screens", () => {
  const css = read("app/layout/footer/footerComponent.module.css");

  assert.ok(
    !/\.privacy_policy\s*\{[^}]*display:\s*none/.test(css),
    "the old CSS hid the privacy link on mobile",
  );
  assert.ok(!/\.legal_links\s*\{[^}]*display:\s*none/.test(css));
});

test("mobile footer stacks the logo and Discord on one left edge", () => {
  const css = read("app/layout/footer/footerComponent.module.css");
  const mobileBlock = css.slice(
    css.indexOf("@media (max-width: 768px) {\n    #info_container #social_links_container"),
  );
  const block = mobileBlock.slice(0, mobileBlock.indexOf("\n}"));

  assert.match(block, /flex-direction:\s*column/);
  assert.match(block, /align-items:\s*flex-start/);
  assert.match(block, /justify-content:\s*flex-start/);
  assert.match(block, /ul\s*\{[^}]*justify-content:\s*flex-start/);
});

test("the footer uses more inset than 2% on phones so nothing hugs the edge", () => {
  const css = read("app/layout/footer/footerComponent.module.css");
  const block = css.slice(css.indexOf("/* MOBILE FOOTER SPACING */"));

  assert.match(block, /#info_container,\s*\n\s*#copyright_row\s*\{\s*\n\s*width:\s*90%/);
});

// --------------------------------------------------------------- favicon

test("the favicon is wired for every browser that asks for one", () => {
  const layout = read("app/layout.tsx");

  assert.match(layout, /url: "\/favicon\.svg", type: "image\/svg\+xml"/);
  assert.match(layout, /url: "\/favicon\.ico"/);
  assert.match(layout, /url: "\/android-chrome-192\.png"/);
  assert.match(layout, /shortcut: "\/favicon\.ico"/);
  assert.match(layout, /apple: \[\{ url: "\/apple-touch-icon\.png"/);

  // both files a browser may request blindly must exist
  assert.ok(existsSync(join(root, "public/favicon.ico")));
  assert.ok(existsSync(join(root, "public/favicon.svg")));
  assert.ok(existsSync(join(root, "public/apple-touch-icon.png")));

  // one ico only: the app-route copy would emit a second, hashed icon link
  assert.ok(!existsSync(join(root, "app/icon.ico")));

  const ico = readFileSync(join(root, "public/favicon.ico"));
  assert.equal(ico.subarray(0, 4).toString("hex"), "00000100", "valid .ico header");
  assert.ok(ico.length > 1000, "the ico actually contains images");
});

test("the manifest and the metadata agree on the icon files", () => {
  const manifest = read("app/manifest.ts");

  for (const file of ["android-chrome-192.png", "android-chrome-512.png", "maskable-512.png"]) {
    assert.ok(existsSync(join(root, "public", file)), `missing ${file}`);
    assert.match(manifest, new RegExp(file.replace(".", "\\.")));
  }
});
