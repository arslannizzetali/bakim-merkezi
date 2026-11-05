import { env } from "../config/index.js";
import type { DemoRequestInput } from "@bakimevi/validation";

export class NotificationService {
  async sendDemoRequestNotification(request: DemoRequestInput): Promise<void> {
    const subject = `Yeni demo talebi: ${request.institutionName}`;
    const body = [
      `Kurum: ${request.institutionName}`,
      `Yetkili: ${request.contactName}`,
      `Telefon: ${request.phone}`,
      `E-posta: ${request.email}`,
      request.message ? `Mesaj: ${request.message}` : undefined
    ]
      .filter(Boolean)
      .join("\n");

    if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
      // Contact details are personal data, so only the subject is logged.
      console.log(`[demo-request] RESEND_API_KEY or NOTIFY_EMAIL not set, e-mail not sent: ${subject}`);
      return;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: env.NOTIFY_EMAIL,
          subject,
          text: body
        })
      });

      if (!response.ok) {
        console.error(`[demo-request] Resend API hatası: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.error("[demo-request] E-posta gönderilemedi", error);
    }
  }
}

export const notificationService = new NotificationService();
