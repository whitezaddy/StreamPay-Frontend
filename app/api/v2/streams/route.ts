import { NextRequest, NextResponse } from "next/server";
import { ErrorCode } from "@/app/lib/errors";
import { toV2Stream, type StreamV1 } from "@/app/lib/api-version";
import { validateCreateStreamBody } from "@/app/lib/stream-validation";
import { 
  getStore, 
  decodeCursor, 
  encodeCursor, 
  idempotencyToken 
} from "@/app/lib/db";
import crypto from "crypto";

const IDEMPOTENCY_TTL_MS = 86_400_000; // 24 hours

interface IdempotencyEntry {
  body: string;
  response: unknown;
  expiresAt: number;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/v2/streams — paginated stream list in v2 shape. */
export async function GET(request: Request) {
  const { streamRepository } = getStore();
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  let streamsList = Array.from(streamRepository.streams.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  if (status) {
    streamsList = streamsList.filter((s) => s.status === status);
  }

  let idx = -1;
  if (cursor) {
    try {
      const cursorId = decodeCursor(cursor);
      idx = streamsList.findIndex((s) => s.id === cursorId);
      if (idx >= 0) {
        streamsList = streamsList.slice(idx + 1);
      }
    } catch {
      return errorResponse("INVALID_CURSOR", "Malformed cursor", 422);
    }
  }

  try {
    const paginatedStreams = streamsList.slice(0, limit);
    const mappedV2Streams = paginatedStreams.map((s) => toV2Stream(s as unknown as StreamV1));
    
    const hasNext = streamsList.length > limit;
    const nextCursor =
      hasNext && mappedV2Streams.length > 0
        ? encodeCursor(paginatedStreams[mappedV2Streams.length - 1].id)
        : null;

    return NextResponse.json({ 
      data: mappedV2Streams,
      meta: { hasNext, nextCursor, total: streamsList.length }
    }, { status: 200 });
  } catch {
    return errorResponse(
      ErrorCode.INTERNAL_SERVER_ERROR,
      "Failed to retrieve streams.",
      500,
    );
  }
}

/** POST /api/v2/streams — Create a payment stream with Idempotency protections. */
export async function POST(request: Request) {
  const { idempotencyStore, streamRepository } = getStore();
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const token = idempotencyKey
    ? idempotencyToken("v2.streams.create", idempotencyKey)
    : null;

  let body: Record<string, unknown>;
  let bodyText: string;
  try {
    bodyText = await request.text();
    body = JSON.parse(bodyText);
  } catch {
    return errorResponse("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }

  if (token) {
    const existing = idempotencyStore.get(token) as IdempotencyEntry | undefined;
    if (existing) {
      if (Date.now() > existing.expiresAt) {
        idempotencyStore.delete(token);
      } else if (existing.body === bodyText) {
        return NextResponse.json(existing.response, { status: 201 });
      } else {
        return errorResponse(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key already used for a different request body.",
          409,
        );
      }
    }
  }

  const { recipient, rate, schedule } = body as {
    recipient?: string;
    rate?: string;
    schedule?: string;
  };

  if (!recipient || !rate || !schedule) {
    return errorResponse(
      ErrorCode.STREAM_CREATE_FAILED,
      "Failed to create stream. Missing required body fields.",
      422,
    );
  }

  const id = `stream-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  
  const newStream = {
    id,
    recipient: String(recipient),
    rate: String(rate),
    schedule: String(schedule),
    status: "draft" as const,
    nextAction: "start" as const,
    createdAt: now,
    updatedAt: now,
    token: "XLM",
  };

  streamRepository.streams.set(id, newStream);

  const payload = {
    data: toV2Stream(newStream as unknown as StreamV1),
    links: { self: `/api/v2/streams/${id}` },
  };

  if (token) {
    idempotencyStore.set(token, {
      body: bodyText,
      response: payload,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  return NextResponse.json(payload, { status: 201 });
}