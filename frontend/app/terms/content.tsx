import React from "react";
import LegalPage, { type LegalSection } from "@/app/components/LegalPage";
import {
  LEGAL_BRAND,
  LEGAL_CONTACT_EMAIL,
  LEGAL_SITE_URL,
} from "@/app/lib/legal/content";
import { countryInProse, type VisitorRegion } from "@/app/lib/legal/geo";

export function buildTermsSections(
  region: VisitorRegion | null,
): LegalSection[] {
  const where = region ? countryInProse(region.name) : "the country you are visiting from";

  return [
  {
    id: "agreement",
    heading: "Agreement to these terms",
    body: (
      <>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between
          you and {LEGAL_BRAND} ({LEGAL_SITE_URL}). By opening the site, creating
          an account, posting a comment or playing an episode, you agree to them.
          If you do not agree, please stop using the site.
        </p>
        <p>
          Our{" "}
          <a href="/privacy">Privacy Policy</a> forms part of these Terms and
          explains how we handle your information.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    heading: "Who may use the site",
    body: (
      <>
        <p>
          You must be at least 13 years old to use {LEGAL_BRAND}. If you are
          under the age of majority where you live, you may use the site only
          with the permission and supervision of a parent or guardian, and the
          adult-content preference may only be enabled by an adult.
        </p>
        <p>
          You must be legally able to enter into this agreement, and you must not
          be barred from using the service under the laws that apply to you.
        </p>
      </>
    ),
  },
  {
    id: "the-service",
    heading: "What the service is, and what it is not",
    body: (
      <>
        <p>
          {LEGAL_BRAND} is a catalogue and discovery layer for anime and manga. We
          index titles, episodes and metadata, and we help you keep track of what
          you are watching. The site does not host, upload or store video files.
        </p>
        <ul>
          <li>
            Episodes and streams are provided by independent third parties that
            are not affiliated with us. We do not control their availability,
            quality, advertising or legality.
          </li>
          <li>
            We are not responsible for the content of third-party players, sites
            or services you reach from our pages.
          </li>
          <li>
            Features, servers, titles and providers may change, break or
            disappear without notice.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "credits",
    heading: "Credits and attribution",
    body: (
      <>
        <p>
          Some of the artwork on this site is not ours. Title logos are supplied
          by The Movie Database (TMDB), and catalogue metadata comes from AniList
          and other public sources.
        </p>
        <p>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.{" "}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noreferrer noopener"
          >
            themoviedb.org
          </a>
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    heading: "Your account",
    body: (
      <>
        <p>
          You can use much of the site without an account. Signing in with AniList
          or email unlocks syncing, lists and comments. If you create an account
          you agree to:
        </p>
        <ul>
          <li>provide accurate information and keep it current;</li>
          <li>
            keep your sign-in credentials secure and accept responsibility for
            activity under your account;
          </li>
          <li>
            not share, sell or transfer your account, and not create accounts to
            evade a suspension;
          </li>
          <li>
            tell us promptly if you believe your account has been accessed by
            someone else.
          </li>
        </ul>
        <p>
          We may suspend or close an account that breaks these Terms or puts other
          users or the service at risk.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: (
      <>
        <p>Please use the site as it is meant to be used. You agree not to:</p>
        <ul>
          <li>
            break any law, infringe anyone&apos;s rights, or help someone else do
            so;
          </li>
          <li>
            scrape, crawl, mirror or bulk-download the site or its catalogues
            without our written permission, or use automated tools that place an
            unreasonable load on our infrastructure;
          </li>
          <li>
            bypass, disable or interfere with security features, rate limits or
            access controls, or attempt to reach data that is not yours;
          </li>
          <li>
            upload or distribute malware, viruses or code designed to damage or
            surveil;
          </li>
          <li>
            post comments that are unlawful, hateful, harassing, defamatory,
            sexually explicit involving minors, spam, advertising, or that
            impersonate someone;
          </li>
          <li>
            post personal information about someone else without their consent,
            or post spoilers aimed at ruining a series for others;
          </li>
          <li>
            resell, sublicense or commercially exploit the service or access to
            it;
          </li>
          <li>
            use the site to distribute pirated files, or to encourage others to.
          </li>
        </ul>
        <p>
          We may remove content, limit features or suspend access where we
          reasonably believe these rules have been broken. Moderation decisions
          can be appealed by email.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    heading: "Comments and content you post",
    body: (
      <>
        <p>
          You keep ownership of what you write. By posting a comment you give us a
          worldwide, non-exclusive, royalty-free licence to host, display,
          reproduce and format it on the site and in related previews, for as
          long as it stays up. That licence ends when you delete the comment,
          apart from copies already cached or backed up for a reasonable period.
        </p>
        <p>
          You confirm you have the right to post what you post, that it does not
          infringe anyone&apos;s rights, and that it complies with these Terms. You
          are responsible for your own comments; we are a hosting service for
          them. You can delete your own comments at any time.
        </p>
      </>
    ),
  },
  {
    id: "intellectual-property",
    heading: "Intellectual property",
    body: (
      <>
        <p>
          The site&apos;s own design, layout, code, name, logos and marks belong to
          us or our licensors and may not be copied or reused without permission.
          You may link to our pages and share them freely.
        </p>
        <p>
          Anime and manga titles, artwork, episode imagery, synopses, ratings and
          character data belong to their respective owners and are shown for
          identification, reference and commentary. {LEGAL_BRAND} claims no
          ownership of them.
        </p>
      </>
    ),
  },
  {
    id: "takedowns",
    heading: "Copyright and takedown requests",
    body: (
      <>
        <p>
          We do not host or store video files, so a takedown of the underlying
          stream belongs with the third-party host carrying it. Where a request
          concerns material we do control (a title entry, an image, a synopsis or
          a comment), email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>{" "}
          with:
        </p>
        <ul>
          <li>identification of the protected work;</li>
          <li>
            the exact URL of the page or comment you are complaining about;
          </li>
          <li>your contact details;</li>
          <li>
            a statement that you have a good-faith belief the use is
            unauthorised, and that the information you gave is accurate and you
            are the owner or authorised to act for them.
          </li>
        </ul>
        <p>
          We review complete notices promptly and remove or disable the material
          where the claim is valid. If you believe material was removed by
          mistake, you can reply with a counter-notice and we will consider it.
        </p>
      </>
    ),
  },
  {
    id: "advertising",
    heading: "Advertising and external offers",
    body: (
      <>
        <p>
          The site is free and funded by advertising. Ads are supplied by third
          parties and we do not endorse the products or services they offer.
          Any transaction you make with an advertiser or an external site is
          between you and them; we are not a party to it and have no liability
          for it.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    heading: "Availability and changes to the service",
    body: (
      <>
        <p>
          We provide the site as it is and as it is available. We may add, change,
          limit or remove features, pages or titles at any time, and we may
          suspend the site for maintenance, security or capacity reasons. We do
          not guarantee that any particular title, episode, server or feature will
          remain available.
        </p>
      </>
    ),
  },
  {
    id: "disclaimer",
    heading: "Disclaimer of warranties",
    body: (
      <>
        <p>
          To the fullest extent allowed by law, {LEGAL_BRAND} is provided
          &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of
          any kind, express or implied, including implied warranties of
          merchantability, fitness for a particular purpose, title and
          non-infringement. We do not warrant that the site will be
          uninterrupted, error-free, secure, or that any information on it,
          including metadata supplied by third parties, is accurate, complete or
          current.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    heading: "Limitation of liability",
    body: (
      <>
        <p>
          To the fullest extent allowed by law, {LEGAL_BRAND} and the people who
          run it are not liable for indirect, incidental, special, consequential
          or punitive damages, or for lost data, lost profits, lost goodwill or
          business interruption, arising from your use of or inability to use the
          site, from third-party streams, ads or links, or from anything else
          connected with these Terms, whether or not we were warned such damage
          was possible.
        </p>
        <p>
          Where liability cannot be excluded, our total liability for all claims
          relating to the site is limited to the greater of the amount you paid us
          in the twelve months before the claim (which for a free site is zero) or
          the minimum amount the law requires. Nothing here limits liability that
          cannot be limited by law, including for fraud or for death or personal
          injury caused by negligence.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    heading: "Indemnity",
    body: (
      <>
        <p>
          If a claim, demand, loss or expense (including reasonable legal fees)
          arises out of your breach of these Terms, your content, or your misuse
          of the site, you agree to indemnify and hold harmless {LEGAL_BRAND} and
          the people who run it. We will let you know about any such claim and may
          take part in the defence at our own cost.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    heading: "Termination",
    body: (
      <>
        <p>
          You may stop using the site at any time and ask us to delete your
          account. We may suspend or end your access immediately if you
          materially breach these Terms, if we are required to by law, or if
          continuing to provide access creates risk for other users or for the
          service. Sections that by their nature should survive termination,
          including intellectual property, disclaimers, limitation of liability
          and governing law, continue to apply.
        </p>
      </>
    ),
  },
  {
    id: "governing-law",
    heading: "Governing law and disputes",
    body: (
      <>
        <p>
          {LEGAL_BRAND} serves visitors all over the world, so these Terms are
          governed by the laws of <strong>{where}</strong>, the country you are
          visiting from, without regard to conflict-of-law rules. Mandatory
          consumer and data protection rules of your country of residence apply
          regardless of where a dispute is heard.
        </p>
        <p>
          Before starting formal proceedings, please contact us at{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> so we
          can try to resolve the issue informally; most problems are settled that
          way. If we cannot resolve it, you may bring a claim before the courts or
          consumer dispute body that has jurisdiction over you in {where}, and
          nothing here stops you from going to the courts where you live.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: (
      <>
        <p>
          We may update these Terms as the site or the law changes. The date at the
          top of the page shows the current version, and material changes will be
          announced on the site before they take effect. Continuing to use{" "}
          {LEGAL_BRAND} after a change means you accept the revised Terms.
        </p>
      </>
    ),
  },
  {
    id: "general",
    heading: "General",
    body: (
      <>
        <ul>
          <li>
            If any part of these Terms is found unenforceable, the rest stays in
            force and that part is read as narrowly as it can be while still
            achieving its purpose.
          </li>
          <li>
            If we do not enforce a provision, that is not a waiver of our right to
            do so later.
          </li>
          <li>
            These Terms, together with the Privacy Policy, are the entire
            agreement between you and us about the site.
          </li>
          <li>
            We may assign our rights under these Terms in connection with a
            merger, acquisition or sale of the site; you may not assign yours.
          </li>
        </ul>
      </>
    ),
  },
  ];
}

export function TermsOfServiceContent({
  region = null,
}: {
  region?: VisitorRegion | null;
}) {
  return (
    <LegalPage
      kind="Terms of Service"
      title={`${LEGAL_BRAND} Terms of Service`}
      summary={`The agreement that covers your use of ${LEGAL_BRAND}: your account, what you may and may not do, how third-party streams and ads work, and the limits of our responsibility.`}
      sections={buildTermsSections(region)}
      region={region}
      contactNote={
        <p>
          Questions about these Terms, moderation decisions, copyright notices and
          legal requests all go to one address. Include the URLs and account
          details involved so we can act without a round trip.
        </p>
      }
    />
  );
}
