<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="sm">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>KumoriTV Sitemap</title>
        <style>
          body { margin: 0; background: #0B0B14; color: #e8e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .wrap { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
          h1 { font-size: 24px; margin: 0 0 4px; }
          h1 span { color: #7c5cff; }
          p.note { margin: 0 0 20px; color: #9a9ab0; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; background: #12121f; border-radius: 10px; overflow: hidden; }
          th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #9a9ab0; padding: 12px 14px; background: #181828; }
          td { padding: 11px 14px; border-top: 1px solid #22223a; font-size: 14px; word-break: break-all; }
          td.n { width: 52px; color: #6c6c88; }
          td.d { width: 120px; color: #9a9ab0; white-space: nowrap; word-break: normal; }
          a { color: #a995ff; text-decoration: none; }
          a:hover { text-decoration: underline; }
          @media (max-width: 600px) { td.d, th.d { display: none; } }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>Kumori<span>TV</span> Sitemap</h1>
          <xsl:choose>
            <xsl:when test="sm:sitemapindex">
              <p class="note">Sitemap index: <xsl:value-of select="count(sm:sitemapindex/sm:sitemap)"/> sitemaps. This page is for people; search engines read the raw XML.</p>
              <table>
                <tr><th>#</th><th>Sitemap</th><th class="d">Last modified</th></tr>
                <xsl:for-each select="sm:sitemapindex/sm:sitemap">
                  <tr>
                    <td class="n"><xsl:value-of select="position()"/></td>
                    <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
                    <td class="d"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
                  </tr>
                </xsl:for-each>
              </table>
            </xsl:when>
            <xsl:otherwise>
              <p class="note"><xsl:value-of select="count(sm:urlset/sm:url)"/> URLs. This page is for people; search engines read the raw XML.</p>
              <table>
                <tr><th>#</th><th>URL</th><th class="d">Last modified</th></tr>
                <xsl:for-each select="sm:urlset/sm:url">
                  <tr>
                    <td class="n"><xsl:value-of select="position()"/></td>
                    <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
                    <td class="d"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
                  </tr>
                </xsl:for-each>
              </table>
            </xsl:otherwise>
          </xsl:choose>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
