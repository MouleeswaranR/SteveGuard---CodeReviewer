import { initializeTracing, traceAsync } from './lib/tracing.js';

process.env.ENABLE_TRACING = 'true';
process.env.JAEGER_AGENT_HOST = 'localhost';
process.env.JAEGER_AGENT_PORT = '6831';

initializeTracing();

async function runTest() {
  await traceAsync('test-operation', async (span) => {
    console.log('Running test operation within trace span...');
    await new Promise(resolve => setTimeout(resolve, 500));
    span.setAttribute('test.attribute', 'hello');
  });
  console.log('Trace complete.');
  // Wait a bit for exporter to flush
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}

runTest();
