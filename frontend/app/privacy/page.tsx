import React from "react";
import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/app/components/LegalPage";
import {
  LEGAL_BRAND,
  LEGAL_CONTACT_EMAIL,
  LEGAL_DISCORD_INVITE,
  LEGAL_SITE_URL,
} from "@/app/lib/legal/content";

const TITLE = `Privacy Policy | ${LEGAL_BRAND}`;

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `${LEGAL_BRAND} Privacy Policy: what we collect when you browse, search, watch or sign in, how cookies and advertising work, and the rights you have over your data.`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: `How ${LEGAL_BRAND} collects, uses and protects your information.`,
    url: "/privacy",
    type: "article",
  },
};

const sections: LegalSection[] = [
  {
    id: "who-we-are",
    heading: "Who we are",
    body: (
      <>
        <p>
          {LEGAL_BRAND} ({LEGAL_SITE_URL}) is an anime and manga discovery site.
          It lets you browse titles, read episode details, keep a watch list and
          play episodes through embeds supplied by third parties. This policy
          explains what information we handle when you use it, why we handle it,
          and what you can ask us to do with it.
        </p>
        <p>
          In this policy, &ldquo;we&rdquo;, &ldquo;us&rdquo; and
          &ldquo;{LEGAL_BRAND}&rdquo; mean the people who run this site, and
          &ldquo;you&rdquo; means anyone visiting or using it.
        </p>
      </>
    ),
  },
  {
    id: "information-we-collect",
    heading: "Information we collect",
    body: (
      <>
        <p>We try to collect as little as possible. In practice that is:</p>
        <ul>
          <li>
            <strong>Account information.</strong> If you sign in with AniList,
            we receive the profile data that AniList returns for the scopes you
            approve, such as your AniList user ID, username, avatar and your
            anime and manga lists. We never see your AniList password. If you
            sign in with email, we store your email address and a display name.
          </li>
          <li>
            <strong>Your activity on the site.</strong> Titles you open, the
            episode you are on, playback position and duration, whether you
            watched with subtitles or dubbing, your favourites, your preference
            for showing adult titles, and the servers you picked. This is what
            makes &ldquo;Keep Watching&rdquo; and your lists work.
          </li>
          <li>
            <strong>Comments.</strong> Anything you post in a comment, together
            with the display name and avatar attached to it, is stored and shown
            publicly on that episode or title.
          </li>
          <li>
            <strong>Technical and device data.</strong> IP address, browser and
            device type, operating system, language, referring page, pages
            requested, timestamps and error diagnostics. Our hosting and
            analytics providers generate this automatically when a page is
            served.
          </li>
          <li>
            <strong>Cookie and local-storage data.</strong> Sign-in cookies,
            session identifiers and the small preferences described in the
            cookies section below.
          </li>
        </ul>
        <p>
          We do not ask for and do not want payment card numbers, government
          identifiers, health information or precise location data. Please do
          not send them to us.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-information",
    heading: "How and why we use your information",
    body: (
      <>
        <p>Your information is used to:</p>
        <ul>
          <li>serve pages, search results and episode metadata to you;</li>
          <li>sign you in, keep you signed in and remember your preferences;</li>
          <li>
            save and sync your watch progress, lists and favourites, including
            across devices;
          </li>
          <li>publish the comments you choose to post;</li>
          <li>
            keep the site working and secure: rate limiting, abuse prevention,
            debugging, and protecting the service from automated scraping;
          </li>
          <li>
            measure aggregate traffic so we know which pages and titles are
            useful;
          </li>
          <li>
            show advertising that funds the site, as described in the
            advertising section; and
          </li>
          <li>comply with legal obligations and enforce our Terms of Service.</li>
        </ul>
        <p>
          Where data protection law asks us to name a legal basis, we rely on:
          performance of a contract (providing the features you asked for),
          legitimate interests (security, fraud prevention, aggregate analytics
          and funding the site through advertising), consent (non-essential
          cookies and personalized advertising where consent is required), and
          legal obligation.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies and local storage",
    body: (
      <>
        <p>
          We use cookies and browser storage because the site cannot work without
          some of them. They fall into three groups:
        </p>
        <ul>
          <li>
            <strong>Strictly necessary.</strong> Sign-in and session cookies,
            security and rate-limiting cookies, and the storage that keeps your
            "sub or dub" choice, subtitle language, adult-content preference and
            theme settings.
          </li>
          <li>
            <strong>Analytics.</strong> Aggregated, low-detail measurement of
            visits and page performance through our hosting platform&apos;s
            analytics.
          </li>
          <li>
            <strong>Advertising.</strong> Cookies set by us or by advertising
            partners such as Google, described below.
          </li>
        </ul>
        <p>
          You can clear or block cookies in your browser settings and the site
          will keep working, but you will be signed out and your saved
          preferences will not persist. Some advertising partners also honour
          the opt-outs listed in the advertising section.
        </p>
      </>
    ),
  },
  {
    id: "advertising",
    heading: "Advertising and monetization",
    body: (
      <>
        <p>
          {LEGAL_BRAND} is free to use and is funded by advertising. We work with
          third-party advertising partners (which may include Google AdSense and
          other ad networks or programmatic exchanges) to display ads on the
          site.
        </p>
        <ul>
          <li>
            Third-party vendors, including Google, use cookies to serve ads based
            on your prior visits to this and other websites.
          </li>
          <li>
            Google&apos;s use of advertising cookies enables it and its partners
            to serve ads to you based on your visit to our site and/or other
            sites on the internet.
          </li>
          <li>
            You may opt out of personalized advertising by visiting{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Ads Settings
            </a>
            , or opt out of a third-party vendor&apos;s use of cookies for
            personalized advertising by visiting{" "}
            <a
              href="https://www.aboutads.info/choices/"
              target="_blank"
              rel="noopener noreferrer"
            >
              aboutads.info
            </a>
            .
          </li>
          <li>
            Where the law requires it, we ask for consent before setting
            non-essential or personalized advertising cookies, and you can
            withdraw that consent at any time.
          </li>
          <li>
            Ad partners may collect IP address, approximate location derived from
            it, device identifiers and browsing signals, and may measure ad
            performance. Their handling of that data is governed by their own
            privacy policies, which we encourage you to read.
          </li>
        </ul>
        <p>
          We do not sell your account information, and we do not give advertisers
          your email address or AniList credentials.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    heading: "Third-party services we rely on",
    body: (
      <>
        <p>
          Running the site means passing limited data to the services below. Each
          one processes data under its own policy:
        </p>
        <ul>
          <li>
            <strong>AniList</strong> for anime and manga metadata, cover images
            and optional sign-in and list sync.
          </li>
          <li>
            <strong>Supabase</strong> for authentication and for storing your
            progress, lists and comments.
          </li>
          <li>
            <strong>Vercel</strong> for hosting, edge delivery and aggregate
            analytics.
          </li>
          <li>
            <strong>Google Analytics</strong> for traffic measurement where it is
            enabled.
          </li>
          <li>
            <strong>Video hosters and embed providers</strong> that serve the
            streams you play. When you press play, the third-party player may set
            its own cookies and see your IP address and device details.
          </li>
          <li>
            <strong>Discord</strong>, if you join our community server through a
            link on the site.
          </li>
        </ul>
        <p>
          We do not control these providers&apos; practices. If a provider is
          unavailable, the related feature may not work, but the rest of the site
          will.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    heading: "When we share information",
    body: (
      <>
        <p>We share information only in these situations:</p>
        <ul>
          <li>
            <strong>With service providers</strong> listed above, as needed to
            run the site.
          </li>
          <li>
            <strong>With other users</strong>, when you post a comment: your
            display name, avatar and the comment text are public.
          </li>
          <li>
            <strong>For legal reasons</strong>, if we believe in good faith that
            disclosure is required by law, a valid legal request, or necessary to
            protect the safety and rights of users, the public, or ourselves.
          </li>
          <li>
            <strong>In a business transfer</strong>, if the site or its assets are
            transferred, merged or acquired, in which case this policy continues
            to apply to the data until it is replaced.
          </li>
        </ul>
        <p>We do not sell your personal information.</p>
      </>
    ),
  },
  {
    id: "retention",
    heading: "How long we keep data",
    body: (
      <>
        <p>
          Watch progress and lists are kept while your account exists, so that
          your history is there when you come back. Comments stay up until you
          delete them, we remove them for breaking the rules, or the title is
          removed. Server logs and analytics are kept for a short period for
          security and troubleshooting, then discarded or aggregated. When you
          delete your account we remove or anonymise the data that belongs to
          you, except records we must keep to comply with the law or to resolve
          disputes.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    heading: "Your rights and choices",
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access,
          correct, delete, restrict or object to our processing, to receive a
          portable copy of your data, and to withdraw consent. If you are in the
          EEA or UK, these come from the GDPR and UK GDPR. If you are a
          California resident, the CCPA/CPRA also gives you the right to know
          what we collect, to delete it, to correct it, to opt out of sale or
          sharing (we do not sell or share personal information for
          cross-context behavioural advertising beyond the ad cookies described
          above, which you can opt out of), and not to be discriminated against
          for exercising those rights.
        </p>
        <p>You can exercise most of these yourself:</p>
        <ul>
          <li>edit your lists and favourites from your account pages;</li>
          <li>delete your comments from the page they appear on;</li>
          <li>
            sign out and clear cookies and local storage from your browser;
          </li>
          <li>
            turn the adult-content preference on or off in settings, though adult
            titles stay hidden by default.
          </li>
        </ul>
        <p>
          For anything you cannot do yourself, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>{" "}
          from the address linked to your account and describe the request. We
          answer within 30 days, and we may ask for enough information to confirm
          the account belongs to you. You also have the right to complain to your
          local data protection authority.
        </p>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security and international transfers",
    body: (
      <>
        <p>
          Traffic is served over HTTPS, sign-in is handled by our auth provider
          rather than by us, and access to stored data is limited to what the
          features need. No service is perfectly secure, so please use a strong
          password with your AniList account and keep it to yourself.
        </p>
        <p>
          Our providers operate servers in several countries. Where data leaves
          your country, transfers rely on the providers&apos; standard
          contractual safeguards.
        </p>
      </>
    ),
  },
  {
    id: "children",
    heading: "Children&apos;s privacy",
    body: (
      <>
        <p>
          {LEGAL_BRAND} is not directed to children under 13, and we do not
          knowingly collect personal information from them. If you believe a
          child under 13 has given us information, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and
          we will delete it. If you are between 13 and the age of majority where
          you live, use the site only with the involvement of a parent or
          guardian.
        </p>
      </>
    ),
  },
  {
    id: "third-party-content",
    heading: "Third-party video and links",
    body: (
      <>
        <p>
          Episodes are played through players and streams hosted by third
          parties. We do not host video files, and the third-party player you use
          may collect data under its own policy. Links to other sites, including
          our Discord server and the sources we reference, are outside our
          control; check the privacy policy of any site you visit.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: (
      <>
        <p>
          We update this policy when the site or the law changes. The date at the
          top of the page shows the current version. If a change materially
          affects your rights, we will announce it on the site before it takes
          effect. Continuing to use {LEGAL_BRAND} after an update means you
          accept the revised policy.
        </p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      kind="Privacy Policy"
      title={`${LEGAL_BRAND} Privacy Policy`}
      summary={`What ${LEGAL_BRAND} collects when you browse, sign in, keep a watch list or play an episode, how cookies and advertising work, and how to get your data changed or deleted.`}
      sections={sections}
      contactNote={
        <p>
          Privacy requests, data exports, deletions and advertising questions all
          go to one place. Tell us the email or AniList account you use on{" "}
          {LEGAL_BRAND} so we can find your records. Our community is also at{" "}
          <a href={LEGAL_DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
            {LEGAL_DISCORD_INVITE.replace("https://", "")}
          </a>
          .
        </p>
      }
    />
  );
}
