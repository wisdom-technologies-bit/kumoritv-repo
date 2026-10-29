// Prompt 15: Privacy Policy and Terms of Service pages, their footer links and
// the favicon wiring.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../test-harness/render";
import Footer from "@/app/layout/footer";
import {
  PrivacyPolicyContent,
  buildPrivacySections,
} from "@/app/privacy/content";
import { metadata as privacyMetadata } from "@/app/privacy/page";
import {
  TermsOfServiceContent,
  buildTermsSections,
} from "@/app/terms/content";
import { metadata as termsMetadata } from "@/app/terms/page";
import {
  LEGAL_LINKS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_SITE_URL,
} from "@/app/lib/legal/content";
import {
  adOptOutFor,
  countryCodeFromHeaders,
  countryNameFromCode,
  privacyLawFor,
  regionFromHeaders,
} from "@/app/lib/legal/geo";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const hrefsIn = (container: HTMLElement, selector = "a") =>
  Array.from(container.querySelectorAll(selector)).map((a) => a.getAttribute("href"));

// ------------------------------------------------------------- legal pages

test("the privacy policy covers the sections a real policy needs", async () => {
  const tree = await render(<PrivacyPolicyContent />);

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

    // monetization is described without naming the ad provider
    assert.match(text, /funded by advertising/);
    assert.match(text, /personalized advertising/i);
    assert.match(text, /do not sell your personal information/i);
    assert.ok(!/monetag/i.test(text), "the ad provider is not named");
    assert.ok(!/adsense/i.test(text), "no ad provider is named");
    assert.ok(!/google ads settings/i.test(text));
    // GDPR + CCPA rights
    assert.match(text, /GDPR|data protection law/);
    // age floor
    assert.match(text, /under 13/);
    // contact route
    assert.match(text, new RegExp(LEGAL_CONTACT_EMAIL.replace(".", "\\.")));
  } finally {
    await tree.unmount();
  }
});

test("the terms of service cover use, content, liability and law", async () => {
  const tree = await render(<TermsOfServiceContent />);

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
    assert.match(text, /governed by the laws of/);
    assert.ok(!/Nigeria/.test(text), "no fixed country is hard-coded");
    assert.ok(
      hrefsIn(tree.container).includes("/privacy"),
      "the terms link to the privacy policy",
    );
  } finally {
    await tree.unmount();
  }
});

