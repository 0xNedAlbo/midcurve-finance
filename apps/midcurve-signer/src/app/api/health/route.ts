import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'midcurve-signer',
    timestamp: new Date().toISOString(),
  });
}
