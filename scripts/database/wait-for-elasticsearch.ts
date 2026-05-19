/* eslint-disable no-console -- CLI wait script */
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const NODE = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';

const MAX_RETRIES = 30;
const BASE_DELAY_MS = 2_000;

const client = new Client({
  node: NODE,
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME || '',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElasticsearch(): Promise<void> {
  console.log(`\nWaiting for Elasticsearch at ${NODE} ...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.ping();
      console.log(`Elasticsearch is ready! (attempt ${attempt}/${MAX_RETRIES})\n`);
      process.exit(0);
    } catch (err) {
      const delay = Math.min(BASE_DELAY_MS * attempt, 10_000);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [${attempt}/${MAX_RETRIES}] Not ready (${msg}) — retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
    }
  }

  console.error(`\nElasticsearch did not become ready after ${MAX_RETRIES} attempts. Aborting.\n`);
  process.exit(1);
}

void waitForElasticsearch();
