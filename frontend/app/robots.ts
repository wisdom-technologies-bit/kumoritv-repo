export default function robots(){const site=process.env.NEXT_PUBLIC_SITE_URL||"https://kumoritv.vercel.app";return {rules:{userAgent:"*",allow:"/",disallow:"/api/"},sitemap:`${site}/sitemap.xml`};}
