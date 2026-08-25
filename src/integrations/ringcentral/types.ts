export type SmsCapability = "SmsSender" | "A2PSmsSender" | "none" | "unknown";

export type RingCentralToken = {
  accessToken: string;
  expiresAtMs: number;
  tokenType: string;
  ownerId: string | null;
  scope: string | null;
};

export type RingCentralPhoneNumber = {
  id: string | null;
  phoneNumber: string;
  usageType: string | null;
  features: string[];
};

export type RingCentralExtensionInfo = {
  id: string;
  extensionNumber: string | null;
  name: string | null;
  type: string | null;
};

export type SendSmsInput = {
  from: string;
  to: string;
  text: string;
};

export type SendSmsResult = {
  providerMessageId: string;
  deliveryState: "queued" | "sent" | "failed";
  rawRedacted: Record<string, unknown>;
};

export type MessageStoreRecord = {
  id: string;
  type: string | null;
  direction: "Inbound" | "Outbound" | string;
  subject: string | null;
  from?: { phoneNumber?: string } | null;
  to?: Array<{ phoneNumber?: string }> | null;
  creationTime: string | null;
  lastModifiedTime: string | null;
  messageStatus: string | null;
  attachments?: Array<{ id?: string; type?: string; contentType?: string }> | null;
};

export type SubscriptionRecord = {
  id: string;
  status: string;
  expiresAt: string | null;
  eventFilters: string[];
  deliveryMode: {
    transportType: string;
    address?: string;
    verificationToken?: string;
  };
};

export class RingCentralSetupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RingCentralSetupError";
    this.code = code;
  }
}
