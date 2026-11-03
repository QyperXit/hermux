// The parts of `web-push` the server uses. The package ships no types, and a
// second dependency just for them isn't worth it.
declare module "web-push" {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
      TTL: number;
      urgency: "very-low" | "low" | "normal" | "high";
      timeout: number;
    },
  ): Promise<{ statusCode: number }>;
}
