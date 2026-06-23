import { NextResponse } from 'next/server';
import { getMetricsEndpoint } from '@/lib/metrics';

/**
 * Prometheus metrics endpoint
 * 
 * Usage: GET /api/metrics
 * 
 * Returns metrics in Prometheus text format
 * 
 * Configure Prometheus to scrape this endpoint every 15 seconds
 */
export async function GET() {
  try {
    const metrics = await getMetricsEndpoint();
    return new NextResponse(metrics, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    return new NextResponse('Error generating metrics', { status: 500 });
  }
}
