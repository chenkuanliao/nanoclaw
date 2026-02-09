import axios, { AxiosInstance } from 'axios';
import { SIGNAL_API_URL } from './config.js';
import { logger } from './logger.js';

export interface SignalMessage {
  envelope: {
    source: string;
    sourceNumber: string;
    sourceName?: string;
    sourceUuid: string;
    timestamp: number;
    dataMessage?: {
      timestamp: number;
      message: string;
      groupInfo?: {
        groupId: string;
        type: string;
      };
    };
  };
  account: string;
}

export interface SignalGroup {
  id: string;
  name: string;
  members: string[];
  blocked: boolean;
  pending_invites: string[];
  pending_requests: string[];
  invite_link: string;
  admins: string[];
}

export class SignalClient {
  private api: AxiosInstance;
  private accountNumber: string;

  constructor(accountNumber: string) {
    this.accountNumber = accountNumber;
    this.api = axios.create({
      baseURL: SIGNAL_API_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Register a new phone number with Signal
   */
  async register(captcha?: string): Promise<void> {
    try {
      const response = await this.api.post(`/v1/register/${this.accountNumber}`, {
        use_voice: false,
        captcha,
      });
      logger.info({ account: this.accountNumber }, 'Signal registration initiated');
      return response.data;
    } catch (error) {
      logger.error({ error, account: this.accountNumber }, 'Failed to register Signal account');
      throw error;
    }
  }

  /**
   * Verify registration with SMS code
   */
  async verify(code: string): Promise<void> {
    try {
      const response = await this.api.post(`/v1/register/${this.accountNumber}/verify/${code}`);
      logger.info({ account: this.accountNumber }, 'Signal account verified');
      return response.data;
    } catch (error) {
      logger.error({ error, account: this.accountNumber }, 'Failed to verify Signal account');
      throw error;
    }
  }

  /**
   * Send a message to a recipient (individual or group)
   */
  async sendMessage(
    recipient: string,
    message: string,
    isGroup: boolean = false,
  ): Promise<void> {
    try {
      const payload: any = {
        message,
        number: this.accountNumber,
        recipients: [recipient],
      };

      if (isGroup) {
        payload.group_id = recipient;
        delete payload.recipients;
      }

      await this.api.post(`/v2/send`, payload);
      logger.debug(
        { recipient, isGroup, messageLength: message.length },
        'Signal message sent',
      );
    } catch (error) {
      logger.error({ error, recipient }, 'Failed to send Signal message');
      throw error;
    }
  }

  /**
   * Receive messages (polling)
   */
  async receiveMessages(timeout: number = 1): Promise<SignalMessage[]> {
    try {
      const response = await this.api.get(`/v1/receive/${this.accountNumber}`, {
        params: { timeout },
      });
      return response.data || [];
    } catch (error) {
      // Timeout is expected for long-polling
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        return [];
      }
      logger.error({ error }, 'Failed to receive Signal messages');
      throw error;
    }
  }

  /**
   * Get list of groups
   */
  async getGroups(): Promise<SignalGroup[]> {
    try {
      const response = await this.api.get(`/v1/groups/${this.accountNumber}`);
      return response.data || [];
    } catch (error) {
      logger.error({ error }, 'Failed to get Signal groups');
      throw error;
    }
  }

  /**
   * Set typing indicator
   */
  async setTyping(recipient: string, isTyping: boolean): Promise<void> {
    try {
      await this.api.put(`/v1/typing-indicator/${this.accountNumber}`, {
        recipient,
        typing: isTyping,
      });
    } catch (error) {
      logger.debug({ error, recipient }, 'Failed to set typing indicator');
      // Don't throw, typing indicators are non-critical
    }
  }

  /**
   * Check if the API is healthy
   */
  async health(): Promise<boolean> {
    try {
      const response = await this.api.get('/v1/health');
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get account info
   */
  async getAccount(): Promise<any> {
    try {
      const response = await this.api.get(`/v1/accounts/${this.accountNumber}`);
      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to get Signal account info');
      throw error;
    }
  }
}
