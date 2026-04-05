function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentFlow</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background:linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa);padding:32px 40px;text-align:center;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:10px;text-align:center;vertical-align:middle;">
      <span style="font-size:18px;color:#ffffff;">&#10024;</span>
    </td>
    <td style="padding-left:10px;">
      <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">AgentFlow</span>
    </td>
  </tr>
  </table>
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:40px;">
${content}
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:24px 40px;border-top:1px solid #eee;text-align:center;">
  <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
    &copy; ${new Date().getFullYear()} AgentFlow. All rights reserved.
  </p>
  <p style="margin:0;font-size:11px;color:#c0c5ce;">
    You received this email because an action was taken on your AgentFlow account.
  </p>
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
<tr>
<td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;">
  <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
    ${label}
  </a>
</td>
</tr>
</table>`;
}

function greeting(name: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;color:#111827;">Hi ${name},</p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4b5563;">${text}</p>`;
}

function urlFallback(url: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;word-break:break-all;">
If the button doesn't work, copy and paste this link:<br/>
<a href="${url}" style="color:#6366f1;">${url}</a>
</p>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #f0f0f3;margin:24px 0;">`;
}

// ─── Verification Email (Set Password) ───

export function verificationEmailHtml(name: string, url: string): string {
  return baseLayout(`
    ${greeting(name)}
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Welcome to AgentFlow! 🎉</h2>
    ${paragraph("Thank you for signing up. You're one step away from building powerful AI agent teams.")}
    ${paragraph('Click the button below to set your password and activate your account:')}
    ${button(url, 'Set Password & Activate')}
    ${divider()}
    ${paragraph('⏱ This link expires in <strong>24 hours</strong>.')}
    ${paragraph('If you did not create an account, you can safely ignore this email.')}
    ${urlFallback(url)}
  `);
}

export function verificationEmailText(name: string, url: string): string {
  return [
    `Hi ${name},`,
    '',
    'Welcome to AgentFlow!',
    '',
    'Click the link below to set your password and activate your account:',
    url,
    '',
    'This link expires in 24 hours.',
    '',
    'If you did not create an account, you can safely ignore this email.',
    '',
    '— The AgentFlow Team',
  ].join('\n');
}

// ─── Password Reset Email ───

export function passwordResetEmailHtml(name: string, url: string): string {
  return baseLayout(`
    ${greeting(name)}
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Reset Your Password</h2>
    ${paragraph('We received a request to reset the password for your AgentFlow account.')}
    ${paragraph('Click the button below to choose a new password:')}
    ${button(url, 'Reset Password')}
    ${divider()}
    ${paragraph('⏱ This link expires in <strong>1 hour</strong>.')}
    ${paragraph("If you didn't request a password reset, no action is needed — your account is still secure.")}
    ${urlFallback(url)}
  `);
}

export function passwordResetEmailText(name: string, url: string): string {
  return [
    `Hi ${name},`,
    '',
    'We received a request to reset your password.',
    '',
    'Click the link below to set a new password:',
    url,
    '',
    'This link expires in 1 hour.',
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    '— The AgentFlow Team',
  ].join('\n');
}

// ─── Welcome Email (sent after account verification completes) ───

export interface WelcomeEmailData {
  name: string;
  plan: string;
  dashboardUrl: string;
  pricingUrl: string;
}

