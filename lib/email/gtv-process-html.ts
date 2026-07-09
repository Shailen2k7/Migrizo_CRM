// =============================================================================
// GTV "HOW IT WORKS" EMAIL — the approved premium marketing/process email.
// Sent from the lead drawer's "How it works" button.
//
// Design notes:
//  - Hero banner is served from https://crm.migrizo.com/gtv-hero.jpg (NOT a
//    base64 data URI — Gmail strips those and the banner would not render).
//  - Email-safe: inline CSS, table layout, no JavaScript.
//  - ~53KB, comfortably under Gmail's 102KB clipping threshold.
// =============================================================================

export const GTV_PROCESS_HTML = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Migrizo — UK Global Talent Visa</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, div, p, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    /* Client resets */
    body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; }
    img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }

    /* Animations — progressive enhancement. Render in browsers & Apple Mail;
       Gmail/Outlook safely ignore them and show the static design. */
    @keyframes mgzPulse {
      0%   { box-shadow: 0 0 0 0 rgba(62,86,212,0.45); }
      70%  { box-shadow: 0 0 0 12px rgba(62,86,212,0); }
      100% { box-shadow: 0 0 0 0 rgba(62,86,212,0); }
    }
    @keyframes mgzPulseGreen {
      0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
      70%  { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
      100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
    }
    @keyframes mgzFlow {
      0%   { background-position: 0 0; }
      100% { background-position: 0 24px; }
    }
    .step-badge { animation: mgzPulse 2.4s ease-out infinite; }
    .step-badge-2 { animation-delay: 0.3s; } .step-badge-3 { animation-delay: 0.6s; }
    .step-badge-4 { animation-delay: 0.9s; } .step-badge-5 { animation-delay: 1.2s; }
    .step-badge-6 { animation-delay: 1.5s; }
    .step-badge-7 { animation: mgzPulseGreen 2.4s ease-out infinite; animation-delay: 1.8s; }
    .step-line {
      background-image: linear-gradient(to bottom, #3E56D4 55%, rgba(62,86,212,0.15) 55%) !important;
      background-size: 2px 24px !important;
      animation: mgzFlow 1.6s linear infinite;
    }

    /* Mobile responsive: stack the multi-column card grids */
    @media only screen and (max-width:600px) {
      .container { width:100% !important; }
      .stack { display:block !important; width:100% !important; box-sizing:border-box !important; }
      .stack-pad { padding-left:24px !important; padding-right:24px !important; }
      .h1 { font-size:26px !important; }
      .h2 { font-size:19px !important; }
      .price-num { font-size:38px !important; }
      .hide-mobile { display:none !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#EEF1F8;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
    Everything about your UK Global Talent Visa — the route, benefits, what we need from you, our 7-step process and transparent pricing.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF1F8;">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <!-- ===================== MAIN CONTAINER ===================== -->
        <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" style="width:640px; max-width:640px; background-color:#FFFFFF; border-radius:18px; overflow:hidden; box-shadow:0 8px 30px rgba(22,41,78,0.10);">

          <!-- ===================== 1. HERO ===================== -->
          <tr>
            <td style="background-color:#FFFFFF; padding:26px 32px 14px 32px; border-bottom:1px solid #EEF1F8;" align="left">
              <img src="https://crm.migrizo.com/migrizo-email-logo.png" alt="Migrizo — Smart. Fast. Reliable Visas" width="180" style="display:block; width:180px; max-width:180px; height:auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0; line-height:0;">
              <a href="https://wa.me/447887348822" target="_blank">
                <img src="https://crm.migrizo.com/gtv-hero.jpg" alt="UK Global Talent Visa — a premium advisory and profile-building journey, fully managed by Migrizo" width="640" style="display:block; width:100%; max-width:640px; height:auto;" />
              </a>
            </td>
          </tr>
          <!-- ===================== TABLE OF CONTENTS (clickable, single row) ===================== -->
          <tr>
            <td style="background-color:#F5F7FC; padding:16px 16px; border-bottom:1px solid #E7EAF1;" align="center">
              <div style="font-size:10.5px; font-weight:800; letter-spacing:1.2px; color:#6B7280; font-family:Arial,Helvetica,sans-serif; margin-bottom:11px;">JUMP TO A SECTION</div>
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td style="padding:0 3px;"><a href="#about" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">About</a></td>
                  <td style="padding:0 3px;"><a href="#benefits" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">Benefits</a></td>
                  <td style="padding:0 3px;"><a href="#who" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">Who Can Apply</a></td>
                  <td style="padding:0 3px;"><a href="#need" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">What We Need</a></td>
                  <td style="padding:0 3px;"><a href="#process" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">Process</a></td>
                  <td style="padding:0 3px;"><a href="#pricing" style="display:inline-block; background:#FFFFFF; border:1px solid #D9DFF0; border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; color:#3E56D4; font-family:Arial,Helvetica,sans-serif; white-space:nowrap;">Pricing</a></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 2. WHAT IS IT ===================== -->
          <tr>
            <td class="stack-pad" style="padding:34px 32px 8px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="about" style="margin:0 0 12px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">What is the UK Global Talent Visa?</h2>
              <p style="margin:0 0 12px 0; font-size:14px; line-height:1.75; color:#3A4152; font-family:Arial,Helvetica,sans-serif;">
                The Global Talent Visa is a UK immigration route for high-potential individuals recognised as leaders — or potential leaders — in technology, science, engineering, academia, arts and culture. It lets you live and work in the UK <strong>without a job offer or employer sponsorship</strong>.
              </p>
              <p style="margin:0; font-size:14px; line-height:1.75; color:#3A4152; font-family:Arial,Helvetica,sans-serif;">
                It is one of the UK's most prestigious routes because it rewards talent and achievement rather than a company tie — giving you full freedom to work, freelance or build your own venture, bring your family from day one, and a fast pathway to permanent settlement.
              </p>
            </td>
          </tr>

          <!-- ===================== 3. WHY CHOOSE (benefit cards) ===================== -->
          <tr>
            <td class="stack-pad" style="padding:30px 32px 6px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="benefits" style="margin:0 0 4px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Why choose this visa?</h2>
              <p style="margin:0 0 16px 0; font-size:13px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">Nine reasons it's a category of its own.</p>
            </td>
          </tr>
          <tr>
            <td class="stack-pad" style="padding:0 26px 14px 26px;">
              <!-- Row 1 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🚫</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">No Job Offer Required</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🤝</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">No Sponsorship Required</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">💼</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">Freedom to Work</div>
                    </div>
                  </td>
                </tr>
              </table>
              <!-- Row 2 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🧑‍💻</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">Freedom to Freelance</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🚀</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">Start Your Own Business</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">👨‍👩‍👧</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">Bring Your Family</div>
                    </div>
                  </td>
                </tr>
              </table>
              <!-- Row 3 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">👩‍💼</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">Spouse Can Work</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🏡</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">ILR Pathway</div>
                    </div>
                  </td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;">
                    <div style="background-color:#F5F7FC; border:1px solid #E7EAF1; border-radius:12px; padding:20px 12px; text-align:center;">
                      <div style="font-size:30px; line-height:1;">🇬🇧</div>
                      <div style="margin-top:11px; font-size:14px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.35;">British Citizenship Opportunity</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 4. WHO CAN APPLY ===================== -->
          <tr>
            <td style="background-color:#F5F7FC; padding:30px 32px 8px 32px;" class="stack-pad" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="who" style="margin:0 0 4px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Who can apply?</h2>
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">If your work sits in any of these, you likely qualify.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F7FC; padding:6px 26px 22px 26px;" class="stack-pad">
              <!-- 12 role pills in rows of 3 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">💻<br/>Software Engineers</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🤖<br/>AI &amp; ML Professionals</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">📊<br/>Data Scientists</div></td>
                </tr>
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🛡️<br/>Cyber Security Experts</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🚀<br/>Tech Founders</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">📦<br/>Product Managers</div></td>
                </tr>
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🔬<br/>Researchers</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🎓<br/>Academics</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">📐<br/>Architects</div></td>
                </tr>
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🎨<br/>Designers</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">⚙️<br/>Engineers</div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:5px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:10px; padding:16px 8px; text-align:center; font-size:13px; font-weight:700; color:#2B3450; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">🎬<br/>Creative Professionals</div></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 5. WHY BUILD CAREER IN UK ===================== -->
          <tr>
            <td class="stack-pad" style="padding:32px 32px 8px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" style="margin:0 0 16px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Why build your career in the UK?</h2>
            </td>
          </tr>
          <tr>
            <td class="stack-pad" style="padding:0 26px 18px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">💷</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">High Salaries</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🌐</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Global Companies</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🏥</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">NHS Healthcare</div></div></td>
                </tr>
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🎓</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Excellent Education</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">💡</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Startup Ecosystem</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🔭</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Innovation Hub</div></div></td>
                </tr>
                <tr>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🌍</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Multicultural Society</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">📈</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Strong Economy</div></div></td>
                  <td class="stack" width="33.33%" valign="top" style="padding:6px;"><div style="background:#EEF2FF; border-radius:12px; padding:20px 10px; text-align:center;"><div style="font-size:28px; line-height:1;">🏡</div><div style="margin-top:10px; font-size:13.5px; font-weight:700; color:#16294E; font-family:Arial,Helvetica,sans-serif; line-height:1.3;">Residency Pathway</div></div></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 6. WHAT WE NEED FROM YOU ===================== -->
          <tr>
            <td style="background-color:#16294E; padding:32px 32px 8px 32px;" class="stack-pad" align="left">
              <div style="width:34px; height:3px; background-color:#F4C430; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="need" style="margin:0 0 4px 0; font-size:22px; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-weight:800;">What we need from you</h2>
              <p style="margin:0 0 6px 0; font-size:13px; color:#AEBEE0; font-family:Arial,Helvetica,sans-serif;">Send what you have — nothing is mandatory upfront, and we guide you on the rest.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#16294E; padding:6px 26px 8px 26px;" class="stack-pad">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Updated CV</div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; LinkedIn Profile</div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Passport</div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Educational Documents</div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Employment Letters</div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Salary Slips <span style="color:#8FA6E8;">(if available)</span></div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Awards &amp; Achievements <span style="color:#8FA6E8;">(if any)</span></div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Publications <span style="color:#8FA6E8;">(if any)</span></div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Speaking Engagements <span style="color:#8FA6E8;">(if any)</span></div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Media Features</div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Portfolio / GitHub / Projects <span style="color:#8FA6E8;">(if any)</span></div></td>
                  <td class="stack" width="50%" valign="top" style="padding:5px;"><div style="background:#1E3358; border:1px solid #2C446E; border-radius:10px; padding:11px 14px; font-size:12.5px; color:#E7ECF7;">✅&nbsp; Business Docs <span style="color:#8FA6E8;">(if founder)</span></div></td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- LOR highlight -->
          <tr>
            <td style="background-color:#16294E; padding:10px 32px 34px 32px;" class="stack-pad">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFBEB; border-radius:14px;">
                <tr>
                  <td style="padding:18px 20px;" align="left">
                    <div style="font-size:11px; font-weight:800; letter-spacing:1px; color:#B45309; font-family:Arial,Helvetica,sans-serif;">⭐ REQUIRED — RECOMMENDATION LETTERS (LOR)</div>
                    <p style="margin:8px 0 12px 0; font-size:13px; line-height:1.6; color:#5B4A1E; font-family:Arial,Helvetica,sans-serif;">
                      We require <strong>3 recommendation letters</strong> from senior professionals who know your work. We draft and structure them — you introduce us to the right referees. Ideal referees:
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">
                      <tr>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">👔 CEO / Founder</div></td>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">🎖️ Director / VP</div></td>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">🎓 Professor</div></td>
                      </tr>
                      <tr>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">🧑‍💼 Senior Manager</div></td>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">🛠️ CTO / Tech Lead</div></td>
                        <td class="stack" width="33.33%" style="padding:4px;"><div style="background:#FFFFFF; border:1px solid #F0E4BE; border-radius:8px; padding:9px 6px; text-align:center; font-size:11.5px; font-weight:600; color:#7A5B00;">🌟 Industry Leader</div></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 7. 7-STEP PROCESS (connected timeline) ===================== -->
          <tr>
            <td class="stack-pad" style="padding:34px 32px 10px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="process" style="margin:0 0 4px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Our complete 7-step process</h2>
              <p style="margin:0 0 8px 0; font-size:13px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">Fully managed from eligibility to landing.</p>
            </td>
          </tr>
          <tr>
            <td class="stack-pad" style="padding:6px 32px 20px 32px;">
              <!-- vertical connected timeline: number badge + card -->
              <!-- Step template repeated -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <!-- 1 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-1" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">1</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Profile Evaluation &amp; Eligibility</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">We map your profile to the right endorsing body and give you a realistic, honest assessment.</div>
                  </td>
                </tr>
                <!-- 2 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-2" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">2</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Personalised Roadmap</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">A step-by-step plan with clear milestones, timelines and a documentation checklist.</div>
                  </td>
                </tr>
                <!-- 3 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-3" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">3</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Profile Building Support</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">UK-style CV, LinkedIn, Personal Statement, PR coordination and UK visibility.</div>
                  </td>
                </tr>
                <!-- 4 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-4" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">4</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Supporting Documents</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Recommendation-letter templates and a structured, criteria-mapped evidence portfolio.</div>
                  </td>
                </tr>
                <!-- 5 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-5" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">5</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Endorsement Submission</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Full preparation, evidence compilation and liaison with the endorsing body.</div>
                  </td>
                </tr>
                <!-- 6 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-6" style="width:38px; height:38px; border-radius:50%; background:#3E56D4; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">6</div>
                    <div class="step-line" style="width:2px; height:30px; background:#D6DDF0; margin:2px auto 0 auto;"></div>
                  </td>
                  <td valign="top" style="padding:0 0 8px 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Visa Application</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">UKVI filing guidance, IHS, and spouse / children dependant applications.</div>
                  </td>
                </tr>
                <!-- 7 -->
                <tr>
                  <td width="52" valign="top" align="center" style="padding:0;">
                    <div class="step-badge step-badge-7" style="width:38px; height:38px; border-radius:50%; background:#10B981; color:#FFFFFF; font-size:15px; font-weight:800; line-height:38px; text-align:center; font-family:Arial,Helvetica,sans-serif;">7</div>
                  </td>
                  <td valign="top" style="padding:0 0 0 10px;">
                    <div style="font-size:14px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Post-Landing Support</div>
                    <div style="font-size:12.5px; color:#6B7280; line-height:1.55; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">UK network built before arrival, NI Number, work setup and ILR planning.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 8. PROFESSIONAL FEE ===================== -->
          <tr>
            <td style="background-color:#F5F7FC; padding:32px 32px 6px 32px;" class="stack-pad" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" style="margin:0 0 4px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Professional fee structure</h2>
              <p style="margin:0 0 14px 0; font-size:13px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">One fixed fee, paid across four simple milestones.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F7FC; padding:0 26px 12px 26px;" class="stack-pad">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="25%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px 8px; text-align:center;"><div style="font-size:20px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">£500</div><div style="font-size:11px; color:#6B7280; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Kickstart</div></div></td>
                  <td class="stack" width="25%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px 8px; text-align:center;"><div style="font-size:20px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">£1,250</div><div style="font-size:11px; color:#6B7280; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Profile Building</div></div></td>
                  <td class="stack" width="25%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px 8px; text-align:center;"><div style="font-size:20px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">£500</div><div style="font-size:11px; color:#6B7280; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Endorsement</div></div></td>
                  <td class="stack" width="25%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px 8px; text-align:center;"><div style="font-size:20px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">£750</div><div style="font-size:11px; color:#6B7280; font-family:Arial,Helvetica,sans-serif; margin-top:2px;">Final Payment</div></div></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F7FC; padding:2px 32px 30px 32px;" class="stack-pad" align="center">
              <div style="display:inline-block; background:#16294E; color:#FFFFFF; border-radius:10px; padding:12px 24px; font-size:15px; font-weight:800; font-family:Arial,Helvetica,sans-serif;">Total Professional Fee: <span style="color:#F4C430;">£3,000</span></div>
            </td>
          </tr>

          <!-- ===================== 9. ADDITIONAL COSTS TABLE ===================== -->
          <tr>
            <td class="stack-pad" style="padding:32px 32px 6px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" style="margin:0 0 4px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Additional costs (paid directly)</h2>
              <p style="margin:0 0 14px 0; font-size:13px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">Government &amp; third-party charges — paid by you to the relevant authority, not part of our fee.</p>
            </td>
          </tr>
          <tr>
            <td class="stack-pad" style="padding:0 32px 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E1E6F2; border-radius:12px; overflow:hidden; font-family:Arial,Helvetica,sans-serif;">
                <tr style="background:#16294E;">
                  <td style="padding:11px 16px; font-size:11px; font-weight:800; color:#FFFFFF; letter-spacing:0.5px;">COST ITEM</td>
                  <td style="padding:11px 16px; font-size:11px; font-weight:800; color:#FFFFFF; letter-spacing:0.5px;" align="right">APPROX. AMOUNT</td>
                </tr>
                <tr style="background:#FFFFFF;">
                  <td style="padding:12px 16px; font-size:13px; color:#2B3450; border-bottom:1px solid #EEF1F8;">Profile Building (PR Agency)</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:700; color:#16294E; border-bottom:1px solid #EEF1F8;" align="right">£500</td>
                </tr>
                <tr style="background:#FAFBFE;">
                  <td style="padding:12px 16px; font-size:13px; color:#2B3450; border-bottom:1px solid #EEF1F8;">UK Endorsement Fee</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:700; color:#16294E; border-bottom:1px solid #EEF1F8;" align="right">£561</td>
                </tr>
                <tr style="background:#FFFFFF;">
                  <td style="padding:12px 16px; font-size:13px; color:#2B3450; border-bottom:1px solid #EEF1F8;">Visa Fee</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:700; color:#16294E; border-bottom:1px solid #EEF1F8;" align="right">£210</td>
                </tr>
                <tr style="background:#FAFBFE;">
                  <td style="padding:12px 16px; font-size:13px; color:#2B3450;">Immigration Health Surcharge (IHS)</td>
                  <td style="padding:12px 16px; font-size:13px; font-weight:700; color:#16294E;" align="right">£1,035 / yr / person</td>
                </tr>
                <tr style="background:#EEF2FF;">
                  <td style="padding:13px 16px; font-size:13px; font-weight:800; color:#16294E;">Approx. Total Government Cost</td>
                  <td style="padding:13px 16px; font-size:15px; font-weight:800; color:#3E56D4;" align="right">~£4,000</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 10. TOTAL ESTIMATED COST (pricing cards) ===================== -->
          <tr>
            <td class="stack-pad" style="padding:22px 32px 6px 32px;" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" id="pricing" style="margin:0 0 16px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Total estimated cost</h2>
            </td>
          </tr>
          <tr>
            <td class="stack-pad" style="padding:0 26px 30px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- 3 Years card -->
                  <td class="stack" width="50%" valign="top" style="padding:6px;">
                    <div style="background:#FFFFFF; border:2px solid #D9DFF0; border-radius:16px; padding:24px 18px; text-align:center;">
                      <div style="font-size:12px; font-weight:800; letter-spacing:1px; color:#3E56D4; font-family:Arial,Helvetica,sans-serif;">3 YEARS VISA</div>
                      <div class="price-num" style="font-size:42px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif; margin:8px 0 2px 0;">£7,500</div>
                      <div style="font-size:11.5px; color:#6B7280; font-family:Arial,Helvetica,sans-serif;">All-inclusive (approx.)</div>
                    </div>
                  </td>
                  <!-- 5 Years card (premium/highlighted) -->
                  <td class="stack" width="50%" valign="top" style="padding:6px;">
                    <div style="background:#16294E; border-radius:16px; padding:24px 18px; text-align:center;">
                      <div style="font-size:12px; font-weight:800; letter-spacing:1px; color:#F4C430; font-family:Arial,Helvetica,sans-serif;">5 YEARS VISA</div>
                      <div class="price-num" style="font-size:42px; font-weight:800; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; margin:8px 0 2px 0;">£9,500</div>
                      <div style="font-size:11.5px; color:#AEBEE0; font-family:Arial,Helvetica,sans-serif;">All-inclusive (approx.)</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 11. WHY MIGRIZO ===================== -->
          <tr>
            <td style="background-color:#F5F7FC; padding:30px 32px 8px 32px;" class="stack-pad" align="left">
              <div style="width:34px; height:3px; background-color:#3E56D4; border-radius:2px; margin-bottom:14px;"></div>
              <h2 class="h2" style="margin:0 0 16px 0; font-size:22px; color:#16294E; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Why Migrizo?</h2>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F5F7FC; padding:0 26px 30px 26px;" class="stack-pad">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px;"><div style="font-size:28px; line-height:1;">🧩</div><div style="margin-top:8px; font-size:13.5px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">End-to-End Support</div><div style="margin-top:3px; font-size:12px; color:#6B7280; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">From first assessment to landing — one team, every stage.</div></div></td>
                  <td class="stack" width="50%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px;"><div style="font-size:28px; line-height:1;">🎓</div><div style="margin-top:8px; font-size:13.5px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Expert Guidance</div><div style="margin-top:3px; font-size:12px; color:#6B7280; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">Real endorsement-criteria expertise, not generic advice.</div></div></td>
                </tr>
                <tr>
                  <td class="stack" width="50%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px;"><div style="font-size:28px; line-height:1;">💎</div><div style="margin-top:8px; font-size:13.5px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Transparent Pricing</div><div style="margin-top:3px; font-size:12px; color:#6B7280; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">A fixed £3,000 fee, clear milestones, no hidden charges.</div></div></td>
                  <td class="stack" width="50%" valign="top" style="padding:6px;"><div style="background:#FFFFFF; border:1px solid #E1E6F2; border-radius:12px; padding:16px;"><div style="font-size:28px; line-height:1;">🧑‍💼</div><div style="margin-top:8px; font-size:13.5px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif;">Dedicated Case Manager</div><div style="margin-top:3px; font-size:12px; color:#6B7280; line-height:1.5; font-family:Arial,Helvetica,sans-serif;">A single point of contact throughout your journey.</div></div></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== 12. FINAL CTA ===================== -->
          <tr>
            <td style="background-color:#16294E; padding:40px 32px;" align="center">
              <h2 style="margin:0 0 10px 0; font-size:26px; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif; font-weight:800;">Ready to start your UK journey?</h2>
              <p style="margin:0 auto 22px auto; max-width:420px; font-size:13.5px; line-height:1.7; color:#C7D3EE; font-family:Arial,Helvetica,sans-serif;">Let's assess your profile and map your fastest route to the UK Global Talent Visa.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td align="center" bgcolor="#F4C430" style="border-radius:10px;">
                    <a href="https://wa.me/447887348822" target="_blank" style="display:inline-block; padding:15px 34px; font-size:15px; font-weight:800; color:#16294E; font-family:Arial,Helvetica,sans-serif; border-radius:10px;">💬&nbsp; Book Your Free Assessment on WhatsApp</a>
                  </td>
                </tr>
              </table>
              <!-- contact row -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-top:26px;">
                <tr>
                  <td style="padding:0 12px; font-size:12.5px; color:#AEBEE0; font-family:Arial,Helvetica,sans-serif;">🌐 <a href="https://www.migrizo.com" style="color:#FFFFFF; text-decoration:none;">www.migrizo.com</a></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px 0 12px; font-size:12.5px; color:#AEBEE0; font-family:Arial,Helvetica,sans-serif;" align="center">✉️ <a href="mailto:info@migrizo.com" style="color:#FFFFFF; text-decoration:none;">info@migrizo.com</a></td>
                </tr>
                <tr>
                  <td style="padding:6px 12px 0 12px; font-size:12.5px; color:#AEBEE0; font-family:Arial,Helvetica,sans-serif;" align="center">📞 <a href="https://wa.me/447887348822" style="color:#FFFFFF; text-decoration:none;">+44 7887 348822</a></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===================== FOOTER ===================== -->
          <tr>
            <td style="background-color:#0F1D38; padding:18px 32px;" align="center">
              <div style="font-size:13px; font-weight:700; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif;">Migrizo</div>
              <div style="font-size:10.5px; color:#7488B4; font-family:Arial,Helvetica,sans-serif; margin-top:4px; line-height:1.6;">
                M4 Investments Ltd (trading as Migrizo) · Suite 39, Podium, 85 Ealing Cross, Ealing, London W5 5BW<br/>
                Migrizo provides immigration advisory and does not guarantee endorsement or visa outcomes. Fees &amp; government costs are indicative and may change.
              </div>
            </td>
          </tr>

        </table>
        <!-- ===================== /MAIN CONTAINER ===================== -->

      </td>
    </tr>
  </table>
</body>
</html>
`;
