import React from "react";
import LegalPage, { type LegalSection } from "@/app/components/LegalPage";
import {
  LEGAL_BRAND,
  LEGAL_CONTACT_EMAIL,
  LEGAL_DISCORD_INVITE,
  LEGAL_SITE_URL,
} from "@/app/lib/legal/content";
import {
  adOptOutFor,
  countryInProse,
  privacyLawFor,
  type VisitorRegion,
} from "@/app/lib/legal/geo";

export function buildPrivacySections(
  region: VisitorRegion | null,
): LegalSection[] {
  const law = privacyLawFor(region);
  const optOut = adOptOutFor(region);
  const where = region ? countryInProse(region.name) : "the country you are visiting from";

  return [
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
            Because the site is open to the whole world, this policy is written to
            work wherever you are. Where your country gives you stronger rights
            than the ones summarised here, your local law wins, and the section on
            your rights says which law applies to you.
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
              device type, operating system, language, the country your connection
              appears to come from, referring page, pages requested, timestamps and
              error diagnostics. Our hosting and analytics providers generate this
              automatically when a page is served.
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
              show advertising that funds the site, as described in the advertising
              section;
            </li>
            <li>
              show the legal pages in the wording that fits the country you are
              visiting from; and
            </li>
            <li>comply with legal obligations and enforce our Terms of Service.</li>
          </ul>
          <p>
            Where a law such as {law} asks us to name a legal basis, we rely on:
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
              <strong>Advertising.</strong> Cookies and similar identifiers set by
              us or by our advertising partners, described below.
            </li>
          </ul>
          <p>
            You can clear or block cookies in your browser settings and the site
            will keep working, but you will be signed out and your saved
            preferences will not persist. Some advertising choices are controlled
            by the ad partners rather than by us; the advertising section explains
            your options in {where}.
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
            third-party advertising partners, such as ad networks and ad servers
            that fill our ad slots, to display and measure ads on the site. We do
            not name individual partners here because the mix changes; the
            technology they use and your choices over it do not.
          </p>
          <ul>
            <li>
              Ad partners may set cookies, web beacons and mobile identifiers, and
              may collect your IP address, approximate location derived from it,
              device and browser details, and the pages where an ad was shown.
            </li>
            <li>
              They use that data to serve ads, to limit how often you see the same
              ad, to detect fraud and to report aggregate performance. Some of it
              is personalized, based on your activity across sites and apps.
            </li>
            <li>
              Where the law where you are requires it, we ask for consent before
              setting non-essential or personalized advertising identifiers, and
              you can withdraw that consent at any time.
            </li>
            <li>
              To limit personalized advertising, you can use {optOut}. Blocking
              third-party cookies in your browser also limits it, though ads will
              still appear and will simply be less relevant.
            </li>
            <li>
              Ad partners handle that data under their own privacy policies, which
              we encourage you to read.
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
            Because you are visiting from <strong>{where}</strong>, the law that
            applies to your data is <strong>{law}</strong>. Where that law gives
            you stronger rights than the ones listed here, those rights apply, and
            nothing in this policy takes them away.
          </p>
          <p>
            Most privacy laws of this kind give you the right to know what we hold
            about you, to see a copy, to have errors corrected, to have data
            deleted, to restrict or object to some processing, to receive your data
            in a portable format, to withdraw consent, and to complain to a
            regulator.
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
            the account belongs to you. You also have the right to complain to the
            data protection authority in {where}.
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
            We serve readers worldwide and our providers operate servers in several
            countries, so your data may be processed outside {where}. Where data
            leaves your country, transfers rely on the providers&apos; standard
            contractual safeguards or another lawful transfer mechanism, and your
            rights under {law} stay in place.
          </p>
        </>
      ),
    },
    {
      id: "children",
      heading: "Children's privacy",
      body: (
        <>
          <p>
            {LEGAL_BRAND} is not directed to children under 13, and we do not
            knowingly collect personal information from them; where local law sets
            a higher age for valid consent, that age applies instead. If you believe
            a child has given us information, email{" "}
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
            effect. Continuing to use {LEGAL_BRAND} after an update means you accept
            the revised policy.
          </p>
        </>
      ),
    },
  ];
}

export function PrivacyPolicyContent({
  region = null,
}: {
  region?: VisitorRegion | null;
}) {
  return (
    <LegalPage
      kind="Privacy Policy"
      title={`${LEGAL_BRAND} Privacy Policy`}
      summary={`What ${LEGAL_BRAND} collects when you browse, sign in, keep a watch list or play an episode, how cookies and advertising work, and how to get your data changed or deleted.`}
      sections={buildPrivacySections(region)}
      region={region}
      contactNote={
        <p>
          Privacy requests, data exports, deletions and advertising questions all
          go to one place. Tell us the email or AniList account you use on{" "}
          {LEGAL_BRAND} and the country you are in, so we can apply the right
          rules. Our community is also at{" "}
          <a href={LEGAL_DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
            {LEGAL_DISCORD_INVITE.replace("https://", "")}
          </a>
          .
        </p>
      }
    />
  );
}
