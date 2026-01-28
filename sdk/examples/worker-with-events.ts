/**
 * Example: Worker with completed events
 * Shows how to receive the result in the completed event
 */

import { Worker } from '../src/worker';
import { FlashQ } from '../src/client';

const QUEUE = 'example-queue';

// Define job data type
interface EmailJob {
  to: string;
  subject: string;
  body: string;
}

// Define result type
interface EmailResult {
  success: boolean;
  messageId: string;
  sentAt: string;
}

async function main() {
  // Create client to push jobs
  const client = new FlashQ({ debug: true });
  await client.connect();

  // Create worker with typed data and result
  const worker = new Worker<EmailJob, EmailResult>(
    QUEUE,
    async (job) => {
      console.log(`\n[Worker] Processing job ${job.id}:`, job.data);

      // Simulate email sending
      await new Promise((r) => setTimeout(r, 100));

      // Return result - THIS will be in the completed event
      return {
        success: true,
        messageId: `msg-${job.id}-${Date.now()}`,
        sentAt: new Date().toISOString(),
      };
    },
    {
      concurrency: 2,
      debug: true,
    }
  );

  // Listen to completed events - result is available here!
  worker.on('completed', (job, result, workerId) => {
    console.log('\n=== COMPLETED EVENT ===');
    console.log('  Job ID:', job.id);
    console.log('  Job Data:', job.data);
    console.log('  Result:', result);  // <-- THE RESULT IS HERE
    console.log('  Worker ID:', workerId);
    console.log('========================\n');
  });

  worker.on('failed', (job, error, workerId) => {
    console.log(`\n[Failed] Job ${job.id} failed:`, error.message);
  });

  worker.on('ready', () => {
    console.log('[Worker] Ready to process jobs');
  });

  // Push some test jobs
  console.log('[Main] Pushing test jobs...');
  for (let i = 0; i < 3; i++) {
    const job = await client.push<EmailJob>(QUEUE, {
      to: `user${i}@example.com`,
      subject: `Test email ${i}`,
      body: `Hello from job ${i}!`,
    });
    console.log(`[Main] Pushed job ${job.id}`);
  }

  // Wait for processing
  await new Promise((r) => setTimeout(r, 2000));

  // Cleanup
  await worker.close();
  await client.close();
  console.log('[Main] Done!');
}

main().catch(console.error);
