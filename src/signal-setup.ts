#!/usr/bin/env tsx
/**
 * Signal Setup Script
 *
 * This script helps you register a phone number with Signal for bot usage.
 * Run with: npm run signal-setup
 */

import * as readline from 'readline';
import { SignalClient } from './signal-client.js';
import { logger } from './logger.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n=== Signal Bot Registration ===\n');
  console.log('This script will help you register a phone number with Signal.');
  console.log('You will need:');
  console.log('  1. A phone number that can receive SMS');
  console.log('  2. Access to that phone to receive the verification code\n');

  // Get phone number
  const phoneNumber = await question('Enter your phone number (international format, e.g., +1234567890): ');

  if (!phoneNumber.startsWith('+')) {
    console.error('Error: Phone number must start with + and include country code');
    rl.close();
    process.exit(1);
  }

  const client = new SignalClient(phoneNumber);

  // Check if Signal API is running
  console.log('\nChecking Signal API connection...');
  const isHealthy = await client.health();

  if (!isHealthy) {
    console.log('Signal API not running, starting container...');
    const { ensureSignalContainer } = await import('./signal-container.js');
    const started = await ensureSignalContainer();
    if (!started) {
      console.error('\n❌ Failed to start Signal API container.');
      rl.close();
      process.exit(1);
    }
  }

  console.log('✅ Signal API is running\n');

  // Check if already registered
  try {
    const account = await client.getAccount();
    console.log('✅ This number is already registered with Signal!');
    console.log(`Account: ${JSON.stringify(account, null, 2)}`);
    console.log('\nYou can now use this number in your .env file:');
    console.log(`SIGNAL_ENABLED=true`);
    console.log(`SIGNAL_NUMBER=${phoneNumber}\n`);
    rl.close();
    return;
  } catch (error) {
    // Not registered yet, continue with registration
  }

  console.log('Initiating registration...');
  console.log('You will receive an SMS with a verification code.\n');

  try {
    await client.register();
    console.log('✅ Registration request sent! Check your phone for an SMS.\n');
  } catch (error: any) {
    if (error.response?.status === 402) {
      console.error('\n❌ Captcha required!');
      console.error('Signal requires a captcha for registration.');
      console.error('Please visit: https://signalcaptchas.org/registration/generate.html');
      console.error('Complete the captcha and copy the token.\n');

      const captcha = await question('Enter the captcha token: ');

      try {
        await client.register(captcha);
        console.log('✅ Registration request sent with captcha! Check your phone for an SMS.\n');
      } catch (retryError) {
        console.error('❌ Registration failed:', retryError);
        rl.close();
        process.exit(1);
      }
    } else {
      console.error('❌ Registration failed:', error.message);
      rl.close();
      process.exit(1);
    }
  }

  // Get verification code
  const code = await question('Enter the 6-digit verification code from SMS: ');

  if (!/^\d{3}-?\d{3}$/.test(code)) {
    console.error('Error: Invalid code format. Should be 6 digits (e.g., 123456 or 123-456)');
    rl.close();
    process.exit(1);
  }

  console.log('\nVerifying...');

  try {
    await client.verify(code.replace('-', ''));
    console.log('\n✅ SUCCESS! Your number is now registered with Signal.\n');
    console.log('Add these to your .env file:');
    console.log(`SIGNAL_ENABLED=true`);
    console.log(`SIGNAL_NUMBER=${phoneNumber}\n`);
    console.log('Then restart the application to start receiving Signal messages.');
  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    console.error('\nPlease try again or check the verification code.');
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