test("both pages show the same last-updated date and a working table of contents", async () => {
  for (const page of [<PrivacyPolicyContent key="p" />, <TermsOfServiceContent key="t" />]) {
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
  const privacyRobots = privacyMetadata.robots as { index?: boolean; follow?: boolean } | undefined;
  const termsRobots = termsMetadata.robots as { index?: boolean; follow?: boolean } | undefined;

  assert.equal(privacyRobots?.index, false, "the policy must not be indexed");
  assert.equal(privacyRobots?.follow, false);
  assert.equal(termsRobots?.index, false, "the terms must not be indexed");
  assert.equal(termsRobots?.follow, false);
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

// ------------------------------------------------------- visitor country

test("the visitor country is read from whichever geo header the host sends", () => {
  const fromVercel = (headers: Record<string, string>) => (name: string) => headers[name];

  assert.equal(countryCodeFromHeaders(fromVercel({ "x-vercel-ip-country": "ng" })), "NG");
  assert.equal(countryCodeFromHeaders(fromVercel({ "cf-ipcountry": "DE" })), "DE");
  assert.equal(countryCodeFromHeaders(fromVercel({ "x-country-code": "br" })), "BR");
  // some proxies send a placeholder instead of a country
  assert.equal(countryCodeFromHeaders(fromVercel({ "x-vercel-ip-country": "XX" })), null);
  assert.equal(countryCodeFromHeaders(fromVercel({ "x-vercel-ip-country": "T1" })), null);
  assert.equal(countryCodeFromHeaders(fromVercel({})), null);
  // the first header that carries a real country wins
  assert.equal(
    countryCodeFromHeaders(
      fromVercel({ "x-vercel-ip-country": "XX", "cf-ipcountry": "fr" }),
    ),
    "FR",
  );
});

test("a country code becomes a readable country name, and junk stays unknown", () => {
  assert.equal(countryNameFromCode("NG"), "Nigeria");
  assert.equal(countryNameFromCode("gb"), "United Kingdom");
  assert.equal(countryNameFromCode("JP"), "Japan");
  assert.equal(countryNameFromCode("ZZ"), null);
  assert.equal(countryNameFromCode("XX"), null);

  assert.deepEqual(
    regionFromHeaders((name: string) => (name === "x-vercel-ip-country" ? "DE" : null)),
    { code: "DE", name: "Germany" },
  );
  assert.equal(regionFromHeaders(() => null), null);
});

test("each region gets the law and the ad opt-out that actually apply there", () => {
  const de = { code: "DE", name: "Germany" };
  const gb = { code: "GB", name: "United Kingdom" };
  const us = { code: "US", name: "United States" };
  const ng = { code: "NG", name: "Nigeria" };
  const jp = { code: "JP", name: "Japan" };

  assert.match(privacyLawFor(de), /GDPR/);
  assert.match(privacyLawFor(gb), /UK General Data Protection Regulation/);
  assert.match(privacyLawFor(us), /CCPA/);
  assert.match(privacyLawFor(ng), /Nigeria Data Protection Act/);
  assert.match(privacyLawFor(jp), /Act on the Protection of Personal Information/);
  assert.match(privacyLawFor(null), /data protection law/);

  assert.notEqual(adOptOutFor(de), adOptOutFor(us));
  assert.match(adOptOutFor(null), /opt-out tools/);
});

test("the privacy policy names the visitor's country and its law", async () => {
  const tree = await render(<PrivacyPolicyContent region={{ code: "DE", name: "Germany" }} />);

  try {
    const text = tree.container.textContent ?? "";

    assert.match(text, /visiting from Germany/);
    assert.match(text, /General Data Protection Regulation/);
    assert.match(text, /data protection authority in Germany/);
    assert.ok(!/Nigeria/.test(text), "Germany gets German wording");
  } finally {
    await tree.unmount();
  }
});

test("an unknown country still produces usable, country-neutral wording", async () => {
  const tree = await render(<PrivacyPolicyContent region={null} />);

  try {
    const text = tree.container.textContent ?? "";
    assert.match(text, /could not tell which country/i);
    assert.ok(!/undefined|null/.test(text), "no broken interpolation leaks into the page");
    assert.match(text, /data protection law of the country you are visiting from/);
  } finally {
    await tree.unmount();
  }
});

test("the governing law follows the visitor instead of a hard-coded country", async () => {
  const gbTree = await render(<TermsOfServiceContent region={{ code: "GB", name: "United Kingdom" }} />);
  try {
    const text = gbTree.container.textContent ?? "";
    assert.match(text, /governed by the laws of\s*the United Kingdom/);
    assert.match(text, /jurisdiction over you in the United Kingdom/);
  } finally {
    await gbTree.unmount();
  }

  const unknown = buildTermsSections(null)
    .find((section) => section.id === "governing-law");
  assert.ok(unknown, "the governing law section exists without a region");
});

test("the region is visible on the page and exposed for styling", async () => {
  const tree = await render(<PrivacyPolicyContent region={{ code: "JP", name: "Japan" }} />);

  try {
    const notice = tree.container.querySelector("[data-region]");
    assert.ok(notice, "the page tells the visitor which country it detected");
    assert.equal(notice?.getAttribute("data-region"), "JP");
    assert.match(notice?.textContent ?? "", /visiting from/i);
  } finally {
    await tree.unmount();
  }

  const fallback = await render(<TermsOfServiceContent region={null} />);
  try {
    assert.equal(
      fallback.container.querySelector("[data-region]")?.getAttribute("data-region"),
      "unknown",
    );
  } finally {
    await fallback.unmount();
  }
});

test("the pages carry the production domain, not the preview host", () => {
  assert.equal(LEGAL_SITE_URL, "https://kumoritv.top");
  assert.ok(
    buildPrivacySections(null).length > 0 &&
      JSON.stringify(LEGAL_SITE_URL).includes("kumoritv.top"),
  );
});

test("both legal routes opt out of indexing in their own file too", () => {
  for (const file of ["app/privacy/page.tsx", "app/terms/page.tsx"]) {
    const source = read(file);
    assert.match(source, /index:\s*false/, `${file} sets noindex`);
    assert.match(source, /follow:\s*false/, `${file} sets nofollow`);
    assert.match(source, /force-dynamic/, `${file} renders per request`);
  }
});

test("country names read correctly in a sentence", () => {
  const { countryInProse } = require("@/app/lib/legal/geo") as typeof import("@/app/lib/legal/geo");

  assert.equal(countryInProse("Germany"), "Germany");
  assert.equal(countryInProse("Nigeria"), "Nigeria");
  assert.equal(countryInProse("United States"), "the United States");
  assert.equal(countryInProse("Netherlands"), "the Netherlands");
  assert.equal(countryInProse("United Kingdom"), "the United Kingdom");
});
