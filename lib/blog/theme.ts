// ============================================================================
// MIGRIZO BLOG THEME — extracted verbatim from migrizo.com css/styles.css.
// Shared by the public blog index and article pages so the blog is
// indistinguishable from the main website.
// ============================================================================

export const BLOG_BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://blog.migrizo.com';

export const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
.mgz{
  --mint:#DFF3EB;--mint-2:#C6E9D9;--mint-soft:#E8F6EF;
  --bg:#F8FCFA;--surface:#FFFFFF;
  --ink:#0E1F1A;--ink-soft:#1F2E29;--muted:#6B7B76;--muted-2:#9AA8A3;
  --line:#E5EDE9;--line-soft:#F0F5F2;
  --emerald:#00A96E;--emerald-dark:#008557;--emerald-darker:#006B47;
  --emerald-light:#D4F0E3;--emerald-glow:rgba(0,169,110,.14);
  --font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;
  --r-sm:10px;--r:14px;--r-lg:20px;--r-xl:28px;
  --shadow:0 4px 16px rgba(14,31,26,.05),0 1px 3px rgba(14,31,26,.04);
  --shadow-md:0 12px 32px rgba(14,31,26,.07),0 2px 6px rgba(14,31,26,.04);
  --shadow-lg:0 24px 56px rgba(14,31,26,.08),0 4px 12px rgba(14,31,26,.05);
  --max-w:1240px;
  font-family:var(--font);background:var(--bg);color:var(--ink);line-height:1.6;
  -webkit-font-smoothing:antialiased;min-height:100vh;
}
.mgz *{margin:0;padding:0;box-sizing:border-box;}
.mgz a{color:inherit;text-decoration:none;transition:all .2s ease;}
.mgz ul{list-style:none;} .mgz img{max-width:100%;display:block;}
.mgz .container{max-width:var(--max-w);margin:0 auto;padding:0 24px;}
.mgz .hl{color:var(--emerald-dark);font-style:normal;position:relative;display:inline-block;}
.mgz .hl::after{content:'';position:absolute;left:-4px;right:-4px;bottom:4px;height:10px;background:rgba(0,169,110,.18);border-radius:3px;z-index:-1;}

/* NAV */
.mgz .nav{position:sticky;top:0;z-index:100;background:rgba(248,252,250,.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--line);}
.mgz .nav-inner{max-width:var(--max-w);margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:32px;}
.mgz .nav-logo{font-size:22px;font-weight:800;letter-spacing:-.03em;color:var(--ink);}
.mgz .nav-logo em{color:var(--emerald);font-style:normal;}
.mgz .nav-links{display:flex;align-items:center;gap:28px;font-size:14.5px;font-weight:600;color:var(--ink-soft);}
.mgz .nav-links a:hover{color:var(--emerald-dark);}
.mgz .nav-cta{padding:11px 20px;background:linear-gradient(135deg,#00C281 0%,var(--emerald) 50%,var(--emerald-dark) 100%);color:#fff !important;font-size:14px;font-weight:700;border-radius:12px;box-shadow:0 4px 14px var(--emerald-glow);}
.mgz .nav-cta:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,169,110,.24);}

