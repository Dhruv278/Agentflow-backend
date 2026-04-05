import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  verificationEmailHtml,
  verificationEmailText,
  passwordResetEmailHtml,
  passwordResetEmailText,
  welcomeEmailHtml,
  welcomeEmailText,
  invoiceEmailHtml,
  invoiceEmailText,
  type InvoiceEmailData,
  type WelcomeEmailData,
} from './email-templates.js';

interface BrevoSendPayload {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent: string;
}

interface BrevoSuccessResponse {
  messageId: string;
}

interface BrevoErrorResponse {
  code: string;
  message: string;
}

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private apiKey: string | null = null;
  private readonly senderName: string;
  private readonly senderEmail: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.senderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ?? 'AgentFlow';
    this.senderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ?? '';
    this.appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  onModuleInit(): void {
    this.apiKey =
      this.configService.get<string>('BREVO_API_KEY') ?? null;

    if (this.apiKey) {
      this.logger.log(
        { from: `${this.senderName} <${this.senderEmail}>` },
        'Brevo email client initialized',
      );
    } else {
      this.logger.warn(
        'BREVO_API_KEY not configured — emails will be logged instead of sent',
      );
    }
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<void> {
    const url = `${this.appUrl}/set-password?token=${rawToken}`;
    await this.send({
      to,
      subject: 'Verify your email — AgentFlow',
      text: verificationEmailText(name, url),
      html: verificationEmailHtml(name, url),
    });
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<void> {
    const url = `${this.appUrl}/reset-password?token=${rawToken}`;
    await this.send({
      to,
      subject: 'Reset your password — AgentFlow',
      text: passwordResetEmailText(name, url),
      html: passwordResetEmailHtml(name, url),
    });
  }

  async sendWelcomeEmail(
    to: string,
    name: string,
    plan: string,
  ): Promise<void> {
    const data: WelcomeEmailData = {
      name,
      plan,
      dashboardUrl: `${this.appUrl}/dashboard`,
      pricingUrl: `${this.appUrl}/pricing`,
    };
    await this.send({
      to,
      subject: 'Your account is ready — AgentFlow',
      text: welcomeEmailText(data),
      html: welcomeEmailHtml(data),
    });
  }

  async sendInvoiceEmail(to: string, data: InvoiceEmailData): Promise<void> {
    const html = invoiceEmailHtml(data).replace(
      'APP_URL_PLACEHOLDER',
      this.appUrl,
    );
    await this.send({
      to,
      subject: `Payment receipt — AgentFlow ${data.plan}`,
      text: invoiceEmailText(data),
      html,
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.apiKey) {
      this.logger.debug(
        { to: params.to, subject: params.subject },
        'DEV MODE — email not sent (no BREVO_API_KEY)',
      );
      return;
    }

    const payload: BrevoSendPayload = {
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text,
    };

    try {
      const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const raw = await response.text();
        let code = 'unknown';
        let errorMessage = raw;
        try {
          const parsed = JSON.parse(raw) as BrevoErrorResponse;
          code = parsed.code;
          errorMessage = parsed.message;
        } catch {
          /* response was not JSON — raw text is already captured */
        }
        this.logger.error(
          {
            to: params.to,
            subject: params.subject,
            status: response.status,
            code,
            error: errorMessage,
          },
          'Brevo API error',
        );
        throw new InternalServerErrorException(
          'Unable to send email. Please try again later.',
        );
      }

      const result = (await response.json()) as BrevoSuccessResponse;
      this.logger.log(
        { to: params.to, subject: params.subject, messageId: result.messageId },
        'Email sent via Brevo',
      );
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { to: params.to, subject: params.subject, error: message },
        'Brevo API call failed',
      );
      throw new InternalServerErrorException(
        'Unable to send email. Please try again later.',
      );
    }
  }
}
