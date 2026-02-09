/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Displays QR code, waits for scan, saves credentials, then exits.
 *
 * Usage:
 *   npx tsx src/whatsapp-auth.ts              # QR code mode
 *   npx tsx src/whatsapp-auth.ts 18145551234  # Pairing code mode
 */
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const AUTH_DIR = './store/auth';

const logger = pino({
  level: 'warn',
});

async function authenticate(): Promise<void> {
  // Clean slate for pairing code to avoid stale creds
  const phoneNumber = process.argv[2];
  if (phoneNumber) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.registered) {
    console.log('✓ Already authenticated with WhatsApp');
    console.log(
      '  To re-authenticate, delete the store/auth folder and run again.',
    );
    process.exit(0);
  }

  const usePairingCode = !!phoneNumber;

  if (usePairingCode) {
    console.log(`Using pairing code method for ${phoneNumber}\n`);
  } else {
    console.log('Starting WhatsApp authentication (QR code mode)...\n');
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: usePairingCode ? ['Chrome (Linux)', '', ''] : ['NanoClaw', 'Chrome', '1.0.0'],
  });

  // For pairing code: wait for socket to be ready, then request code
  if (usePairingCode) {
    // Need to wait for the WebSocket to connect before requesting pairing code
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log('════════════════════════════════════');
      console.log(`  Your pairing code:  ${code}`);
      console.log('════════════════════════════════════');
      console.log('\nEnter this code on your phone:');
      console.log('  1. Open WhatsApp');
      console.log('  2. Tap Settings → Linked Devices → Link a Device');
      console.log('  3. Tap "Link with phone number instead"');
      console.log(`  4. Enter the code: ${code}\n`);
      console.log('Waiting for you to enter the code...\n');
    } catch (err: any) {
      console.error('Failed to get pairing code:', err.message);
      console.log('Falling back to QR code mode...\n');
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode) {
      const qrImagePath = path.join(process.cwd(), 'whatsapp-qr.png');
      QRCode.toFile(qrImagePath, qr, { width: 800, margin: 4 }, (err) => {
        if (err) {
          console.error('Failed to save QR code image:', err);
        } else {
          // Auto-open the image
          import('child_process').then(({ execSync }) => {
            try { execSync(`open "${qrImagePath}"`); } catch {}
          });
        }
      });

      console.log('QR code saved and opened as whatsapp-qr.png');
      console.log('Scan it with WhatsApp:');
      console.log('  1. Open WhatsApp on your phone');
      console.log('  2. Tap Settings → Linked Devices → Link a Device');
      console.log('  3. Scan the QR code from the image\n');
      console.log('Waiting for scan...\n');
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log('\n✗ Logged out. Delete store/auth and try again.');
        process.exit(1);
      } else if (reason === 515) {
        console.log('Rate limited by WhatsApp. Retrying in 30 seconds...');
        setTimeout(() => authenticate(), 30000);
      } else {
        console.log('\n✗ Connection failed. Please try again.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('\n✓ Successfully authenticated with WhatsApp!');
      console.log('  Credentials saved to store/auth/');
      console.log('  You can now start the NanoClaw service.\n');

      setTimeout(() => process.exit(0), 1000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