export function welcomeEmailHtml(data: WelcomeEmailData): string {
  const { name, plan, dashboardUrl, pricingUrl } = data;
  const isFree = plan === 'FREE';

  const planFeatures = isFree
    ? `
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; 1 AI agent team
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; 10 agent runs per month
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; Gemini Flash, GPT-4o Mini &amp; Mistral
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; Agent template library
    </td></tr>`
    : `
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; Up to 10 agent teams
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; 500 agent runs per month
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; All AI models
    </td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#4b5563;">
      <span style="color:#6366f1;font-weight:600;">&#10003;</span>&nbsp; Priority support
    </td></tr>`;

  return baseLayout(`
    ${greeting(name)}
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Your account is ready! 🚀</h2>
    ${paragraph("Your email has been verified and your password is set. You're all set to start building AI agent teams.")}

    <!-- Plan card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:24px 0;">
      <tr>
        <td style="padding:16px 24px;border-bottom:1px solid #e5e7eb;background:#f3f0ff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:14px;font-weight:700;color:#111827;">Your Plan</td>
              <td align="right">
                <span style="display:inline-block;padding:4px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:12px;font-weight:600;border-radius:20px;">
                  ${plan}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;">
          <p style="margin:0 0 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">What you get:</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            ${planFeatures}
          </table>
        </td>
      </tr>
    </table>

    <!-- Quick start steps -->
    <h3 style="margin:24px 0 16px;font-size:16px;font-weight:600;color:#111827;">Get started in 3 steps:</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:10px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;height:28px;background:#6366f1;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#ffffff;">1</td>
              <td style="padding-left:12px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">Create a team</strong> — Pick agent roles like Researcher, Writer, Coder</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;height:28px;background:#8b5cf6;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#ffffff;">2</td>
              <td style="padding-left:12px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">Set a goal</strong> — Tell your team what to accomplish</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;height:28px;background:#a78bfa;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#ffffff;">3</td>
              <td style="padding-left:12px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">Run & watch</strong> — See your agents collaborate in real-time</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${button(dashboardUrl, 'Go to Dashboard')}
    ${divider()}
    ${isFree ? paragraph('Want more power? <a href="' + pricingUrl + '" style="color:#6366f1;font-weight:600;text-decoration:none;">Upgrade to Pro</a> for all models and 500 runs/month.') : ''}
    ${paragraph("Need help? Just reply to this email — we're happy to assist.")}
  `);
}

export function welcomeEmailText(data: WelcomeEmailData): string {
  const { name, plan } = data;
  const isFree = plan === 'FREE';
  return [
    `Hi ${name},`,
    '',
    'Your AgentFlow account is ready!',
    '',
    `Plan: ${plan}`,
    '',
    'Get started:',
    '1. Create a team — pick agent roles (Researcher, Writer, Coder)',
    '2. Set a goal — tell your team what to accomplish',
    '3. Run & watch — see your agents collaborate in real-time',
    '',
    isFree ? 'Want more? Upgrade to Pro for all models and 500 runs/month.' : '',
    "Need help? Reply to this email — we're happy to assist.",
    '',
    '— The AgentFlow Team',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Invoice / Payment Confirmation Email ───

export interface InvoiceEmailData {
  name: string;
  plan: string;
  amount: string;
  currency: string;
  invoiceDate: string;
  nextBillingDate: string;
  invoiceId: string;
}

export function invoiceEmailHtml(data: InvoiceEmailData): string {
  const { name, plan, amount, currency, invoiceDate, nextBillingDate, invoiceId } = data;
  const currencySymbol =
    currency.toUpperCase() === 'INR'
      ? '₹'
      : currency.toUpperCase() === 'USD'
        ? '$'
        : currency.toUpperCase();
  const dashboardUrl = 'APP_URL_PLACEHOLDER/billing';

  return baseLayout(`
    ${greeting(name)}
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Payment Confirmed ✓</h2>
    ${paragraph("Thank you for your payment! Here's your receipt:")}

    <!-- Invoice card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:24px 0;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Invoice</td>
              <td align="right" style="font-size:13px;color:#111827;font-weight:600;">#${invoiceId.slice(0, 8).toUpperCase()}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">Plan</td>
              <td align="right" style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">AgentFlow ${plan}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">Date</td>
              <td align="right" style="padding:6px 0;font-size:13px;color:#111827;">${invoiceDate}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#6b7280;">Next billing</td>
              <td align="right" style="padding:6px 0;font-size:13px;color:#111827;">${nextBillingDate}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f3f0ff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:14px;font-weight:700;color:#111827;">Total Paid</td>
              <td align="right" style="font-size:20px;font-weight:700;color:#6366f1;">${currencySymbol}${amount}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${button(dashboardUrl, 'View Billing Dashboard')}
    ${divider()}
    ${paragraph('If you have any questions about this charge, reply to this email or contact our support.')}
  `);
}

export function invoiceEmailText(data: InvoiceEmailData): string {
  const { name, plan, amount, currency, invoiceDate, nextBillingDate, invoiceId } = data;
  return [
    `Hi ${name},`,
    '',
    "Payment confirmed! Here's your receipt:",
    '',
    `Invoice: #${invoiceId.slice(0, 8).toUpperCase()}`,
    `Plan: AgentFlow ${plan}`,
    `Amount: ${currency.toUpperCase()} ${amount}`,
    `Date: ${invoiceDate}`,
    `Next billing: ${nextBillingDate}`,
    '',
    'If you have any questions, reply to this email.',
    '',
    '— The AgentFlow Team',
  ].join('\n');
}
