import { execSync } from 'child_process';
import path from 'path';

import axios from 'axios';

import {
  DATA_DIR,
  SIGNAL_API_URL,
  SIGNAL_CONTAINER_NAME,
  SIGNAL_IMAGE,
} from './config.js';
import { logger } from './logger.js';

const HEALTH_POLL_INTERVAL = 2000;
const HEALTH_TIMEOUT = 180000; // 3 minutes for cold starts

type ContainerState = 'running' | 'stopped' | 'none';

function getContainerState(): ContainerState {
  try {
    const output = execSync(
      `docker inspect --format={{.State.Running}} ${SIGNAL_CONTAINER_NAME}`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    ).trim();
    return output === 'true' ? 'running' : 'stopped';
  } catch {
    return 'none';
  }
}

function parsePort(url: string): number {
  try {
    const parsed = new URL(url);
    return parseInt(parsed.port, 10) || 8080;
  } catch {
    return 8080;
  }
}

async function waitForHealth(): Promise<boolean> {
  const healthUrl = `${SIGNAL_API_URL}/v1/health`;
  const deadline = Date.now() + HEALTH_TIMEOUT;

  while (Date.now() < deadline) {
    try {
      const res = await axios.get(healthUrl, { timeout: 5000 });
      if (res.status >= 200 && res.status < 300) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL));
  }

  return false;
}

/**
 * Ensure the Signal API container is running and healthy.
 * Creates, starts, or waits for the container as needed.
 * Returns true if the container is healthy, false if it timed out.
 */
export async function ensureSignalContainer(): Promise<boolean> {
  const state = getContainerState();
  const port = parsePort(SIGNAL_API_URL);
  const signalDataDir = path.resolve(DATA_DIR, 'signal-cli');

  if (state === 'none') {
    logger.info('Signal API container not found, creating...');
    try {
      execSync(
        [
          'docker run -d',
          `--name ${SIGNAL_CONTAINER_NAME}`,
          '--restart unless-stopped',
          `-p ${port}:8080`,
          `-v ${signalDataDir}:/home/.local/share/signal-cli`,
          '-e MODE=json-rpc',
          '--health-cmd "curl -sf http://localhost:8080/v1/health || exit 1"',
          '--health-interval 30s',
          '--health-timeout 10s',
          '--health-retries 3',
          '--health-start-period 40s',
          SIGNAL_IMAGE,
        ].join(' '),
        { stdio: 'pipe' },
      );
      logger.info('Signal API container created');
    } catch (err) {
      logger.error({ err }, 'Failed to create Signal API container');
      return false;
    }
  } else if (state === 'stopped') {
    logger.info('Signal API container stopped, starting...');
    try {
      execSync(`docker start ${SIGNAL_CONTAINER_NAME}`, { stdio: 'pipe' });
      logger.info('Signal API container started');
    } catch (err) {
      logger.error({ err }, 'Failed to start Signal API container');
      return false;
    }
  } else {
    logger.info('Signal API container already running');
  }

  logger.info('Waiting for Signal API to become healthy...');
  const healthy = await waitForHealth();

  if (healthy) {
    logger.info('Signal API is healthy');
  } else {
    logger.error(
      `Signal API did not become healthy within ${HEALTH_TIMEOUT / 1000}s`,
    );
  }

  return healthy;
}
