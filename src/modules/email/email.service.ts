import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
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

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private readonly fromEmail: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'onboarding@resend.dev';
    this.appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  onModuleInit(): void {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log(
        { from: this.fromEmail },
        'Resend email client initialized',
      );
    } else {
      this.logger.warn(
        'RESEND_API_KEY not configured — emails will be logged instead of sent',
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
    if (!this.resend) {
      this.logger.debug(
        { to: params.to, subject: params.subject },
        'DEV MODE — email not sent (no RESEND_API_KEY)',
      );
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `AgentFlow <${this.fromEmail}>`,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });

      if (error) {
        this.logger.error(
          {
            to: params.to,
            subject: params.subject,
            error: error.message,
            name: error.name,
          },
          'Resend API error',
        );
        throw new InternalServerErrorException(
          'Unable to send email. Please try again later.',
        );
      }

      this.logger.log(
        { to: params.to, subject: params.subject, id: data?.id },
        'Email sent via Resend',
      );
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { to: params.to, subject: params.subject, error: message },
        'Resend API call failed',
      );
      throw new InternalServerErrorException(
        'Unable to send email. Please try again later.',
      );
    }
  }
}
