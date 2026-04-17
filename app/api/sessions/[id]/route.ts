// app/api/sessions/[id]/route.ts
// Session metadata endpoint for debugging and reconnect logic.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionResponse {
  exists: boolean;
  metadata?: {
    id: string;
    createdAt: string;
    closed: boolean;
    eventCount: number;
    lastEventAt: string | null;
    ageMs: number;
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<SessionResponse>> {
  const { id } = await params;
  
  const session = await getSession(id);
  
  if (!session) {
    return NextResponse.json(
      { exists: false },
      { status: 404 }
    );
  }

  return NextResponse.json({
    exists: true,
    metadata: {
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      closed: session.closed,
      eventCount: session.eventCount,
      lastEventAt: session.lastEventAt
        ? new Date(session.lastEventAt).toISOString()
        : null,
      ageMs: Date.now() - session.createdAt,
    },
  });
}
