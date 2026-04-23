import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendCodeEmail(to: string, code: string): Promise<void> {
  const from = process.env.EMAIL_FROM ?? 'Wardrobe <no-reply@example.com>';
  await resend.emails.send({
    from,
    to,
    subject: `Your wardrobe sign-in code: ${code}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #2a251e;">
        <h1 style="font-size: 20px; letter-spacing: -0.02em; margin: 0 0 24px;">Wardrobe</h1>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Your sign-in code:
        </p>
        <div style="font-family: ui-monospace, monospace; font-size: 34px; letter-spacing: 0.2em; font-weight: 600; color: #2a251e; padding: 18px 0; border-top: 1px solid #e8dcc2; border-bottom: 1px solid #e8dcc2; text-align: center;">
          ${code}
        </div>
        <p style="font-size: 13px; line-height: 1.6; color: #8a8275; margin: 24px 0 0;">
          Expires in 10 minutes. If you didn't request this, ignore it.
        </p>
      </div>
    `,
  });
}
