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
  to: { email: string }[];
  subject: string;
  htmlContent: string;
  textContent: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private apiKey: string | null = null;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.senderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ??
      this.configService.get<string>('SMTP_USER') ??
      'noreply@agentflow.app';
    this.senderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ?? 'AgentFlow';
    this.appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  onModuleInit(): void {
    this.apiKey = this.configService.get<string>('BREVO_API_KEY') ?? null;

    if (this.apiKey) {
      this.logger.log(
        { sender: this.senderEmail },
        'Brevo HTTP email API initialized',
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
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        this.logger.error(
          {
            to: params.to,
            subject: params.subject,
            status: response.status,
            error: body['message'] ?? response.statusText,
            code: body['code'],
          },
          'Brevo API error',
        );
        throw new InternalServerErrorException(
          'Unable to send email. Please try again later.',
        );
      }

      this.logger.log(
        { to: params.to, subject: params.subject },
        'Email sent successfully via Brevo',
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
