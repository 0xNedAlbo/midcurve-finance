import { handlers } from '@/lib/auth';

// Force dynamic rendering - don't try to statically analyze during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
