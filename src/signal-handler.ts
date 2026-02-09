import WebSocket from 'ws';
import { SignalClient, SignalMessage } from './signal-client.js';
import {
  SIGNAL_ENABLED,
  SIGNAL_NUMBER,
  SIGNAL_API_URL,
  TRIGGER_PATTERN,
  MAIN_GROUP_FOLDER,
} from './config.js';
import {
  storeSignalMessage,
  getAllRegisteredGroups,
  storeChatMetadata,
  updateChatName,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';

let signalClient: SignalClient | null = null;
let lastSignalTimestamp = Date.now();
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function initSignalClient(): SignalClient | null {
  if (!SIGNAL_ENABLED || !SIGNAL_NUMBER) {
    logger.info('Signal integration disabled');
    return null;
  }

  signalClient = new SignalClient(SIGNAL_NUMBER);
  logger.info({ number: SIGNAL_NUMBER }, 'Signal client initialized');
  return signalClient;
}

export function getSignalClient(): SignalClient | null {
  return signalClient;
}

/**
 * Start listening for Signal messages via WebSocket (json-rpc mode)
 */
export function startSignalMessageLoop(queue: GroupQueue): void {
  if (!signalClient) {
    logger.warn('Signal client not initialized, cannot start message loop');
    return;
  }

  connectWebSocket(queue);
}

function connectWebSocket(queue: GroupQueue): void {
  if (ws) {
    try { ws.close(); } catch {}
  }

  const wsUrl = SIGNAL_API_URL.replace(/^http/, 'ws') + `/v1/receive/${SIGNAL_NUMBER}`;
  logger.info({ wsUrl }, 'Connecting Signal WebSocket');

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logger.info('Signal WebSocket connected');
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString()) as SignalMessage;
      processSignalMessage(msg, queue);
    } catch (error) {
      logger.error({ error, raw: data.toString().substring(0, 200) }, 'Failed to parse Signal WebSocket message');
    }
  });

  ws.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Signal WebSocket error');
  });

  ws.on('close', (code: number, reason: Buffer) => {
    logger.warn({ code, reason: reason.toString() }, 'Signal WebSocket closed, reconnecting in 5s');
    scheduleReconnect(queue);
  });
}

function scheduleReconnect(queue: GroupQueue): void {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(() => connectWebSocket(queue), 5000);
}

/**
 * Stop Signal message listening
 */
export function stopSignalMessageLoop(): void {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = null;
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  logger.info('Stopped Signal message loop');
}

/**
 * Process a single Signal message
 */
function processSignalMessage(
  msg: SignalMessage,
  queue: GroupQueue,
): void {
  const envelope = msg.envelope;
  const dataMessage = envelope.dataMessage;

  if (!dataMessage || !dataMessage.message) {
    return; // Skip non-text messages
  }

  const timestamp = envelope.timestamp;
  if (timestamp <= lastSignalTimestamp) {
    return; // Skip old messages
  }

  const sender = envelope.sourceNumber || envelope.source;
  const messageText = dataMessage.message;
  const groupInfo = dataMessage.groupInfo;

  // Determine chat ID (group or direct message)
  let chatJid: string;

  if (groupInfo && groupInfo.groupId) {
    chatJid = `signal:${groupInfo.groupId}`;
  } else {
    chatJid = `signal:${sender}`;
  }

  // Store chat metadata
  storeChatMetadata(chatJid, new Date(timestamp).toISOString());

  // Store message in database with Signal prefix
  storeSignalMessage(
    chatJid,
    `signal:${sender}`,
    envelope.sourceName || sender,
    messageText,
    timestamp,
  );

  logger.info(
    { chatJid, sender, messageLength: messageText.length },
    'Signal message received',
  );

  // Update last timestamp
  lastSignalTimestamp = timestamp;

  // Check if this chat is registered and should be processed
  const registeredGroups = getAllRegisteredGroups();
  const group = registeredGroups[chatJid];

  if (!group) {
    logger.info({ chatJid }, 'Signal chat not registered, ignoring');
    return;
  }

  // Check if trigger is required
  const requiresTrigger = group.requiresTrigger !== false;
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Main group doesn't require trigger
  if (!isMainGroup && requiresTrigger) {
    const hasTrigger = TRIGGER_PATTERN.test(messageText);
    if (!hasTrigger) {
      logger.debug(
        { chatJid, message: messageText.substring(0, 50) },
        'Message ignored (no trigger)',
      );
      return;
    }
  }

  // Add to processing queue
  queue.enqueueMessageCheck(chatJid);
  logger.info({ chatJid }, 'Signal message queued for processing');
}

/**
 * Send a Signal message
 */
export async function sendSignalMessage(
  recipient: string,
  message: string,
): Promise<void> {
  if (!signalClient) {
    throw new Error('Signal client not initialized');
  }

  // Strip "signal:" prefix if present
  const actualRecipient = recipient.startsWith('signal:')
    ? recipient.substring(7)
    : recipient;

  // Determine if this is a group by checking if it looks like a group ID
  const isGroup = actualRecipient.length > 20;

  try {
    await signalClient.sendMessage(actualRecipient, message, isGroup);
    logger.debug({ recipient: actualRecipient, isGroup }, 'Signal message sent');
  } catch (error) {
    logger.error({ error, recipient: actualRecipient }, 'Failed to send Signal message');
    throw error;
  }
}

/**
 * Set typing indicator for Signal
 */
export async function setSignalTyping(
  recipient: string,
  isTyping: boolean,
): Promise<void> {
  if (!signalClient) return;

  const actualRecipient = recipient.startsWith('signal:')
    ? recipient.substring(7)
    : recipient;

  try {
    await signalClient.setTyping(actualRecipient, isTyping);
  } catch (error) {
    logger.debug({ error, recipient: actualRecipient }, 'Failed to set Signal typing indicator');
  }
}

/**
 * Sync Signal group metadata
 */
export async function syncSignalGroups(): Promise<void> {
  if (!signalClient) {
    logger.warn('Signal client not initialized, cannot sync groups');
    return;
  }

  try {
    logger.info('Syncing Signal group metadata...');
    const groups = await signalClient.getGroups();

    let count = 0;
    for (const group of groups) {
      const chatJid = `signal:${group.id}`;
      updateChatName(chatJid, group.name);
      count++;
    }

    logger.info({ count }, 'Signal group metadata synced');
  } catch (error) {
    logger.error({ error }, 'Failed to sync Signal groups');
  }
}

/**
 * Check Signal API health
 */
export async function checkSignalHealth(): Promise<boolean> {
  if (!signalClient) return false;

  try {
    return await signalClient.health();
  } catch (error) {
    logger.error({ error }, 'Signal health check failed');
    return false;
  }
}
