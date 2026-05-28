/* eslint-disable no-console -- CLI wait script */
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

const isLocalEndpoint =
  ENDPOINT.includes('localhost') ||
  ENDPOINT.includes('127.0.0.1') ||
  ENDPOINT.includes('dynamodb:');

const MAX_RETRIES = 30;
const BASE_DELAY_MS = 2_000;

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: isLocalEndpoint
    ? { accessKeyId: 'local', secretAccessKey: 'local' }
    : {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
      },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDynamoDB(): Promise<void> {
  console.log(`\nWaiting for DynamoDB at ${ENDPOINT} ...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.send(new ListTablesCommand({}));
      console.log(`DynamoDB is ready! (attempt ${attempt}/${MAX_RETRIES})\n`);
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

  console.error(`\nDynamoDB did not become ready after ${MAX_RETRIES} attempts. Aborting.\n`);
  process.exit(1);
}

void waitForDynamoDB();
