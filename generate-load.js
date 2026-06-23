const http = require('http');

const WEBHOOK_URL = 'http://localhost:3000/api/webhooks/github';

async function sendWebhook(prNumber) {
  const payload = JSON.stringify({
    action: "opened",
    number: prNumber,
    pull_request: {
      id: prNumber,
      title: `Test PR - Load Generation ${prNumber}`,
      html_url: `https://github.com/owner/repo/pull/${prNumber}`,
      head: { sha: `abc123def456_${prNumber}` },
      base: { sha: `xyz789uvw012_${prNumber}` },
      diff_url: `https://github.com/owner/repo/pull/${prNumber}.diff`
    },
    repository: {
      id: 999,
      name: "test-repo",
      full_name: "testuser/test-repo",
      owner: { login: "testuser", id: 555 }
    },
    sender: {
      id: 777,
      login: "testuser",
      avatar_url: "https://avatars.githubusercontent.com/u/777"
    }
  });

  return new Promise((resolve, reject) => {
    const req = http.request(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('==============================================');
  console.log('🚀 Starting Data Generation for SteveGuard...');
  console.log('==============================================\n');
  console.log('This script simulates real GitHub Webhook traffic.');
  console.log('It will create:');
  console.log(' 📈 Metrics in Prometheus (and Grafana)');
  console.log(' 🕵️ Traces in Jaeger');
  console.log(' 📬 Messages in Kafka');
  console.log(' ⚡ Cache entries in Redis\n');
  
  const numRequests = 5;
  for (let i = 1; i <= numRequests; i++) {
    const prNumber = Math.floor(Math.random() * 10000);
    console.log(`[${i}/${numRequests}] Sending webhook for simulated PR #${prNumber}...`);
    try {
      const result = await sendWebhook(prNumber);
      console.log(`  -> Status: ${result.status} | Body: ${result.data}`);
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
    }
    
    // Wait between 500ms and 1500ms to simulate scattered traffic
    const delay = Math.floor(Math.random() * 1000) + 500;
    await new Promise(r => setTimeout(r, delay));
  }
  
  console.log('\n✅ Data generation complete!');
  console.log('Now you can verify the data across all services:');
  console.log('----------------------------------------------');
  console.log('1. Jaeger UI   -> http://localhost:16686  (Select "steveguard" and find traces)');
  console.log('2. Grafana     -> http://localhost:3001   (Check the dashboard for API traffic/latency)');
  console.log('3. Kafka UI    -> http://localhost:8080   (Check "pr.review.requested" topic)');
  console.log('4. Prometheus  -> http://localhost:9090   (Query "http_request_duration_seconds_count")');
}

run();