/* SHARED BITS */
.mgz .crumb{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted);flex-wrap:wrap;}
.mgz .crumb a:hover{color:var(--emerald-dark);}
.mgz .crumb .sep{width:4px;height:4px;border-radius:50%;background:var(--muted-2);}
.mgz .crumb .here{color:var(--emerald-dark);}
.mgz .pill{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;background:var(--surface);border:1px solid var(--line);color:var(--ink-soft);border-radius:999px;font-size:13px;font-weight:600;}
.mgz .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--emerald);}
.mgz .chip{display:inline-flex;align-items:center;background:var(--emerald-light);color:var(--emerald-darker);font-size:12.5px;font-weight:700;padding:6px 13px;border-radius:999px;width:fit-content;}
.mgz .meta{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:var(--muted);flex-wrap:wrap;}
.mgz .meta .sep{width:4px;height:4px;border-radius:50%;background:var(--muted-2);}
.mgz .avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--emerald),var(--emerald-dark));color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}
.mgz .btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 22px;font-family:var(--font);font-size:15px;font-weight:700;border-radius:14px;border:1.5px solid transparent;cursor:pointer;white-space:nowrap;}
.mgz .btn-em{background:linear-gradient(135deg,#00C281,var(--emerald) 50%,var(--emerald-dark));color:#fff !important;box-shadow:0 4px 14px var(--emerald-glow);}
.mgz .btn-em:hover{transform:translateY(-1px);}
.mgz .ph-media{position:relative;background:linear-gradient(135deg,var(--mint-soft),var(--mint) 55%,var(--mint-2));overflow:hidden;}
.mgz .ph-media .ring{position:absolute;border-radius:50%;border:2px solid rgba(0,133,87,.15);}
.mgz .ph-media .r1{width:340px;height:340px;right:-90px;top:-90px;}
.mgz .ph-media .r2{width:220px;height:220px;right:-30px;top:30px;border-color:rgba(0,133,87,.09);}
.mgz .ph-media .brandmark{position:absolute;left:22px;bottom:18px;background:#fff;border-radius:999px;box-shadow:var(--shadow);padding:7px 14px;font-size:12px;font-weight:800;color:var(--emerald-darker);}

/* HOME: page head, featured, tagbar, grid */
.mgz .page-head{padding:56px 0 8px;}
.mgz .page-head .crumb{margin-bottom:18px;}
.mgz .page-head .pill{margin-bottom:16px;}
.mgz .page-head h1{font-size:clamp(2.25rem,4.8vw,3.6rem);font-weight:800;letter-spacing:-.04em;line-height:1.08;}
.mgz .page-head p.lede{color:var(--muted);font-size:1.06rem;max-width:56ch;margin-top:14px;}
.mgz .featured{margin:40px 0 12px;}
.mgz .feat-card{display:grid;grid-template-columns:1.1fr .9fr;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);overflow:hidden;box-shadow:var(--shadow-md);transition:all .25s ease;}
.mgz .feat-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);}
.mgz .feat-body{padding:44px 46px;display:flex;flex-direction:column;justify-content:center;}
.mgz .feat-body h2{font-size:clamp(1.5rem,2.6vw,2rem);font-weight:800;letter-spacing:-.03em;margin:16px 0 12px;line-height:1.2;}
.mgz .feat-card:hover h2{color:var(--emerald-dark);}
.mgz .feat-body p{color:var(--muted);font-size:15.5px;max-width:48ch;}
.mgz .feat-body .meta{margin-top:20px;}
.mgz .readlink{margin-top:22px;color:var(--emerald-dark);font-weight:700;font-size:14.5px;display:inline-flex;align-items:center;gap:8px;}
.mgz .readlink .arw{transition:transform .2s;}
.mgz .feat-card:hover .arw{transform:translateX(4px);}
.mgz .feat-media{min-height:340px;}
.mgz .feat-media img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;}
.mgz .tagbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:34px 0 6px;}
.mgz .tagbar a{padding:8px 16px;border-radius:999px;font-size:13.5px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);}
.mgz .tagbar a:hover{border-color:var(--emerald);color:var(--emerald-dark);}
.mgz .tagbar a.on{background:var(--ink);border-color:var(--ink);color:#fff;}
.mgz .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:26px 0 8px;}
.mgz .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow);transition:all .25s ease;display:flex;flex-direction:column;}
.mgz .card:hover{transform:translateY(-4px);box-shadow:var(--shadow-md);}
.mgz .card-media{aspect-ratio:16/9;}
.mgz .card-media img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;}
.mgz .card-body{padding:22px 24px 24px;display:flex;flex-direction:column;gap:10px;flex:1;}
.mgz .card-body h3{font-size:18.5px;font-weight:700;letter-spacing:-.02em;line-height:1.3;}
.mgz .card:hover h3{color:var(--emerald-dark);}
.mgz .card-body p{color:var(--muted);font-size:14px;flex:1;}
.mgz .empty{text-align:center;color:var(--muted);padding:70px 0;font-size:15px;}

