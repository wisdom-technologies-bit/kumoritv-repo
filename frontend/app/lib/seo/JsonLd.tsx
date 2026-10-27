// Server component: renders structured data inside the first HTML response.
// `dangerouslySetInnerHTML` is required for a <script> payload and the serialiser
// escapes "<", ">" and "&" so the JSON cannot close the tag.
import type { JsonLdNode } from "./jsonld";
import { serializeJsonLd } from "./jsonld";

export default function JsonLd({ data }: { data: JsonLdNode }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