/* DARK CTA / NEWSLETTER */
.mgz .cta-banner{margin:64px 0 0;background:var(--ink);border-radius:var(--r-xl);padding:56px 48px;text-align:center;position:relative;overflow:hidden;}
.mgz .cta-banner::before{content:'';position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(0,169,110,.25),transparent 65%);top:-190px;right:-120px;}
.mgz .cta-banner>*{position:relative;z-index:2;}
.mgz .cta-banner h2{color:#fff;margin-bottom:12px;font-size:clamp(1.5rem,2.6vw,2rem);font-weight:800;letter-spacing:-.03em;}
.mgz .cta-banner h2 em{color:#A7F3D0;font-style:normal;}
.mgz .cta-banner p{color:rgba(255,255,255,.75);max-width:52ch;margin:0 auto 28px;font-size:1.0625rem;}
.mgz .subrow{display:flex;gap:12px;max-width:460px;margin:0 auto;}
.mgz .subrow input{flex:1;padding:14px 18px;border-radius:14px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#fff;font-family:var(--font);font-size:14.5px;outline:none;}
.mgz .subrow input::placeholder{color:rgba(255,255,255,.45);}
.mgz .subrow input:focus{border-color:var(--emerald);}
.mgz .subok{color:#A7F3D0;font-weight:700;font-size:14.5px;}

/* ARTICLE LAYOUT + SIDEBAR */
.mgz .layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:44px;padding:44px 0 0;align-items:start;}
.mgz h1.title{font-size:clamp(2rem,4.2vw,3.1rem);font-weight:800;letter-spacing:-.038em;line-height:1.1;margin:20px 0 22px;}
.mgz .meta-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:28px;}
.mgz .meta-row .who{font-size:14px;font-weight:700;color:var(--ink);}
.mgz .mpill{display:inline-flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;color:var(--muted);}
.mgz .hero{border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow-md);margin-bottom:38px;aspect-ratio:16/8;}
.mgz .hero img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;}
.mgz .art-cta{background:var(--ink);border-radius:var(--r-lg);padding:34px 32px;margin:40px 0 8px;position:relative;overflow:hidden;}
.mgz .art-cta::before{content:'';position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(0,169,110,.28),transparent 65%);top:-130px;right:-80px;}
.mgz .art-cta>*{position:relative;z-index:2;}
.mgz .art-cta h3{color:#fff;font-size:1.4rem;font-weight:800;letter-spacing:-.025em;margin-bottom:8px;}
.mgz .art-cta h3 em{color:#A7F3D0;font-style:normal;}
.mgz .art-cta p{color:rgba(255,255,255,.75);font-size:14.5px;margin-bottom:20px;max-width:48ch;}
.mgz .side{position:sticky;top:86px;display:flex;flex-direction:column;gap:22px;}
.mgz .panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:24px;box-shadow:var(--shadow);}
.mgz .panel .ph3{font-size:14px;font-weight:800;letter-spacing:-.01em;margin-bottom:16px;color:var(--ink);}
.mgz .share{display:flex;gap:10px;}
.mgz .share a,.mgz .share button{width:40px;height:40px;border-radius:12px;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;color:var(--ink-soft);background:var(--surface);cursor:pointer;transition:all .2s ease;}
.mgz .share a:hover,.mgz .share button:hover{border-color:var(--emerald);color:var(--emerald-dark);background:var(--mint-soft);}
.mgz .share svg{width:17px;height:17px;fill:currentColor;}
.mgz .tags{display:flex;flex-wrap:wrap;gap:8px;}
.mgz .tags a{padding:7px 13px;border-radius:999px;font-size:12.5px;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--ink-soft);}
.mgz .tags a:hover{border-color:var(--emerald);color:var(--emerald-dark);}
.mgz .rel a{display:grid;grid-template-columns:76px 1fr;gap:13px;padding:12px 0;border-bottom:1px solid var(--line-soft);align-items:center;}
.mgz .rel a:last-child{border-bottom:none;padding-bottom:0;}
.mgz .rel a:first-child{padding-top:0;}
.mgz .rel .thumb{width:76px;height:56px;border-radius:10px;background:linear-gradient(135deg,var(--mint-soft),var(--mint-2));overflow:hidden;position:relative;}
.mgz .rel .thumb img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;}
.mgz .rel .rd{font-size:11.5px;font-weight:600;color:var(--muted);margin-bottom:3px;display:block;}
.mgz .rel .rt{font-size:13.5px;font-weight:700;line-height:1.32;letter-spacing:-.01em;display:block;color:var(--ink);}
.mgz .rel a:hover .rt{color:var(--emerald-dark);}
.mgz .newsbox{background:var(--ink);border:none;position:relative;overflow:hidden;}
.mgz .newsbox::before{content:'';position:absolute;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(0,169,110,.3),transparent 65%);top:-110px;right:-70px;}
.mgz .newsbox>*{position:relative;z-index:2;}
.mgz .newsbox .ph3{color:#fff;font-size:17px;margin-bottom:8px;}
.mgz .newsbox p{color:rgba(255,255,255,.72);font-size:13.5px;margin-bottom:16px;}
.mgz .newsbox input{width:100%;padding:13px 15px;border-radius:12px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#fff;font-family:var(--font);font-size:14px;outline:none;margin-bottom:10px;}
.mgz .newsbox input::placeholder{color:rgba(255,255,255,.45);}
.mgz .newsbox input:focus{border-color:var(--emerald);}
.mgz .newsbox .btn{width:100%;justify-content:center;}
.mgz .wa{display:flex;align-items:center;gap:12px;background:var(--mint-soft);border:1px solid var(--mint-2);}
.mgz .wa .ic{width:42px;height:42px;border-radius:12px;background:#25D366;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.mgz .wa .ic svg{width:22px;height:22px;fill:#fff;}
.mgz .wa .t1{font-size:13.5px;font-weight:800;color:var(--ink);display:block;}
.mgz .wa .t2{font-size:12px;color:var(--muted);display:block;}
.mgz .more{padding:56px 0 0;}
.mgz .more h2{font-size:clamp(1.5rem,2.6vw,2rem);font-weight:800;letter-spacing:-.03em;margin-bottom:24px;}
.mgz .progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--emerald);z-index:200;}

/* FOOTER (matches migrizo.com) */
.mgz footer{background:var(--ink);color:rgba(255,255,255,.7);padding:72px 0 32px;margin-top:80px;}
.mgz .footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:56px;margin-bottom:56px;}
.mgz .footer-brand h4{font-size:22px;font-weight:800;color:#fff;margin-bottom:12px;}
.mgz .footer-brand h4 em{color:var(--emerald);font-style:normal;}
.mgz .footer-brand p{font-size:14px;max-width:34ch;margin-bottom:18px;}
.mgz .footer-contact div{font-size:13.5px;margin-bottom:5px;}
.mgz footer h5{font-size:13px;font-weight:700;color:#fff;margin-bottom:14px;}
.mgz footer ul li{margin-bottom:9px;font-size:14px;}
.mgz footer ul a:hover{color:#fff;}
.mgz .footer-bottom{border-top:1px solid rgba(255,255,255,.1);padding-top:26px;font-size:13px;color:rgba(255,255,255,.45);display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;}

@media(max-width:1000px){
  .mgz .layout{grid-template-columns:1fr;}
  .mgz .side{position:static;}
}
@media(max-width:900px){
  .mgz .nav-links a:not(.nav-cta){display:none;}
  .mgz .feat-card{grid-template-columns:1fr;}
  .mgz .feat-media{min-height:220px;order:-1;}
  .mgz .feat-body{padding:28px 26px 32px;}
  .mgz .grid{grid-template-columns:1fr;}
  .mgz .footer-grid{grid-template-columns:1fr 1fr;gap:32px;}
  .mgz .subrow{flex-direction:column;}
}
.mgz a:focus-visible,.mgz button:focus-visible,.mgz input:focus-visible{outline:2px solid var(--emerald);outline-offset:2px;}
@media(prefers-reduced-motion:reduce){.mgz *{transition:none!important;}.mgz .progress{display:none;}}
`;

export function fmtDate(d: string | null): string {
  return d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '';
}
